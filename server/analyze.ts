import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import {
  METRIC_KEYS,
  type MetricKey,
  type NailAnalysis,
} from "../shared/analysis.js";
import { NailAnalysisSchema } from "./schema.js";
import { SYSTEM_PROMPT, buildUserPrompt } from "./prompt.js";

export const MODEL = "claude-opus-5";

export const SUPPORTED_MEDIA_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
] as const;

export type SupportedMediaType = (typeof SUPPORTED_MEDIA_TYPES)[number];

export class AnalyzeError extends Error {
  constructor(
    readonly code:
      | "bad_request"
      | "no_api_key"
      | "rate_limited"
      | "declined"
      | "upstream_error",
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

let cachedClient: Anthropic | null = null;

function getClient(): Anthropic {
  if (!cachedClient) {
    // 키는 환경변수에서만 읽는다. 브라우저는 이 값을 절대 볼 수 없다.
    cachedClient = new Anthropic();
  }
  return cachedClient;
}

export function hasCredentials(): boolean {
  return Boolean(
    process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN,
  );
}

export async function analyzeNailPhoto(
  input: AnalyzeInput,
): Promise<NailAnalysis> {
  if (!hasCredentials()) {
    throw new AnalyzeError("no_api_key", "ANTHROPIC_API_KEY가 설정되지 않았습니다.");
  }

  const client = getClient();

  try {
    const response = await client.beta.messages.parse({
      model: MODEL,
      max_tokens: 8000,
      // 정책상 거절된 경우 같은 호출 안에서 대체 모델로 자동 재시도된다.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: [
        {
          type: "text",
          text: SYSTEM_PROMPT,
          // 시스템 프롬프트는 요청마다 동일하므로 캐시된다.
          cache_control: { type: "ephemeral" },
        },
      ],
      output_config: {
        effort: "medium",
        format: betaZodOutputFormat(NailAnalysisSchema),
      },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: input.mediaType,
                data: input.imageBase64,
              },
            },
            {
              type: "text",
              text: buildUserPrompt(input),
            },
          ],
        },
      ],
    });

    if (response.stop_reason === "refusal") {
      throw new AnalyzeError(
        "declined",
        "이 사진은 분석하지 않았습니다. 다른 사진으로 시도해 주세요.",
      );
    }

    const parsed = response.parsed_output;
    if (!parsed) {
      throw new AnalyzeError(
        "upstream_error",
        "분석 결과를 해석하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      );
    }

    return normalize(parsed);
  } catch (err) {
    if (err instanceof AnalyzeError) throw err;
    if (err instanceof Anthropic.RateLimitError) {
      throw new AnalyzeError(
        "rate_limited",
        "요청이 많아 잠시 대기가 필요합니다. 잠시 후 다시 시도해 주세요.",
      );
    }
    if (err instanceof Anthropic.AuthenticationError) {
      throw new AnalyzeError("no_api_key", "API 키를 확인해 주세요.");
    }
    // APIConnectionError 는 APIError 의 하위 클래스이므로 먼저 확인한다.
    if (err instanceof Anthropic.APIConnectionError) {
      throw new AnalyzeError(
        "upstream_error",
        "분석 서버에 연결하지 못했습니다. 네트워크를 확인해 주세요.",
      );
    }
    if (err instanceof Anthropic.APIError) {
      throw new AnalyzeError(
        "upstream_error",
        `분석 서버에서 오류가 발생했습니다. (${err.status ?? "네트워크"})`,
      );
    }
    throw new AnalyzeError(
      "upstream_error",
      "분석 중 알 수 없는 오류가 발생했습니다.",
    );
  }
}

/**
 * 모델이 6개 항목을 모두, 정해진 순서로 돌려주도록 프롬프트에서 지시하지만
 * UI가 순서와 개수에 의존하므로 여기서 한 번 더 보정한다.
 */
function normalize(analysis: NailAnalysis): NailAnalysis {
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
  };
}
