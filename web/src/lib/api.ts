import type { AnalyzeResponse, NailAnalysis } from "../../../shared/analysis";

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
}

export async function health(): Promise<HealthInfo | null> {
  try {
    const response = await fetch("/api/health");
    if (!response.ok) return null;
    return (await response.json()) as HealthInfo;
  } catch {
    return null;
  }
}
