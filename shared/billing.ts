/**
 * 구독과 사용 한도에 관해 화면과 서버가 함께 쓰는 타입.
 *
 * Pro 는 휴대폰 앱의 인앱 구독(App Store · Google Play)으로만 판다. 영수증 확인은 RevenueCat 이 한다.
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

/** 인앱 구독의 상태. 결제 문제로 유예 중이면 past_due(그동안은 Pro 유지). */
export type SubscriptionStatus = "active" | "trialing" | "past_due" | "canceled";

/** 인앱 구독을 판 스토어 */
export type StoreName = "app_store" | "play_store" | "other";

export interface UsageInfo {
  plan: PlanId;
  /** 기간 안에 할 수 있는 분석 횟수. null 이면 한도가 없다(인앱 구독이 설정되지 않았을 때). */
  limit: number | null;
  used: number;
  period: "month" | "day";
  /** 한도가 다시 차는 시각(UTC 기준 다음 달 1일 또는 다음 날 0시) */
  resetsAt: number;
}

export interface SubscriptionInfo {
  status: SubscriptionStatus;
  interval: BillingInterval | null;
  /** 지금 결제 기간이 끝나는 시각. 체험 중이면 체험이 끝나는 시각 */
  currentPeriodEnd: number | null;
  /** 해지를 예약했으면 Pro 가 끝나는 시각 */
  cancelAt: number | null;
  /** 어느 스토어에서 샀는지. 해지·결제 수단 변경은 그 스토어에서 한다. */
  source: StoreName;
}

export interface BillingStatus {
  /** 인앱 구독이 설정되어 있는지. 꺼져 있으면 한도도 없다. */
  enabled: boolean;
  usage: UsageInfo;
  subscription: SubscriptionInfo | null;
  limits: { freePerMonth: number; proPerDay: number };
  /**
   * 휴대폰 앱의 인앱 구독(RevenueCat) 설정. 공개 키만 담는다(비밀키는 서버에만 있다).
   * 꺼져 있으면 null.
   */
  store: { iosKey: string | null; androidKey: string | null; entitlement: string } | null;
}
