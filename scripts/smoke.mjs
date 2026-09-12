/**
 * 브라우저에서 앱 전체 흐름을 한 번 돌려 보는 스모크 테스트.
 *
 *   npm run build && npm start        # 다른 터미널에서 서버를 띄우고
 *   npm run smoke                     # 이 스크립트를 실행
 *
 * 스크린샷은 .smoke/ 에 저장된다. CHROMIUM_PATH 로 실행 파일을 지정할 수 있다.
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.SMOKE_BASE_URL ?? "http://localhost:8787";
const OUT = process.env.SMOKE_OUT ?? ".smoke";
fs.mkdirSync(OUT, { recursive: true });

const shot = (page, name) =>
  page.screenshot({ path: path.join(OUT, name), fullPage: true });

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH
    ? { executablePath: process.env.CHROMIUM_PATH }
    : {},
);
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
});

const problems = [];
page.on("console", (message) => {
  if (message.type() === "error") problems.push(message.text());
});
page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));

await page.goto(BASE, { waitUntil: "networkidle" });
await shot(page, "01-home.png");

await page.click("text=손톱 스캔 시작하기");
await page.waitForTimeout(400);
await shot(page, "02-scan.png");

// 손톱 비슷한 톤의 더미 사진을 브라우저 안에서 만들어 업로드한다.
const bytes = await page.evaluate(async () => {
  const canvas = document.createElement("canvas");
  canvas.width = 600;
  canvas.height = 800;
  const ctx = canvas.getContext("2d");
  const gradient = ctx.createLinearGradient(0, 0, 0, 800);
  gradient.addColorStop(0, "#f2d6c8");
  gradient.addColorStop(1, "#e8bda9");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 600, 800);
  ctx.fillStyle = "#f7e2d8";
  ctx.beginPath();
  ctx.ellipse(300, 400, 150, 230, 0, 0, Math.PI * 2);
  ctx.fill();
  const blob = await new Promise((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.9),
  );
  return Array.from(new Uint8Array(await blob.arrayBuffer()));
});
const photo = path.join(OUT, "sample-nail.jpg");
fs.writeFileSync(photo, Buffer.from(bytes));

await page.setInputFiles('input[type="file"]:not([capture])', photo);
await page.waitForTimeout(600);
await page.click("text=왼손");
await page.click("text=약지");
await page.fill("textarea", "스모크 테스트 메모");
await shot(page, "03-scan-ready.png");

await page.click("text=분석 시작");
await page.waitForSelector("text=항목별 관찰", { timeout: 60000 });
await page.waitForTimeout(800);
await shot(page, "04-result.png");

await page.click("text=색상");
await page.waitForTimeout(400);
await shot(page, "05-result-expanded.png");

const download = await Promise.all([
  page.waitForEvent("download", { timeout: 20000 }).catch(() => null),
  page.click("text=카드 공유하기"),
]).then(([event]) => event);
if (download) {
  await download.saveAs(path.join(OUT, "share-card.png"));
} else {
  problems.push("공유 카드 다운로드가 발생하지 않았습니다.");
}

// 두 번째 기록을 만들어 추이와 기록 화면을 확인한다.
await page.click("text=다른 손톱도 스캔하기");
await page.waitForTimeout(400);
await page.setInputFiles('input[type="file"]:not([capture])', photo);
await page.waitForTimeout(600);
await page.click("text=분석 시작");
await page.waitForSelector("text=항목별 관찰", { timeout: 60000 });

await page.click(".tabbar >> text=기록");
await page.waitForTimeout(700);
await shot(page, "06-history.png");

await page.click(".tabbar >> text=프로필");
await page.waitForTimeout(500);
await shot(page, "07-profile.png");

await page.click(".tabbar >> text=홈");
await page.waitForTimeout(700);
await shot(page, "08-home-trend.png");

await browser.close();

if (problems.length > 0) {
  console.error("스모크 테스트에서 문제가 발견되었습니다:");
  for (const problem of problems) console.error(` - ${problem}`);
  process.exit(1);
}
console.log(`스모크 테스트 통과. 스크린샷: ${path.resolve(OUT)}`);
