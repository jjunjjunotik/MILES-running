import { ApiError, GoogleGenAI } from "@google/genai";
import { z } from "zod";
import type { NailAnalysis } from "../shared/analysis.js";
import { NailAnalysisSchema } from "./schema.js";
import { SYSTEM_PROMPT, buildUserPrompt } from "./prompt.js";
import {
  AnalyzeError,
  normalize,
  type AnalyzeInput,
  type Provider,
} from "./analysis-core.js";

/**
 * Gemini 프로바이더.
 *
 * Claude 쪽과 완전히 같은 프롬프트와 출력 스키마를 쓴다. 프로바이더를 바꿔도
 * 진단 금지 규칙과 화면이 받는 데이터 모양이 달라지지 않아야 하기 때문이다.
 *
 * 키는 GEMINI_API_KEY 환경변수에서만 읽는다. 이 값은 서버 프로세스 안에만
 * 존재하며, 브라우저로 내려가는 번들에는 어떤 경로로도 포함되지 않는다.
 */
export const MODEL = process.env.GEMINI_MODEL ?? "gemini-3.8-flash";

let cachedClient: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  if (!cachedClient) {
    const apiKey = process.env.GEMINI_API_KEY?.trim();
    if (!apiKey) {
      throw new AnalyzeError(
        "no_api_key",
        "GEMINI_API_KEY가 설정되지 않았습니다.",
      );
    }
    // GEMINI_BASE_URL 은 테스트나 사내 프록시를 거칠 때만 쓴다.
    // 평소에는 비워 두고 SDK 기본 엔드포인트를 그대로 쓴다.
    const baseUrl = process.env.GEMINI_BASE_URL?.trim();
    cachedClient = new GoogleGenAI({
      apiKey,
      ...(baseUrl ? { httpOptions: { baseUrl } } : {}),
    });
  }
  return cachedClient;
}

function hasCredentials(): boolean {
  return Boolean(process.env.GEMINI_API_KEY?.trim());
}

/**
 * zod 스키마를 Gemini 가 받는 JSON Schema 로 바꾼다.
 *
 * Gemini 는 JSON Schema 의 일부만 지원하므로, 해석하지 못하는 키를 걷어낸다.
 * 남겨 두면 400 으로 거절당한다.
 */
let cachedSchema: unknown = null;

function responseSchema(): unknown {
  if (cachedSchema) return cachedSchema;

  const jsonSchema = z.toJSONSchema(NailAnalysisSchema, { io: "output" });
  cachedSchema = prune(jsonSchema);
  return cachedSchema;
}

const DROP_KEYS = new Set([
  "$schema",
  "$id",
  "additionalProperties",
  "exclusiveMinimum",
  "exclusiveMaximum",
]);

function prune(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(prune);
  if (node === null || typeof node !== "object") return node;

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (DROP_KEYS.has(key)) continue;
    out[key] = prune(value);
  }
  return out;
}

async function analyzeNailPhoto(input: AnalyzeInput): Promise<NailAnalysis> {
  const client = getClient();

  let text: string | undefined;
  try {
    const response = await client.models.generateContent({
      model: MODEL,
      contents: [
        {
          role: "user",
          parts: [
            {
              inlineData: {
                mimeType: input.mediaType,
                data: input.imageBase64,
              },
            },
            { text: buildUserPrompt(input) },
          ],
        },
      ],
      config: {
        systemInstruction: SYSTEM_PROMPT,
        // 정해진 모양의 JSON 만 받는다. 자유 서술이 끼어들 여지를 없앤다.
        responseMimeType: "application/json",
        responseJsonSchema: responseSchema(),
        maxOutputTokens: 8000,
        temperature: 0.4,
      },
    });

    const blockReason = response.promptFeedback?.blockReason;
    if (blockReason) {
      throw new AnalyzeError(
        "declined",
        "이 사진은 분석하지 않았습니다. 다른 사진으로 시도해 주세요.",
      );
    }

    const finishReason = response.candidates?.[0]?.finishReason;
    if (finishReason === "SAFETY" || finishReason === "PROHIBITED_CONTENT") {
      throw new AnalyzeError(
        "declined",
        "이 사진은 분석하지 않았습니다. 다른 사진으로 시도해 주세요.",
      );
    }
    if (finishReason === "MAX_TOKENS") {
      throw new AnalyzeError(
        "upstream_error",
        "결과가 너무 길어 중간에 끊겼습니다. 다시 시도해 주세요.",
      );
    }

    text = response.text;
  } catch (err) {
    if (err instanceof AnalyzeError) throw err;
    throw toAnalyzeError(err);
  }

  if (!text) {
    throw new AnalyzeError(
      "upstream_error",
      "분석 결과를 받지 못했습니다. 잠시 후 다시 시도해 주세요.",
    );
  }

  // 스키마를 걸어도 응답은 여전히 바깥에서 온 문자열이다. 반드시 검증한다.
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new AnalyzeError(
      "upstream_error",
      "분석 결과를 해석하지 못했습니다. 잠시 후 다시 시도해 주세요.",
    );
  }

  const result = NailAnalysisSchema.safeParse(parsed);
  if (!result.success) {
    throw new AnalyzeError(
      "upstream_error",
      "분석 결과가 예상한 형식이 아닙니다. 잠시 후 다시 시도해 주세요.",
    );
  }

  return normalize(result.data);
}

function toAnalyzeError(err: unknown): AnalyzeError {
  if (err instanceof ApiError) {
    if (err.status === 429) {
      return new AnalyzeError(
        "rate_limited",
        "요청이 많아 잠시 대기가 필요합니다. 잠시 후 다시 시도해 주세요.",
      );
    }
    if (err.status === 401 || err.status === 403) {
      return new AnalyzeError("no_api_key", "GEMINI_API_KEY를 확인해 주세요.");
    }
    if (err.status === 404) {
      // 쓸 수 있는 모델은 키와 지역에 따라 다르다. 추측하지 말고 확인하게 한다.
      return new AnalyzeError(
        "upstream_error",
        `모델 "${MODEL}" 을 찾지 못했습니다. 터미널에서 npm run models 를 실행해 쓸 수 있는 모델을 확인한 뒤, .env 의 GEMINI_MODEL 에 적어 주세요.`,
      );
    }
    // 상태 코드만 전한다. 응답 본문에는 키가 섞여 나올 수 있다.
    return new AnalyzeError(
      "upstream_error",
      `분석 서버에서 오류가 발생했습니다. (${err.status})`,
    );
  }

  return new AnalyzeError(
    "upstream_error",
    "분석 중 알 수 없는 오류가 발생했습니다.",
  );
}

export const geminiProvider: Provider = {
  id: "gemini",
  label: "Gemini",
  get model() {
    return MODEL;
  },
  hasCredentials,
  analyze: analyzeNailPhoto,
};
