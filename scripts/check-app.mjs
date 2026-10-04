/**
 * 휴대폰 앱 방식(다른 출처 + 토큰 로그인)이 제대로 동작하고, 웹 쪽 보호가 약해지지 않았는지 본다.
 *
 *   npm run check:app
 *
 * 1) 서버만: 앱 출처의 CORS, 토큰 발급·사용·폐기, 쿠키를 주지 않음, 낯선 출처 거절,
 *    웹 로그인은 여전히 쿠키만 받음.
 * 2) 브라우저: 앱용 빌드(dist-app)를 서버와 다른 출처에서 띄우고
 *    가입 → 다시 열어도 로그인 유지 → 분석 → 기록 → 로그아웃까지 본다.
 *    (실제 휴대폰의 키체인 대신, 보안 저장소 플러그인의 웹 대체 구현을 쓴다.)
 */
import { spawn, execFileSync } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";

const API_PORT = 8861;
const APP_PORT = 8862;
const API = `http://127.0.0.1:${API_PORT}`;
const APP_ORIGIN = `http://localhost:${APP_PORT}`;
const OUT = path.join(".smoke", "app");
fs.mkdirSync(OUT, { recursive: true });

// 동의 문구 버전은 공유 코드에서 읽는다(.ts 라 import 대신 글자로).
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

// 테스트용 앱 빌드: API 주소를 이 테스트 서버로 둔다. 끝나면 기본 주소로 다시 만든다.
const APP_DIR = path.join(os.tmpdir(), "nailsense-app-build");
execFileSync("npx", ["vite", "build", "--mode", "app", "--outDir", APP_DIR, "--emptyOutDir", "--logLevel", "warn"], {
  env: { ...process.env, APP_API_BASE: API },
  stdio: "inherit",
});

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "nailsense-app-"));
const server = spawn("npx", ["tsx", "server/index.ts"], {
  env: {
    ...process.env,
    PORT: String(API_PORT),
    DATA_DIR: dataDir,
    // 실제 앱의 출처 대신 테스트용 출처를 허락한다. 기본값(capacitor://localhost 등)은 아래에서 따로 본다.
    APP_ORIGINS: `${APP_ORIGIN},capacitor://localhost,https://localhost`,
    NODE_ENV: "production",
    GEMINI_API_KEY: "",
    ANTHROPIC_API_KEY: "",
    PADDLE_API_KEY: "",
  },
  stdio: "ignore",
  detached: true,
});

// 앱 화면만 내주는 정적 서버(앱 안의 웹뷰 역할)
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml" };
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

async function ready() {
  for (let i = 0; i < 60; i += 1) {
    try {
      if ((await fetch(`${API}/api/health`)).ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

let browser;
let page;
const consoleErrors = [];

const appHeaders = (origin = "capacitor://localhost", extra = {}) => ({
  "Content-Type": "application/json",
  Origin: origin,
  "X-NailSense-Client": "app",
  ...extra,
});

try {
  if (!(await ready())) throw new Error("서버가 뜨지 않았습니다.");

  console.log("서버: 앱 출처와 토큰 로그인");
  const preflight = await fetch(`${API}/api/auth/login`, {
    method: "OPTIONS",
    headers: {
      Origin: "capacitor://localhost",
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "authorization,content-type,x-nailsense-client",
    },
  });
  check(preflight.status === 204, `iOS 앱 출처 사전 요청 허락 (${preflight.status})`);
  check(preflight.headers.get("access-control-allow-origin") === "capacitor://localhost", "허락한 출처를 그대로 돌려줌");
  check(/authorization/i.test(preflight.headers.get("access-control-allow-headers") ?? ""), "Authorization 헤더 허락");
  check(!preflight.headers.get("access-control-allow-credentials"), "쿠키 전송은 허락하지 않음");

  const evilPreflight = await fetch(`${API}/api/auth/login`, {
    method: "OPTIONS",
    headers: { Origin: "https://evil.example", "Access-Control-Request-Method": "POST" },
  });
  check(!evilPreflight.headers.get("access-control-allow-origin"), "낯선 출처에는 CORS 허락 없음");

  const evilPost = await fetch(`${API}/api/auth/signup`, {
    method: "POST",
    headers: appHeaders("https://evil.example"),
    body: JSON.stringify({ email: "evil@example.com", password: "password123" }),
  });
  check(evilPost.status === 403, `낯선 출처의 가입 요청 거절 (${evilPost.status})`);

  const signup = await fetch(`${API}/api/auth/signup`, {
    method: "POST",
    headers: appHeaders("https://localhost"),
    body: JSON.stringify({ email: "app@example.com", password: "password123", displayName: "App" }),
  });
  const signupBody = await signup.json();
  const token = signupBody.sessionToken;
  check(signup.status === 201 && typeof token === "string" && token.length >= 40, "안드로이드 앱 출처에서 가입하면 토큰을 받음");
  check(!signup.headers.get("set-cookie"), "앱에는 세션 쿠키를 주지 않음");
  check(signup.headers.get("cache-control") === "no-store", "토큰 응답은 캐시 금지");
  check(signup.headers.get("access-control-allow-origin") === "https://localhost", "응답에 CORS 허락");

  const me = await (await fetch(`${API}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } })).json();
  check(me.user?.email === "app@example.com", "토큰으로 로그인 상태 확인");
  const meWrong = await (await fetch(`${API}/api/auth/me`, { headers: { Authorization: `Bearer ${"x".repeat(43)}` } })).json();
  check(meWrong.user === null, "틀린 토큰은 로그인 아님");
  const meBadShape = await (await fetch(`${API}/api/auth/me`, { headers: { Authorization: `Bearer a.b;c` } })).json();
  check(meBadShape.user === null, "형식이 이상한 토큰은 무시");

  const analyze = await fetch(`${API}/api/analyze`, {
    method: "POST",
    headers: appHeaders("capacitor://localhost", {
      Authorization: `Bearer ${token}`,
      "X-NailSense-Device": "device-test-0123456789",
    }),
    body: JSON.stringify({
      image: Buffer.from("fake-image-bytes").toString("base64"),
      mediaType: "image/jpeg",
      hand: "left",
      fingerKey: "ring",
      note: "",
      keepPhoto: false,
      consentVersion: CONSENT_VERSION,
    }),
  });
  const analyzed = await analyze.json();
  check(analyze.ok && analyzed.ok && typeof analyzed.scanId === "string", `앱에서 분석하면 계정에 기록됨 (${analyze.status})`);
  const scans = await (await fetch(`${API}/api/scans`, { headers: { Authorization: `Bearer ${token}` } })).json();
  check(scans.scans?.length === 1, "토큰으로 기록 목록 조회");

  const logout = await fetch(`${API}/api/auth/logout`, {
    method: "POST",
    headers: appHeaders("capacitor://localhost", { Authorization: `Bearer ${token}` }),
  });
  check(logout.ok, "토큰으로 로그아웃");
  const afterLogout = await (await fetch(`${API}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } })).json();
  check(afterLogout.user === null, "로그아웃한 토큰은 더 못 씀");

  console.log("서버: 웹은 그대로");
  const web = await fetch(`${API}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: API },
    body: JSON.stringify({ email: "app@example.com", password: "password123" }),
  });
  const webBody = await web.json();
  check(/ns_session=.*HttpOnly/i.test(web.headers.get("set-cookie") ?? ""), "웹 로그인은 httpOnly 쿠키");
  check(!("sessionToken" in webBody), "웹 응답 본문에는 토큰 없음");
  check(!web.headers.get("access-control-allow-origin"), "같은 출처 요청에는 CORS 헤더 없음");

  console.log("브라우저: 다른 출처에서 띄운 앱 화면");
  browser = await chromium.launch(
    process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
  );
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "en-US" });
  page = await context.newPage();
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text().slice(0, 200));
  });
  const apiRequests = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/")) apiRequests.push(request);
  });

  await page.goto(APP_ORIGIN, { waitUntil: "networkidle" });
  if (await page.locator("text=Skip").count()) await page.click("text=Skip");
  await page.waitForSelector(".tabbar", { timeout: 20000 });
  check(apiRequests.length > 0 && apiRequests.every((r) => r.url().startsWith(API)), "API 요청이 설정한 서버 주소로 감");
  check(apiRequests.every((r) => r.headers()["x-nailsense-client"] === "app"), "모든 요청에 앱 표시");
  check(apiRequests.some((r) => /^[A-Za-z0-9_-]{16,64}$/.test(r.headers()["x-nailsense-device"] ?? "")), "기기 아이디 헤더");

  await page.click(".tabbar >> text=Profile");
  await page.click(".signin-btn");
  await page.click("text=No account? Sign up");
  await page.fill('input[type="text"]', "Phone");
  await page.fill('input[type="email"]', "phone@example.com");
  await page.fill('input[type="password"]', "password456");
  await page.click('button[type="submit"]');
  await page.waitForSelector(".tabbar", { timeout: 20000 });
  await page.click(".tabbar >> text=Profile");
  await page.waitForSelector("text=phone@example.com", { timeout: 10000 });
  check(true, "앱 화면에서 가입");
  const cookies = await context.cookies(API);
  check(!cookies.some((c) => c.name === "ns_session"), "앱 화면에는 세션 쿠키가 생기지 않음");
  await page.screenshot({ path: path.join(OUT, "01-signed-in.png") });

  // 앱을 다시 연 것처럼 새로 불러온다.
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector(".tabbar", { timeout: 20000 });
  await page.click(".tabbar >> text=Profile");
  await page.waitForSelector("text=phone@example.com", { timeout: 10000 });
  check(true, "다시 열어도 로그인 유지");

  await page.click(".tabbar >> text=Home");
  const photo = path.join(OUT, "nail.jpg");
  const bytes = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 600;
    canvas.height = 800;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#e8bda9";
    ctx.fillRect(0, 0, 600, 800);
    ctx.fillStyle = "#f7e2d8";
    ctx.beginPath();
    ctx.ellipse(300, 400, 150, 230, 0, 0, Math.PI * 2);
    ctx.fill();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  fs.writeFileSync(photo, Buffer.from(bytes));
  await page.click('button:has-text("Scan a nail")');
  await page.setInputFiles('input[type="file"]:not([capture])', photo);
  await page.waitForTimeout(400);
  await page.click("text=Left hand");
  await page.click('text="Ring"');
  await page.click('button:has-text("Analyze")');
  await page.waitForSelector(".sheet >> text=Before your first scan", { timeout: 5000 });
  for (const box of await page.locator('.sheet input[type="checkbox"]').all()) await box.check();
  await page.locator('.sheet button:has-text("Agree")').click();
  await page.waitForSelector("text=By area", { timeout: 30000 });
  check(true, "앱 화면에서 분석");
  await page.screenshot({ path: path.join(OUT, "02-result.png") });

  await page.click(".tabbar >> text=History");
  await page.waitForTimeout(800);
  const rows = await page.locator(".history-item").count();
  check(rows === 1, `분석 기록이 계정에서 불러와짐 (${rows}건)`);

  await page.click(".tabbar >> text=Profile");
  await page.click("text=Log out");
  await page.waitForTimeout(900);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector(".tabbar", { timeout: 20000 });
  await page.click(".tabbar >> text=Profile");
  check((await page.locator(".signin-btn").count()) > 0, "로그아웃하면 다시 열어도 로그아웃 상태");

  check(consoleErrors.length === 0, `콘솔 오류 없음${consoleErrors.length ? `: ${consoleErrors.join(" | ")}` : ""}`);
  await browser.close();
} catch (err) {
  problems.push(`예외: ${err.message.split("\n")[0]}`);
  console.log(`실패  예외: ${err.message.split("\n")[0]}`);
  if (consoleErrors.length) console.log(`  콘솔: ${consoleErrors.join(" | ")}`);
  await page?.screenshot({ path: path.join(OUT, "zz-failure.png") }).catch(() => undefined);
  await browser?.close().catch(() => undefined);
} finally {
  try {
    process.kill(-server.pid);
  } catch {}
  appServer.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.rmSync(APP_DIR, { recursive: true, force: true });
}

if (problems.length > 0) {
  console.error(`\n실패 ${problems.length}건:`);
  for (const problem of problems) console.error(` - ${problem}`);
  process.exit(1);
}
console.log("\n앱 방식 점검 통과.");
