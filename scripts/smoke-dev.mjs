/**
 * 개발 환경(npm run dev) 경로만 따로 확인하는 스모크 테스트.
 *
 *   npm run dev          # 다른 터미널에서
 *   npm run smoke:dev
 *
 * 왜 따로 두는가: 기존 smoke 는 빌드된 앱을 서버(8787)가 직접 서빙하는
 * 경로만 확인한다. 개발 중에는 화면이 Vite(5173) 에서 오고 API 는 프록시를
 * 거치므로 오리진과 Host 가 달라진다. 이 차이 때문에 서버의 오리진 검사가
 * 자기 자신의 요청을 403 으로 막은 적이 있다. 그 경로를 상시 확인한다.
 */
import { chromium } from "playwright";

const BASE = process.env.SMOKE_DEV_URL ?? "http://localhost:5173";

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

const problems = [];
page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));

let analyzeStatus = null;
page.on("response", (response) => {
  if (response.url().includes("/api/analyze")) analyzeStatus = response.status();
});

await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForTimeout(600);

// 온보딩만 건너뛴다. 로그인 없이도 분석할 수 있어야 한다.
if ((await page.locator("text=건너뛰기").count()) > 0) {
  await page.click("text=건너뛰기");
  await page.waitForTimeout(500);
}
await page.waitForSelector("text=손톱 스캔 시작하기", { timeout: 20000 });

await page.click("text=손톱 스캔 시작하기");
await page.waitForTimeout(400);

const bytes = await page.evaluate(async () => {
  const canvas = document.createElement("canvas");
  canvas.width = 600;
  canvas.height = 800;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#eac4b2";
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

const fs = await import("node:fs");
const photo = `${process.env.TMPDIR ?? "/tmp"}/smoke-dev-nail.jpg`;
fs.writeFileSync(photo, Buffer.from(bytes));

await page.setInputFiles('input[type="file"]:not([capture])', photo);
await page.waitForTimeout(500);
await page.click("text=분석 시작");

await page
  .waitForSelector("text=항목별 관찰", { timeout: 60000 })
  .catch(() => problems.push("결과 화면에 도달하지 못했습니다."));

if (analyzeStatus !== 200) {
  problems.push(`/api/analyze 가 ${analyzeStatus} 를 반환했습니다.`);
}

await browser.close();

if (problems.length > 0) {
  console.error("개발 경로 스모크 테스트 실패:");
  for (const problem of problems) console.error(` - ${problem}`);
  process.exit(1);
}
console.log("개발 경로 스모크 테스트 통과 (Vite 5173 -> API 8787).");
