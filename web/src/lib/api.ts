import type { AnalyzeResponse, NailAnalysis } from "../../../shared/analysis";
import { buildDemoAnalysis } from "../../../shared/demo";

/**
 * 서버 없이 동작하는 빌드(단일 HTML 데모)에서만 true.
 * 이때 분석 요청은 네트워크로 나가지 않고 샘플 결과로 대체된다.
 */
export const STANDALONE_DEMO = import.meta.env.VITE_STANDALONE_DEMO === "1";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface AnalyzeArgs {
  base64: string;
  mediaType: string;
  hand: "left" | "right";
  finger: string;
  note: string;
  signal?: AbortSignal;
}

export interface AnalyzeResult {
  analysis: NailAnalysis;
  demo: boolean;
}

export async function analyze(args: AnalyzeArgs): Promise<AnalyzeResult> {
  if (STANDALONE_DEMO) {
    // 실제 호출과 비슷한 대기 시간을 두어 진행 표시가 제 역할을 하게 한다.
    await new Promise((resolve) => setTimeout(resolve, 2200));
    if (args.signal?.aborted) {
      throw new DOMException("취소되었습니다.", "AbortError");
    }
    return {
      analysis: buildDemoAnalysis(args.base64.length % 13),
      demo: true,
    };
  }

  let response: Response;
  try {
    response = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image: args.base64,
        mediaType: args.mediaType,
        hand: args.hand,
        finger: args.finger,
        note: args.note,
      }),
      signal: args.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiError(
      "분석 서버에 연결하지 못했습니다. 네트워크를 확인해 주세요.",
      "network",
    );
  }

  let body: AnalyzeResponse;
  try {
    body = (await response.json()) as AnalyzeResponse;
  } catch {
    throw new ApiError("서버 응답을 읽지 못했습니다.", "upstream_error");
  }

  if (!body.ok) throw new ApiError(body.error, body.code);
  return { analysis: body.analysis, demo: body.demo };
}

export interface HealthInfo {
  configured: boolean;
  demoAvailable: boolean;
  /** 어떤 모델로 분석하는지. 키는 어떤 형태로도 내려오지 않는다. */
  provider?: string;
  model?: string;
}

export async function health(): Promise<HealthInfo | null> {
  if (STANDALONE_DEMO) return { configured: false, demoAvailable: true };

  try {
    const response = await fetch("/api/health");
    if (!response.ok) return null;
    return (await response.json()) as HealthInfo;
  } catch {
    return null;
  }
}
