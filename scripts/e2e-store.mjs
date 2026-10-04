/**
 * 휴대폰 앱의 인앱 구독 화면을 브라우저로 점검한다.
 *
 *   npm run e2e:store
 *
 * 앱용 빌드를 "가짜 스토어 플러그인"으로 만들어 서버와 다른 출처에서 띄운다.
 * 진짜 App Store · Google Play 결제 창은 여기서 열 수 없으므로, 스토어 결제 단계만 가짜이고
 * 나머지(서버 확인, RevenueCat 조회, Pro 전환, 화면 문구)는 실제 코드가 돈다.
 */
import { execFileSync } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { startAppServer } from "./lib/mock-paddle.mjs";
import {
  ANDROID_KEY,
  IOS_KEY,
  SECRET_KEY,
  WEBHOOK_AUTH,
  startMockRevenueCat,
} from "./lib/mock-revenuecat.mjs";

const RC_PORT = 8881;
const API_PORT = 8882;
const APP_PORT = 8883;
const APP_ORIGIN = `http://localhost:${APP_PORT}`;
const OUT = path.join(".smoke", "store");
fs.mkdirSync(OUT, { recursive: true });

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
    APP_ORIGINS: APP_ORIGIN,
    BILLING_RATE_LIMIT_PER_IP: "500",
  },
});

const APP_DIR = path.join(os.tmpdir(), "nailsense-store-build");
execFileSync(
  "npx",
  ["vite", "build", "--mode", "app", "--outDir", APP_DIR, "--emptyOutDir", "--logLevel", "warn"],
  { env: { ...process.env, APP_API_BASE: app.api, NAILSENSE_FAKE_STORE: "1" }, stdio: "inherit" },
);

const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2" };
const appServer = http.createServer((req, res) => {
  const url = new URL(req.url, APP_ORIGIN);
  let file = path.join(APP_DIR, decodeURIComponent(url.pathname));
  if (!file.startsWith(APP_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    file = path.join(APP_DIR, "index.html");
  }
  res.writeHead(200, { "content-type": types[path.extname(file)] ?? "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
await new Promise((resolve) => appServer.listen(APP_PORT, resolve));

/** 스토어가 내려 주는 상품(RevenueCat 오퍼링) 흉내 */
const PACKAGES = [
  {
    identifier: "$rc_monthly",
    packageType: "MONTHLY",
    product: { identifier: "nailsense_pro_monthly", price: 4.99, priceString: "$4.99", pricePerMonthString: "$4.99", introPrice: null },
  },
  {
    identifier: "$rc_annual",
    packageType: "ANNUAL",
    product: {
      identifier: "nailsense_pro_yearly",
      price: 39.99,
      priceString: "$39.99",
      pricePerMonthString: "$3.33",
      introPrice: { price: 0, priceString: "$0.00", periodNumberOfUnits: 7, periodUnit: "DAY", cycles: 1 },
    },
  },
];

let browser;
let page;
const consoleErrors = [];
const visible = async (selector) => (await page.locator(selector).count()) > 0;
const fake = () => page.evaluate(() => window.__fakeStore);

try {
  browser = await chromium.launch(
    process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
  );
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "en-US" });
  await context.addInitScript(
    ({ packages, rcUrl }) => {
      window.__fakeStore = { packages, rcUrl, log: [], opened: [], user: null, nextPurchase: "buy" };
    },
    { packages: PACKAGES, rcUrl: rc.url },
  );
  page = await context.newPage();
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text().slice(0, 200));
  });

  await page.goto(APP_ORIGIN, { waitUntil: "networkidle" });
  if (await page.locator("text=Skip").count()) await page.click("text=Skip");
  await page.waitForSelector(".tabbar", { timeout: 20000 });

  console.log("로그인 전");
  await page.click(".tabbar >> text=Profile");
  await page.click(".plan-row");
  await page.waitForSelector("text=Log in to subscribe", { timeout: 10000 });
  check(true, "로그인 전에는 구독 대신 로그인 안내");
  check(!(await visible("text=Paddle")), "앱에는 웹 결제(Paddle) 문구가 없음");
  check(!(await visible("text=Restore purchases")), "로그인 전에는 구매 복원 버튼 없음");
  await page.screenshot({ path: path.join(OUT, "01-guest.png") });

  console.log("가입 후 요금제");
  await page.click("text=Log in to subscribe");
  await page.click("text=No account? Sign up");
  await page.fill('input[type="text"]', "Store");
  await page.fill('input[type="email"]', "store@example.com");
  await page.fill('input[type="password"]', "password789");
  await page.click('button[type="submit"]');
  // 요금제 화면에서 로그인하러 갔으면, 가입한 뒤 요금제 화면으로 돌아온다.
  await page.waitForSelector(".price-option", { timeout: 20000 });
  check(true, "가입하면 요금제 화면으로 돌아옴");
  let log = (await fake()).log;
  check(
    log.some((entry) => (entry[0] === "configure" || entry[0] === "logIn") && /^[0-9a-f-]{36}$/.test(entry.at(-1) ?? "")),
    "로그인하면 RevenueCat 사용자 = 우리 계정 아이디",
  );
  check(log.some((entry) => entry[0] === "configure" && entry[1] === IOS_KEY), "서버가 준 공개 키로 준비");
  check(await visible(".price-option >> text=$4.99/month"), "월간 가격(스토어 현지 통화)");
  check(await visible(".price-option >> text=$39.99/year"), "연간 가격");
  check(await visible(".price-option >> text=7-day free trial"), "연간 무료 체험 표시");
  check(await visible("text=Free for 7 days, then $39.99/year"), "체험 뒤 청구 금액 안내");
  check(await visible("text=unless you cancel at least 24 hours before"), "자동 갱신·해지 방법 안내");
  check(await visible('button:has-text("Restore purchases")'), "구매 복원 버튼");
  check(await visible('button:has-text("Terms of Use")') && await visible('button:has-text("Privacy Policy")'), "이용약관·개인정보처리방침 링크");
  await page.screenshot({ path: path.join(OUT, "02-paywall.png"), fullPage: true });

  console.log("구매 취소·대기");
  await page.evaluate(() => (window.__fakeStore.nextPurchase = "cancel"));
  await page.click('button:has-text("Start free trial")');
  await page.waitForTimeout(600);
  check(!(await visible(".form-error")) && (await visible(".tier-name >> text=Free")), "취소하면 오류 없이 그대로 Free");
  await page.evaluate(() => (window.__fakeStore.nextPurchase = "pending"));
  await page.click('button:has-text("Start free trial")');
  await page.waitForSelector("text=waiting for approval", { timeout: 5000 });
  check(await visible(".tier-name >> text=Free"), "승인 대기는 아직 Free");

  console.log("구매");
  await page.click('button:has-text("Start free trial")');
  await page.waitForSelector("text=You're on Pro now", { timeout: 15000 });
  check(await visible(".tier-name >> text=Pro"), "구매 뒤 서버 확인으로 Pro");
  check(await visible("text=Free trial until"), "체험 종료일 표시");
  check(await visible("text=Manage or cancel subscription"), "구독 관리·해지 버튼");
  await page.screenshot({ path: path.join(OUT, "03-pro.png"), fullPage: true });
  await page.click("text=Manage or cancel subscription");
  await page.waitForTimeout(300);
  check((await fake()).opened.includes("https://apps.apple.com/account/subscriptions"), "스토어 구독 관리 화면을 엶");

  // 서버도 정말 Pro 로 알고 있는지(화면 말고)
  log = (await fake()).log;
  check(log.some((entry) => entry[0] === "purchase" && entry[1] === "$rc_annual"), "고른 상품(연간)으로 구매");

  console.log("다른 계정·복원·로그아웃");
  await page.click('button[aria-label="Back"]');
  await page.click("text=Log out");
  await page.waitForTimeout(800);
  log = (await fake()).log;
  check(log.some((entry) => entry[0] === "logOut"), "로그아웃하면 RevenueCat 사용자도 떼어 냄");

  await page.click(".tabbar >> text=Profile");
  await page.click(".signin-btn");
  await page.click("text=No account? Sign up");
  await page.fill('input[type="text"]', "Other");
  await page.fill('input[type="email"]', "other@example.com");
  await page.fill('input[type="password"]', "password789");
  await page.click('button[type="submit"]');
  await page.waitForSelector(".tabbar", { timeout: 20000 });
  await page.click(".tabbar >> text=Profile");
  await page.click(".plan-row");
  await page.waitForSelector(".price-option", { timeout: 10000 });
  check(await visible(".tier-name >> text=Free"), "다른 계정은 Free (Pro 가 섞이지 않음)");
  await page.click('button:has-text("Restore purchases")');
  await page.waitForSelector("text=didn't find an active subscription", { timeout: 10000 });
  check(true, "구독이 없으면 복원 시 그렇다고 알려 줌");

  check(consoleErrors.length === 0, `콘솔 오류 없음${consoleErrors.length ? `: ${consoleErrors.join(" | ")}` : ""}`);
} catch (err) {
  problems.push(`예외: ${err.message.split("\n")[0]}`);
  console.log(`실패  예외: ${err.message.split("\n")[0]}`);
  if (consoleErrors.length) console.log(`  콘솔: ${consoleErrors.join(" | ")}`);
  await page?.screenshot({ path: path.join(OUT, "zz-failure.png") }).catch(() => undefined);
} finally {
  await browser?.close().catch(() => undefined);
  app.stop();
  await rc.close();
  appServer.close();
  fs.rmSync(APP_DIR, { recursive: true, force: true });
}

if (problems.length > 0) {
  console.error(`\n실패 ${problems.length}건:`);
  for (const problem of problems) console.error(` - ${problem}`);
  process.exit(1);
}
console.log(`\n인앱 구독 화면 흐름 통과. 스크린샷: ${path.resolve(OUT)}`);
