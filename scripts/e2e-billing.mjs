/**
 * 요금제 화면 흐름을 브라우저로 확인한다.
 *
 *   npm run build && npm run e2e:billing
 *
 * 모의 Paddle 과 그쪽을 바라보는 앱 서버를 이 스크립트가 직접 띄운다(scripts/lib/mock-paddle.mjs).
 * Paddle.js 는 진짜 결제 창 대신 가짜 스크립트로 바꿔 끼운다. 결제 창이 "완료"를 알리면
 * 화면이 서버에 확인을 맡기고, 서버는 모의 Paddle 에 직접 물어 Pro 를 켠다.
 *
 * 확인하는 것: 첫 분석 전 동의, 무료 한도 안내, 요금제 화면의 가격·체험·자동갱신 고지,
 * 로그인 후 결제 창 열기, 결제 확인 후 Pro, 해지 예약과 철회, 결제 수단 변경 링크,
 * 동의 철회와 재동의, 약관 시트, 구독 중 계정 삭제 시 즉시 해지, CSP 위반 없음.
 * 스크린샷은 .smoke/billing/ 에 남는다(SCHEME=dark 로 다크 모드).
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import {
  CLIENT_TOKEN,
  PRICE_MONTH,
  startAppServer,
  startMockPaddle,
} from "./lib/mock-paddle.mjs";

const PADDLE_PORT = 8854;
const API_PORT = 8855;
const SCHEME = process.env.SCHEME === "dark" ? "dark" : "light";
const OUT = path.join(process.env.SMOKE_OUT ?? ".smoke", "billing");
fs.mkdirSync(OUT, { recursive: true });

const problems = [];
const check = (condition, label) => {
  if (condition) console.log(`  ok  ${label}`);
  else {
    problems.push(label);
    console.log(`실패  ${label}`);
  }
};

const { paddle, completeCheckout, close: closeMock } = await startMockPaddle(PADDLE_PORT);
const app = await startAppServer({
  port: API_PORT,
  paddlePort: PADDLE_PORT,
  env: { FREE_SCANS_PER_MONTH: "2", PRO_SCANS_PER_DAY: "5" },
}).catch((err) => {
  closeMock();
  throw err;
});

/** 결제 창 대신 쓰는 가짜 Paddle.js. 열린 거래를 기록하고, 테스트가 완료를 알릴 수 있게 한다. */
const PADDLE_STUB = `
window.__paddle = { opened: null, token: null, env: null, callback: null };
window.Paddle = {
  Environment: { set: function (e) { window.__paddle.env = e; } },
  Initialize: function (o) { window.__paddle.token = o.token; window.__paddle.callback = o.eventCallback; },
  Checkout: {
    open: function (o) { window.__paddle.opened = o; },
    close: function () { if (window.__paddle.callback) window.__paddle.callback({ name: "checkout.closed" }); }
  }
};
window.__completePaddle = function () {
  var o = window.__paddle.opened;
  window.__paddle.callback({ name: "checkout.completed", data: { transaction_id: o.transactionId } });
  window.__paddle.callback({ name: "checkout.closed" });
};
`;

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  colorScheme: SCHEME,
});
await context.route("https://cdn.paddle.com/paddle/v2/paddle.js", (route) =>
  route.fulfill({ status: 200, contentType: "application/javascript", body: PADDLE_STUB }),
);
await context.route("https://customer-portal.paddle.com/**", (route) =>
  route.fulfill({ status: 200, contentType: "text/html", body: "<title>Portal</title>portal" }),
);

const page = await context.newPage();
page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
page.on("console", (message) => {
  // 한도 초과(402)는 의도한 응답이라 브라우저가 찍는 네트워크 오류 줄은 건너뛴다.
  if (message.type() === "error" && !/status of 402/.test(message.text())) {
    problems.push(`console: ${message.text().slice(0, 200)}`);
  }
});
const shot = (name) => page.screenshot({ path: path.join(OUT, `${SCHEME}-${name}.png`) });
const shotFull = (name) =>
  page.screenshot({ path: path.join(OUT, `${SCHEME}-${name}.png`), fullPage: true });
const visible = async (selector) => (await page.locator(selector).count()) > 0;

try {
  await page.goto(app.api, { waitUntil: "networkidle" });
  const skip = page.locator("text=Skip");
  await skip.or(page.locator('button:has-text("Scan a nail")')).first().waitFor({ timeout: 20000 });
  if (await skip.count()) await skip.click();

  // 손톱 비슷한 사진을 만든다.
  const bytes = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 600;
    canvas.height = 800;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#efcdbd";
    ctx.fillRect(0, 0, 600, 800);
    ctx.fillStyle = "#f7e2d8";
    ctx.beginPath();
    ctx.ellipse(300, 400, 150, 230, 0, 0, Math.PI * 2);
    ctx.fill();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  const photo = path.join(OUT, "nail.jpg");
  fs.writeFileSync(photo, Buffer.from(bytes));

  async function scanOnce({ expectConsent }) {
    await page.click('.tabbar >> text=Scan');
    await page.setInputFiles('input[type="file"]:not([capture])', photo);
    await page.waitForTimeout(400);
    await page.click('button:has-text("Analyze")');
    if (expectConsent) {
      await page.waitForSelector(".sheet >> text=Before your first scan", { timeout: 5000 });
      await shotFull("01-consent");
      const agree = page.locator('.sheet button:has-text("Agree and analyze")');
      check(await agree.isDisabled(), "동의 체크 전에는 분석 버튼이 꺼져 있음");
      await page.check('.sheet input[type="checkbox"]');
      await agree.click();
    }
    await page.waitForSelector("text=By area", { timeout: 30000 });
  }

  /* ------------------------------ 동의와 무료 한도 ------------------------------ */
  console.log("동의와 무료 한도");
  await scanOnce({ expectConsent: true });
  await page.click(".tabbar >> text=Scan");
  check(await visible("text=1 of 2 free scans left this month"), "남은 무료 횟수 표시");
  await scanOnce({ expectConsent: false });
  await page.click(".tabbar >> text=Scan");
  await page.waitForTimeout(300);
  check(await visible("text=You've used your 2 free scans this month"), "한도를 다 쓰면 안내가 분석 버튼 자리에");
  check(!(await visible('button:has-text("Analyze")')), "한도를 다 쓰면 분석 버튼 없음");
  await page.locator(".quota").scrollIntoViewIfNeeded();
  await shot("02-quota");

  /* ------------------------------ 요금제 화면 ------------------------------ */
  console.log("요금제 화면");
  await page.click('.quota button:has-text("See Pro")');
  await page.waitForSelector("text=Your plan", { timeout: 10000 });
  check(await visible("text=$4.99 a month"), "월간 가격");
  check(await visible("text=$29.99 a year"), "연간 가격");
  check(await visible("text=7-day free trial"), "체험 표시");
  check(await visible("text=Save 50%"), "연간 할인율");
  check(
    await visible("text=Free for 7 days, then $4.99 a month plus any applicable tax"),
    "결제 전 금액·체험 고지",
  );
  check(await visible("text=Renews automatically every month until you cancel"), "자동갱신·해지 방법 고지");
  check(await visible('button:has-text("Log in to subscribe")'), "손님은 로그인부터");
  await shotFull("03-plan-guest");

  await page.click('button:has-text("Log in to subscribe")');
  await page.click("text=No account? Sign up");
  await page.fill('input[type="email"]', `pro-${Date.now()}@example.com`);
  await page.fill('input[type="password"]', "password-pro1");
  await page.click('button[type="submit"]');
  await page.waitForSelector("text=Your plan", { timeout: 20000 });
  check(true, "가입 후 요금제 화면으로 돌아옴");

  const start = page.locator('button:has-text("Start free trial")');
  check(await start.isDisabled(), "약관 동의 체크 전에는 결제 버튼이 꺼져 있음");
  await shotFull("04-plan-signed-in");
  await page.check('.check input[type="checkbox"]');
  await start.click();
  await page.waitForFunction(() => window.__paddle?.opened, null, { timeout: 10000 });
  const opened = await page.evaluate(() => ({
    env: window.__paddle.env,
    token: window.__paddle.token,
    transactionId: window.__paddle.opened.transactionId,
  }));
  check(opened.env === "sandbox" && opened.token === CLIENT_TOKEN, "sandbox 결제 창을 공개 토큰으로 엶");
  check(/^txn_/.test(opened.transactionId), "서버가 만든 거래로 결제 창을 엶");
  check(paddle.transactions.get(opened.transactionId)?.price_id === PRICE_MONTH, "고른 요금(월간)으로 거래");

  // 결제 창에서 결제를 마친 것으로 한다(웹훅은 보내지 않는다: 확인 경로만으로 Pro 가 되어야 한다).
  completeCheckout(opened.transactionId);
  await page.evaluate(() => window.__completePaddle());
  await page.waitForSelector("text=You're on Pro now", { timeout: 20000 });
  check(await visible(".tier-name >> text=Pro"), "결제 확인 후 Pro");
  check(await visible("text=Free trial until"), "체험 종료일 표시");
  await shotFull("05-plan-pro");

  /* ------------------------------ 해지와 철회 ------------------------------ */
  console.log("해지");
  await page.click('button:has-text("Cancel subscription")');
  await page.waitForSelector(".sheet >> text=Cancel Pro?");
  await shot("06-cancel-sheet");
  await page.click('.sheet button:has-text("Cancel Pro")');
  await page.waitForSelector("text=You'll keep Pro until", { timeout: 10000 });
  check(await visible('button:has-text("Keep my subscription")'), "해지 예약 후 철회 버튼");
  await shotFull("07-plan-canceling");
  await page.click('button:has-text("Keep my subscription")');
  await page.waitForSelector("text=Your subscription will keep renewing.", { timeout: 10000 });
  check(await visible('button:has-text("Cancel subscription")'), "철회 후 다시 해지 가능");

  const [popup] = await Promise.all([
    context.waitForEvent("page", { timeout: 10000 }),
    page.click('button:has-text("Payment method and receipts")'),
  ]);
  await popup.waitForURL(/customer-portal\.paddle\.com/, { timeout: 10000 }).catch(() => undefined);
  check(/customer-portal\.paddle\.com\/.*\/payment$/.test(popup.url()), "결제 수단 변경은 Paddle 포털 새 창으로");
  check(await popup.evaluate(() => window.opener === null), "새 창이 앱 창을 건드릴 수 없음(opener 없음)");
  await popup.close();

  /* ------------------------------ Pro 로 분석 ------------------------------ */
  await page.click("button[aria-label='Back']");
  await page.click(".tabbar >> text=Scan");
  check(await visible("text=5 of 5 scans left today"), "Pro 하루 한도 표시");
  await scanOnce({ expectConsent: false });
  await page.click(".tabbar >> text=Scan");
  check(await visible("text=4 of 5 scans left today"), "Pro 로 분석하면 하루 한도에서 차감");
  const recorded = await page.evaluate(async () => (await (await fetch("/api/preferences")).json()).preferences);
  check(recorded.healthConsentVersion === "2026-10.2" && recorded.healthConsentAt > 0, "로그인 상태의 분석은 동의 기록을 계정에 남김");

  /* ------------------------------ 프로필 ------------------------------ */
  console.log("프로필");
  await page.click(".tabbar >> text=Profile");
  await page.waitForTimeout(400);
  check(await visible(".plan-row >> text=Pro"), "프로필의 요금제 줄");
  await shot("08-profile");

  await page.click('button:has-text("Privacy Policy")');
  await page.waitForSelector(".sheet >> text=Draft for legal review", { timeout: 5000 });
  check(await visible(".sheet h3 >> text=Privacy Policy"), "개인정보처리방침 시트");
  await shot("09-privacy-sheet");
  await page.click('.sheet button:has-text("Close")');

  await page.click('button:has-text("Withdraw")');
  await page.waitForSelector(".sheet >> text=Withdraw consent?");
  await page.click('.sheet button:has-text("Withdraw")');
  await page.waitForSelector("text=Not given. We'll ask before your next scan.", { timeout: 5000 });
  const prefs = await page.evaluate(async () => (await (await fetch("/api/preferences")).json()).preferences);
  check(prefs.healthConsentVersion === null, "동의 철회가 계정에도 반영");
  await page.click(".tabbar >> text=Scan");
  await page.setInputFiles('input[type="file"]:not([capture])', photo);
  await page.waitForTimeout(300);
  await page.click('button:has-text("Analyze")');
  check(
    await page.locator(".sheet >> text=Before your first scan").isVisible({ timeout: 5000 }),
    "철회 뒤에는 다시 동의를 묻는다",
  );
  await page.click('.sheet button:has-text("Not now")');

  /* ------------------------------ 구독 중 계정 삭제 ------------------------------ */
  console.log("계정 삭제");
  await page.click(".tabbar >> text=Profile");
  await page.click('button:has-text("Delete account")');
  check(await visible(".sheet >> text=Your Pro subscription will be canceled right away"), "삭제 전 구독 해지 안내");
  await shot("10-delete-with-pro");
  await page.fill("#confirm-delete", "password-pro1");
  await page.click('.sheet button:has-text("Delete")');
  await page.waitForSelector('button:has-text("Scan a nail")', { timeout: 15000 });
  const sub = [...paddle.subscriptions.values()][0];
  check(sub?.status === "canceled", "계정 삭제와 함께 구독 즉시 해지");
} catch (err) {
  problems.push(`예외: ${err.message.split("\n")[0]}`);
  await shot("zz-failure").catch(() => undefined);
} finally {
  await browser.close();
  app.stop();
  closeMock();
}

if (problems.length > 0) {
  console.error(`\n실패 ${problems.length}건:`);
  for (const problem of problems) console.error(` - ${problem}`);
  process.exit(1);
}
console.log(`\n요금제 화면 흐름 통과. 스크린샷: ${path.resolve(OUT)}`);
