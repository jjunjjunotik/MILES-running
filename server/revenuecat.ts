import crypto from "node:crypto";
import type { Request, Response } from "express";
import { db, now } from "./db.js";
import type {
  BillingInterval,
  StoreName,
  SubscriptionInfo,
  SubscriptionStatus,
} from "../shared/billing.js";

/**
 * 휴대폰 앱의 인앱 구독(애플 App Store · 구글 Play). 결제는 스토어가 하고,
 * RevenueCat 이 영수증을 확인해 "이 계정에 Pro 권한이 있는가"를 알려 준다.
 *
 * 믿는 순서
 * 1. 앱이 "샀다"고 말하는 것은 믿지 않는다. 서버가 RevenueCat 서버에 직접 물어본 결과만 믿는다.
 * 2. 웹훅은 "이 계정 상태가 바뀌었다"는 신호로만 쓰고, 상태 자체는 다시 물어서 저장한다.
 *    웹훅 본문을 위조해도 RevenueCat 이 모르는 Pro 를 만들 수 없다.
 * 3. 앱 사용자 아이디(app_user_id)는 우리 계정 아이디다. 앱은 로그인한 뒤에만 구매하게 하고,
 *    로그인할 때 RevenueCat 에 같은 아이디로 알린다(Purchases.logIn).
 *
 * 설정 (모두 있어야 켜진다)
 *   REVENUECAT_SECRET_KEY      서버 전용 비밀키(sk_…). 앱으로 절대 내보내지 않는다.
 *   REVENUECAT_WEBHOOK_AUTH    RevenueCat 대시보드 웹훅의 Authorization 값과 같은 긴 무작위 문자열
 *   REVENUECAT_IOS_KEY         앱용 공개 키(appl_…)    — 둘 중 하나만 있어도 된다
 *   REVENUECAT_ANDROID_KEY     앱용 공개 키(goog_…)
 *   REVENUECAT_ENTITLEMENT     Pro 권한 이름 (기본 pro)
 */

const read = (name: string): string => (process.env[name] ?? "").trim();

export interface StoreConfig {
  enabled: boolean;
  secretKey: string;
  webhookAuth: string;
  iosKey: string | null;
  androidKey: string | null;
  entitlement: string;
}

export function storeConfig(): StoreConfig {
  const secretKey = read("REVENUECAT_SECRET_KEY");
  const webhookAuth = read("REVENUECAT_WEBHOOK_AUTH");
  const iosKey = read("REVENUECAT_IOS_KEY") || null;
  const androidKey = read("REVENUECAT_ANDROID_KEY") || null;
  return {
    enabled: Boolean(secretKey && webhookAuth.length >= 16 && (iosKey || androidKey)),
    secretKey,
    webhookAuth,
    iosKey,
    androidKey,
    entitlement: read("REVENUECAT_ENTITLEMENT") || "pro",
  };
}

/** 일부만 설정했을 때 무엇이 빠졌는지. 값은 출력하지 않는다. */
export function missingStoreSettings(): string[] {
  const names = ["REVENUECAT_SECRET_KEY", "REVENUECAT_WEBHOOK_AUTH", "REVENUECAT_IOS_KEY", "REVENUECAT_ANDROID_KEY"];
  if (!names.some((name) => read(name))) return [];
  const missing: string[] = [];
  if (!read("REVENUECAT_SECRET_KEY")) missing.push("REVENUECAT_SECRET_KEY");
  const auth = read("REVENUECAT_WEBHOOK_AUTH");
  if (!auth) missing.push("REVENUECAT_WEBHOOK_AUTH");
  else if (auth.length < 16) missing.push("REVENUECAT_WEBHOOK_AUTH(16자 이상)");
  if (!read("REVENUECAT_IOS_KEY") && !read("REVENUECAT_ANDROID_KEY")) {
    missing.push("REVENUECAT_IOS_KEY 또는 REVENUECAT_ANDROID_KEY");
  }
  return missing;
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** RevenueCat API 주소. 테스트용 모의 서버는 같은 기기 주소만 받는다(비밀키가 엉뚱한 곳으로 가지 않게). */
function apiBase(): string {
  const override = read("REVENUECAT_API_URL");
  if (override) {
    try {
      if (LOOPBACK.has(new URL(override).hostname)) return override.replace(/\/+$/, "");
    } catch {
      // 잘못된 주소는 무시한다.
    }
  }
  return "https://api.revenuecat.com";
}

export class StoreError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "StoreError";
  }
}

/* ------------------------------ RevenueCat 응답 ------------------------------ */

interface RcEntitlement {
  expires_date: string | null;
  grace_period_expires_date?: string | null;
  product_identifier: string;
  purchase_date?: string;
}

interface RcSubscription {
  expires_date: string | null;
  period_type?: string;
  store?: string;
  is_sandbox?: boolean;
  unsubscribe_detected_at?: string | null;
  billing_issues_detected_at?: string | null;
  grace_period_expires_date?: string | null;
  refunded_at?: string | null;
}

interface RcSubscriber {
  entitlements?: Record<string, RcEntitlement>;
  subscriptions?: Record<string, RcSubscription>;
}

const USER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function fetchSubscriber(userId: string): Promise<RcSubscriber> {
  const config = storeConfig();
  let response: globalThis.Response;
  try {
    response = await fetch(`${apiBase()}/v1/subscribers/${encodeURIComponent(userId)}`, {
      headers: {
        Authorization: `Bearer ${config.secretKey}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new StoreError(502, "billing_error", "We couldn't check your subscription right now. Please try again in a moment.");
  }
  if (!response.ok) {
    // 비밀키나 응답 본문은 남기지 않는다. 상태 코드만.
    console.error(`[store] RevenueCat 조회 실패: ${response.status}`);
    throw new StoreError(502, "billing_error", "We couldn't check your subscription right now. Please try again in a moment.");
  }
  const body = (await response.json().catch(() => null)) as { subscriber?: RcSubscriber } | null;
  if (!body?.subscriber) {
    throw new StoreError(502, "billing_error", "We couldn't check your subscription right now. Please try again in a moment.");
  }
  return body.subscriber;
}

function time(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function asStore(value: string | undefined): StoreName {
  if (value === "app_store" || value === "mac_app_store") return "app_store";
  if (value === "play_store") return "play_store";
  return "other";
}

/** 상품 아이디로 기간을 짐작한다. 모르면 null (화면에서 기간을 빼고 보여 준다). */
function guessInterval(productId: string): BillingInterval | null {
  if (/year|annual|12m|1y/i.test(productId)) return "year";
  if (/month|1m\b|monthly/i.test(productId)) return "month";
  return null;
}

export interface StoreRow {
  userId: string;
  status: SubscriptionStatus;
  store: StoreName | null;
  productId: string | null;
  interval: BillingInterval | null;
  expiresAt: number | null;
  cancelAt: number | null;
  sandbox: boolean;
  checkedAt: number;
}

/** RevenueCat 의 구독자 정보를 우리 상태 한 줄로 */
export function toStoreRow(userId: string, subscriber: RcSubscriber, at = now()): StoreRow {
  const entitlement = subscriber.entitlements?.[storeConfig().entitlement];
  if (!entitlement) {
    return {
      userId,
      status: "canceled",
      store: null,
      productId: null,
      interval: null,
      expiresAt: null,
      cancelAt: null,
      sandbox: false,
      checkedAt: at,
    };
  }
  const subscription = subscriber.subscriptions?.[entitlement.product_identifier];
  const expiresAt = time(entitlement.expires_date);
  const graceUntil =
    time(entitlement.grace_period_expires_date) ?? time(subscription?.grace_period_expires_date);
  const refunded = Boolean(subscription?.refunded_at);
  const active =
    !refunded &&
    (entitlement.expires_date === null || (expiresAt !== null && expiresAt > at) || (graceUntil !== null && graceUntil > at));

  let status: SubscriptionStatus = "canceled";
  if (active) {
    if (subscription?.billing_issues_detected_at) status = "past_due";
    else if (subscription?.period_type === "trial") status = "trialing";
    else status = "active";
  }
  return {
    userId,
    status,
    store: asStore(subscription?.store),
    productId: entitlement.product_identifier,
    interval: guessInterval(entitlement.product_identifier),
    // 결제 문제로 유예 중이면 유예가 끝나는 때까지를 기간으로 본다.
    expiresAt: graceUntil !== null && (expiresAt === null || graceUntil > expiresAt) ? graceUntil : expiresAt,
    cancelAt: active && subscription?.unsubscribe_detected_at ? expiresAt : null,
    sandbox: Boolean(subscription?.is_sandbox),
    checkedAt: at,
  };
}

function saveStoreRow(row: StoreRow): void {
  db()
    .prepare(
      `INSERT INTO store_subscriptions
         (user_id, status, store, product_id, billing_interval, expires_at, cancel_at, sandbox, checked_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         status = excluded.status, store = excluded.store, product_id = excluded.product_id,
         billing_interval = excluded.billing_interval, expires_at = excluded.expires_at,
         cancel_at = excluded.cancel_at, sandbox = excluded.sandbox, checked_at = excluded.checked_at`,
    )
    .run(
      row.userId,
      row.status,
      row.store,
      row.productId,
      row.interval,
      row.expiresAt,
      row.cancelAt,
      row.sandbox ? 1 : 0,
      row.checkedAt,
    );
}

export function storeSubscription(userId: string): StoreRow | null {
  const row = db()
    .prepare(
      `SELECT user_id AS userId, status, store, product_id AS productId,
              billing_interval AS interval, expires_at AS expiresAt, cancel_at AS cancelAt,
              sandbox, checked_at AS checkedAt
         FROM store_subscriptions WHERE user_id = ?`,
    )
    .get(userId) as (Omit<StoreRow, "sandbox"> & { sandbox: number }) | undefined;
  return row ? { ...row, sandbox: row.sandbox === 1 } : null;
}

const PRO = new Set<SubscriptionStatus>(["active", "trialing", "past_due"]);
/** 기간이 끝났는데 갱신 소식이 아직 없을 때 Pro 를 잠깐 이어 주는 여유(웹훅 지연 대비) */
const GRACE_MS = 6 * 60 * 60 * 1000;

export function storeHasPro(row: StoreRow | null, at = now()): boolean {
  if (!row || !PRO.has(row.status)) return false;
  return row.expiresAt === null || row.expiresAt + GRACE_MS > at;
}

export function storeSubscriptionInfo(row: StoreRow | null, at = now()): SubscriptionInfo | null {
  if (!row || !storeHasPro(row, at)) return null;
  return {
    status: row.status,
    interval: row.interval,
    currentPeriodEnd: row.expiresAt,
    cancelAt: row.cancelAt,
    source: row.store ?? "other",
  };
}

/** RevenueCat 에 물어 이 계정의 상태를 새로 저장한다. */
export async function syncStoreSubscription(userId: string): Promise<StoreRow> {
  if (!storeConfig().enabled) {
    throw new StoreError(503, "billing_unavailable", "Subscriptions aren't available right now.");
  }
  const row = toStoreRow(userId, await fetchSubscriber(userId));
  // 그사이 계정이 지워졌으면 저장하지 않는다(외래 키).
  const exists = db().prepare("SELECT 1 FROM profiles WHERE id = ?").get(userId);
  if (exists) saveStoreRow(row);
  return row;
}

/** 기간이 지났는데 소식이 없으면 다시 물어본다. 10분에 한 번까지. */
const lastCheck = new Map<string, number>();

export async function refreshStoreIfStale(userId: string): Promise<void> {
  const row = storeSubscription(userId);
  if (!row || !PRO.has(row.status)) return;
  const at = now();
  if (row.expiresAt === null || row.expiresAt > at) return;
  if ((lastCheck.get(userId) ?? 0) > at - 10 * 60 * 1000) return;
  lastCheck.set(userId, at);
  try {
    await syncStoreSubscription(userId);
  } catch {
    // 조회가 안 되면 저장된 상태로 판단한다.
  }
}

/* ---------------------------------- 웹훅 ---------------------------------- */

function sameSecret(given: string, expected: string): boolean {
  const a = crypto.createHash("sha256").update(given).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

interface RcEvent {
  id?: unknown;
  type?: unknown;
  app_user_id?: unknown;
  original_app_user_id?: unknown;
  aliases?: unknown;
  transferred_from?: unknown;
  transferred_to?: unknown;
}

/** 이벤트에 나온 아이디 가운데 실제 우리 계정인 것만 */
function accountsIn(event: RcEvent): string[] {
  const ids = new Set<string>();
  const add = (value: unknown) => {
    if (typeof value === "string" && USER_ID.test(value)) ids.add(value);
  };
  add(event.app_user_id);
  add(event.original_app_user_id);
  for (const list of [event.aliases, event.transferred_from, event.transferred_to]) {
    if (Array.isArray(list)) list.slice(0, 20).forEach(add);
  }
  const exists = db().prepare("SELECT 1 FROM profiles WHERE id = ?");
  return [...ids].filter((id) => exists.get(id));
}

/**
 * RevenueCat 웹훅. Authorization 헤더가 대시보드에 넣은 값과 같아야 한다.
 * 처리하지 못하면 500 을 돌려준다. RevenueCat 이 잠시 뒤 다시 보낸다.
 */
export async function handleStoreWebhook(req: Request, res: Response): Promise<void> {
  const config = storeConfig();
  if (!config.enabled) {
    res.status(503).json({ ok: false, code: "billing_unavailable", error: "Subscriptions aren't available right now." });
    return;
  }
  const given = req.get("authorization") ?? "";
  if (!sameSecret(given, config.webhookAuth) && !sameSecret(given, `Bearer ${config.webhookAuth}`)) {
    console.warn("[store] 웹훅 인증 실패");
    res.status(401).json({ ok: false, code: "unauthorized", error: "Unauthorized." });
    return;
  }

  const event = (req.body?.event ?? null) as RcEvent | null;
  const eventId = typeof event?.id === "string" ? event.id.slice(0, 100) : null;
  const eventType = typeof event?.type === "string" ? event.type.slice(0, 60) : "unknown";
  if (!event || !eventId) {
    res.status(400).json({ ok: false, code: "bad_request", error: "Malformed event." });
    return;
  }

  const seen = db().prepare("SELECT 1 FROM billing_events WHERE event_id = ?").get(`rc:${eventId}`);
  if (seen) {
    res.json({ ok: true, duplicate: true });
    return;
  }

  try {
    // 테스트 이벤트나 익명 사용자 이벤트는 계정이 없으니 아무것도 하지 않는다.
    for (const userId of accountsIn(event)) await syncStoreSubscription(userId);
  } catch {
    res.status(500).json({ ok: false, code: "billing_error", error: "Try again later." });
    return;
  }
  db()
    .prepare("INSERT OR IGNORE INTO billing_events (event_id, event_type, received_at) VALUES (?, ?, ?)")
    .run(`rc:${eventId}`, `rc:${eventType}`, now());
  res.json({ ok: true });
}

/**
 * 계정을 지울 때 RevenueCat 쪽 고객 기록도 지운다(개인정보 최소화).
 * 스토어 구독 자체는 애플·구글에서만 해지할 수 있어 여기서 끊을 수 없다. 화면에서 따로 안내한다.
 * 실패해도 계정 삭제는 막지 않는다. 남는 것은 결제 영수증과 우리 계정 아이디뿐이다.
 */
export async function forgetStoreCustomer(userId: string): Promise<void> {
  const config = storeConfig();
  if (!config.enabled) return;
  try {
    const response = await fetch(`${apiBase()}/v1/subscribers/${encodeURIComponent(userId)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${config.secretKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok && response.status !== 404) {
      console.warn(`[store] RevenueCat 고객 삭제 실패: ${response.status}`);
    }
  } catch {
    console.warn("[store] RevenueCat 고객 삭제 실패: 연결 안 됨");
  }
}
