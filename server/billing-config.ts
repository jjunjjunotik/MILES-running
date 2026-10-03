/**
 * 결제(Paddle) 설정. 다른 서버 모듈을 가져오지 않아 어디서든 안전하게 읽을 수 있다.
 *
 * 다섯 값이 모두 있어야 결제 기능이 켜진다. 하나라도 비면 결제 화면을 그리지 않고
 * 사용 한도도 걸지 않는다(지금까지처럼 무제한). 올리지 못하는 요금제를 보여 주면서
 * 한도만 거는 상태를 만들지 않기 위해서다.
 *
 *   PADDLE_ENV             sandbox | production (기본 sandbox)
 *   PADDLE_API_KEY         서버 전용 비밀키. 브라우저로 절대 내보내지 않는다.
 *   PADDLE_WEBHOOK_SECRET  웹훅 서명 검증용 비밀값
 *   PADDLE_CLIENT_TOKEN    결제 창(Paddle.js)용 공개 토큰 (test_… / live_…)
 *   PADDLE_PRICE_MONTHLY   월간 요금 아이디 (pri_…)
 *   PADDLE_PRICE_YEARLY    연간 요금 아이디 (pri_…) — 둘 중 하나만 있어도 된다
 */

export type PaddleEnvironment = "sandbox" | "production";

export interface BillingConfig {
  enabled: boolean;
  environment: PaddleEnvironment;
  apiKey: string;
  webhookSecret: string;
  clientToken: string;
  prices: { month: string | null; year: string | null };
}

const read = (name: string): string => (process.env[name] ?? "").trim();

export function billingConfig(): BillingConfig {
  const environment: PaddleEnvironment =
    read("PADDLE_ENV") === "production" ? "production" : "sandbox";
  const apiKey = read("PADDLE_API_KEY");
  const webhookSecret = read("PADDLE_WEBHOOK_SECRET");
  const clientToken = read("PADDLE_CLIENT_TOKEN");
  const month = read("PADDLE_PRICE_MONTHLY") || null;
  const year = read("PADDLE_PRICE_YEARLY") || null;

  return {
    enabled: Boolean(apiKey && webhookSecret && clientToken && (month || year)),
    environment,
    apiKey,
    webhookSecret,
    clientToken,
    prices: { month, year },
  };
}

export function billingEnabled(): boolean {
  return billingConfig().enabled;
}

/** 일부만 설정했을 때 무엇이 빠졌는지 알려 준다. 값은 절대 출력하지 않는다. */
export function missingBillingSettings(): string[] {
  const names = [
    "PADDLE_API_KEY",
    "PADDLE_WEBHOOK_SECRET",
    "PADDLE_CLIENT_TOKEN",
  ];
  const any =
    names.some((name) => read(name)) ||
    Boolean(read("PADDLE_PRICE_MONTHLY") || read("PADDLE_PRICE_YEARLY"));
  if (!any) return [];

  const missing = names.filter((name) => !read(name));
  if (!read("PADDLE_PRICE_MONTHLY") && !read("PADDLE_PRICE_YEARLY")) {
    missing.push("PADDLE_PRICE_MONTHLY 또는 PADDLE_PRICE_YEARLY");
  }
  return missing;
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Paddle API 주소. PADDLE_API_URL 은 테스트용 모의 서버를 가리킬 때만 쓰며,
 * 비밀키가 엉뚱한 곳으로 가지 않도록 같은 기기(루프백) 주소만 받아들인다.
 */
export function paddleApiBase(environment: PaddleEnvironment): string {
  const override = read("PADDLE_API_URL");
  if (override) {
    try {
      const url = new URL(override);
      if (LOOPBACK.has(url.hostname)) return override.replace(/\/+$/, "");
    } catch {
      // 잘못된 주소는 무시하고 기본값을 쓴다.
    }
  }
  return environment === "production"
    ? "https://api.paddle.com"
    : "https://sandbox-api.paddle.com";
}
