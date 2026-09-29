import {
  ATTENTION_KEYS,
  ATTENTION_RANK,
  LIKELIHOOD_KEYS,
  METRIC_KEYS,
  SIGN_STATES,
  type Attention,
  type Finding,
  type Likelihood,
  type MetricKey,
  type NailAnalysis,
  type Possibility,
  type SignCheck,
  type SignState,
} from "../shared/analysis.js";

/**
 * 프로바이더(Claude / Gemini)와 무관한 공통부.
 * 각 프로바이더 모듈은 이 파일만 참조하고 서로를 참조하지 않는다.
 */

export const SUPPORTED_MEDIA_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
] as const;

export type SupportedMediaType = (typeof SUPPORTED_MEDIA_TYPES)[number];

export type AnalyzeErrorCode =
  | "bad_request"
  | "no_api_key"
  | "rate_limited"
  | "declined"
  | "upstream_error";

export class AnalyzeError extends Error {
  constructor(
    readonly code: AnalyzeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AnalyzeError";
  }
}

export interface AnalyzeInput {
  imageBase64: string;
  mediaType: SupportedMediaType;
  hand: string;
  finger: string;
  note: string;
}

/** 한 프로바이더가 갖춰야 할 모양. */
export interface Provider {
  readonly id: "claude" | "gemini";
  readonly label: string;
  readonly model: string;
  hasCredentials(): boolean;
  analyze(input: AnalyzeInput): Promise<NailAnalysis>;
}

/**
 * 모델이 6개 항목을 모두, 정해진 순서로 돌려주도록 프롬프트에서 지시하지만
 * UI가 순서와 개수에 의존하므로 여기서 한 번 더 보정한다.
 * 프로바이더가 바뀌어도 화면이 받는 모양은 같아야 한다.
 */
export function normalize(analysis: NailAnalysis): NailAnalysis {
  const byKey = new Map<MetricKey, NailAnalysis["metrics"][number]>();
  for (const metric of analysis.metrics) {
    if (!byKey.has(metric.key)) byKey.set(metric.key, metric);
  }

  const metrics = METRIC_KEYS.map(
    (key) =>
      byKey.get(key) ?? {
        key,
        status: "watch" as const,
        confidence: "low" as const,
        observation: "이 사진에서는 해당 항목을 확인하기 어려웠습니다.",
        explanation:
          "손톱 전체가 잘 보이도록 다시 촬영하면 더 자세히 살펴볼 수 있습니다.",
      },
  );

  return tidyStrings({
    ...analysis,
    observationScore: Math.max(
      0,
      Math.min(100, Math.round(analysis.observationScore)),
    ),
    metrics,
    findings: normalizeFindings(analysis.findings),
  });
}

/**
 * 모델은 프롬프트에서 막아도 가끔 문장 사이에 줄표(—, –)를 끼워 넣는다.
 * 화면 문구 규칙에 맞춰 숫자 사이의 줄표는 물결표("2~3주")로, 문장이 끝난 자리는
 * 마침표로, 나머지는 쉼표로 바꾼다.
 * 문장부호만 고칠 뿐 내용은 건드리지 않는다.
 */
export function tidyDashes(text: string): string {
  return text
    .replace(/(\d)\s*[–—]\s*(\d)/g, "$1~$2")
    // "~습니다 — 이어지는 말" 처럼 문장이 끝난 자리라면 마침표로 끊는다.
    .replace(/([다요])\s*[—–]+\s*(?=\S)/g, "$1. ")
    .replace(/\s*[—–]+\s*/g, ", ")
    .replace(/,\s*([,.])/g, "$1")
    .replace(/^,\s*/, "")
    .replace(/,\s*$/, "");
}

function tidyStrings<T>(value: T): T {
  if (typeof value === "string") return tidyDashes(value) as T;
  if (Array.isArray(value)) return value.map((item) => tidyStrings(item)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, tidyStrings(item)]),
    ) as T;
  }
  return value;
}

const MAX_FINDINGS = 4;

/**
 * findings 는 모델이 아예 빼먹거나, 같은 특징을 여러 번 적거나, 목록을 길게 늘여
 * 보낼 수 있다. 화면이 받는 모양을 여기서 한 번 고정한다.
 * 신경 쓸 항목이 먼저 오도록 attention 순으로 정렬하되, 같은 단계 안에서는
 * 모델이 준 순서를 지킨다.
 */
function normalizeFindings(findings: Finding[] | undefined): Finding[] {
  if (!Array.isArray(findings)) return [];

  const seen = new Set<string>();
  const cleaned: Finding[] = [];

  for (const finding of findings) {
    if (!finding || typeof finding.label !== "string") continue;
    const label = finding.label.trim();
    if (!label) continue;

    const key = `${finding.metric}:${label}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const possibilities = toPossibilities(finding.possibilities);
    const signChecks = toSignChecks(finding.signChecks);

    cleaned.push({
      metric: METRIC_KEYS.includes(finding.metric) ? finding.metric : "color",
      label,
      detail: finding.detail ?? "",
      patternNames: toLines(finding.patternNames),
      possibilities,
      signChecks,
      cannotTell: finding.cannotTell ?? "",
      attention: escalate(toAttention(finding.attention), possibilities, signChecks),
      nextSteps: toLines(finding.nextSteps),
      watchFor: toLines(finding.watchFor),
      timeframe: finding.timeframe ?? "",
    });
  }

  return cleaned
    .map((finding, index) => ({ finding, index }))
    .sort(
      (a, b) =>
        ATTENTION_RANK[b.finding.attention] -
          ATTENTION_RANK[a.finding.attention] || a.index - b.index,
    )
    .slice(0, MAX_FINDINGS)
    .map((entry) => entry.finding);
}

/**
 * 단계는 코드에서 한 번 더 올린다. 모델이 위험 신호를 짚어 놓고도 attention 을
 * 낮게 주는 경우가 있는데, 그 방향의 실수는 사용자가 치른다.
 * 올리기만 하고 내리지는 않는다.
 */
function escalate(
  attention: Attention,
  possibilities: Possibility[],
  signChecks: SignCheck[],
): Attention {
  const raise = (floor: Attention) =>
    ATTENTION_RANK[floor] > ATTENTION_RANK[attention] ? floor : attention;

  // 위험 신호가 하나라도 보이면 진료를 미룰 이유가 없다.
  if (signChecks.some((check) => check.state === "present")) return raise("soon");

  // 놓치면 안 되는 가능성이 걸려 있는데 사진으로 확인이 안 됐다면, 사진을 더 보는
  // 것으로는 해결되지 않는다. 직접 보여 주는 쪽으로 보낸다.
  const rareImportant = possibilities.some(
    (item) => item.likelihood === "rare_important",
  );
  const unclear = signChecks.some((check) => check.state === "unclear");
  if (rareImportant && unclear) return raise("consult");

  return attention;
}

function toPossibilities(value: unknown): Possibility[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Possibility => Boolean(item) && typeof item === "object")
    .map((item) => ({
      name: String(item.name ?? "").trim(),
      likelihood: LIKELIHOOD_KEYS.includes(item.likelihood as Likelihood)
        ? (item.likelihood as Likelihood)
        : "possible",
      why: String(item.why ?? "").trim(),
    }))
    .filter((item) => item.name);
}

function toSignChecks(value: unknown): SignCheck[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is SignCheck => Boolean(item) && typeof item === "object")
    .map((item) => ({
      sign: String(item.sign ?? "").trim(),
      // 알 수 없는 값은 absent 가 아니라 unclear 로 떨어뜨린다.
      state: SIGN_STATES.includes(item.state as SignState)
        ? (item.state as SignState)
        : "unclear",
      note: String(item.note ?? "").trim(),
    }))
    .filter((item) => item.sign);
}

function toLines(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function toAttention(value: unknown): Attention {
  return ATTENTION_KEYS.includes(value as Attention)
    ? (value as Attention)
    : "monitor";
}
