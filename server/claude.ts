import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { NailAnalysis } from "../shared/analysis.js";
import { NailAnalysisSchema } from "./schema.js";
import { SYSTEM_PROMPT, buildUserPrompt } from "./prompt.js";
import {
  AnalyzeError,
  normalize,
  type AnalyzeInput,
  type Provider,
} from "./analysis-core.js";

export const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-opus-5";

let cachedClient: Anthropic | null = null;

function getClient(): Anthropic {
  if (!cachedClient) {
    // 키는 환경변수에서만 읽는다. 브라우저는 이 값을 절대 볼 수 없다.
    cachedClient = new Anthropic();
  }
  return cachedClient;
}

function hasCredentials(): boolean {
  return Boolean(
    process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN,
  );
}

async function analyzeNailPhoto(input: AnalyzeInput): Promise<NailAnalysis> {
  if (!hasCredentials()) {
    throw new AnalyzeError("no_api_key", "ANTHROPIC_API_KEY is not set.");
  }

  const client = getClient();

  try {
    const response = await client.beta.messages.parse({
      model: MODEL,
      max_tokens: 12000,
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
        "This photo wasn't analyzed. Please try a different photo.",
      );
    }

    const parsed = response.parsed_output;
    if (!parsed) {
      throw new AnalyzeError(
        "upstream_error",
        "The analysis result couldn't be read. Please try again in a moment.",
      );
    }

    return normalize(parsed, input.locale);
  } catch (err) {
    if (err instanceof AnalyzeError) throw err;
    if (err instanceof Anthropic.RateLimitError) {
      throw new AnalyzeError(
        "rate_limited",
        "Too many requests right now. Please try again in a moment.",
      );
    }
    if (err instanceof Anthropic.AuthenticationError) {
      throw new AnalyzeError("no_api_key", "Please check the API key.");
    }
    // APIConnectionError 는 APIError 의 하위 클래스이므로 먼저 확인한다.
    if (err instanceof Anthropic.APIConnectionError) {
      throw new AnalyzeError(
        "upstream_error",
        "Couldn't reach the analysis server. Please check your connection.",
      );
    }
    if (err instanceof Anthropic.APIError) {
      throw new AnalyzeError(
        "upstream_error",
        `The analysis server returned an error. (${err.status ?? "network"})`,
      );
    }
    throw new AnalyzeError(
      "upstream_error",
      "Something went wrong during analysis.",
    );
  }
}

export const claudeProvider: Provider = {
  id: "claude",
  label: "Claude",
  get model() {
    return MODEL;
  },
  hasCredentials,
  analyze: analyzeNailPhoto,
};
