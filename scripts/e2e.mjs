/**
 * 앱 전체 흐름을 한 번에 도는 테스트.
 *
 *   npm run build && npm start     # 다른 터미널에서
 *   npm run e2e
 *
 * 온보딩 → (로그인 없이) 스캔 → 결과 → 기록 → 건강 정보 → 프로필에서 로그인 →
 * 이 기기 기록 가져오기 → 로그아웃 → 다시 로그인까지 확인하고, 마지막에 다른 계정으로
 * 가입해 남의 기록이 보이지 않는 것까지 본다.
 * 계정은 지워지지 않으므로 실행마다 새 이메일을 쓴다.
 */
import { chromium } from "playwright";
import fs from "node:fs";

const OUT = process.env.E2E_OUT ?? ".smoke/e2e";
fs.mkdirSync(OUT, { recursive: true });
const B = process.env.E2E_BASE_URL ?? "http://127.0.0.1:8787";
// 계정은 남으므로 실행마다 새 이메일을 쓴다.
const stamp = Date.now();
const EMAIL = `e2e-${stamp}@example.com`;
const OTHER = `other-${stamp}@example.com`;
const problems = [];
const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });

const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") problems.push(`console: ${m.text()}`); });

const has = async (text) => (await page.locator(`text=${text}`).count()) > 0;

// 1. 온보딩
await page.goto(B, { waitUntil: "networkidle" });
await page.waitForTimeout(600);
if (!(await has("Start with one photo of a nail"))) problems.push("온보딩 1페이지가 안 보임");
await shot(page, "01-onboarding");
await page.click('button:has-text("Next")');
await page.waitForTimeout(300);
if (!(await has("A description, not a diagnosis"))) problems.push("온보딩 2페이지가 안 보임");
await page.click('button:has-text("Next")');
await page.waitForTimeout(300);
await shot(page, "02-onboarding-privacy");
await page.click('button:has-text("Get started")');
await page.waitForTimeout(500);

// 2. 로그인 화면 없이 바로 앱으로 들어와야 한다
if (await has("No account? Sign up")) problems.push("로그인 화면이 앞을 막고 있음");
await page.waitForSelector('button:has-text("Scan a nail")', { timeout: 20000 });
await shot(page, "03-home-guest");

// 3. 스캔
const bytes = await page.evaluate(async () => {
  const c = document.createElement("canvas");
  c.width = 600; c.height = 800;
  const x = c.getContext("2d");
  x.fillStyle = "#e8bda9"; x.fillRect(0, 0, 600, 800);
  x.fillStyle = "#f7e2d8"; x.beginPath(); x.ellipse(300, 400, 150, 230, 0, 0, Math.PI * 2); x.fill();
  x.fillStyle = "#6b4a33"; x.fillRect(285, 210, 22, 360);
  const b = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.9));
  return Array.from(new Uint8Array(await b.arrayBuffer()));
});
const photo = `${OUT}/nail.jpg`;
fs.writeFileSync(photo, Buffer.from(bytes));

await page.click('button:has-text("Scan a nail")');
await page.waitForTimeout(400);
await page.setInputFiles('input[type="file"]:not([capture])', photo);
await page.waitForTimeout(700);
await page.click("text=Left hand");
await page.click('text="Ring"');
await page.fill("textarea", "E2E test");
await shot(page, "05-scan-ready");
await page.click('button:has-text("Analyze")');
await page.waitForSelector("text=By area", { timeout: 60000 });
await page.waitForTimeout(600);
await shot(page, "06-result");
if (!(await has("Findings"))) problems.push("결과에 특이 사항 섹션이 없음");

// 4. 기록 (서버 저장 확인)
await page.click(".tabbar >> text=History");
await page.waitForTimeout(800);
const rows = await page.locator(".history-item").count();
if (rows !== 1) problems.push(`기록이 서버에서 안 옴 (${rows}건)`);
await shot(page, "07-history");

// 5. 건강 정보
await page.click(".tabbar >> text=Learn");
await page.waitForTimeout(600);
const articles = await page.locator(".article-card").count();
if (articles < 5) problems.push(`건강 정보 글이 부족 (${articles})`);
await page.fill('input[type="search"]', "black");
await page.waitForTimeout(300);
const found = await page.locator(".article-card").count();
if (found === 0) problems.push("검색 결과 없음");
await shot(page, "08-library-search");
await page.locator(".article-card").first().click();
await page.waitForTimeout(500);
if (!(await has("This is general health information"))) problems.push("글 상세에 비진단 안내가 없음");
await shot(page, "09-article");

// 6. 프로필: 로그인하지 않은 상태 안내 → 로그인
await page.click(".tabbar >> text=Profile");
await page.waitForTimeout(600);
if (!(await has("Saving on this device"))) problems.push("게스트 상태 안내가 없음");
if (!(await has("NailSense v"))) problems.push("버전 표시가 없음");
await shot(page, "10-profile-guest");

await page.click(".signin-btn");
await page.waitForTimeout(600);
if ((await page.locator(".auth-title").count()) === 0) problems.push("프로필에서 로그인 화면이 열리지 않음");
await shot(page, "11-auth-optional");
await page.click("text=No account? Sign up");
await page.waitForTimeout(200);
await page.fill('input[type="text"]', "Jun");
await page.fill('input[type="email"]', EMAIL);
await page.fill('input[type="password"]', "testpassword1");
await page.click('button[type="submit"]');
await page.waitForSelector(".tabbar", { timeout: 20000 });
await page.waitForTimeout(1000);

// 7. 이 기기에 있던 기록을 계정으로 가져온다
await page.click(".tabbar >> text=Profile");
await page.waitForTimeout(800);
if (!(await has("saved on this device"))) problems.push("로컬 기록 가져오기 안내가 없음");
await page.click("text=Move to account");
await page.waitForTimeout(1200);
await shot(page, "12-imported");
await page.click(".tabbar >> text=History");
await page.waitForTimeout(900);
const rows2 = await page.locator(".history-item").count();
if (rows2 !== 1) problems.push(`가져온 기록이 계정에 없음 (${rows2}건)`);

// 8. 로그아웃하면 로그인 화면이 아니라 앱으로 돌아온다
await page.click(".tabbar >> text=Profile");
await page.waitForTimeout(500);
await page.click("text=Log out");
await page.waitForTimeout(900);
if ((await page.locator(".auth-title").count()) > 0) problems.push("로그아웃 후 로그인 화면에 갇힘");
if ((await page.locator(".tabbar").count()) === 0) problems.push("로그아웃 후 앱이 사라짐");
await shot(page, "13-after-signout");

// 9. 다른 계정은 남의 기록을 못 본다
const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page2 = await ctx2.newPage();
await page2.goto(B, { waitUntil: "networkidle" });
await page2.waitForTimeout(600);
if (await page2.locator("text=Skip").count()) await page2.click("text=Skip");
await page2.waitForTimeout(600);
await page2.click(".tabbar >> text=Profile");
await page2.waitForTimeout(500);
await page2.click(".signin-btn");
await page2.waitForTimeout(400);
await page2.click("text=No account? Sign up");
await page2.fill('input[type="email"]', OTHER);
await page2.fill('input[type="password"]', "testpassword2");
await page2.click('button[type="submit"]');
await page2.waitForSelector(".tabbar", { timeout: 20000 });
await page2.waitForTimeout(900);
await page2.click(".tabbar >> text=History");
await page2.waitForTimeout(800);
const otherRows = await page2.locator(".history-item").count();
if (otherRows !== 0) problems.push(`다른 계정에 남의 기록이 보임 (${otherRows}건)`);
await shot(page2, "14-other-user-empty");

await browser.close();
if (problems.length) {
  console.error("문제:");
  for (const p of problems) console.error(" -", p);
  process.exit(1);
}
console.log("전체 흐름 통과");
