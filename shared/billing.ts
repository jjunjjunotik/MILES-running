/**
 * 구독과 사용 한도에 관해 화면과 서버가 함께 쓰는 타입.
 *
 * 원칙: 안전에 관한 정보(위험 신호 점검, 진료 안내, 결과 전체)는 요금제와 상관없이
 * 모두에게 보인다. 요금제가 바꾸는 것은 새로 분석할 수 있는 횟수뿐이다.
 */

/**
 * 건강 데이터 처리 동의 문구의 버전. 문구를 바꾸면 이 값도 바꾼다.
 * 서버는 이 버전으로 동의했다는 표시가 없는 분석 요청을 받지 않는다.
 */
export const HEALTH_CONSENT_VERSION = "2026-10.2";

export type PlanId = "free" | "pro";
export type BillingInterval = "month" | "year";

export type SubscriptionStatus =
  | "active"
  | "trialing"
  | "past_due"
  | "paused"
  | "canceled";

export interface UsageInfo {
  plan: PlanId;
  /** 기간 안에 할 수 있는 분석 횟수. null 이면 한도가 없다(결제 기능이 꺼져 있을 때). */
  limit: number | null;
  used: number;
  period: "month" | "day";
  /** 한도가 다시 차는 시각(UTC 기준 다음 달 1일 또는 다음 날 0시) */
  resetsAt: number;
}

export interface PriceInfo {
  interval: BillingInterval;
  /** 화면에 그대로 쓰는 금액. 예: "$4.99" */
  amount: string;
  currency: string;
  /** 결제 업체에 설정된 무료 체험. 없으면 null */
  trial: { interval: "day" | "week" | "month" | "year"; frequency: number } | null;
}

export interface SubscriptionInfo {
  status: SubscriptionStatus;
  interval: BillingInterval | null;
  /** 지금 결제 기간이 끝나는 시각. 체험 중이면 체험이 끝나는 시각 */
  currentPeriodEnd: number | null;
  /** 해지를 예약했으면 Pro 가 끝나는 시각 */
  cancelAt: number | null;
}

export interface BillingStatus {
  /** 결제 기능이 설정되어 있는지. 꺼져 있으면 한도도 없다. */
  enabled: boolean;
  environment: "sandbox" | "production";
  /** 결제 창(Paddle.js)용 공개 토큰. 비밀값이 아니다. */
  clientToken: string | null;
  usage: UsageInfo;
  subscription: SubscriptionInfo | null;
  prices: PriceInfo[];
  limits: { freePerMonth: number; proPerDay: number };
}

/** 체험 기간을 "7-day" 처럼 읽기 좋게 */
export function trialLabel(trial: NonNullable<PriceInfo["trial"]>): string {
  return `${trial.frequency}-${trial.interval}`;
}

/** 체험 기간을 "7 days" 처럼 문장 속에 */
export function trialDuration(trial: NonNullable<PriceInfo["trial"]>): string {
  return `${trial.frequency} ${trial.interval}${trial.frequency === 1 ? "" : "s"}`;
}
