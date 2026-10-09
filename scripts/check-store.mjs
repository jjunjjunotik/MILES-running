/**
 * 요금제 · 사용 한도 · 인앱 구독(RevenueCat)을 서버 쪽에서 점검한다. 진짜 RevenueCat 대신 가짜 서버를 띄운다.
 *
 *   npm run check:store
 *
 * 보는 것
 * - 웹 결제(Paddle)가 정말 없어졌는지: 옛 결제 경로 404, CSP 에 결제 업체 출처 없음, 남은 PADDLE_ 설정 경고
 * - 동의 없는 분석 거절, 무료 한도(손님: 웹 쿠키 · 앱 기기 아이디 + IP, 계정: 월간), Pro 하루 한도
 * - 공개 키만 내려감, 구매 뒤 확인(sync)으로 Pro, 앱 말만으로는 Pro 가 안 됨
 * - 웹훅 인증 · 중복 · 실패 시 재시도, 체험 · 해지 예약 · 결제 문제 · 환불, 계정 간 이전(구매 복원)
 * - 기간이 지나면 다시 확인, 계정 삭제 시 RevenueCat 고객 기록 삭제
 */
import http from "node:http";
import fs from "node:fs";
import { startAppServer } from "./lib/app-server.mjs";
import {
  ANDROID_KEY,
  IOS_KEY,
  SECRET_KEY,
  WEBHOOK_AUTH,
  startMockRevenueCat,
} from "./lib/mock-revenuecat.mjs";

const RC_PORT = 8871;
const API_PORT = 8872;
const CONSENT_VERSION = /HEALTH_CONSENT_VERSION = "([^"]+)"/.exec(
  fs.readFileSync("shared/billing.ts", "utf8"),
)[1];
// 예전 웹 결제 설정이 남아 있는 상황을 흉내 낸다. 진짜 키가 아니다(비밀값 검사에 걸리지 않게 나눠 적음).
const LEFTOVER_PADDLE_KEY = "pdl_" + "sdbx_apikey_" + "leftovervalue0000";

const problems = [];
const check = (condition, label) => {
  if (condition) console.log(`  ok  ${label}`);
  else {
    problems.push(label);
    console.log(`실패  ${label}`);
  }
};

const rc = await startMockRevenueCat(RC_PORT);
let app;
try {
  app = await startAppServer({
    port: API_PORT,
    env: {
      REVENUECAT_SECRET_KEY: SECRET_KEY,
      REVENUECAT_WEBHOOK_AUTH: WEBHOOK_AUTH,
      REVENUECAT_IOS_KEY: IOS_KEY,
      REVENUECAT_ANDROID_KEY: ANDROID_KEY,
      REVENUECAT_API_URL: rc.url,
      FREE_SCANS_PER_MONTH: "3",
      GUEST_SCANS_PER_IP_PER_MONTH: "5",
      PRO_SCANS_PER_DAY: "4",
      PADDLE_API_KEY: LEFTOVER_PADDLE_KEY,
    },
  });
} catch (err) {
  await rc.close();
  throw err;
}
const API = app.api;

/**
 * 요청 하나. from 으로 보내는 쪽 주소(127.0.0.x)를 바꿔 서로 다른 IP 의 손님을 흉내 낸다.
 * 리눅스에서는 127.0.0.0/8 전체가 이 기기 주소라 따로 설정할 것이 없다.
 */
function request(method, urlPath, { body, headers = {}, from } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request(
      `${API}${urlPath}`,
      {
        method,
        localAddress: from,
        headers: {
          ...(data ? { "content-type": "application/json", "content-length": Buffer.byteLength(data) } : {}),
          ...headers,
        },
      },
      (res) => {
        let raw = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (raw += chunk));
        res.on("end", () => {
          let json = null;
          try {
            json = JSON.parse(raw);
          } catch {}
          resolve({ status: res.statusCode, headers: res.headers, json, text: raw });
        });
      },
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

const appHeaders = (token, extra = {}) => ({
  Origin: "capacitor://localhost",
  "X-NailSense-Client": "app",
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
  ...extra,
});

async function signup(email) {
  const response = await request("POST", "/api/auth/signup", {
    headers: appHeaders(),
    body: { email, password: "password123" },
  });
  return { token: response.json.sessionToken, id: response.json.user.id };
}

const scanBody = (extra = {}) => ({
  image: Buffer.from(`img-${Math.random()}`).toString("base64"),
  mediaType: "image/jpeg",
  hand: "left",
  fingerKey: "ring",
  note: "",
  keepPhoto: false,
  consentVersion: CONSENT_VERSION,
  ...extra,
});

const status = async (token) =>
  (await request("GET", "/api/billing/status", { headers: appHeaders(token) })).json.status;
const sync = (token) => request("POST", "/api/billing/sync", { headers: appHeaders(token) });
const webhook = (event, auth = WEBHOOK_AUTH) =>
  request("POST", "/api/billing/store-webhook", {
    headers: { Authorization: auth },
    body: { api_version: "1.0", event },
  });
const analyze = (token) =>
  request("POST", "/api/analyze", {
    headers: appHeaders(token, { "X-NailSense-Device": "device-store-test-0001" }),
    body: scanBody(),
  });

/** 쿠키를 기억하는 웹 손님 */
function webGuest(from) {
  const jar = new Map();
  return async (method, urlPath, body) => {
    const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    const response = await request(method, urlPath, {
      body,
      from,
      headers: cookie ? { cookie } : {},
    });
    for (const line of response.headers["set-cookie"] ?? []) {
      const [pair] = line.split(";");
      const index = pair.indexOf("=");
      jar.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
    }
    return response;
  };
}

/** 기기 아이디 헤더를 보내는 앱 손님 */
const appGuest = (deviceId, from) => () =>
  request("POST", "/api/analyze", {
    from,
    headers: appHeaders(null, { "X-NailSense-Device": deviceId }),
    body: scanBody(),
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
  console.log("웹 결제(Paddle)는 없음");
  for (const [method, route] of [
    ["POST", "/api/billing/checkout"],
    ["POST", "/api/billing/confirm"],
    ["POST", "/api/billing/cancel"],
    ["POST", "/api/billing/resume"],
    ["POST", "/api/billing/portal"],
    ["POST", "/api/billing/webhook"],
  ]) {
    const response = await request(method, route, { body: {} });
    check(response.status === 404, `${route} 없음 (${response.status})`);
  }
  const home = await request("GET", "/");
  const csp = String(home.headers["content-security-policy"] ?? "");
  check(csp.length > 0 && !/paddle/i.test(csp), "CSP 에 결제 업체 출처가 없음");
  check(home.headers["cross-origin-opener-policy"] === "same-origin", "외부 결제 창이 없으니 COOP 는 same-origin");
  const startupLog = app.output();
  check(startupLog.includes("PADDLE_API_KEY") && !startupLog.includes(LEFTOVER_PADDLE_KEY), "남은 PADDLE_ 설정은 이름만 경고하고 값은 찍지 않음");

  console.log("상태");
  const alice = await signup("alice@example.com");
  let s = await status(alice.token);
  check(s.enabled === true, "인앱 구독이 켜지면 한도가 켜짐");
  check(s.store?.iosKey === IOS_KEY && s.store?.androidKey === ANDROID_KEY, "앱용 공개 키를 내려줌");
  check(s.store?.entitlement === "pro", "권한 이름 기본값 pro");
  check(!("clientToken" in s) && !("prices" in s) && !("environment" in s), "웹 결제용 항목은 응답에 없음");
  const raw = (await request("GET", "/api/billing/status", { headers: appHeaders(alice.token) })).text;
  check(!raw.includes(SECRET_KEY) && !raw.includes(WEBHOOK_AUTH), "비밀키·웹훅 값은 응답에 없음");
  check(s.usage.plan === "free" && s.usage.limit === 3, "처음엔 무료(월 3회)");

  console.log("동의");
  const noConsent = await request("POST", "/api/analyze", {
    headers: appHeaders(alice.token),
    body: scanBody({ consentVersion: undefined }),
  });
  check(noConsent.status === 400 && noConsent.json?.code === "consent_required", "동의 없는 분석 거절");
  const oldConsent = await request("POST", "/api/analyze", {
    headers: appHeaders(alice.token),
    body: scanBody({ consentVersion: "2020-01" }),
  });
  check(oldConsent.json?.code === "consent_required", "옛 동의 문구 버전은 거절");

  console.log("손님 한도 (웹: 쿠키 + IP)");
  const web1 = webGuest("127.0.0.2");
  for (let i = 1; i <= 3; i += 1) {
    const r = await web1("POST", "/api/analyze", scanBody());
    check(r.status === 200 && r.json?.usage?.used === i, `웹 손님 분석 ${i}/3`);
  }
  const webOver = await web1("POST", "/api/analyze", scanBody());
  check(webOver.status === 402 && webOver.json?.code === "quota_exceeded", "4번째는 한도 초과");
  // 쿠키를 지운 새 손님(같은 IP): 기기 한도는 새로 3회지만, 같은 IP 손님 전체 한도 5회에 먼저 걸린다.
  const web2 = webGuest("127.0.0.2");
  const w = [];
  for (let i = 0; i < 3; i += 1) w.push(await web2("POST", "/api/analyze", scanBody()));
  check(w[0].status === 200 && w[1].status === 200 && w[2].status === 402, "쿠키를 지워도 같은 IP 손님 한도(5회)에 걸림");
  check(w[2].json?.usage?.used >= w[2].json?.usage?.limit, "IP 한도에 걸려도 화면에는 다 쓴 것으로 안내");

  console.log("손님 한도 (앱: 기기 아이디 + IP)");
  const phoneA = appGuest("device-guest-aaaaaaaaaaaa", "127.0.0.3");
  for (let i = 1; i <= 3; i += 1) {
    const r = await phoneA();
    check(r.status === 200 && r.json?.usage?.used === i, `앱 손님 분석 ${i}/3`);
  }
  check((await phoneA()).status === 402, "앱 손님도 4번째는 한도 초과");
  // 앱을 지우고 다시 깔아 기기 아이디가 바뀌어도, 같은 IP 손님 한도는 그대로다.
  const phoneB = appGuest("device-guest-bbbbbbbbbbbb", "127.0.0.3");
  const p = [await phoneB(), await phoneB(), await phoneB()];
  check(p[0].status === 200 && p[1].status === 200 && p[2].status === 402, "기기 아이디를 바꿔도 같은 IP 손님 한도(5회)에 걸림");
  const otherIp = await appGuest("device-guest-cccccccccccc", "127.0.0.4")();
  check(otherIp.status === 200, "다른 IP 의 손님은 따로 셈");

  console.log("계정 한도");
  for (let i = 0; i < 3; i += 1) await analyze(alice.token);
  const blocked = await analyze(alice.token);
  check(blocked.status === 402 && blocked.json?.code === "quota_exceeded", `계정 무료 3회 뒤 막힘 (${blocked.status})`);
  const prefs = await request("GET", "/api/preferences", { headers: appHeaders(alice.token) });
  check(prefs.json?.preferences?.healthConsentVersion === CONSENT_VERSION, "로그인 상태의 분석은 동의 기록을 계정에 남김");

  console.log("구매 확인");
  const unauth = await request("POST", "/api/billing/sync", { headers: appHeaders() });
  check(unauth.status === 401, "로그인 없이 확인 요청은 거절");
  let synced = (await sync(alice.token)).json;
  check(synced.ok && synced.status.usage.plan === "free", "스토어에 구매가 없으면 확인해도 무료");
  rc.grant(alice.id, { productId: "nailsense_pro_monthly", store: "app_store" });
  synced = (await sync(alice.token)).json;
  check(synced.status.usage.plan === "pro" && synced.status.usage.limit === 4 && synced.status.usage.period === "day", "구매 뒤 확인하면 Pro(하루 한도로 셈)");
  check(synced.status.subscription?.source === "app_store", "구독 출처: 앱스토어");
  check(synced.status.subscription?.interval === "month", "월간 상품으로 인식");

  console.log("Pro 하루 한도");
  for (let i = 1; i <= 4; i += 1) {
    const r = await analyze(alice.token);
    check(r.status === 200 && r.json?.usage?.used === i, `Pro 분석 ${i}/4 (무료 한도를 다 쓴 뒤에도)`);
  }
  const proOver = await analyze(alice.token);
  check(proOver.status === 402 && /today's limit of 4 scans/.test(proOver.json?.error ?? ""), "Pro 도 하루 한도를 넘으면 막힘");
  const proOverKo = await request("POST", "/api/analyze", {
    headers: appHeaders(alice.token, { "X-NailSense-Locale": "ko", "X-NailSense-Device": "device-store-test-0001" }),
    body: scanBody(),
  });
  check(/오늘 분석 한도 4회/.test(proOverKo.json?.error ?? ""), "한도 안내는 한국어로도");

  console.log("웹훅");
  check((await webhook(event("EXPIRATION", alice.id), "wrong")).status === 401, "틀린 인증값은 거절");
  check((await webhook(event("EXPIRATION", alice.id), "")).status === 401, "인증값 없으면 거절");
  rc.update(alice.id, { expiresAt: Date.now() - 1000 });
  const expiration = event("EXPIRATION", alice.id);
  let hook = await webhook(expiration);
  check(hook.status === 200, "만료 웹훅 처리");
  s = await status(alice.token);
  check(s.usage.plan === "free" && s.subscription === null, "만료되면 무료로");
  const dup = (await webhook(expiration)).json;
  check(dup?.duplicate === true, "같은 웹훅은 한 번만 처리");
  check((await webhook(event("TEST", "$RCAnonymousID:abc"))).status === 200, "익명·테스트 이벤트는 그냥 받음");
  check((await webhook({ type: "RENEWAL" })).status === 400, "아이디 없는 이벤트는 거절");

  // RevenueCat 조회가 실패하면 500 → RevenueCat 이 다시 보낸다.
  rc.update(alice.id, { expiresAt: Date.now() + 30 * 86400000 });
  rc.state.failNext = 1;
  const renewal = event("RENEWAL", alice.id);
  hook = await webhook(renewal);
  check(hook.status === 500, "조회 실패 시 500 (재전송 받음)");
  hook = await webhook(renewal);
  check(hook.status === 200 && !hook.json?.duplicate, "재전송은 처리됨(실패한 건 기록하지 않았음)");
  check((await status(alice.token)).usage.plan === "pro", "갱신 웹훅으로 다시 Pro");
  const syncFailKo = await (async () => {
    rc.state.failNext = 1;
    return request("POST", "/api/billing/sync", { headers: appHeaders(alice.token, { "X-NailSense-Locale": "ko" }) });
  })();
  check(syncFailKo.status === 502 && /구독 상태를 확인하지 못했습니다/.test(syncFailKo.json?.error ?? ""), "확인 실패 안내도 한국어로");

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

  const frank = await signup("frank@example.com");
  rc.grant(frank.id, { productId: "rc_promo_pro_monthly", store: "promotional" });
  await sync(frank.token);
  s = await status(frank.token);
  check(s.usage.plan === "pro" && s.subscription?.source === "other", "스토어 결제가 아닌 이용권도 Pro (출처는 other)");

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
  const deleted = await request("DELETE", "/api/auth/account", {
    headers: appHeaders(dave.token),
    body: { password: "password123" },
  });
  check(deleted.status === 200, "스토어 구독이 있어도 계정 삭제는 됨(스토어 구독은 스토어에서 해지)");
  check(rc.state.deleted.includes(dave.id), "RevenueCat 고객 기록도 삭제 요청");
  const afterDelete = await webhook(event("RENEWAL", dave.id));
  check(afterDelete.status === 200, "지운 계정의 웹훅도 오류 없이 받음");

  check(rc.state.badAuth === 0, "RevenueCat 에 늘 서버 비밀키로 요청");
  check(!app.output().includes(SECRET_KEY), "로그에 비밀키 없음");
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
console.log("\n요금제·한도·인앱 구독 서버 점검 통과.");
