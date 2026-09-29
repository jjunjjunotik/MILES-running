import type { NailAnalysis } from "../shared/analysis.js";
import { claudeProvider } from "./claude.js";
import { geminiProvider } from "./gemini.js";
import {
  AnalyzeError,
  type AnalyzeInput,
  type Provider,
} from "./analysis-core.js";

export {
  AnalyzeError,
  SUPPORTED_MEDIA_TYPES,
  type AnalyzeInput,
  type SupportedMediaType,
} from "./analysis-core.js";

const PROVIDERS: Provider[] = [geminiProvider, claudeProvider];

/**
 * 어떤 프로바이더로 분석할지 고른다.
 *
 * ANALYSIS_PROVIDER 로 명시하면 그대로 따르고, 없으면 키가 설정된 쪽을 쓴다.
 * 둘 다 설정되어 있으면 Gemini 를 쓴다. 기동 로그에 무엇을 쓰는지 찍히므로
 * "왜 저쪽 모델이 돌지?" 하고 헤맬 일은 없다.
 */
export function activeProvider(): Provider {
  const requested = process.env.ANALYSIS_PROVIDER?.trim().toLowerCase();
  if (requested) {
    const match = PROVIDERS.find((provider) => provider.id === requested);
    if (match) return match;
    console.warn(
      `[설정] ANALYSIS_PROVIDER=${requested} 는 알 수 없는 값입니다. 키가 있는 프로바이더를 자동으로 고릅니다.`,
    );
  }
  return PROVIDERS.find((provider) => provider.hasCredentials()) ?? geminiProvider;
}

export function hasCredentials(): boolean {
  return activeProvider().hasCredentials();
}

export async function analyzeNailPhoto(
  input: AnalyzeInput,
): Promise<NailAnalysis> {
  const provider = activeProvider();
  if (!provider.hasCredentials()) {
    throw new AnalyzeError(
      "no_api_key",
      provider.id === "gemini"
        ? "GEMINI_API_KEY가 설정되지 않았습니다."
        : "ANTHROPIC_API_KEY가 설정되지 않았습니다.",
    );
  }
  return await provider.analyze(input);
}
