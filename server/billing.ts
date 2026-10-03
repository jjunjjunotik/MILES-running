import crypto from "node:crypto";
import { Router, type Request, type Response } from "express";
import { db, now } from "./db.js";
import { requireUser } from "./auth.js";
import { createRateLimiter } from "./security.js";
import { billingConfig, paddleApiBase } from "./billing-config.js";
import {
  dayKey,
  guestBuckets,
  monthKey,
  nextDayStart,
  nextMonthStart,
  reserve,
  usageLimits,
  usedCount,
  userBucket,
  type Bucket,
  type Reservation,
} from "./usage.js";
import type {
  BillingInterval,
  BillingStatus,
  PlanId,
  PriceInfo,
  SubscriptionInfo,
  SubscriptionStatus,
  UsageInfo,
} from "../shared/billing.js";

/**
 * 구독 결제. 결제 업체는 Paddle 이다(판매 대행: 세금 신고·환불·카드 정보는 Paddle 이 맡는다).
 *
 * 지키는 것:
 * 1. 카드 정보는 이 서버를 지나가지 않는다. 결제 창은 Paddle 이 띄운다.
 * 2. 어느 계정의 결제인지는 서버가 만든 거래(billing_checkouts)로만 정한다.
 *    브라우저가 보낸 값으로 계정을 고르지 않는다.
 * 3. 구독 상태는 서명이 맞는 웹훅이나, 서버가 비밀키로 직접 조회한 결과로만 바꾼다.
 * 4. 결제 업체가 돌려준 오류 본문은 사용자에게도 로그에도 그대로 내보내지 않는다.
 *    이메일 같은 개인정보가 섞여 있을 수 있다. 상태 코드와 오류 코드만 남긴다.
 */

export class BillingError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "BillingError";
  }
}

/* --------------------------------- Paddle API -------------------------------- */

interface PaddleSubscription {
  id: string;
  status: string;
  customer_id?: string | null;
  updated_at?: string | null;
  /** subscription.created 이벤트에만 있다: 이 구독을 만든 거래 */
  transaction_id?: string | null;
  billing_cycle?: { interval?: string; frequency?: number } | null;
  current_billing_period?: { starts_at?: string; ends_at?: string } | null;
  scheduled_change?: { action?: string; effective_at?: string } | null;
  items?: { price?: { id?: string; billing_cycle?: { interval?: string } } }[];
}

interface PaddleTransaction {
  id: string;
  status?: string;
  customer_id?: string | null;
  subscription_id?: string | null;
}

interface PaddlePrice {
  id: string;
  status?: string;
  unit_price?: { amount?: string; currency_code?: string };
  billing_cycle?: { interval?: string; frequency?: number } | null;
  trial_period?: { interval?: string; frequency?: number } | null;
}

interface PaddlePortalSession {
  urls?: {
    general?: { overview?: string };
    subscriptions?: {
      id?: string;
      cancel_subscription?: string;
      update_subscription_payment_method?: string;
    }[];
  };
}

const SUB_ID = /^sub_[a-z0-9]{8,64}$/;
const TXN_ID = /^txn_[a-z0-9]{8,64}$/;
const CTM_ID = /^ctm_[a-z0-9]{8,64}$/;

const UNAVAILABLE =
  "We couldn't reach our payment provider. Please try again in a moment.";

async function paddle<T>(
  method: "GET" | "POST" | "PATCH",
  path: string,
  body?: unknown,
): Promise<T> {
  const config = billingConfig();
  if (!config.enabled) {
    throw new BillingError(503, "billing_unavailable", "Subscriptions aren't available right now.");
  }

  let response;
  try {
    response = await fetch(`${paddleApiBase(config.environment)}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    console.error(`[billing] ${method} ${path} 연결 실패`);
    throw new BillingError(502, "billing_unavailable", UNAVAILABLE);
  }

  type Envelope = { data?: T; error?: { code?: string } };
  let json: Envelope | null;
  try {
    json = (await response.json()) as Envelope;
  } catch {
    json = null;
  }

  if (!response.ok || !json || json.data === undefined) {
    // 오류 본문에는 고객 이메일이 섞일 수 있다. 코드만 남긴다.
    console.error(
      `[billing] ${method} ${path} → ${response.status} (${json?.error?.code ?? "no_code"})`,
    );
    throw new BillingError(
      502,
      "billing_error",
      "Our payment provider couldn't complete this request. Please try again in a moment.",
    );
  }
  return json.data;
}

/* --------------------------------- 구독 상태 --------------------------------- */

const PRO_STATUSES = new Set<SubscriptionStatus>(["active", "trialing", "past_due"]);
const OPEN_STATUSES = new Set<SubscriptionStatus>([
  "active",
  "trialing",
  "past_due",
  "paused",
]);
/** 결제 기간이 끝났는데 갱신 소식이 없을 때 Pro 를 이어 주는 여유 */
const GRACE_MS = 3 * 24 * 60 * 60 * 1000;

interface SubscriptionRow {
  id: string;
  userId: string | null;
  customerId: string | null;
  status: SubscriptionStatus;
  priceId: string | null;
  interval: BillingInterval | null;
  currentPeriodEnd: number | null;
  scheduledCancelAt: number | null;
  sourceUpdatedAt: number;
}

const SUBSCRIPTION_COLUMNS = `id, user_id AS userId, customer_id AS customerId, status,
  price_id AS priceId, billing_interval AS interval,
  current_period_end AS currentPeriodEnd, scheduled_cancel_at AS scheduledCancelAt,
  source_updated_at AS sourceUpdatedAt`;

/** 이 사용자의 구독 하나. 살아 있는 구독이 있으면 그것을, 없으면 가장 최근 것을. */
export function currentSubscription(userId: string): SubscriptionRow | null {
  const row = db()
    .prepare(
      `SELECT ${SUBSCRIPTION_COLUMNS} FROM subscriptions
        WHERE user_id = ?
        ORDER BY CASE WHEN status IN ('active','trialing','past_due','paused') THEN 0 ELSE 1 END,
                 source_updated_at DESC
        LIMIT 1`,
    )
    .get(userId) as SubscriptionRow | undefined;
  return row ?? null;
}

export function hasPro(row: SubscriptionRow | null, at = now()): boolean {
  if (!row || !PRO_STATUSES.has(row.status)) return false;
  return row.currentPeriodEnd === null || row.currentPeriodEnd + GRACE_MS > at;
}

function parseTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function asStatus(value: string): SubscriptionStatus | null {
  return ["active", "trialing", "past_due", "paused", "canceled"].includes(value)
    ? (value as SubscriptionStatus)
    : null;
}

function asInterval(value: string | undefined): BillingInterval | null {
  return value === "month" || value === "year" ? value : null;
}

/** 이 구독이 어느 계정 것인지. 서버가 만든 거래 기록을 먼저 믿는다. */
function resolveOwner(
  subscriptionId: string,
  transactionId: string | null | undefined,
  customerId: string | null | undefined,
): string | null {
  const database = db();
  const bySubscription = database
    .prepare("SELECT user_id AS userId FROM billing_checkouts WHERE subscription_id = ? LIMIT 1")
    .get(subscriptionId) as { userId: string } | undefined;
  if (bySubscription) return bySubscription.userId;

  if (transactionId && TXN_ID.test(transactionId)) {
    const byTransaction = database
      .prepare("SELECT user_id AS userId FROM billing_checkouts WHERE transaction_id = ?")
      .get(transactionId) as { userId: string } | undefined;
    if (byTransaction) return byTransaction.userId;
  }

  if (customerId && CTM_ID.test(customerId)) {
    // 같은 결제 고객이 두 계정에 묶여 있으면 어느 쪽인지 모르므로 고르지 않는다.
    const byCustomer = database
      .prepare("SELECT id FROM profiles WHERE paddle_customer_id = ? LIMIT 2")
      .all(customerId) as { id: string }[];
    if (byCustomer.length === 1) return byCustomer[0]!.id;
  }
  return null;
}

/** Paddle 이 알려 준 구독 상태를 저장한다. 이미 더 새로운 상태를 알고 있으면 무시한다. */
export function upsertSubscription(subscription: PaddleSubscription): void {
  if (typeof subscription?.id !== "string" || !SUB_ID.test(subscription.id)) {
    console.warn("[billing] 알 수 없는 구독 아이디라 건너뜁니다.");
    return;
  }
  const status = asStatus(String(subscription.status));
  if (!status) {
    console.warn(`[billing] 알 수 없는 구독 상태라 건너뜁니다: ${String(subscription.status).slice(0, 20)}`);
    return;
  }

  const sourceUpdatedAt = parseTime(subscription.updated_at) ?? now();
  const database = db();
  const existing = database
    .prepare("SELECT user_id AS userId, source_updated_at AS sourceUpdatedAt FROM subscriptions WHERE id = ?")
    .get(subscription.id) as { userId: string | null; sourceUpdatedAt: number } | undefined;
  // 웹훅은 순서가 뒤바뀌어 올 수 있다. 옛 상태로 되돌리지 않는다.
  if (existing && existing.sourceUpdatedAt > sourceUpdatedAt) return;

  const customerId =
    subscription.customer_id && CTM_ID.test(subscription.customer_id)
      ? subscription.customer_id
      : null;
  const userId =
    existing?.userId ??
    resolveOwner(subscription.id, subscription.transaction_id, customerId);
  const firstItem = subscription.items?.[0]?.price;
  const interval =
    asInterval(subscription.billing_cycle?.interval) ??
    asInterval(firstItem?.billing_cycle?.interval);
  const cancelAt =
    subscription.scheduled_change?.action === "cancel"
      ? parseTime(subscription.scheduled_change.effective_at)
      : null;
  const stamp = now();

  database
    .prepare(
      `INSERT INTO subscriptions (id, user_id, customer_id, status, price_id, billing_interval,
         current_period_end, scheduled_cancel_at, source_updated_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         user_id = COALESCE(subscriptions.user_id, excluded.user_id),
         customer_id = COALESCE(excluded.customer_id, subscriptions.customer_id),
         status = excluded.status,
         price_id = COALESCE(excluded.price_id, subscriptions.price_id),
         billing_interval = COALESCE(excluded.billing_interval, subscriptions.billing_interval),
         current_period_end = excluded.current_period_end,
         scheduled_cancel_at = excluded.scheduled_cancel_at,
         source_updated_at = excluded.source_updated_at,
         updated_at = excluded.updated_at`,
    )
    .run(
      subscription.id,
      userId,
      customerId,
      status,
      typeof firstItem?.id === "string" ? firstItem.id : null,
      interval,
      parseTime(subscription.current_billing_period?.ends_at),
      cancelAt,
      sourceUpdatedAt,
      stamp,
      stamp,
    );

  if (userId && customerId) {
    database
      .prepare("UPDATE profiles SET paddle_customer_id = ? WHERE id = ?")
      .run(customerId, userId);
  }
  if (userId && OPEN_STATUSES.has(status)) {
    // 결제 창을 두 번 열어 둘 다 결제하면 구독이 둘 생길 수 있다. 운영자가 환불할 수 있게 알린다.
    const open = database
      .prepare(
        `SELECT COUNT(*) AS n FROM subscriptions
          WHERE user_id = ? AND status IN ('active','trialing','past_due','paused')`,
      )
      .get(userId) as { n: number };
    if (open.n > 1) {
      console.warn(
        `[billing] 한 계정에 살아 있는 구독이 ${open.n}개입니다. Paddle 에서 중복 구독(${subscription.id} 등)을 확인하세요.`,
      );
    }
  }
  if (userId && subscription.transaction_id && TXN_ID.test(subscription.transaction_id)) {
    database
      .prepare(
        "UPDATE billing_checkouts SET subscription_id = ? WHERE transaction_id = ? AND user_id = ?",
      )
      .run(subscription.id, subscription.transaction_id, userId);
  }
}

/** 결제가 끝난 거래를 우리가 만든 거래와 이어, 생긴 구독의 주인을 정한다. */
function linkTransaction(transaction: PaddleTransaction): void {
  if (typeof transaction?.id !== "string" || !TXN_ID.test(transaction.id)) return;
  const database = db();
  const checkout = database
    .prepare("SELECT user_id AS userId FROM billing_checkouts WHERE transaction_id = ?")
    .get(transaction.id) as { userId: string } | undefined;
  // 우리 서버가 만들지 않은 거래는 어느 계정에도 붙이지 않는다.
  if (!checkout) return;

  const subscriptionId = transaction.subscription_id;
  if (subscriptionId && SUB_ID.test(subscriptionId)) {
    database
      .prepare("UPDATE billing_checkouts SET subscription_id = ? WHERE transaction_id = ?")
      .run(subscriptionId, transaction.id);
    database
      .prepare("UPDATE subscriptions SET user_id = ? WHERE id = ? AND user_id IS NULL")
      .run(checkout.userId, subscriptionId);
  }
  const customerId = transaction.customer_id;
  if (customerId && CTM_ID.test(customerId)) {
    database
      .prepare("UPDATE profiles SET paddle_customer_id = ? WHERE id = ?")
      .run(customerId, checkout.userId);
  }
}

/** 결제 기간이 지났는데 소식이 없으면 Paddle 에 직접 물어본다. 웹훅이 빠졌을 때의 안전망. */
const lastRefresh = new Map<string, number>();

async function refreshIfStale(row: SubscriptionRow | null): Promise<void> {
  if (!row || !OPEN_STATUSES.has(row.status)) return;
  const at = now();
  if (row.currentPeriodEnd === null || row.currentPeriodEnd > at) return;
  if ((lastRefresh.get(row.id) ?? 0) > at - 10 * 60 * 1000) return;
  lastRefresh.set(row.id, at);
  try {
    upsertSubscription(await paddle<PaddleSubscription>("GET", `/subscriptions/${row.id}`));
  } catch {
    // 조회가 안 되면 저장된 상태로 판단한다(여유 기간 안에서는 Pro 유지).
  }
}

/* -------------------------------- 사용 한도 -------------------------------- */

export interface Allowance {
  plan: PlanId;
  limit: number | null;
  period: "month" | "day";
  resetsAt: number;
  /** 한도를 세는 주체들. 첫 번째가 화면에 보여 주는 기준이다. */
  buckets: Bucket[];
}

/** 이 요청이 지금 몇 번 분석할 수 있는지. 결제 기능이 꺼져 있으면 한도가 없다. */
export function scanAllowance(
  req: Request,
  res: Response,
  subscription: SubscriptionRow | null = req.user ? currentSubscription(req.user.id) : null,
): Allowance {
  const at = now();
  if (!billingConfig().enabled) {
    return { plan: "free", limit: null, period: "month", resetsAt: nextMonthStart(at), buckets: [] };
  }

  const limits = usageLimits();
  if (req.user && hasPro(subscription, at)) {
    return {
      plan: "pro",
      limit: limits.proPerDay,
      period: "day",
      resetsAt: nextDayStart(at),
      buckets: [userBucket(req.user.id, dayKey(at), limits.proPerDay)],
    };
  }
  return {
    plan: "free",
    limit: limits.freePerMonth,
    period: "month",
    resetsAt: nextMonthStart(at),
    buckets: req.user
      ? [userBucket(req.user.id, monthKey(at), limits.freePerMonth)]
      : guestBuckets(req, res, at),
  };
}

export function usageOf(allowance: Allowance): UsageInfo {
  const first = allowance.buckets[0];
  return {
    plan: allowance.plan,
    limit: allowance.limit,
    used: first ? Math.min(usedCount(first), allowance.limit ?? Infinity) : 0,
    period: allowance.period,
    resetsAt: allowance.resetsAt,
  };
}

/** 분석 한 번을 미리 센다. 실패하면 release() 로 되돌린다. */
export function reserveScan(allowance: Allowance): Reservation {
  return reserve(allowance.buckets);
}

export function quotaMessage(allowance: Allowance, signedIn: boolean): string {
  if (allowance.plan === "pro") {
    return `You've reached today's limit of ${allowance.limit} scans. It resets at midnight UTC.`;
  }
  return signedIn
    ? "You've used your free scans for this month. Upgrade to Pro to keep scanning."
    : "You've used the free scans for this month. Log in or upgrade to Pro to keep scanning.";
}

/* --------------------------------- 가격 --------------------------------- */

let priceCache: { at: number; prices: PriceInfo[] } | null = null;

function formatPrice(price: PaddlePrice, expected: BillingInterval): PriceInfo | null {
  const interval = asInterval(price.billing_cycle?.interval);
  // 매달/매년 한 번 청구되는 요금만 다룬다. 설정이 다르면 보여 주지 않는다.
  if (interval !== expected || (price.billing_cycle?.frequency ?? 1) !== 1) return null;
  const currency = price.unit_price?.currency_code;
  const minor = Number(price.unit_price?.amount);
  if (!currency || !/^[A-Z]{3}$/.test(currency) || !Number.isFinite(minor)) return null;

  let formatter: Intl.NumberFormat;
  try {
    formatter = new Intl.NumberFormat("en-US", { style: "currency", currency });
  } catch {
    return null;
  }
  const digits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
  const trialInterval = price.trial_period?.interval;
  const trialFrequency = price.trial_period?.frequency;
  return {
    interval,
    amount: formatter.format(minor / 10 ** digits),
    currency,
    trial:
      (trialInterval === "day" ||
        trialInterval === "week" ||
        trialInterval === "month" ||
        trialInterval === "year") &&
      typeof trialFrequency === "number" &&
      trialFrequency > 0
        ? { interval: trialInterval, frequency: trialFrequency }
        : null,
  };
}

/** 결제 업체에 설정된 가격을 그대로 보여 준다. 화면의 금액과 실제 청구액이 어긋나지 않게. */
async function listPrices(): Promise<PriceInfo[]> {
  const at = now();
  if (priceCache && at - priceCache.at < 10 * 60 * 1000) return priceCache.prices;

  const config = billingConfig();
  const prices: PriceInfo[] = [];
  for (const interval of ["month", "year"] as const) {
    const id = config.prices[interval];
    if (!id) continue;
    try {
      const price = await paddle<PaddlePrice>("GET", `/prices/${encodeURIComponent(id)}`);
      if (price.status && price.status !== "active") continue;
      const formatted = formatPrice(price, interval);
      if (formatted) prices.push(formatted);
      else console.warn(`[billing] ${interval} 요금 설정이 예상과 달라 보여 주지 않습니다(1회/${interval} 청구인지 확인).`);
    } catch {
      // 가격을 못 읽으면 결제 버튼을 그리지 않는다. 지난 값이 있으면 그것을 쓴다.
      if (priceCache) return priceCache.prices;
      // 결제 업체에 닿지 않는 동안 요청마다 기다리지 않도록, 1분 뒤에 다시 묻는다.
      priceCache = { at: at - 9 * 60 * 1000, prices: [] };
      return [];
    }
  }
  priceCache = { at, prices };
  return prices;
}

/* --------------------------------- 상태 응답 --------------------------------- */

function toSubscriptionInfo(row: SubscriptionRow | null): SubscriptionInfo | null {
  if (!row || !OPEN_STATUSES.has(row.status)) return null;
  return {
    status: row.status,
    interval: row.interval,
    currentPeriodEnd: row.currentPeriodEnd,
    cancelAt: row.scheduledCancelAt,
  };
}

export async function billingStatus(req: Request, res: Response): Promise<BillingStatus> {
  const config = billingConfig();
  const limits = usageLimits();
  let subscription = req.user ? currentSubscription(req.user.id) : null;
  if (config.enabled && req.user) {
    await refreshIfStale(subscription);
    subscription = currentSubscription(req.user.id);
  }
  const allowance = scanAllowance(req, res, subscription);

  return {
    enabled: config.enabled,
    environment: config.environment,
    clientToken: config.enabled ? config.clientToken : null,
    usage: usageOf(allowance),
    subscription: config.enabled ? toSubscriptionInfo(subscription) : null,
    prices: config.enabled ? await listPrices() : [],
    limits: { freePerMonth: limits.freePerMonth, proPerDay: limits.proPerDay },
  };
}

/* --------------------------------- 웹훅 --------------------------------- */

export type SignatureVerdict = "ok" | "malformed" | "stale" | "mismatch";

/** 서명 시각 허용치(초). 값이 이상하면 기본값을 쓴다. 숫자가 아니면 검사가 꺼지는 일이 없게. */
function webhookTolerance(): number {
  const value = Number(process.env.PADDLE_WEBHOOK_TOLERANCE_SECONDS ?? 5);
  return Number.isFinite(value) && value > 0 && value <= 600 ? value : 5;
}

/**
 * Paddle-Signature: ts=1671552777;h1=<hex>
 * 서명 대상은 "ts:원본 본문"이고 HMAC-SHA256 이다. 비밀값을 바꾸는 동안에는 h1 이 둘 이상 올 수 있다.
 * 같은 요청을 나중에 다시 보내는 공격을 막으려고 시각 차이를 짧게 허용한다(Paddle SDK 기본 5초).
 */
export function verifyPaddleSignature(
  raw: Buffer,
  header: string,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
  toleranceSeconds = webhookTolerance(),
): SignatureVerdict {
  let ts: string | null = null;
  const signatures: string[] = [];
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key === "ts") ts = value;
    else if (key === "h1") signatures.push(value);
  }
  if (!ts || !/^\d{1,12}$/.test(ts) || signatures.length === 0 || !secret) {
    return "malformed";
  }
  if (Math.abs(nowSeconds - Number(ts)) > toleranceSeconds) return "stale";

  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${ts}:`)
    .update(raw)
    .digest();
  const matched = signatures.some((signature) => {
    if (!/^[0-9a-f]{64}$/i.test(signature)) return false;
    return crypto.timingSafeEqual(Buffer.from(signature, "hex"), expected);
  });
  return matched ? "ok" : "mismatch";
}

interface PaddleEvent {
  event_id: string;
  event_type: string;
  occurred_at?: string;
  data: unknown;
}

function applyEvent(event: PaddleEvent): void {
  if (event.event_type.startsWith("subscription.")) {
    upsertSubscription(event.data as PaddleSubscription);
    return;
  }
  if (event.event_type === "transaction.completed" || event.event_type === "transaction.paid") {
    linkTransaction(event.data as PaddleTransaction);
  }
  // 나머지 이벤트는 받았다는 기록만 남긴다.
}

/** express.raw() 로 받은 원본 본문이어야 한다. JSON 으로 파싱한 뒤에는 서명을 검증할 수 없다. */
export function handlePaddleWebhook(req: Request, res: Response): void {
  const config = billingConfig();
  if (!config.webhookSecret) {
    res.status(503).json({ ok: false });
    return;
  }

  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  const verdict = verifyPaddleSignature(raw, req.get("paddle-signature") ?? "", config.webhookSecret);
  if (verdict !== "ok") {
    console.warn(
      verdict === "stale"
        ? "[billing] 웹훅 서명 시각이 서버 시각과 너무 다릅니다. 서버 시계(NTP)를 확인하세요."
        : `[billing] 웹훅 서명 검증 실패 (${verdict})`,
    );
    res.status(401).json({ ok: false });
    return;
  }

  let event: PaddleEvent;
  try {
    event = JSON.parse(raw.toString("utf8")) as PaddleEvent;
  } catch {
    res.status(400).json({ ok: false });
    return;
  }
  if (
    typeof event?.event_id !== "string" ||
    typeof event?.event_type !== "string" ||
    event.data === null ||
    typeof event.data !== "object"
  ) {
    res.status(400).json({ ok: false });
    return;
  }

  const database = db();
  database.exec("BEGIN IMMEDIATE");
  try {
    const inserted = database
      .prepare(
        "INSERT OR IGNORE INTO billing_events (event_id, event_type, received_at) VALUES (?, ?, ?)",
      )
      .run(event.event_id.slice(0, 80), event.event_type.slice(0, 80), now());
    if (Number(inserted.changes) === 0) {
      database.exec("COMMIT");
      res.json({ ok: true, duplicate: true });
      return;
    }
    applyEvent(event);
    database.exec("COMMIT");
  } catch {
    database.exec("ROLLBACK");
    // 처리하지 못했으면 기록도 남기지 않는다. Paddle 이 다시 보내면 그때 처리한다.
    console.error(`[billing] 웹훅 처리 실패: ${event.event_type.slice(0, 80)}`);
    res.status(500).json({ ok: false });
    return;
  }
  res.json({ ok: true });
}

/* --------------------------------- 계정 삭제 --------------------------------- */

/** 계정을 지우기 전에 살아 있는 구독을 즉시 해지한다. 지운 계정에 계속 청구되지 않게. */
export async function cancelForAccountDeletion(userId: string): Promise<void> {
  const rows = db()
    .prepare(
      `SELECT id FROM subscriptions
        WHERE user_id = ? AND status IN ('active','trialing','past_due','paused')`,
    )
    .all(userId) as { id: string }[];
  if (rows.length === 0) return;

  const failure = new BillingError(
    502,
    "billing_error",
    "We couldn't cancel your subscription, so your account wasn't deleted. Please try again in a moment.",
  );
  if (!billingConfig().enabled) throw failure;
  for (const row of rows) {
    try {
      upsertSubscription(
        await paddle<PaddleSubscription>("POST", `/subscriptions/${row.id}/cancel`, {
          effective_from: "immediately",
        }),
      );
    } catch {
      throw failure;
    }
  }
}

/* --------------------------------- 라우트 --------------------------------- */

export const billing = Router();

const billingLimiter = createRateLimiter({
  perIp: Number(process.env.BILLING_RATE_LIMIT_PER_IP ?? 30),
  global: Number(process.env.BILLING_RATE_LIMIT_GLOBAL ?? 600),
  windowMs: 10 * 60 * 1000,
});

function fail(res: Response, err: unknown): void {
  if (err instanceof BillingError) {
    res.status(err.status).json({ ok: false, code: err.code, error: err.message });
    return;
  }
  console.error("[billing] 처리 중 오류");
  res.status(500).json({
    ok: false,
    code: "server_error",
    error: "Something went wrong. Please try again in a moment.",
  });
}

function requireBilling(): void {
  if (!billingConfig().enabled) {
    throw new BillingError(503, "billing_unavailable", "Subscriptions aren't available right now.");
  }
}

billing.get("/status", async (req, res) => {
  try {
    res.json({ ok: true, status: await billingStatus(req, res) });
  } catch (err) {
    fail(res, err);
  }
});

/**
 * 결제 거래를 서버가 만든다. 브라우저는 이 거래 아이디로 Paddle 결제 창을 연다.
 * 어떤 요금을 얼마에 사는지는 서버가 정하고, 결제 창에서는 바꿀 수 없다.
 */
billing.post("/checkout", requireUser, billingLimiter, async (req, res) => {
  try {
    requireBilling();
    const interval = asInterval(req.body?.interval);
    const config = billingConfig();
    const priceId = interval ? config.prices[interval] : null;
    if (!interval || !priceId) {
      throw new BillingError(400, "bad_request", "That plan isn't available.");
    }
    if (hasPro(currentSubscription(req.user!.id))) {
      throw new BillingError(409, "already_subscribed", "You already have Pro.");
    }

    const profile = db()
      .prepare("SELECT paddle_customer_id AS customerId FROM profiles WHERE id = ?")
      .get(req.user!.id) as { customerId: string | null } | undefined;

    const transaction = await paddle<PaddleTransaction>("POST", "/transactions", {
      items: [{ price_id: priceId, quantity: 1 }],
      ...(profile?.customerId ? { customer_id: profile.customerId } : {}),
      // 결제 업체 화면에서 어느 계정의 결제인지 찾을 수 있게 내부 아이디만 붙인다.
      custom_data: { nailsense_user_id: req.user!.id },
    });
    if (typeof transaction?.id !== "string" || !TXN_ID.test(transaction.id)) {
      throw new BillingError(502, "billing_error", UNAVAILABLE);
    }

    db()
      .prepare(
        `INSERT INTO billing_checkouts (transaction_id, user_id, price_id, created_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(transaction.id, req.user!.id, priceId, now());

    res.json({
      ok: true,
      transactionId: transaction.id,
      clientToken: config.clientToken,
      environment: config.environment,
    });
  } catch (err) {
    fail(res, err);
  }
});

/**
 * 결제 창이 "완료"를 알린 뒤 화면이 부른다. 웹훅이 늦거나 빠져도 바로 Pro 가 되도록
 * 서버가 Paddle 에 직접 거래와 구독을 조회해 저장한다. 브라우저가 보낸 내용은 믿지 않는다.
 */
billing.post("/confirm", requireUser, billingLimiter, async (req, res) => {
  try {
    requireBilling();
    const transactionId =
      typeof req.body?.transactionId === "string" ? req.body.transactionId : "";
    if (!TXN_ID.test(transactionId)) {
      throw new BillingError(400, "bad_request", "That payment wasn't found.");
    }
    const mine = db()
      .prepare("SELECT 1 FROM billing_checkouts WHERE transaction_id = ? AND user_id = ?")
      .get(transactionId, req.user!.id);
    if (!mine) throw new BillingError(404, "not_found", "That payment wasn't found.");

    const transaction = await paddle<PaddleTransaction>(
      "GET",
      `/transactions/${transactionId}`,
    );
    linkTransaction(transaction);
    if (transaction.subscription_id && SUB_ID.test(transaction.subscription_id)) {
      upsertSubscription(
        await paddle<PaddleSubscription>("GET", `/subscriptions/${transaction.subscription_id}`),
      );
    }
    res.json({ ok: true, status: await billingStatus(req, res) });
  } catch (err) {
    fail(res, err);
  }
});

function openSubscriptionOf(userId: string): SubscriptionRow {
  const row = currentSubscription(userId);
  if (!row || !OPEN_STATUSES.has(row.status)) {
    throw new BillingError(404, "not_found", "You don't have an active subscription.");
  }
  return row;
}

/** 해지: 이번 결제 기간이 끝날 때 끝난다. 그때까지는 Pro 그대로. 체험 중이면 체험이 끝날 때. */
billing.post("/cancel", requireUser, billingLimiter, async (req, res) => {
  try {
    requireBilling();
    const row = openSubscriptionOf(req.user!.id);
    if (row.scheduledCancelAt === null) {
      upsertSubscription(
        await paddle<PaddleSubscription>("POST", `/subscriptions/${row.id}/cancel`, {
          effective_from: "next_billing_period",
        }),
      );
    }
    res.json({ ok: true, status: await billingStatus(req, res) });
  } catch (err) {
    fail(res, err);
  }
});

/** 예약한 해지를 거둔다. */
billing.post("/resume", requireUser, billingLimiter, async (req, res) => {
  try {
    requireBilling();
    const row = openSubscriptionOf(req.user!.id);
    if (row.scheduledCancelAt !== null) {
      upsertSubscription(
        await paddle<PaddleSubscription>("PATCH", `/subscriptions/${row.id}`, {
          scheduled_change: null,
        }),
      );
    }
    res.json({ ok: true, status: await billingStatus(req, res) });
  } catch (err) {
    fail(res, err);
  }
});

/** 결제 수단 변경·영수증은 Paddle 고객 포털에서 한다. 링크는 잠깐만 유효하므로 매번 새로 만든다. */
billing.post("/portal", requireUser, billingLimiter, async (req, res) => {
  try {
    requireBilling();
    const row = currentSubscription(req.user!.id);
    const profile = db()
      .prepare("SELECT paddle_customer_id AS customerId FROM profiles WHERE id = ?")
      .get(req.user!.id) as { customerId: string | null } | undefined;
    const customerId = row?.customerId ?? profile?.customerId ?? null;
    if (!customerId || !CTM_ID.test(customerId)) {
      throw new BillingError(404, "not_found", "There's no billing account to manage yet.");
    }

    const session = await paddle<PaddlePortalSession>(
      "POST",
      `/customers/${customerId}/portal-sessions`,
      row && OPEN_STATUSES.has(row.status) ? { subscription_ids: [row.id] } : {},
    );
    const deepLink = session.urls?.subscriptions?.find((item) => item.id === row?.id)
      ?.update_subscription_payment_method;
    const url = deepLink ?? session.urls?.general?.overview ?? "";
    // 결제 업체의 주소로만 보낸다.
    let host = "";
    try {
      const parsed = new URL(url);
      host = parsed.protocol === "https:" ? parsed.hostname : "";
    } catch {
      host = "";
    }
    if (!(host === "paddle.com" || host.endsWith(".paddle.com"))) {
      throw new BillingError(502, "billing_error", UNAVAILABLE);
    }
    res.json({ ok: true, url });
  } catch (err) {
    fail(res, err);
  }
});
