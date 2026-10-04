import crypto from "node:crypto";
import type { Request, Response } from "express";
import { db, now } from "./db.js";
import { isAppClient, readCookie } from "./auth.js";

/**
 * 분석 횟수 한도.
 *
 * 분석 한 번이 곧 API 비용이라 무료로 쓸 수 있는 횟수를 둔다.
 * 로그인했으면 계정으로 센다. 로그인하지 않았으면 이 기기를 가리키는 무작위 쿠키로
 * 세고, 쿠키를 지워 가며 쓰는 것을 막으려고 같은 IP 에서 오는 손님 분석도 넉넉한
 * 한도로 함께 센다. IP 와 쿠키 값은 그대로 저장하지 않고 서버 비밀값으로 만든
 * 해시만 남긴다. IP 해시에는 달(月)을 섞어서, 달이 바뀌면 이어 볼 수 없게 한다.
 */

const DEVICE_COOKIE = "ns_device";
const DEVICE_MAX_AGE = 400 * 24 * 60 * 60 * 1000;

export function usageLimits() {
  return {
    freePerMonth: nonNegativeInt(process.env.FREE_SCANS_PER_MONTH, 3),
    proPerDay: nonNegativeInt(process.env.PRO_SCANS_PER_DAY, 20),
    guestPerIpPerMonth: nonNegativeInt(process.env.GUEST_SCANS_PER_IP_PER_MONTH, 15),
  };
}

function nonNegativeInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

/* --------------------------------- 기간 --------------------------------- */

const pad = (value: number) => String(value).padStart(2, "0");

export function monthKey(at: number): string {
  const d = new Date(at);
  return `m:${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}

export function dayKey(at: number): string {
  const d = new Date(at);
  return `d:${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function nextMonthStart(at: number): number {
  const d = new Date(at);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
}

export function nextDayStart(at: number): number {
  const d = new Date(at);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
}

/* ------------------------------- 주체 해시 ------------------------------- */

let secret: Buffer | null = null;

/** 해시용 비밀값. 환경변수가 없으면 처음 한 번 만들어 데이터베이스에 둔다. */
function hashSecret(): Buffer {
  if (secret) return secret;
  const fromEnv = (process.env.USAGE_HASH_SECRET ?? "").trim();
  if (fromEnv) {
    secret = Buffer.from(fromEnv, "utf8");
    return secret;
  }

  const row = db()
    .prepare("SELECT value FROM app_secrets WHERE name = 'usage_hash'")
    .get() as { value: string } | undefined;
  if (row) {
    secret = Buffer.from(row.value, "base64");
    return secret;
  }

  const value = crypto.randomBytes(32).toString("base64");
  db()
    .prepare(
      `INSERT INTO app_secrets (name, value, created_at) VALUES ('usage_hash', ?, ?)
       ON CONFLICT(name) DO NOTHING`,
    )
    .run(value, now());
  // 동시에 다른 값이 먼저 들어갔을 수 있으니 저장된 값을 다시 읽는다.
  const stored = db()
    .prepare("SELECT value FROM app_secrets WHERE name = 'usage_hash'")
    .get() as { value: string };
  secret = Buffer.from(stored.value, "base64");
  return secret;
}

function hashed(kind: string, value: string): string {
  const digest = crypto
    .createHmac("sha256", hashSecret())
    .update(`${kind}|${value}`)
    .digest("base64url")
    .slice(0, 32);
  return `${kind}:${digest}`;
}

/**
 * 이 기기를 가리키는 무작위 아이디. 없으면 만들어 쿠키로 남긴다.
 * 휴대폰 앱은 쿠키를 쓰지 않으므로, 설치할 때 만든 아이디를 X-NailSense-Device 로 보낸다.
 * (아이디는 지우고 다시 만들 수 있으므로 IP 한도가 함께 걸린다.)
 */
function deviceId(req: Request, res: Response): string {
  const fromApp = isAppClient(req) ? req.get("x-nailsense-device") : undefined;
  if (fromApp && /^[A-Za-z0-9_-]{16,64}$/.test(fromApp)) return fromApp;

  const existing = readCookie(req, DEVICE_COOKIE);
  if (existing && /^[A-Za-z0-9_-]{16,64}$/.test(existing)) return existing;

  const created = crypto.randomBytes(18).toString("base64url");
  res.cookie(DEVICE_COOKIE, created, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: DEVICE_MAX_AGE,
  });
  return created;
}

export interface Bucket {
  subject: string;
  period: string;
  limit: number;
}

export function userBucket(userId: string, period: string, limit: number): Bucket {
  return { subject: `user:${userId}`, period, limit };
}

/** 로그인하지 않은 사람의 한도: 이 기기 쿠키 + 같은 IP 전체 */
export function guestBuckets(req: Request, res: Response, at: number): Bucket[] {
  const limits = usageLimits();
  const period = monthKey(at);
  return [
    {
      subject: hashed("device", deviceId(req, res)),
      period,
      limit: limits.freePerMonth,
    },
    {
      subject: hashed("ip", `${req.ip ?? "unknown"}|${period}`),
      period,
      limit: limits.guestPerIpPerMonth,
    },
  ];
}

/* ------------------------------- 세고 되돌리기 ------------------------------- */

export function usedCount(bucket: Bucket): number {
  const row = db()
    .prepare("SELECT count FROM usage_counters WHERE subject = ? AND period = ?")
    .get(bucket.subject, bucket.period) as { count: number } | undefined;
  return row?.count ?? 0;
}

export type Reservation =
  | { ok: true; release: () => void }
  | { ok: false; bucket: Bucket };

/**
 * 분석을 시작하기 전에 한 번을 미리 센다. 모든 한도에 여유가 있어야 통과한다.
 * 동시에 두 요청이 들어와도 한도를 넘지 않도록 검사와 증가를 한 트랜잭션에서 한다.
 * 분석이 실패하면 release() 로 되돌린다. 결과를 받지 못한 시도는 세지 않는다.
 */
export function reserve(buckets: Bucket[]): Reservation {
  if (buckets.length === 0) return { ok: true, release: () => undefined };

  const database = db();
  const stamp = now();
  database.exec("BEGIN IMMEDIATE");
  try {
    for (const bucket of buckets) {
      if (usedCount(bucket) >= bucket.limit) {
        database.exec("ROLLBACK");
        return { ok: false, bucket };
      }
    }
    const increment = database.prepare(
      `INSERT INTO usage_counters (subject, period, count, updated_at) VALUES (?, ?, 1, ?)
       ON CONFLICT(subject, period) DO UPDATE SET count = count + 1, updated_at = excluded.updated_at`,
    );
    for (const bucket of buckets) increment.run(bucket.subject, bucket.period, stamp);
    database.exec("COMMIT");
  } catch (err) {
    database.exec("ROLLBACK");
    throw err;
  }

  let released = false;
  return {
    ok: true,
    release: () => {
      if (released) return;
      released = true;
      const decrement = database.prepare(
        `UPDATE usage_counters SET count = MAX(count - 1, 0), updated_at = ?
          WHERE subject = ? AND period = ?`,
      );
      for (const bucket of buckets) decrement.run(now(), bucket.subject, bucket.period);
    },
  };
}

/** 지난 기간의 기록은 쓸 데가 없다. 몇 달 지난 것은 지운다. */
export function pruneUsage(): void {
  const cutoff = now() - 100 * 24 * 60 * 60 * 1000;
  db().prepare("DELETE FROM usage_counters WHERE updated_at < ?").run(cutoff);
  db().prepare("DELETE FROM billing_events WHERE received_at < ?").run(cutoff);
}
