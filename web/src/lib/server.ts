import type { NailAnalysis, NailRecord } from "../../../shared/analysis";
import type { ArticleCategory } from "../../../shared/articles";
import { STANDALONE_DEMO } from "./api";

/**
 * 서버 API 클라이언트.
 *
 * 인증은 httpOnly 쿠키로 유지된다. 토큰을 자바스크립트가 만질 수 없으므로
 * 여기서는 credentials: "same-origin" 만 챙기면 된다.
 * 서버 없이 도는 단일 HTML 데모에서는 이 모듈의 함수를 호출하지 않는다.
 */

export class ServerError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ServerError";
  }
}

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  provider: "password" | "google" | "apple";
  hasPassword: boolean;
}

export interface Providers {
  password: boolean;
  google: { clientId: string } | false;
  apple: { clientId: string } | false;
}

export interface ServerPreferences {
  nickname: string;
  keepPhotos: boolean;
  expandByDefault: boolean;
  onboarded: boolean;
}

export interface ServerScan {
  id: string;
  hand: "left" | "right";
  finger: string;
  note: string;
  hasImage: boolean;
  status: "done" | "failed" | "pending";
  errorCode: string | null;
  errorMessage: string | null;
  provider: string | null;
  model: string | null;
  demo: boolean;
  capturedAt: number;
  analysis: NailAnalysis | null;
}

export interface ArticleSummary {
  id: string;
  slug: string;
  category: ArticleCategory;
  title: string;
  summary: string;
  tags: string;
}

export interface Article extends ArticleSummary {
  body: string;
  updatedAt: number;
}

async function request<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  if (STANDALONE_DEMO) {
    throw new ServerError("데모 빌드에서는 서버 기능을 쓸 수 없습니다.", "demo", 0);
  }

  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      ...init,
      credentials: "same-origin",
      headers: {
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    });
  } catch {
    throw new ServerError(
      "서버에 연결하지 못했습니다. 네트워크를 확인해 주세요.",
      "network",
      0,
    );
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok || (body as { ok?: boolean })?.ok === false) {
    const payload = (body ?? {}) as { error?: string; code?: string };
    throw new ServerError(
      payload.error ?? "요청을 처리하지 못했습니다.",
      payload.code ?? "server_error",
      response.status,
    );
  }

  return body as T;
}

/* ---------------------------------- 인증 ---------------------------------- */

export async function fetchMe(): Promise<AuthUser | null> {
  const body = await request<{ user: AuthUser | null }>("/auth/me");
  return body.user;
}

/** 로그인 화면이 어떤 버튼을 그릴지 서버에 묻는다. 설정되지 않은 제공자는 그리지 않는다. */
export async function fetchProviders(): Promise<Providers> {
  const body = await request<{ providers: Providers }>("/auth/providers");
  return body.providers;
}

export async function signInWithGoogle(idToken: string): Promise<AuthUser> {
  const body = await request<{ user: AuthUser }>("/auth/google", {
    method: "POST",
    body: JSON.stringify({ idToken }),
  });
  return body.user;
}

export async function signInWithApple(input: {
  idToken?: string;
  code?: string;
  name?: string;
}): Promise<AuthUser> {
  const body = await request<{ user: AuthUser }>("/auth/apple", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return body.user;
}

export async function signup(input: {
  email: string;
  password: string;
  displayName: string;
}): Promise<AuthUser> {
  const body = await request<{ user: AuthUser }>("/auth/signup", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return body.user;
}

export async function login(input: {
  email: string;
  password: string;
}): Promise<AuthUser> {
  const body = await request<{ user: AuthUser }>("/auth/login", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return body.user;
}

export async function logout(): Promise<void> {
  await request("/auth/logout", { method: "POST" });
}

export async function deleteAccount(input: {
  password?: string;
  confirmEmail?: string;
}): Promise<void> {
  await request("/auth/account", {
    method: "DELETE",
    body: JSON.stringify(input),
  });
}

/* ---------------------------------- 기록 ---------------------------------- */

export async function listScans(): Promise<ServerScan[]> {
  const body = await request<{ scans: ServerScan[] }>("/scans");
  return body.scans;
}

export async function deleteScan(id: string): Promise<void> {
  await request(`/scans/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function deleteAllScans(): Promise<number> {
  const body = await request<{ deleted: number }>("/scans", { method: "DELETE" });
  return body.deleted;
}

export async function clearServerImages(): Promise<void> {
  await request("/scans/images", { method: "DELETE" });
}

/** 계정을 만들기 전 이 기기에 쌓인 기록을 계정으로 옮긴다. */
export async function importScans(records: NailRecord[]): Promise<number> {
  const body = await request<{ imported: number }>("/scans/import", {
    method: "POST",
    body: JSON.stringify({ scans: records }),
  });
  return body.imported;
}

/* ---------------------------------- 설정 ---------------------------------- */

export async function fetchPreferences(): Promise<ServerPreferences> {
  const body = await request<{ preferences: ServerPreferences }>("/preferences");
  return body.preferences;
}

export async function savePreferences(
  next: Partial<ServerPreferences>,
): Promise<ServerPreferences> {
  const body = await request<{ preferences: ServerPreferences }>("/preferences", {
    method: "PUT",
    body: JSON.stringify(next),
  });
  return body.preferences;
}

/* -------------------------------- 건강 정보 -------------------------------- */

export async function listArticles(options: {
  category?: string;
  q?: string;
}): Promise<ArticleSummary[]> {
  const params = new URLSearchParams();
  if (options.category && options.category !== "all") {
    params.set("category", options.category);
  }
  if (options.q) params.set("q", options.q);
  const query = params.toString();
  const body = await request<{ articles: ArticleSummary[] }>(
    `/articles${query ? `?${query}` : ""}`,
  );
  return body.articles;
}

export async function fetchArticle(slug: string): Promise<Article> {
  const body = await request<{ article: Article }>(
    `/articles/${encodeURIComponent(slug)}`,
  );
  return body.article;
}

/** 서버가 준 기록을 화면이 쓰는 모양으로 바꾼다. */
export function toRecord(scan: ServerScan): NailRecord | null {
  if (!scan.analysis) return null;
  return {
    id: scan.id,
    createdAt: scan.capturedAt,
    hand: scan.hand,
    finger: scan.finger as NailRecord["finger"],
    note: scan.note,
    analysis: scan.analysis,
    hasImage: scan.hasImage,
  };
}
