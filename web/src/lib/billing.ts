import type { BillingStatus, UsageInfo } from "../../../shared/billing";
import { STANDALONE_DEMO } from "./api";
import { request } from "./server";
import { INTL_LOCALE, KO } from "../i18n";

/**
 * 요금제 상태와 표시용 문장.
 *
 * Pro 는 휴대폰 앱의 인앱 구독(App Store · Google Play)으로만 판다. 구매·복원·구독 관리는
 * 앱 빌드에만 들어가는 lib/store.ts 가 맡고, 이 파일은 웹과 앱이 함께 쓰는 부분만 담는다.
 */

export async function fetchBillingStatus(): Promise<BillingStatus | null> {
  if (STANDALONE_DEMO) return null;
  try {
    const body = await request<{ status: BillingStatus }>("/billing/status");
    return body.status;
  } catch {
    return null;
  }
}

/* --------------------------------- 표시용 --------------------------------- */

const DATE = new Intl.DateTimeFormat(INTL_LOCALE, {
  month: "short",
  day: "numeric",
  year: "numeric",
});

export function formatBillingDate(at: number): string {
  return DATE.format(new Date(at));
}

/** "2 of 3 free scans left this month" 같은 남은 횟수 문장. 한도가 없으면 null */
export function usageLine(usage: UsageInfo): string | null {
  if (usage.limit === null) return null;
  const left = Math.max(usage.limit - usage.used, 0);
  if (KO) {
    const span = usage.period === "day" ? "오늘" : "이번 달";
    const kind = usage.plan === "free" ? " 무료" : "";
    return `${span}${kind} 분석 ${usage.limit}회 중 ${left}회 남음`;
  }
  const span = usage.period === "day" ? "today" : "this month";
  const kind = usage.plan === "free" ? " free" : "";
  return `${left} of ${usage.limit}${kind} ${usage.limit === 1 ? "scan" : "scans"} left ${span}`;
}

export function usageExhausted(usage: UsageInfo | undefined | null): boolean {
  return Boolean(usage && usage.limit !== null && usage.used >= usage.limit);
}

/**
 * 구독을 판 스토어의 이름. 관리·해지 안내에 쓴다.
 * "other"(스토어 결제가 아닌 이용권 등)는 화면에서 따로 안내하고, 이 이름은 대체로만 쓴다.
 */
export function storeLabel(source: "app_store" | "play_store" | "other"): string {
  if (source === "play_store") return "Google Play";
  if (source === "app_store") return "App Store";
  return "App Store · Google Play";
}
