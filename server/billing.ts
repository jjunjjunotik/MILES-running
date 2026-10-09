import { Router, type Request, type Response } from "express";
import { now } from "./db.js";
import { requireUser } from "./auth.js";
import { createRateLimiter } from "./security.js";
import {
  StoreError,
  handleStoreWebhook,
  refreshStoreIfStale,
  storeConfig,
  storeHasPro,
  storeSubscription,
  storeSubscriptionInfo,
  syncStoreSubscription,
} from "./revenuecat.js";
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
import type { BillingStatus, PlanId, UsageInfo } from "../shared/billing.js";

/**
 * 요금제와 사용 한도.
 *
 * Pro 는 휴대폰 앱의 인앱 구독(App Store · Google Play)으로만 판다. 결제 창과 카드 정보는
 * 스토어가 맡고, 영수증 확인은 RevenueCat 이 한다(revenuecat.ts). 이 파일은
 * "지금 몇 번 분석할 수 있는가"와 요금제 API 를 맡는다.
 *
 * 인앱 구독이 설정되지 않았으면 한도도 걸지 않는다. 올릴 수 없는 요금제를 두고
 * 한도만 거는 상태를 만들지 않기 위해서다.
 */

/** 인앱 구독이 켜져 있는지. 켜져 있어야 무료 한도가 걸린다. */
export function paymentsEnabled(): boolean {
  return storeConfig().enabled;
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

/** 이 요청이 지금 몇 번 분석할 수 있는지. 인앱 구독이 꺼져 있으면 한도가 없다. */
export function scanAllowance(req: Request, res: Response): Allowance {
  const at = now();
  if (!paymentsEnabled()) {
    return { plan: "free", limit: null, period: "month", resetsAt: nextMonthStart(at), buckets: [] };
  }

  const limits = usageLimits();
  if (req.user && storeHasPro(storeSubscription(req.user.id), at)) {
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

/* --------------------------------- 상태 응답 --------------------------------- */

export async function billingStatus(req: Request, res: Response): Promise<BillingStatus> {
  const store = storeConfig();
  const limits = usageLimits();
  // 기간이 지났는데 갱신 소식이 없으면 RevenueCat 에 다시 묻는다(웹훅이 빠졌을 때의 안전망).
  if (store.enabled && req.user) await refreshStoreIfStale(req.user.id);
  const allowance = scanAllowance(req, res);

  return {
    enabled: store.enabled,
    usage: usageOf(allowance),
    subscription:
      store.enabled && req.user ? storeSubscriptionInfo(storeSubscription(req.user.id)) : null,
    limits: { freePerMonth: limits.freePerMonth, proPerDay: limits.proPerDay },
    store: store.enabled
      ? { iosKey: store.iosKey, androidKey: store.androidKey, entitlement: store.entitlement }
      : null,
  };
}

/* --------------------------------- 라우트 --------------------------------- */

export const billing = Router();

const billingLimiter = createRateLimiter({
  perIp: Number(process.env.BILLING_RATE_LIMIT_PER_IP ?? 30),
  global: Number(process.env.BILLING_RATE_LIMIT_GLOBAL ?? 600),
  windowMs: 10 * 60 * 1000,
});

function fail(res: Response, err: unknown): void {
  if (err instanceof StoreError) {
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

billing.get("/status", async (req, res) => {
  try {
    res.json({ ok: true, status: await billingStatus(req, res) });
  } catch (err) {
    fail(res, err);
  }
});

/**
 * 휴대폰 앱에서 구매·복원한 뒤 부른다. 앱이 보낸 내용은 믿지 않고 RevenueCat 에 직접 물어 저장한다.
 */
billing.post("/sync", requireUser, billingLimiter, async (req, res) => {
  try {
    await syncStoreSubscription(req.user!.id);
    res.json({ ok: true, status: await billingStatus(req, res) });
  } catch (err) {
    fail(res, err);
  }
});

/** RevenueCat 웹훅. 세션이 아니라 Authorization 값으로 확인한다. */
billing.post("/store-webhook", (req, res) => {
  void handleStoreWebhook(req, res);
});
