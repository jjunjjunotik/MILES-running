/**
 * .env 의 Paddle 설정이 실제 Paddle 에서 통하는지 확인한다.
 *
 *   npm run check:paddle
 *
 * 비밀키 값은 출력하지 않는다. 각 요청의 결과(상태 코드, Paddle 오류 코드와 설명)만 보여 준다.
 * sandbox 에서는 결제되지 않은 임시 거래(draft) 하나를 만들어 볼 뿐 청구는 일어나지 않는다.
 */
import fs from "node:fs";

const ENV_FILE = process.env.ENV_FILE ?? ".env";
if (fs.existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);

const read = (name) => (process.env[name] ?? "").trim();
const env = read("PADDLE_ENV") === "production" ? "production" : "sandbox";
const base = env === "production" ? "https://api.paddle.com" : "https://sandbox-api.paddle.com";
const key = read("PADDLE_API_KEY");

const shape = (name, prefix) => {
  const value = read(name);
  if (!value) return `${name}: 비어 있음`;
  const ok = prefix.some((p) => value.startsWith(p));
  const spaces = value !== (process.env[name] ?? "") || /\s|["']/.test(value);
  return `${name}: ${ok ? "형식 맞음" : `형식 다름 (${prefix.join(" 또는 ")} 로 시작해야 함)`}${spaces ? ", 공백/따옴표 섞임" : ""}`;
};

console.log(`환경: ${env} (${base})`);
for (const line of [
  shape("PADDLE_API_KEY", env === "production" ? ["pdl_live_apikey_"] : ["pdl_sdbx_apikey_"]),
  shape("PADDLE_WEBHOOK_SECRET", ["pdl_ntfset_"]),
  shape("PADDLE_CLIENT_TOKEN", env === "production" ? ["live_"] : ["test_"]),
  shape("PADDLE_PRICE_MONTHLY", ["pri_"]),
  shape("PADDLE_PRICE_YEARLY", ["pri_"]),
]) console.log(`  ${line}`);
if (!key) process.exit(1);

async function call(label, method, path, body) {
  try {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await response.json().catch(() => null);
    if (response.ok) {
      console.log(`  ok    ${label}`);
      return json?.data;
    }
    console.log(`  실패  ${label} → ${response.status} ${json?.error?.code ?? ""}`);
    if (json?.error?.detail) console.log(`        ${json.error.detail}`);
  } catch (err) {
    console.log(`  실패  ${label} → 연결 안 됨 (${err.cause?.code ?? err.message})`);
  }
  return null;
}

console.log("\nPaddle 에 물어보기");
await call("키 확인 (이벤트 종류 목록)", "GET", "/event-types");
const month = read("PADDLE_PRICE_MONTHLY");
const year = read("PADDLE_PRICE_YEARLY");
const monthPrice = month ? await call("월간 가격 읽기", "GET", `/prices/${month}`) : null;
const yearPrice = year ? await call("연간 가격 읽기", "GET", `/prices/${year}`) : null;
for (const [label, price] of [["월간", monthPrice], ["연간", yearPrice]]) {
  if (price) {
    console.log(
      `        ${label}: ${price.unit_price?.amount} ${price.unit_price?.currency_code}, 주기 ${price.billing_cycle?.interval ?? "없음(일회성)"}, 상태 ${price.status}`,
    );
  }
}
const priceId = month || year;
if (priceId) {
  await call("결제 거래 만들기 (임시, 청구 없음)", "POST", "/transactions", {
    items: [{ price_id: priceId, quantity: 1 }],
  });
}
