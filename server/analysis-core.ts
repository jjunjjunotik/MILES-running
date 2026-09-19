import {
  ATTENTION_KEYS,
  ATTENTION_RANK,
  METRIC_KEYS,
  type Attention,
  type Finding,
  type MetricKey,
  type NailAnalysis,
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

  return {
    ...analysis,
    observationScore: Math.max(
      0,
      Math.min(100, Math.round(analysis.observationScore)),
    ),
    metrics,
    findings: normalizeFindings(analysis.findings),
  };
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

    cleaned.push({
      metric: METRIC_KEYS.includes(finding.metric) ? finding.metric : "color",
      label,
      detail: finding.detail ?? "",
      causes: toLines(finding.causes),
      cannotTell: finding.cannotTell ?? "",
      attention: toAttention(finding.attention),
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
