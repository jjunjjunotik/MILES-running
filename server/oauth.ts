import crypto from "node:crypto";

/**
 * 구글 · 애플 로그인에서 받은 ID 토큰을 검증한다.
 *
 * ID 토큰은 제공자가 서명한 JWT 다. 서명을 확인하지 않으면 누구나 "나는 이 이메일이다"라고
 * 적어 보낼 수 있으므로, 다음을 전부 확인한 것만 통과시킨다.
 *  1. 서명이 제공자의 공개키(JWKS)로 검증되는가
 *  2. 발급자(iss)가 그 제공자인가
 *  3. 수신자(aud)가 우리 앱의 클라이언트 아이디인가
 *  4. 아직 만료되지 않았는가
 * 라이브러리를 쓰지 않고 node:crypto 로 직접 확인한다. 의존성을 늘리지 않기 위해서다.
 */

export class OAuthError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "OAuthError";
  }
}

interface Jwk {
  kid?: string;
  kty?: string;
  alg?: string;
  use?: string;
  [key: string]: unknown;
}

interface JwksCache {
  keys: Jwk[];
  fetchedAt: number;
}

const JWKS_TTL_MS = 60 * 60 * 1000;
const jwksCache = new Map<string, JwksCache>();

async function getKeys(url: string, kid: string): Promise<Jwk[]> {
  const cached = jwksCache.get(url);
  const fresh = cached && Date.now() - cached.fetchedAt < JWKS_TTL_MS;

  // 키가 캐시에 있으면 그대로 쓴다. 모르는 kid 가 오면 키가 교체된 것이므로 한 번 더 받아 온다.
  if (fresh && cached.keys.some((key) => key.kid === kid)) return cached.keys;

  const response = await fetch(url);
  if (!response.ok) {
    throw new OAuthError("provider_unavailable", "로그인 제공자에 연결하지 못했습니다.");
  }
  const body = (await response.json()) as { keys?: Jwk[] };
  const keys = Array.isArray(body.keys) ? body.keys : [];
  jwksCache.set(url, { keys, fetchedAt: Date.now() });
  return keys;
}

function decodeSegment(segment: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
}

export interface VerifiedIdToken {
  sub: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
}

export async function verifyIdToken(options: {
  token: string;
  jwksUrl: string;
  issuers: string[];
  audience: string;
  nonce?: string;
}): Promise<VerifiedIdToken> {
  const parts = options.token.split(".");
  if (parts.length !== 3) {
    throw new OAuthError("bad_token", "로그인 정보를 확인하지 못했습니다.");
  }

  const [rawHeader, rawPayload, rawSignature] = parts as [string, string, string];
  const header = decodeSegment(rawHeader) as { alg?: string; kid?: string };
  const payload = decodeSegment(rawPayload) as Record<string, unknown>;

  if (header.alg !== "RS256" && header.alg !== "ES256") {
    throw new OAuthError("bad_token", "지원하지 않는 서명 방식입니다.");
  }

  const keys = await getKeys(options.jwksUrl, header.kid ?? "");
  const jwk = keys.find((key) => key.kid === header.kid) ?? keys[0];
  if (!jwk) {
    throw new OAuthError("bad_token", "로그인 정보를 확인하지 못했습니다.");
  }

  const publicKey = crypto.createPublicKey({ key: jwk as crypto.JsonWebKey, format: "jwk" });
  const signed = Buffer.from(`${rawHeader}.${rawPayload}`);
  const signature = Buffer.from(rawSignature, "base64url");

  const valid =
    header.alg === "RS256"
      ? crypto.verify("sha256", signed, publicKey, signature)
      : crypto.verify(
          "sha256",
          signed,
          // 애플은 ES256 을 쓴다. JWT 서명은 R||S 형식이라 그렇게 읽어야 한다.
          { key: publicKey, dsaEncoding: "ieee-p1363" },
          signature,
        );

  if (!valid) {
    throw new OAuthError("bad_token", "로그인 정보를 확인하지 못했습니다.");
  }

  const issuer = String(payload.iss ?? "");
  if (!options.issuers.includes(issuer)) {
    throw new OAuthError("bad_token", "로그인 정보를 확인하지 못했습니다.");
  }

  const audience = payload.aud;
  const audienceOk = Array.isArray(audience)
    ? audience.includes(options.audience)
    : audience === options.audience;
  if (!audienceOk) {
    throw new OAuthError("bad_token", "다른 앱에서 발급된 로그인 정보입니다.");
  }

  const exp = Number(payload.exp ?? 0);
  if (!Number.isFinite(exp) || exp * 1000 <= Date.now()) {
    throw new OAuthError("expired_token", "로그인 정보가 만료되었습니다. 다시 시도해 주세요.");
  }

  if (options.nonce && payload.nonce !== options.nonce) {
    throw new OAuthError("bad_token", "로그인 정보를 확인하지 못했습니다.");
  }

  const sub = String(payload.sub ?? "");
  if (!sub) {
    throw new OAuthError("bad_token", "로그인 정보를 확인하지 못했습니다.");
  }

  const emailVerified =
    payload.email_verified === true || payload.email_verified === "true";

  return {
    sub,
    email: typeof payload.email === "string" ? payload.email.toLowerCase() : null,
    emailVerified,
    name: typeof payload.name === "string" ? payload.name : null,
  };
}

/* ---------------------------------- 구글 ---------------------------------- */

export const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID?.trim() ?? "";
const GOOGLE_JWKS = process.env.GOOGLE_JWKS_URL ?? "https://www.googleapis.com/oauth2/v3/certs";
const GOOGLE_ISSUERS = (process.env.GOOGLE_ISSUERS ?? "https://accounts.google.com,accounts.google.com")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

export function googleEnabled(): boolean {
  return GOOGLE_CLIENT_ID.length > 0;
}

export async function verifyGoogleToken(idToken: string): Promise<VerifiedIdToken> {
  if (!googleEnabled()) {
    throw new OAuthError("not_configured", "구글 로그인이 설정되지 않았습니다.");
  }
  return verifyIdToken({
    token: idToken,
    jwksUrl: GOOGLE_JWKS,
    issuers: GOOGLE_ISSUERS,
    audience: GOOGLE_CLIENT_ID,
  });
}

/* ---------------------------------- 애플 ---------------------------------- */

export const APPLE_CLIENT_ID = process.env.APPLE_CLIENT_ID?.trim() ?? "";
const APPLE_TEAM_ID = process.env.APPLE_TEAM_ID?.trim() ?? "";
const APPLE_KEY_ID = process.env.APPLE_KEY_ID?.trim() ?? "";
const APPLE_PRIVATE_KEY = (process.env.APPLE_PRIVATE_KEY ?? "").replace(/\\n/g, "\n").trim();
const APPLE_JWKS = process.env.APPLE_JWKS_URL ?? "https://appleid.apple.com/auth/keys";
const APPLE_TOKEN_URL = process.env.APPLE_TOKEN_URL ?? "https://appleid.apple.com/auth/token";
const APPLE_ISSUERS = (process.env.APPLE_ISSUERS ?? "https://appleid.apple.com")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

export function appleEnabled(): boolean {
  return APPLE_CLIENT_ID.length > 0;
}

/** 코드 교환에는 애플 개발자 키(.p8)로 직접 서명한 JWT 가 client_secret 자리에 들어간다. */
function appleClientSecret(): string {
  if (!APPLE_TEAM_ID || !APPLE_KEY_ID || !APPLE_PRIVATE_KEY) {
    throw new OAuthError(
      "not_configured",
      "애플 로그인 키가 설정되지 않았습니다.",
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "ES256", kid: APPLE_KEY_ID, typ: "JWT" };
  const payload = {
    iss: APPLE_TEAM_ID,
    iat: now,
    exp: now + 10 * 60,
    aud: "https://appleid.apple.com",
    sub: APPLE_CLIENT_ID,
  };

  const encode = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const signed = `${encode(header)}.${encode(payload)}`;

  const signature = crypto.sign(
    "sha256",
    Buffer.from(signed),
    {
      key: crypto.createPrivateKey(APPLE_PRIVATE_KEY),
      dsaEncoding: "ieee-p1363",
    },
  );

  return `${signed}.${signature.toString("base64url")}`;
}

/**
 * 애플은 두 가지 방식으로 돌아온다.
 * - 웹(JS SDK): 페이지가 id_token 을 바로 받는다. 그대로 검증하면 된다.
 * - 인가 코드: 코드를 애플 서버에서 토큰으로 바꾼 뒤 그 안의 id_token 을 검증한다.
 */
export async function verifyAppleLogin(input: {
  idToken?: string;
  code?: string;
  nonce?: string;
}): Promise<VerifiedIdToken> {
  if (!appleEnabled()) {
    throw new OAuthError("not_configured", "애플 로그인이 설정되지 않았습니다.");
  }

  let idToken = input.idToken;

  if (!idToken && input.code) {
    const body = new URLSearchParams({
      client_id: APPLE_CLIENT_ID,
      client_secret: appleClientSecret(),
      code: input.code,
      grant_type: "authorization_code",
    });
    const response = await fetch(APPLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!response.ok) {
      throw new OAuthError("provider_error", "애플 로그인에 실패했습니다. 다시 시도해 주세요.");
    }
    const tokens = (await response.json()) as { id_token?: string };
    idToken = tokens.id_token;
  }

  if (!idToken) {
    throw new OAuthError("bad_token", "로그인 정보를 확인하지 못했습니다.");
  }

  return verifyIdToken({
    token: idToken,
    jwksUrl: APPLE_JWKS,
    issuers: APPLE_ISSUERS,
    audience: APPLE_CLIENT_ID,
    nonce: input.nonce,
  });
}
