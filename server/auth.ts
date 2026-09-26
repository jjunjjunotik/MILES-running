import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { db, now } from "./db.js";

/**
 * 이메일과 비밀번호로 하는 계정 인증.
 *
 * 지키는 것 세 가지:
 * 1. 비밀번호 원문은 어디에도 남기지 않는다. scrypt 해시와 사용자별 솔트만 저장한다.
 * 2. 세션 토큰은 브라우저 쿠키(httpOnly)에만 있고, 서버에는 그 해시만 둔다.
 *    데이터베이스 파일이 새어도 그것만으로 남의 세션을 흉내 낼 수 없다.
 * 3. 가입 여부를 알려 주지 않는다. 로그인 실패 메시지는 언제나 같은 문장이다.
 */

const COOKIE_NAME = "ns_session";
const SESSION_DAYS = 30;
const SESSION_MS = SESSION_DAYS * 24 * 60 * 60 * 1000;

// scrypt 기본값보다 메모리를 넉넉히 준다. 로그인 한 번에 수십 ms 수준이다.
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 } as const;

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  /** 어떻게 만든 계정인지. 화면에서 안내 문구를 고르는 데 쓴다. */
  provider: "password" | "google" | "apple";
  /** 비밀번호로도 로그인할 수 있는 계정인지 */
  hasPassword: boolean;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export class AuthError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

interface ProfileRow {
  id: string;
  email: string;
  displayName: string;
  passwordHash: string;
  authProvider: string;
}

const PROFILE_COLUMNS = `id, email, display_name AS displayName,
  password_hash AS passwordHash, auth_provider AS authProvider`;

function toUser(row: ProfileRow): AuthUser {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    provider: (row.authProvider as AuthUser["provider"]) ?? "password",
    hasPassword: row.passwordHash.length > 0,
  };
}

/* --------------------------------- 비밀번호 -------------------------------- */

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(password.normalize("NFKC"), salt, SCRYPT.keylen, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
  });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${derived.toString("base64")}`;
}

function verifyPassword(password: string, stored: string): boolean {
  // 소셜 전용 계정은 해시가 비어 있다. 어떤 비밀번호와도 맞지 않아야 한다.
  if (!stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, salt, expected] = parts;

  let derived: Buffer;
  try {
    derived = crypto.scryptSync(
      password.normalize("NFKC"),
      Buffer.from(salt!, "base64"),
      Buffer.from(expected!, "base64").length,
      { N: Number(n), r: Number(r), p: Number(p) },
    );
  } catch {
    return false;
  }

  const expectedBuf = Buffer.from(expected!, "base64");
  if (expectedBuf.length !== derived.length) return false;
  // 비교 시간이 값에 따라 달라지지 않게 한다.
  return crypto.timingSafeEqual(derived, expectedBuf);
}

/* ---------------------------------- 입력값 --------------------------------- */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function normalizeEmail(value: unknown): string {
  if (typeof value !== "string") {
    throw new AuthError(400, "bad_request", "이메일을 입력해 주세요.");
  }
  const email = value.trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 254) {
    throw new AuthError(400, "bad_request", "이메일 형식을 확인해 주세요.");
  }
  return email;
}

export function checkPassword(value: unknown): string {
  if (typeof value !== "string") {
    throw new AuthError(400, "bad_request", "비밀번호를 입력해 주세요.");
  }
  if (value.length < 8) {
    throw new AuthError(400, "weak_password", "비밀번호는 8자 이상으로 만들어 주세요.");
  }
  if (value.length > 200) {
    throw new AuthError(400, "bad_request", "비밀번호가 너무 깁니다.");
  }
  return value;
}

/* ---------------------------------- 세션 ---------------------------------- */

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    if (part.slice(0, index).trim() !== name) continue;
    return decodeURIComponent(part.slice(index + 1).trim());
  }
  return null;
}

function setSessionCookie(res: Response, token: string, maxAgeMs: number): void {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: maxAgeMs,
  });
}

export function startSession(res: Response, userId: string): void {
  const token = crypto.randomBytes(32).toString("base64url");
  const created = now();
  db()
    .prepare(
      `INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_seen)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(hashToken(token), userId, created, created + SESSION_MS, created);
  setSessionCookie(res, token, SESSION_MS);
}

export function endSession(req: Request, res: Response): void {
  const token = readCookie(req, COOKIE_NAME);
  if (token) {
    db().prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
  }
  res.clearCookie(COOKIE_NAME, { path: "/" });
}

/** 이 사용자의 다른 모든 세션을 끊는다. 비밀번호를 바꾸거나 계정을 지울 때 쓴다. */
export function endAllSessions(userId: string): void {
  db().prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
}

function lookupSession(req: Request): { user: AuthUser; tokenHash: string } | null {
  const token = readCookie(req, COOKIE_NAME);
  if (!token) return null;

  const tokenHash = hashToken(token);
  const row = db()
    .prepare(
      `SELECT s.expires_at AS expiresAt, p.id, p.email, p.display_name AS displayName,
              p.password_hash AS passwordHash, p.auth_provider AS authProvider
         FROM sessions s
         JOIN profiles p ON p.id = s.user_id
        WHERE s.token_hash = ?`,
    )
    .get(tokenHash) as unknown as
    | ({ expiresAt: number } & ProfileRow)
    | undefined;

  if (!row) return null;
  if (row.expiresAt <= now()) {
    db().prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
    return null;
  }

  return { tokenHash, user: toUser(row) };
}

/**
 * 세션이 있으면 req.user 를 채우고, 없으면 그냥 지나간다.
 * 로그인 없이도 볼 수 있는 화면(건강 정보 등)에 쓴다.
 */
export function attachUser(req: Request, _res: Response, next: NextFunction): void {
  const found = lookupSession(req);
  if (found) {
    req.user = found.user;
    const current = now();
    // 쓰는 중인 세션은 기한을 밀어 준다. 매 요청마다 쓰지 않도록 하루 단위로만.
    db()
      .prepare(
        `UPDATE sessions SET last_seen = ?, expires_at = ?
          WHERE token_hash = ? AND last_seen < ?`,
      )
      .run(current, current + SESSION_MS, found.tokenHash, current - 24 * 60 * 60 * 1000);
  }
  next();
}

/** 로그인이 반드시 필요한 경로에 건다. */
export function requireUser(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({
      ok: false,
      code: "unauthorized",
      error: "로그인이 필요합니다.",
    });
    return;
  }
  next();
}

/* ---------------------------------- 계정 ---------------------------------- */

export function createAccount(
  email: string,
  password: string,
  displayName: string,
): AuthUser {
  const existing = db()
    .prepare("SELECT id FROM profiles WHERE email = ?")
    .get(email) as { id: string } | undefined;
  if (existing) {
    throw new AuthError(409, "email_taken", "이미 가입된 이메일입니다.");
  }

  const id = crypto.randomUUID();
  const created = now();
  const name = displayName.trim().slice(0, 40);

  db().exec("BEGIN");
  try {
    db()
      .prepare(
        `INSERT INTO profiles (id, email, password_hash, display_name, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, email, hashPassword(password), name, created, created);
    db()
      .prepare(
        `INSERT INTO user_preferences (user_id, nickname, created_at, updated_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(id, name, created, created);
    db().exec("COMMIT");
  } catch (err) {
    db().exec("ROLLBACK");
    throw err;
  }

  return { id, email, displayName: name, provider: "password", hasPassword: true };
}

/**
 * 구글 · 애플에서 확인된 사람을 계정에 연결한다.
 *
 * 순서가 중요하다.
 * 1. 같은 제공자 아이디(sub)로 이미 있으면 그 계정이다.
 * 2. 없으면, 제공자가 **확인한** 이메일과 같은 계정에 연결한다.
 *    확인되지 않은 이메일로는 절대 연결하지 않는다. 그랬다가는 남의 이메일을 적어 낸
 *    사람이 그 계정을 가져갈 수 있다.
 * 3. 그래도 없으면 새로 만든다. 이 계정에는 비밀번호가 없다.
 */
export function linkSocialAccount(input: {
  provider: "google" | "apple";
  sub: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
}): AuthUser {
  const column = input.provider === "google" ? "google_sub" : "apple_sub";

  const bySub = db()
    .prepare(`SELECT ${PROFILE_COLUMNS} FROM profiles WHERE ${column} = ?`)
    .get(input.sub) as unknown as ProfileRow | undefined;
  if (bySub) return toUser(bySub);

  const email = input.email?.trim().toLowerCase() ?? "";
  if (!email) {
    throw new AuthError(
      400,
      "no_email",
      "로그인 제공자에서 이메일을 받지 못했습니다. 이메일로 가입해 주세요.",
    );
  }

  const stamp = now();
  const byEmail = db()
    .prepare(`SELECT ${PROFILE_COLUMNS} FROM profiles WHERE email = ?`)
    .get(email) as unknown as ProfileRow | undefined;

  if (byEmail) {
    if (!input.emailVerified) {
      throw new AuthError(
        409,
        "email_taken",
        "이미 가입된 이메일입니다. 기존 방법으로 로그인해 주세요.",
      );
    }
    db()
      .prepare(`UPDATE profiles SET ${column} = ?, email_verified = 1, updated_at = ? WHERE id = ?`)
      .run(input.sub, stamp, byEmail.id);
    return toUser({ ...byEmail, email });
  }

  const id = crypto.randomUUID();
  const name = (input.name ?? "").trim().slice(0, 40);

  db().exec("BEGIN");
  try {
    db()
      .prepare(
        `INSERT INTO profiles
           (id, email, password_hash, display_name, auth_provider, ${column}, email_verified, created_at, updated_at)
         VALUES (?, ?, '', ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        email,
        name,
        input.provider,
        input.sub,
        input.emailVerified ? 1 : 0,
        stamp,
        stamp,
      );
    db()
      .prepare(
        `INSERT INTO user_preferences (user_id, nickname, created_at, updated_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(id, name, stamp, stamp);
    db().exec("COMMIT");
  } catch (err) {
    db().exec("ROLLBACK");
    throw err;
  }

  return {
    id,
    email,
    displayName: name,
    provider: input.provider,
    hasPassword: false,
  };
}

export function authenticate(email: string, password: string): AuthUser {
  const row = db()
    .prepare(`SELECT ${PROFILE_COLUMNS} FROM profiles WHERE email = ?`)
    .get(email) as unknown as ProfileRow | undefined;

  // 가입된 이메일인지 알려 주지 않는다. 없는 계정일 때도 같은 일을 하고 같은 답을 준다.
  const stored = row?.passwordHash ?? hashPassword(crypto.randomBytes(16).toString("hex"));
  const ok = verifyPassword(password, stored);

  if (!row || !ok) {
    throw new AuthError(401, "invalid_credentials", "이메일 또는 비밀번호가 올바르지 않습니다.");
  }
  return toUser(row);
}

export function deleteAccount(userId: string): void {
  // 프로필을 지우면 세션·기록·결과·설정이 외래 키를 타고 함께 사라진다.
  db().prepare("DELETE FROM profiles WHERE id = ?").run(userId);
}
