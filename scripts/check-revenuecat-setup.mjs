/**
 * RevenueCat 설정 도구(scripts/revenuecat.mjs)를 가짜 RevenueCat 으로 시험한다.
 *
 *   npm run check:rc-setup
 *
 * 1) 확인만 하면 아무것도 바꾸지 않고, 빠진 것을 알리며 0 이 아닌 코드로 끝난다.
 * 2) --apply 는 권한 · 상품 4개 · 오퍼링(현재) · 패키지 2개 · 웹훅을 문서대로 만든다.
 * 3) 다시 --apply 해도 아무것도 새로 만들지 않는다(여러 번 돌려도 안전).
 * 4) 비밀값(설정 키, 서버 키, 웹훅 인증값)은 출력에 나오지 않는다. 공개 키는 알려 준다.
 * 5) 앱이 없으면 만들고, 번들 아이디가 다른 앱에는 상품을 만들지 않는다. 틀린 서버 키를 잡아낸다.
 *    다른 오퍼링이 현재 오퍼링이면 바꾼다. 요청 제한(429)이 오면 기다렸다 다시 한다.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import { startMockRevenueCatV2, V2_KEY } from "./lib/mock-revenuecat-v2.mjs";
import { SECRET_KEY, startMockRevenueCat } from "./lib/mock-revenuecat.mjs";

const V2_PORT = 8892;
const V1_PORT = 8893;
const APP_ID = /appId:\s*"([^"]+)"/.exec(fs.readFileSync("capacitor.config.ts", "utf8"))[1];
const WEBHOOK_AUTH = "whauth-" + "setupcheck-0123456789";
const SERVER = "https://nailsense-test.example.com";

const problems = [];
const check = (condition, label) => {
  if (condition) console.log(`  ok  ${label}`);
  else {
    problems.push(label);
    console.log(`실패  ${label}`);
  }
};

/**
 * 도구를 다른 프로세스로 돌린다. 가짜 RevenueCat 이 이 프로세스 안에서 돌기 때문에
 * spawnSync 처럼 이 프로세스를 멈추면 가짜 서버가 대답하지 못한다. 그래서 비동기로 기다린다.
 */
function runTool(v2, v1, { apply = false, env = {} } = {}) {
  const child = spawn("node", ["scripts/revenuecat.mjs", ...(apply ? ["--apply"] : [])], {
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      ENV_FILE: "/nonexistent/.env",
      REVENUECAT_V2_KEY: V2_KEY,
      REVENUECAT_V2_URL: v2.url,
      REVENUECAT_API_URL: v1.url,
      REVENUECAT_SECRET_KEY: SECRET_KEY,
      REVENUECAT_WEBHOOK_AUTH: WEBHOOK_AUTH,
      APP_API_BASE: SERVER,
      ...env,
    },
  });
  let out = "";
  child.stdout.on("data", (chunk) => (out += chunk));
  child.stderr.on("data", (chunk) => (out += chunk));
  return new Promise((resolve) => child.on("close", (code) => resolve({ code, out })));
}

const noSecrets = (out) => ![V2_KEY, SECRET_KEY, WEBHOOK_AUTH].some((secret) => out.includes(secret));

const v1 = await startMockRevenueCat(V1_PORT);
let v2 = null;
try {
  console.log("1. 확인만 (앱만 있는 새 프로젝트)");
  v2 = await startMockRevenueCatV2(V2_PORT, {
    apps: [
      { name: "NailSense iOS", type: "app_store", bundle: APP_ID },
      { name: "NailSense Android", type: "play_store", bundle: APP_ID },
    ],
  });
  let run = await runTool(v2, v1);
  check(run.code === 1, `빠진 것이 있으면 0 이 아닌 코드 (${run.code})`);
  check(v2.writes().length === 0, "확인만 할 때는 아무것도 만들지 않음");
  check(/✗ 권한 pro 가 없습니다/.test(run.out), "빠진 권한을 알림");
  check(/✗ App Store 월간 상품 nailsense_pro_monthly 가 없습니다/.test(run.out), "빠진 상품을 알림");
  check(/✗ 오퍼링 default 가 없습니다/.test(run.out) && /✗ 웹훅 .* 가 없습니다/.test(run.out), "빠진 오퍼링·웹훅을 알림");
  const iosKey = v2.state.publicKeys.find((k) => k.key.startsWith("appl_")).key;
  check(run.out.includes(iosKey), "공개 키(appl_…)는 넣을 값으로 알려 줌");
  check(noSecrets(run.out), "비밀값은 출력에 없음");
  check(/✓ 서버가 RevenueCat 에 구독 상태를 물어볼 수 있습니다/.test(run.out), "서버용 v1 키 확인");
  check(v1.state.deleted.some((id) => id.includes("nailsense-setup-check")), "확인용 손님 기록은 바로 지움");

  console.log("2. --apply 로 만들기 (요청 제한도 한 번 겪음)");
  v2.state.rateLimitOnce = /^POST .*\/products$/;
  const publicKeys = {
    REVENUECAT_IOS_KEY: v2.state.publicKeys.find((k) => k.key.startsWith("appl_")).key,
    REVENUECAT_ANDROID_KEY: v2.state.publicKeys.find((k) => k.key.startsWith("goog_")).key,
  };
  run = await runTool(v2, v1, { apply: true, env: publicKeys });
  check(run.code === 0, `모두 갖춰지면 0 (${run.code})`);
  check(/요청이 많아 1초 기다립니다/.test(run.out), "429 가 오면 기다렸다 다시 함");
  const s = v2.state;
  const entitlement = s.entitlements.find((e) => e.lookup_key === "pro");
  check(Boolean(entitlement), "권한 pro");
  const ios = s.apps.find((a) => a.type === "app_store");
  const android = s.apps.find((a) => a.type === "play_store");
  const identifiers = s.products.map((p) => `${p.app_id === ios.id ? "ios" : "android"}:${p.store_identifier}`).sort();
  check(
    JSON.stringify(identifiers) ===
      JSON.stringify([
        "android:nailsense_pro_monthly:monthly",
        "android:nailsense_pro_yearly:yearly",
        "ios:nailsense_pro_monthly",
        "ios:nailsense_pro_yearly",
      ]),
    "상품 4개(앱스토어 2, 플레이 2 = 정기 결제:기본 요금제)",
  );
  check(s.products.every((p) => p.type === "subscription"), "모두 구독 상품");
  check(s.entitlementProducts.get(entitlement.id).size === 4, "권한에 상품 4개가 붙음");
  const offering = s.offerings.find((o) => o.lookup_key === "default");
  check(offering?.is_current === true, "오퍼링 default 가 현재 오퍼링");
  const packages = s.packages.filter((p) => p.offering_id === offering.id).sort((a, b) => a.position - b.position);
  check(packages.map((p) => p.lookup_key).join(",") === "$rc_monthly,$rc_annual", "패키지 $rc_monthly(1) · $rc_annual(2)");
  const storeIdsOf = (pkg) => pkg.attached.map((a) => s.products.find((p) => p.id === a.product_id).store_identifier).sort().join(",");
  check(storeIdsOf(packages[0]) === "nailsense_pro_monthly,nailsense_pro_monthly:monthly", "월간 패키지에 iOS · 안드로이드 월간 상품");
  check(storeIdsOf(packages[1]) === "nailsense_pro_yearly,nailsense_pro_yearly:yearly", "연간 패키지에 iOS · 안드로이드 연간 상품");
  check(packages.every((p) => p.attached.every((a) => a.eligibility_criteria === "all")), "모든 사용자 대상(eligibility all)");
  const hook = s.webhooks[0];
  check(
    s.webhooks.length === 1 && hook.url === `${SERVER}/api/billing/store-webhook` && hook.authorization_header === WEBHOOK_AUTH && hook.environment === null,
    "웹훅: 서버 주소, 인증값, 운영·sandbox 둘 다",
  );
  check(noSecrets(run.out), "비밀값은 출력에 없음");
  const writesAfterFirst = v2.writes().length;

  console.log("3. 다시 --apply (이미 다 있음)");
  run = await runTool(v2, v1, { apply: true, env: publicKeys });
  check(run.code === 0 && v2.writes().length === writesAfterFirst, "두 번 돌려도 새로 만드는 것이 없음");
  check(/RevenueCat 설정이 다 되어 있습니다/.test(run.out), "다 되어 있다고 알림");
  await v2.close();

  console.log("4. 앱이 없는 프로젝트 · 다른 오퍼링이 현재");
  v2 = await startMockRevenueCatV2(V2_PORT);
  // 미리 다른 오퍼링을 현재로 만들어 둔다.
  v2.state.offerings.push({ object: "offering", id: "ofrngold0001", project_id: "proj1a2b3c4d", lookup_key: "old_sale", display_name: "Old", is_current: true, state: "active", created_at: 1, metadata: null, packages: null });
  run = await runTool(v2, v1, { apply: true });
  const created = v2.state.apps.map((a) => `${a.type}:${a.app_store?.bundle_id ?? a.play_store?.package_name}`).sort();
  check(JSON.stringify(created) === JSON.stringify([`app_store:${APP_ID}`, `play_store:${APP_ID}`]), "앱이 없으면 두 스토어 앱을 앱 아이디로 만듦");
  check(v2.state.offerings.find((o) => o.lookup_key === "default")?.is_current === true && !v2.state.offerings.find((o) => o.lookup_key === "old_sale").is_current, "다른 오퍼링 대신 default 를 현재로");
  check(/지금은 "old_sale" 가 현재 오퍼링/.test(run.out), "무엇이 현재였는지 알려 줌");
  check(run.code === 1 && /REVENUECAT_IOS_KEY 를 appl_/.test(run.out), "새 앱의 공개 키를 넣으라고 알림(아직 안 넣었으니 1)");
  await v2.close();

  console.log("5. 번들 아이디가 다른 앱 · 틀린 서버 키 · 웹훅 인증값 없음");
  v2 = await startMockRevenueCatV2(V2_PORT, {
    apps: [
      { name: "Other iOS", type: "app_store", bundle: "com.someone.else" },
      { name: "NailSense Android", type: "play_store", bundle: APP_ID },
    ],
  });
  run = await runTool(v2, v1, { apply: true, env: { REVENUECAT_SECRET_KEY: "sk_" + "wrongkey000000000000000", REVENUECAT_WEBHOOK_AUTH: "" } });
  check(/App Store 앱의 bundle_id 가 com\.someone\.else/.test(run.out), "번들 아이디가 다르다고 알림");
  check(!v2.state.products.some((p) => p.app_id === v2.state.apps[0].id), "그 앱에는 상품을 만들지 않음");
  check(v2.state.products.filter((p) => p.app_id === v2.state.apps[1].id).length === 2, "맞는 앱(안드로이드)에는 만듦");
  check(v2.state.apps.filter((a) => a.type === "app_store").length === 1, "다른 iOS 앱을 새로 만들지 않음");
  check(/REVENUECAT_SECRET_KEY 가 받아들여지지 않습니다/.test(run.out), "틀린 서버 키를 잡아냄");
  check(/REVENUECAT_WEBHOOK_AUTH 를 16자 이상/.test(run.out) && v2.state.webhooks.length === 0, "웹훅 인증값이 없으면 웹훅을 만들지 않음");
  check(run.code === 1, "빠진 것이 있으니 1");
  await v2.close();
  v2 = null;

  console.log("6. 설정 키가 없거나 틀릴 때");
  v2 = await startMockRevenueCatV2(V2_PORT);
  run = await runTool(v2, v1, { env: { REVENUECAT_V2_KEY: "" } });
  check(run.code === 2 && /REVENUECAT_V2_KEY 가 없습니다/.test(run.out), "키가 없으면 만드는 방법을 알려 줌");
  run = await runTool(v2, v1, { env: { REVENUECAT_V2_KEY: "sk_" + "badbadbadbadbadbadbad" } });
  check(run.code === 1 && /키가 맞지 않습니다/.test(run.out) && !run.out.includes("badbadbadbad"), "틀린 키는 값 없이 알림");
  run = await runTool(v2, v1, { env: { REVENUECAT_V2_URL: "https://evil.example.com/v2" } });
  check(run.code === 2 && /같은 기기 주소만/.test(run.out), "테스트 주소는 루프백만 허용(키가 밖으로 새지 않게)");
} catch (err) {
  problems.push(`예외: ${err.message.split("\n")[0]}`);
  console.log(`실패  예외: ${err.message.split("\n")[0]}`);
} finally {
  await v2?.close().catch(() => undefined);
  await v1.close();
}

if (problems.length > 0) {
  console.error(`\n실패 ${problems.length}건:`);
  for (const problem of problems) console.error(` - ${problem}`);
  process.exit(1);
}
console.log("\nRevenueCat 설정 도구 점검 통과.");
