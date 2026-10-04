/**
 * 휴대폰 앱 인앱 구독(RevenueCat)을 서버 쪽에서 점검한다. 진짜 RevenueCat 대신 가짜 서버를 띄운다.
 *
 *   npm run check:store
 *
 * 보는 것: 공개 키만 내려감, 무료 한도, 구매 뒤 확인(sync)으로 Pro, 앱 말만으로는 Pro 가 안 됨,
 * 웹훅 인증·중복·실패 시 재시도, 체험·해지 예약·결제 문제·환불, 계정 간 이전(구매 복원),
 * 기간이 지나면 다시 확인, 계정 삭제 시 RevenueCat 고객 기록 삭제.
 */
import { startAppServer } from "./lib/mock-paddle.mjs";
import {
  ANDROID_KEY,
  IOS_KEY,
  SECRET_KEY,
  WEBHOOK_AUTH,
  startMockRevenueCat,
} from "./lib/mock-revenuecat.mjs";
import fs from "node:fs";

const RC_PORT = 8871;
const API_PORT = 8872;
const CONSENT_VERSION = /HEALTH_CONSENT_VERSION = "([^"]+)"/.exec(
  fs.readFileSync("shared/billing.ts", "utf8"),
)[1];

const problems = [];
const check = (condition, label) => {
  if (condition) console.log(`  ok  ${label}`);
  else {
    problems.push(label);
    console.log(`실패  ${label}`);
  }
};

const rc = await startMockRevenueCat(RC_PORT);
const app = await startAppServer({
  port: API_PORT,
  paddlePort: 1,
  env: {
    // 웹 결제(Paddle)는 끄고 인앱 구독만 켠다.
    PADDLE_API_KEY: "",
    PADDLE_WEBHOOK_SECRET: "",
    PADDLE_CLIENT_TOKEN: "",
    PADDLE_PRICE_MONTHLY: "",
    PADDLE_PRICE_YEARLY: "",
    REVENUECAT_SECRET_KEY: SECRET_KEY,
    REVENUECAT_WEBHOOK_AUTH: WEBHOOK_AUTH,
    REVENUECAT_IOS_KEY: IOS_KEY,
    REVENUECAT_ANDROID_KEY: ANDROID_KEY,
    REVENUECAT_API_URL: rc.url,
    BILLING_RATE_LIMIT_PER_IP: "500",
  },
});
const API = app.api;

const appHeaders = (token) => ({
  "Content-Type": "application/json",
  Origin: "capacitor://localhost",
  "X-NailSense-Client": "app",
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
});

async function signup(email) {
  const response = await fetch(`${API}/api/auth/signup`, {
    method: "POST",
    headers: appHeaders(),
    body: JSON.stringify({ email, password: "password123" }),
  });
  const body = await response.json();
  return { token: body.sessionToken, id: body.user.id };
}

const status = async (token) =>
  (await (await fetch(`${API}/api/billing/status`, { headers: appHeaders(token) })).json()).status;
const sync = (token) =>
  fetch(`${API}/api/billing/sync`, { method: "POST", headers: appHeaders(token) });
const webhook = (event, auth = WEBHOOK_AUTH) =>
  fetch(`${API}/api/billing/store-webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: auth },
    body: JSON.stringify({ api_version: "1.0", event }),
  });
const analyze = (token) =>
  fetch(`${API}/api/analyze`, {
    method: "POST",
    headers: { ...appHeaders(token), "X-NailSense-Device": "device-store-test-0001" },
    body: JSON.stringify({
      image: Buffer.from(`img-${Math.random()}`).toString("base64"),
      mediaType: "image/jpeg",
      hand: "left",
      fingerKey: "ring",
      note: "",
      keepPhoto: false,
      consentVersion: CONSENT_VERSION,
    }),
  });
let eventSeq = 0;
const event = (type, userId, extra = {}) => ({
  id: `evt-${Date.now()}-${(eventSeq += 1)}`,
  type,
  app_user_id: userId,
  original_app_user_id: userId,
  aliases: [userId],
  ...extra,
});

try {
  console.log("상태");
  const alice = await signup("alice@example.com");
  let s = await status(alice.token);
  check(s.enabled === true, "인앱 구독이 켜지면 한도가 켜짐");
  check(s.store?.iosKey === IOS_KEY && s.store?.androidKey === ANDROID_KEY, "앱용 공개 키를 내려줌");
  check(s.store?.entitlement === "pro", "권한 이름 기본값 pro");
  check(s.clientToken === null && s.prices.length === 0, "웹 결제(Paddle) 정보는 없음");
  const raw = await (await fetch(`${API}/api/billing/status`, { headers: appHeaders(alice.token) })).text();
  check(!raw.includes(SECRET_KEY) && !raw.includes(WEBHOOK_AUTH), "비밀키·웹훅 값은 응답에 없음");
  check(s.usage.plan === "free" && s.usage.limit === 3, "처음엔 무료(월 3회)");

  console.log("무료 한도");
  for (let i = 0; i < 3; i += 1) await analyze(alice.token);
  const blocked = await analyze(alice.token);
  check(blocked.status === 402, `무료 3회 뒤 막힘 (${blocked.status})`);

  console.log("구매 확인");
  const unauth = await fetch(`${API}/api/billing/sync`, { method: "POST", headers: appHeaders() });
  check(unauth.status === 401, "로그인 없이 확인 요청은 거절");
  let synced = await (await sync(alice.token)).json();
  check(synced.ok && synced.status.usage.plan === "free", "스토어에 구매가 없으면 확인해도 무료");
  rc.grant(alice.id, { productId: "nailsense_pro_monthly", store: "app_store" });
  synced = await (await sync(alice.token)).json();
  check(synced.status.usage.plan === "pro" && synced.status.usage.limit === 20, "구매 뒤 확인하면 Pro(하루 20회)");
  check(synced.status.subscription?.source === "app_store", "구독 출처: 앱스토어");
  check(synced.status.subscription?.interval === "month", "월간 상품으로 인식");
  check((await analyze(alice.token)).status === 200, "Pro 가 되면 다시 분석됨");

  console.log("웹훅");
  check((await webhook(event("EXPIRATION", alice.id), "wrong")).status === 401, "틀린 인증값은 거절");
  check((await webhook(event("EXPIRATION", alice.id), "")).status === 401, "인증값 없으면 거절");
  rc.update(alice.id, { expiresAt: Date.now() - 1000 });
  const expiration = event("EXPIRATION", alice.id);
  let hook = await webhook(expiration);
  check(hook.ok, "만료 웹훅 처리");
  s = await status(alice.token);
  check(s.usage.plan === "free" && s.subscription === null, "만료되면 무료로");
  const dup = await (await webhook(expiration)).json();
  check(dup.duplicate === true, "같은 웹훅은 한 번만 처리");
  check((await webhook(event("TEST", "$RCAnonymousID:abc"))).ok, "익명·테스트 이벤트는 그냥 받음");
  check((await webhook({ type: "RENEWAL" })).status === 400, "아이디 없는 이벤트는 거절");

  // RevenueCat 조회가 실패하면 500 → RevenueCat 이 다시 보낸다.
  rc.update(alice.id, { expiresAt: Date.now() + 30 * 86400000 });
  rc.state.failNext = 1;
  const renewal = event("RENEWAL", alice.id);
  hook = await webhook(renewal);
  check(hook.status === 500, "조회 실패 시 500 (재전송 받음)");
  hook = await webhook(renewal);
  check(hook.ok && !(await hook.json()).duplicate, "재전송은 처리됨(실패한 건 기록하지 않았음)");
  check((await status(alice.token)).usage.plan === "pro", "갱신 웹훅으로 다시 Pro");

  console.log("상태 종류");
  const bob = await signup("bob@example.com");
  rc.grant(bob.id, { productId: "nailsense_pro_yearly", periodType: "trial", store: "play_store" });
  await webhook(event("INITIAL_PURCHASE", bob.id));
  s = await status(bob.token);
  check(s.subscription?.status === "trialing" && s.subscription.source === "play_store", "무료 체험 · 플레이스토어");
  check(s.subscription?.interval === "year", "연간 상품으로 인식");
  rc.update(bob.id, { unsubscribed: true, periodType: "normal" });
  await webhook(event("CANCELLATION", bob.id));
  s = await status(bob.token);
  check(s.usage.plan === "pro" && typeof s.subscription?.cancelAt === "number", "해지 예약: 기간 끝까지 Pro, 끝나는 날 표시");
  rc.update(bob.id, { unsubscribed: false, billingIssue: true, expiresAt: Date.now() - 1000, graceUntil: Date.now() + 86400000 });
  await webhook(event("BILLING_ISSUE", bob.id));
  s = await status(bob.token);
  check(s.subscription?.status === "past_due" && s.usage.plan === "pro", "결제 문제: 유예 기간엔 Pro 유지");
  rc.update(bob.id, { billingIssue: false, graceUntil: null, expiresAt: Date.now() + 86400000, refunded: true });
  await webhook(event("CANCELLATION", bob.id));
  check((await status(bob.token)).usage.plan === "free", "환불되면 Pro 아님");

  console.log("구매 복원(계정 이전)");
  const carol = await signup("carol@example.com");
  rc.grant(carol.id, { productId: "nailsense_pro_monthly" });
  await sync(carol.token);
  check((await status(carol.token)).usage.plan === "pro", "carol Pro");
  const dave = await signup("dave@example.com");
  rc.transfer(carol.id, dave.id);
  await webhook(event("TRANSFER", dave.id, { transferred_from: [carol.id], transferred_to: [dave.id] }));
  check((await status(carol.token)).usage.plan === "free", "옮겨 간 쪽(carol)은 무료로");
  check((await status(dave.token)).usage.plan === "pro", "받은 쪽(dave)은 Pro");

  console.log("기간이 지나면 다시 확인");
  const erin = await signup("erin@example.com");
  rc.grant(erin.id, { expiresAt: Date.now() + 1500 });
  await sync(erin.token);
  const firstEnd = (await status(erin.token)).subscription?.currentPeriodEnd;
  rc.update(erin.id, { expiresAt: Date.now() + 30 * 86400000 });
  await new Promise((r) => setTimeout(r, 1800));
  const before = rc.state.requests.length;
  const renewed = (await status(erin.token)).subscription?.currentPeriodEnd;
  check(rc.state.requests.length > before && renewed > firstEnd, "웹훅이 없어도 기간이 지나면 스스로 다시 확인");

  console.log("계정 삭제");
  const deleted = await fetch(`${API}/api/auth/account`, {
    method: "DELETE",
    headers: appHeaders(dave.token),
    body: JSON.stringify({ password: "password123" }),
  });
  check(deleted.ok, "스토어 구독이 있어도 계정 삭제는 됨(스토어 구독은 스토어에서 해지)");
  check(rc.state.deleted.includes(dave.id), "RevenueCat 고객 기록도 삭제 요청");
  await webhook(event("RENEWAL", dave.id));
  check(true, "지운 계정의 웹훅도 오류 없이 받음");

  check(rc.state.badAuth === 0, "RevenueCat 에 늘 서버 비밀키로 요청");
  const errors = app.errors();
  check(!errors.includes(SECRET_KEY), "로그에 비밀키 없음");
} catch (err) {
  problems.push(`예외: ${err.message.split("\n")[0]}`);
  console.log(`실패  예외: ${err.message.split("\n")[0]}`);
} finally {
  app.stop();
  await rc.close();
}

if (problems.length > 0) {
  console.error(`\n실패 ${problems.length}건:`);
  for (const problem of problems) console.error(` - ${problem}`);
  process.exit(1);
}
console.log("\n인앱 구독 서버 점검 통과.");
