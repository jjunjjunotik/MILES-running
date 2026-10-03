/**
 * 구독 결제와 사용 한도가 실제로 막을 것을 막는지 확인한다.
 *
 *   npm run check:billing
 *
 * 진짜 Paddle 을 부르지 않는다. 이 스크립트가 Paddle API 를 흉내 내는 모의 서버를 띄우고,
 * 앱 서버를 그쪽으로 향하게 한 뒤(PADDLE_API_URL, 루프백만 허용), 서명한 웹훅을 직접 보낸다.
 *
 * 확인하는 것:
 * - 동의 없는 분석 요청 거절, 무료 한도(손님: 기기 + IP, 계정: 월간)
 * - 결제 거래는 로그인한 사람만, 서버가 만든 거래로만 계정에 연결
 * - 웹훅 서명 위조·시각 초과·형식 오류 거절, 같은 이벤트 두 번, 순서가 뒤바뀐 이벤트
 * - 웹훅 없이도 결제 확인(confirm)으로 Pro 전환, 남의 거래 확인 거절
 * - 해지 예약 → 기간 끝까지 Pro, 해지 철회, 해지 확정 후 무료
 * - 결제 수단 변경 링크, 이미 Pro 인데 또 결제 거절
 * - 계정 삭제 시 구독 즉시 해지, 해지 실패 시 계정 유지
 * - 비밀키가 응답에 섞이지 않음, CSP 에 Paddle 출처가 들어감
 */
import {
  CLIENT_TOKEN,
  API_KEY,
  PRICE_MONTH,
  PRICE_YEAR,
  WEBHOOK_SECRET,
  id,
  sendWebhook,
  startAppServer,
  startMockPaddle,
  subscriptionEntity,
} from "./lib/mock-paddle.mjs";

const PADDLE_PORT = 8852;
const API_PORT = 8853;

const problems = [];
const ok = (label) => console.log(`  ok  ${label}`);
const check = (condition, label, detail = "") => {
  if (condition) ok(label);
  else {
    problems.push(`${label}${detail ? ` (${detail})` : ""}`);
    console.log(`실패  ${label}${detail ? ` (${detail})` : ""}`);
  }
};

const { paddle, completeCheckout, close: closeMock } = await startMockPaddle(PADDLE_PORT);
let app;
try {
  app = await startAppServer({
    port: API_PORT,
    paddlePort: PADDLE_PORT,
    env: {
      FREE_SCANS_PER_MONTH: "3",
      GUEST_SCANS_PER_IP_PER_MONTH: "5",
      PRO_SCANS_PER_DAY: "4",
    },
  });
} catch (err) {
  closeMock();
  throw err;
}
const API = app.api;
const stop = () => {
  app.stop();
  closeMock();
};
const signedWebhook = (event, options) => sendWebhook(API, event, options);

/** 쿠키를 기억하는 간단한 브라우저 흉내 */
function client() {
  const jar = new Map();
  return async (method, urlPath, body, headers = {}) => {
    const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    const response = await fetch(`${API}${urlPath}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(cookie ? { cookie } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const line of response.headers.getSetCookie?.() ?? []) {
      const [pair] = line.split(";");
      const index = pair.indexOf("=");
      const name = pair.slice(0, index).trim();
      const value = pair.slice(index + 1).trim();
      if (value) jar.set(name, value);
      else jar.delete(name);
    }
    const text = await response.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {}
    return { status: response.status, json, text, headers: response.headers };
  };
}

const CONSENT = "2026-10";
const scanBody = (extra = {}) => ({
  image: Buffer.from("not really a photo").toString("base64"),
  mediaType: "image/jpeg",
  hand: "right",
  fingerKey: "index",
  note: "",
  keepPhoto: false,
  consentVersion: CONSENT,
  ...extra,
});

const subEvent = (type, sub, extra = {}) => ({
  event_id: id("evt"),
  event_type: type,
  occurred_at: new Date().toISOString(),
  notification_id: id("ntf"),
  data: { ...subscriptionEntity(sub), ...extra },
});

const txnEvent = (txn) => ({
  event_id: id("evt"),
  event_type: "transaction.completed",
  occurred_at: new Date().toISOString(),
  data: { id: txn.id, status: "completed", customer_id: txn.customer_id, subscription_id: txn.subscription_id },
});

try {
  /* ---------------------------- 상태와 보안 헤더 ---------------------------- */
  console.log("요금제 상태");
  const guest = client();
  const status0 = await guest("GET", "/api/billing/status");
  const s0 = status0.json?.status;
  check(s0?.enabled === true, "결제 기능 켜짐");
  check(s0?.usage?.plan === "free" && s0?.usage?.limit === 3 && s0?.usage?.used === 0, "손님 무료 한도 3회", JSON.stringify(s0?.usage));
  const month = s0?.prices?.find((p) => p.interval === "month");
  const year = s0?.prices?.find((p) => p.interval === "year");
  check(month?.amount === "$4.99" && month?.trial?.frequency === 7, "월간 $4.99, 7일 체험", JSON.stringify(month));
  check(year?.amount === "$29.99" && year?.trial === null, "연간 $29.99, 체험 없음", JSON.stringify(year));
  check(s0?.clientToken === CLIENT_TOKEN, "공개 토큰은 내려감");
  check(!status0.text.includes(API_KEY) && !status0.text.includes(WEBHOOK_SECRET), "비밀키는 응답에 없음");
  const csp = status0.headers.get("content-security-policy") ?? "";
  check(
    csp.includes("https://cdn.paddle.com") && csp.includes("https://sandbox-buy.paddle.com"),
    "CSP 에 Paddle 출처",
  );

  /* ------------------------------ 동의와 한도 ------------------------------ */
  console.log("동의와 무료 한도");
  const noConsent = await guest("POST", "/api/analyze", scanBody({ consentVersion: undefined }));
  check(noConsent.status === 400 && noConsent.json?.code === "consent_required", "동의 없는 분석 거절");
  const oldConsent = await guest("POST", "/api/analyze", scanBody({ consentVersion: "2020-01" }));
  check(oldConsent.json?.code === "consent_required", "옛 동의 버전 거절");

  for (let i = 1; i <= 3; i += 1) {
    const r = await guest("POST", "/api/analyze", scanBody());
    check(r.status === 200 && r.json?.usage?.used === i, `손님 분석 ${i}/3`, `${r.status} ${JSON.stringify(r.json?.usage ?? r.json?.code)}`);
  }
  const over = await guest("POST", "/api/analyze", scanBody());
  check(over.status === 402 && over.json?.code === "quota_exceeded", "4번째는 한도 초과", `${over.status} ${over.json?.code}`);

  // 쿠키를 지운 새 손님(같은 IP): 기기 한도는 새로 3회지만, 같은 IP 손님 전체 한도 5회에 먼저 걸린다.
  const guest2 = client();
  const g1 = await guest2("POST", "/api/analyze", scanBody());
  const g2 = await guest2("POST", "/api/analyze", scanBody());
  const g3 = await guest2("POST", "/api/analyze", scanBody());
  check(g1.status === 200 && g2.status === 200 && g3.status === 402, "쿠키를 지워도 같은 IP 손님 한도(5회)에 걸림", `${g1.status} ${g2.status} ${g3.status}`);
  check(g3.json?.usage?.used >= g3.json?.usage?.limit, "IP 한도에 걸려도 화면에는 다 쓴 것으로 안내", JSON.stringify(g3.json?.usage));

  /* ------------------------------ 계정 한도 ------------------------------ */
  const userA = client();
  const signup = await userA("POST", "/api/auth/signup", { email: "a@example.com", password: "password-a1" });
  check(signup.status === 201, "가입 A");
  for (let i = 1; i <= 3; i += 1) await userA("POST", "/api/analyze", scanBody());
  const overA = await userA("POST", "/api/analyze", scanBody());
  check(overA.json?.code === "quota_exceeded", "계정 무료 한도 3회");
  const consentPrefs = await userA("GET", "/api/preferences");
  check(consentPrefs.json?.preferences?.healthConsentVersion === CONSENT, "계정에 동의 기록 남음");

  /* ------------------------------ 결제 거래 ------------------------------ */
  console.log("결제");
  const anonCheckout = await guest("POST", "/api/billing/checkout", { interval: "month" });
  check(anonCheckout.status === 401, "로그인 없이 결제 거래 거절");
  const badInterval = await userA("POST", "/api/billing/checkout", { interval: "week" });
  check(badInterval.status === 400, "없는 요금제 거절");
  const checkoutA = await userA("POST", "/api/billing/checkout", { interval: "month" });
  const txnA = checkoutA.json?.transactionId;
  check(checkoutA.status === 200 && /^txn_/.test(txnA ?? ""), "결제 거래 생성");
  check(paddle.transactions.get(txnA)?.price_id === PRICE_MONTH, "서버가 정한 요금으로 거래");

  /* ------------------------------ 웹훅 검증 ------------------------------ */
  console.log("웹훅");
  const subA = completeCheckout(txnA);
  const createdA = subEvent("subscription.created", subA, { transaction_id: txnA });

  const forged = await signedWebhook(createdA, { secret: "wrong-secret" });
  check(forged.status === 401, "다른 비밀값으로 서명한 웹훅 거절");
  const stale = await signedWebhook(createdA, { ts: Math.floor(Date.now() / 1000) - 120 });
  check(stale.status === 401, "오래된 서명 거절");
  const tampered = await signedWebhook(createdA, { tamper: true });
  check(tampered.status === 401, "본문을 바꾼 웹훅 거절");
  const noSig = await fetch(`${API}/api/billing/webhook`, { method: "POST", body: JSON.stringify(createdA) });
  check(noSig.status === 401, "서명 없는 웹훅 거절");
  const stillFree = await userA("GET", "/api/billing/status");
  check(stillFree.json?.status?.usage?.plan === "free", "거절된 웹훅으로는 Pro 가 되지 않음");

  const delivered = await signedWebhook(createdA);
  check(delivered.status === 200, "정상 웹훅 처리");
  await signedWebhook(txnEvent(paddle.transactions.get(txnA)));
  const proA = (await userA("GET", "/api/billing/status")).json?.status;
  check(proA?.usage?.plan === "pro" && proA?.subscription?.status === "trialing", "결제 후 Pro(체험 중)", JSON.stringify(proA?.subscription));
  check(proA?.usage?.limit === 4 && proA?.usage?.period === "day", "Pro 는 하루 한도로 셈");
  const scanPro = await userA("POST", "/api/analyze", scanBody());
  check(scanPro.status === 200, "무료 한도를 다 쓴 뒤에도 Pro 는 분석 가능");

  const again = await signedWebhook(createdA);
  const againJson = await again.json();
  check(again.status === 200 && againJson.duplicate === true, "같은 이벤트 두 번은 한 번만 처리");

  const older = subEvent("subscription.updated", { ...subA, status: "past_due", updated_at: subA.updated_at - 60_000 });
  await signedWebhook(older);
  const afterOlder = (await userA("GET", "/api/billing/status")).json?.status;
  check(afterOlder?.subscription?.status === "trialing", "늦게 온 옛 이벤트는 무시");

  const againCheckout = await userA("POST", "/api/billing/checkout", { interval: "year" });
  check(againCheckout.status === 409, "이미 Pro 면 또 결제하지 않음");

  /* ------------------------------ 해지와 철회 ------------------------------ */
  console.log("해지");
  const cancel = await userA("POST", "/api/billing/cancel");
  const afterCancel = cancel.json?.status;
  check(afterCancel?.subscription?.cancelAt !== null && afterCancel?.usage?.plan === "pro", "해지 예약 후에도 기간 끝까지 Pro");
  const resume = await userA("POST", "/api/billing/resume");
  check(resume.json?.status?.subscription?.cancelAt === null, "해지 철회");
  await userA("POST", "/api/billing/cancel");
  // 기간이 끝나 Paddle 이 해지를 확정했다.
  subA.status = "canceled";
  subA.scheduled_change = null;
  subA.updated_at = Date.now();
  await signedWebhook(subEvent("subscription.canceled", subA));
  const afterCanceled = (await userA("GET", "/api/billing/status")).json?.status;
  check(afterCanceled?.usage?.plan === "free" && afterCanceled?.subscription === null, "해지 확정 후 무료");

  const portal = await userA("POST", "/api/billing/portal");
  check(portal.status === 200 && /^https:\/\/[a-z-]+\.paddle\.com\//.test(portal.json?.url ?? ""), "결제 관리 링크", portal.json?.url);

  /* ---------------------- 웹훅 없이 결제 확인(confirm) ---------------------- */
  console.log("결제 확인");
  const userB = client();
  await userB("POST", "/api/auth/signup", { email: "b@example.com", password: "password-b1" });
  const checkoutB = await userB("POST", "/api/billing/checkout", { interval: "year" });
  const txnB = checkoutB.json?.transactionId;
  completeCheckout(txnB, { trial: false });
  const stealB = await userA("POST", "/api/billing/confirm", { transactionId: txnB });
  check(stealB.status === 404, "남의 거래는 확인할 수 없음");
  const confirmB = await userB("POST", "/api/billing/confirm", { transactionId: txnB });
  check(confirmB.json?.status?.usage?.plan === "pro" && confirmB.json?.status?.subscription?.interval === "year", "웹훅 없이도 확인으로 Pro", JSON.stringify(confirmB.json?.status?.subscription ?? confirmB.json));
  const stillFreeA = (await userA("GET", "/api/billing/status")).json?.status;
  check(stillFreeA?.usage?.plan === "free", "다른 계정의 결제가 A 에게 번지지 않음");

  /* ---------------------- 우리가 만들지 않은 거래 ---------------------- */
  const strayTxn = { id: id("txn"), status: "draft", customer_id: null, subscription_id: null, price_id: PRICE_MONTH };
  paddle.transactions.set(strayTxn.id, strayTxn);
  const straySub = completeCheckout(strayTxn.id);
  await signedWebhook(subEvent("subscription.created", straySub, { transaction_id: strayTxn.id }));
  const userC = client();
  await userC("POST", "/api/auth/signup", { email: "c@example.com", password: "password-c1" });
  check((await userC("GET", "/api/billing/status")).json?.status?.usage?.plan === "free", "모르는 거래의 구독은 아무 계정에도 붙지 않음");

  /* ------------------------------ 계정 삭제 ------------------------------ */
  console.log("계정 삭제");
  const subB = [...paddle.subscriptions.values()].find((s) => paddle.transactions.get(txnB)?.subscription_id === s.id);
  paddle.failCancel.add(subB.id);
  const failedDelete = await userB("DELETE", "/api/auth/account", { password: "password-b1" });
  check(failedDelete.status === 502 && failedDelete.json?.code === "billing_error", "구독 해지가 실패하면 계정을 지우지 않음", `${failedDelete.status}`);
  const stillThere = await userB("GET", "/api/auth/me");
  check(stillThere.json?.user?.email === "b@example.com", "계정과 세션 유지");
  paddle.failCancel.delete(subB.id);
  const deleted = await userB("DELETE", "/api/auth/account", { password: "password-b1" });
  check(deleted.status === 200, "계정 삭제");
  check(subB.status === "canceled", "삭제 전에 구독 즉시 해지");

  const csp2 = (await fetch(`${API}/`)).headers.get("cross-origin-opener-policy");
  check(csp2 === "same-origin-allow-popups", "결제 창 팝업(PayPal 등)을 위한 COOP");
} finally {
  stop();
}

if (problems.length > 0 && app.errors()) console.log(app.errors().slice(0, 2000));

if (problems.length > 0) {
  console.error(`\n실패 ${problems.length}건:`);
  for (const problem of problems) console.error(` - ${problem}`);
  process.exit(1);
}
console.log("\n결제·한도 검증 통과");
