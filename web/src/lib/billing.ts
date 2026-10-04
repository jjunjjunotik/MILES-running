import type {
  BillingInterval,
  BillingStatus,
  PriceInfo,
  UsageInfo,
} from "../../../shared/billing";
import { STANDALONE_DEMO } from "./api";
import { request } from "./server";
import { INTL_LOCALE, KO, LOCALE } from "../i18n";

/**
 * 요금제와 결제.
 *
 * 결제 창은 Paddle 이 띄운다(Paddle.js 오버레이). 카드 정보는 이 앱을 지나가지 않는다.
 * 어떤 요금을 얼마에 사는지는 서버가 거래를 만들 때 정하고, 화면은 그 거래 아이디로
 * 결제 창만 연다. 결제가 끝나면 서버에 확인을 맡긴다. 화면이 받은 "완료" 신호만으로
 * Pro 를 켜지 않는다.
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

export async function createCheckout(interval: BillingInterval): Promise<{
  transactionId: string;
  clientToken: string;
  environment: "sandbox" | "production";
}> {
  return request("/billing/checkout", {
    method: "POST",
    body: JSON.stringify({ interval }),
  });
}

export async function confirmCheckout(transactionId: string): Promise<BillingStatus> {
  const body = await request<{ status: BillingStatus }>("/billing/confirm", {
    method: "POST",
    body: JSON.stringify({ transactionId }),
  });
  return body.status;
}

export async function cancelSubscription(): Promise<BillingStatus> {
  const body = await request<{ status: BillingStatus }>("/billing/cancel", {
    method: "POST",
  });
  return body.status;
}

export async function resumeSubscription(): Promise<BillingStatus> {
  const body = await request<{ status: BillingStatus }>("/billing/resume", {
    method: "POST",
  });
  return body.status;
}

/** 결제 수단 변경·영수증을 보는 Paddle 고객 포털 주소. 잠깐만 유효하므로 누를 때마다 새로 받는다. */
export async function billingPortalUrl(): Promise<string> {
  const body = await request<{ url: string }>("/billing/portal", { method: "POST" });
  return body.url;
}

/* --------------------------------- Paddle.js --------------------------------- */

interface PaddleEvent {
  name?: string;
  data?: { transaction_id?: string } | null;
}

interface PaddleGlobal {
  Environment: { set: (environment: "sandbox") => void };
  Initialize: (options: {
    token: string;
    eventCallback?: (event: PaddleEvent) => void;
  }) => void;
  Checkout: {
    open: (options: {
      transactionId: string;
      settings?: {
        displayMode?: "overlay";
        theme?: "light" | "dark";
        locale?: string;
      };
    }) => void;
    close: () => void;
  };
}

declare global {
  interface Window {
    Paddle?: PaddleGlobal;
  }
}

const PADDLE_SRC = "https://cdn.paddle.com/paddle/v2/paddle.js";

let paddleReady: Promise<PaddleGlobal> | null = null;
/** Paddle 은 한 페이지에서 한 번만 초기화된다. 이벤트는 지금 열린 결제 창으로 넘긴다. */
let listener: ((event: PaddleEvent) => void) | null = null;

/** 결제 버튼을 누를 때 처음 불러온다. 결제하지 않는 사람의 브라우저에는 Paddle 스크립트가 들어가지 않는다. */
function loadPaddle(
  environment: "sandbox" | "production",
  token: string,
): Promise<PaddleGlobal> {
  if (paddleReady) return paddleReady;
  paddleReady = new Promise<PaddleGlobal>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = PADDLE_SRC;
    script.async = true;
    script.onload = () => {
      const paddle = window.Paddle;
      if (!paddle) {
        reject(new Error("Paddle unavailable"));
        return;
      }
      if (environment === "sandbox") paddle.Environment.set("sandbox");
      paddle.Initialize({
        token,
        eventCallback: (event) => listener?.(event),
      });
      resolve(paddle);
    };
    script.onerror = () => reject(new Error("Paddle unavailable"));
    document.head.appendChild(script);
  }).catch((err: unknown) => {
    // 다음에 누르면 다시 시도할 수 있게 한다.
    paddleReady = null;
    throw err;
  });
  return paddleReady;
}

export async function openCheckout(options: {
  transactionId: string;
  clientToken: string;
  environment: "sandbox" | "production";
  onCompleted: (transactionId: string) => void;
  onClosed: () => void;
}): Promise<void> {
  const paddle = await loadPaddle(options.environment, options.clientToken);
  let completed = false;
  listener = (event) => {
    if (event.name === "checkout.completed" && !completed) {
      completed = true;
      options.onCompleted(event.data?.transaction_id ?? options.transactionId);
    } else if (event.name === "checkout.closed") {
      listener = null;
      options.onClosed();
    }
  };
  const dark = window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
  paddle.Checkout.open({
    transactionId: options.transactionId,
    settings: { displayMode: "overlay", theme: dark ? "dark" : "light", locale: LOCALE },
  });
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

export function perInterval(price: PriceInfo): string {
  return KO
    ? `${price.interval === "month" ? "월" : "연"} ${price.amount}`
    : `${price.amount} a ${price.interval}`;
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

/** 연간 요금이 월간 열두 번보다 얼마나 싼지. 통화가 다르거나 차이가 작으면 null */
export function yearlySaving(prices: PriceInfo[]): number | null {
  const month = prices.find((price) => price.interval === "month");
  const year = prices.find((price) => price.interval === "year");
  if (!month || !year || month.currency !== year.currency) return null;
  const parse = (amount: string) => Number(amount.replace(/[^0-9.]/g, ""));
  const monthly = parse(month.amount);
  const yearly = parse(year.amount);
  if (!monthly || !yearly) return null;
  const saving = Math.round((1 - yearly / (monthly * 12)) * 100);
  return saving >= 5 ? saving : null;
}
