/**
 * 한국어 기기에서 앱이 한국어로 나오는지 확인한다.
 *
 *   npm run build && npm start     # 다른 터미널에서
 *   npm run smoke:ko
 *
 * 브라우저 언어를 ko-KR 로 두고 온보딩 → 동의(민감정보·국외 이전 두 가지) → 분석 → 결과 →
 * 건강 정보 글 → 서버 오류 문구 → 약관 → 언어를 영어로 바꾸기까지 본다.
 * 스크린샷은 .smoke/ko/ 에 남는다.
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.SMOKE_BASE_URL ?? "http://localhost:8787";
const OUT = path.join(process.env.SMOKE_OUT ?? ".smoke", "ko");
fs.mkdirSync(OUT, { recursive: true });

const problems = [];
const check = (condition, label) => {
  if (condition) console.log(`  ok  ${label}`);
  else {
    problems.push(label);
    console.log(`실패  ${label}`);
  }
};

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  locale: "ko-KR",
});
const page = await context.newPage();
page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
page.on("console", (message) => {
  // 일부러 잘못 보낸 가입 요청(400)은 오류 문구를 보려는 것이라 건너뛴다.
  if (message.type() === "error" && !/status of 400/.test(message.text())) {
    problems.push(`console: ${message.text().slice(0, 200)}`);
  }
});
const shot = (name) => page.screenshot({ path: path.join(OUT, `${name}.png`) });
const shotFull = (name) => page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
const visible = async (selector) => (await page.locator(selector).count()) > 0;

try {
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForSelector("text=손톱 사진 한 장으로 시작해요", { timeout: 20000 });
  check(await page.evaluate(() => document.documentElement.lang) === "ko", "html lang=ko");
  await shot("01-onboarding");
  await page.click("text=건너뛰기");
  await page.waitForSelector('button:has-text("손톱 스캔 시작하기")', { timeout: 10000 });
  check(await visible("text=오늘 손톱은 어떤 모습인가요?"), "홈 인사 한국어");
  check(await visible(".tabbar >> text=기록"), "탭 이름 한국어");
  await shot("02-home");

  // 분석: 동의 두 가지를 모두 체크해야 버튼이 켜진다.
  await page.click('button:has-text("손톱 스캔 시작하기")');
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
  await page.setInputFiles('input[type="file"]:not([capture])', photo);
  await page.waitForTimeout(400);
  await page.click("text=왼손");
  await page.click('text="약지"');
  await page.click('button:has-text("분석 시작")');
  await page.waitForSelector(".sheet >> text=첫 분석 전에", { timeout: 5000 });
  const agree = page.locator('.sheet button:has-text("동의하고 분석")');
  const boxes = page.locator('.sheet input[type="checkbox"]');
  check((await boxes.count()) === 2, "한국어는 동의를 두 가지로 받음(민감정보, 국외 이전)");
  await page.locator(".sheet summary", { hasText: "국외 이전" }).click();
  check(await visible(".sheet >> text=Fly.io, Inc.(서버 운영)"), "국외 이전 받는 곳 안내");
  await shotFull("03-consent");
  await boxes.nth(0).check();
  check(await agree.isDisabled(), "하나만 체크하면 분석 버튼이 꺼져 있음");
  await boxes.nth(1).check();
  await agree.click();
  await page.waitForSelector("text=항목별 관찰", { timeout: 30000 });
  check(await visible("text=한눈에 보기"), "결과 화면 한국어");
  check(await visible("text=왼손 약지"), "부위 이름 한국어");
  const headline = await page.locator(".result-title").first().textContent().catch(() => "");
  check(/[가-힣]/.test(headline ?? ""), "분석 결과(데모)도 한국어");
  await shot("04-result");

  // 건강 정보 글은 서버에서 한국어로
  await page.click(".tabbar >> text=정보");
  await page.waitForSelector("text=손톱은 어떻게 자라나요", { timeout: 10000 });
  check(true, "건강 정보 글 한국어");
  await page.locator(".article-card").first().click();
  await page.waitForTimeout(400);
  check(await visible("text=이 글은 일반적인 건강 정보"), "글 비진단 안내 한국어");

  // 서버가 돌려주는 오류 문구도 한국어
  const signupError = await page.evaluate(async () => {
    const response = await fetch("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-NailSense-Locale": "ko" },
      body: JSON.stringify({ email: "not-an-email", password: "x" }),
    });
    return (await response.json()).error;
  });
  check(signupError === "이메일 형식을 확인해 주세요.", `서버 오류 문구 한국어 (${signupError})`);

  // 약관 시트
  await page.click(".tabbar >> text=프로필");
  await page.click('button:has-text("개인정보처리방침")');
  await page.waitForSelector(".sheet >> text=법률 검토 전 초안입니다.", { timeout: 5000 });
  check(await visible(".sheet >> text=4. 처리 위탁과 국외 이전"), "개인정보처리방침 한국어(국외 이전 항목)");
  await shot("05-privacy");
  await page.click('.sheet button:has-text("닫기")');

  // 언어를 영어로 바꾸면 다시 불러온 뒤 영어로 나온다.
  await page.locator(".chip", { hasText: "English" }).click();
  await page.waitForSelector(".tabbar >> text=Profile", { timeout: 15000 });
  check(await page.evaluate(() => document.documentElement.lang) === "en", "언어를 영어로 바꿀 수 있음");
  check(await visible("text=Saving on this device"), "언어를 바꾼 뒤 프로필로 돌아옴");
  await page.locator(".chip", { hasText: "Device setting" }).click();
  await page.waitForSelector(".tabbar >> text=프로필", { timeout: 15000 });
  check(true, "기기 설정으로 되돌리면 다시 한국어");
} catch (err) {
  problems.push(`예외: ${err.message.split("\n")[0]}`);
  await shot("zz-failure").catch(() => undefined);
} finally {
  await browser.close();
}

if (problems.length > 0) {
  console.error(`\n실패 ${problems.length}건:`);
  for (const problem of problems) console.error(` - ${problem}`);
  process.exit(1);
}
console.log(`\n한국어 흐름 통과. 스크린샷: ${path.resolve(OUT)}`);
