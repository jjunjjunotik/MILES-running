/**
 * 소셜 로그인 토큰 검증이 실제로 막을 것을 막는지 확인한다.
 *
 *   npm run check:oauth
 *
 * 구글·애플의 진짜 서버를 부르지 않는다. 대신 이 스크립트가 직접 키를 만들어
 * JWKS 를 내려 주는 가짜 제공자를 띄우고, 서버를 그쪽으로 향하게 해서 확인한다.
 * 확인하는 것: 정상 토큰은 통과, 서명·수신자·만료·발급자가 어긋난 토큰은 거절,
 * 같은 사람이 다시 로그인하면 같은 계정, 확인되지 않은 이메일은 남의 계정에 붙지 않음.
 */
import crypto from "node:crypto";
import http from "node:http";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const JWKS_PORT = 8850;
const API_PORT = 8851;
const CLIENT_ID = "test-client-id.apps.googleusercontent.com";
const ISSUER = "https://accounts.test";

const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const jwk = publicKey.export({ format: "jwk" });
const KID = "test-key-1";

const jwksServer = http.createServer((_req, res) => {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ keys: [{ ...jwk, kid: KID, alg: "RS256", use: "sig" }] }));
});
await new Promise((resolve) => jwksServer.listen(JWKS_PORT, resolve));

const b64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");

function makeToken(payload, options = {}) {
  const header = { alg: "RS256", kid: options.kid ?? KID, typ: "JWT" };
  const signed = `${b64(header)}.${b64(payload)}`;
  const key = options.key ?? privateKey;
  const signature = crypto.sign("sha256", Buffer.from(signed), key);
  return `${signed}.${signature.toString("base64url")}`;
}

const base = (over = {}) => ({
  iss: ISSUER,
  aud: CLIENT_ID,
  sub: "google-user-1",
  email: "social@example.com",
  email_verified: true,
  name: "소셜 사용자",
  exp: Math.floor(Date.now() / 1000) + 600,
  ...over,
});

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "nailsense-oauth-"));
const server = spawn("npx", ["tsx", "server/index.ts"], {
  env: {
    ...process.env,
    PORT: String(API_PORT),
    DATA_DIR: dataDir,
    GOOGLE_CLIENT_ID: CLIENT_ID,
    GOOGLE_JWKS_URL: `http://127.0.0.1:${JWKS_PORT}/certs`,
    GOOGLE_ISSUERS: ISSUER,
  },
  stdio: "ignore",
  detached: true,
});

const API = `http://127.0.0.1:${API_PORT}`;
const ready = async () => {
  for (let i = 0; i < 50; i += 1) {
    try {
      const response = await fetch(`${API}/api/health`);
      if (response.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
};
if (!(await ready())) throw new Error("서버가 뜨지 않았습니다.");

const problems = [];
const post = (pathname, body, cookie) =>
  fetch(`${API}${pathname}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: API,
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  });

const check = async (label, expectOk, body) => {
  const response = await post("/api/auth/google", body);
  const json = await response.json().catch(() => ({}));
  const ok = response.ok && json.ok === true;
  if (ok !== expectOk) {
    problems.push(`${label}: 기대 ${expectOk ? "통과" : "거절"} · 실제 ${response.status} ${json.code ?? ""}`);
  }
  console.log(
    `${ok === expectOk ? "  ok" : "실패"}  ${label} → ${response.status}${json.code ? ` (${json.code})` : ""}`,
  );
  return { response, json };
};

console.log("구글 ID 토큰 검증");
const first = await check("정상 토큰", true, { idToken: makeToken(base()) });
const cookie = first.response.headers.get("set-cookie")?.split(";")[0];
const userId = first.json.user?.id;

await check("다른 앱의 수신자(aud)", false, {
  idToken: makeToken(base({ aud: "someone-else" })),
});
await check("만료된 토큰", false, {
  idToken: makeToken(base({ exp: Math.floor(Date.now() / 1000) - 10 })),
});
await check("발급자가 다름", false, {
  idToken: makeToken(base({ iss: "https://evil.example" })),
});
await check("남의 키로 서명", false, {
  idToken: makeToken(base(), {
    key: crypto.generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey,
  }),
});
await check("본문만 바꿔치기", false, {
  idToken: (() => {
    const token = makeToken(base());
    const [h, , s] = token.split(".");
    return `${h}.${b64(base({ email: "victim@example.com" }))}.${s}`;
  })(),
});
await check("토큰 없음", false, {});

// 같은 사람이 다시 로그인하면 같은 계정이어야 한다.
const again = await check("같은 사람 재로그인", true, { idToken: makeToken(base()) });
if (again.json.user?.id !== userId) {
  problems.push("같은 구글 계정인데 다른 계정이 만들어졌습니다.");
}
if (again.json.user?.provider !== "google" || again.json.user?.hasPassword !== false) {
  problems.push("소셜 계정 표시가 잘못되었습니다.");
}

// 비밀번호로는 들어올 수 없어야 한다.
const byPassword = await post("/api/auth/login", {
  email: "social@example.com",
  password: "anything-at-all",
});
if (byPassword.ok) problems.push("비밀번호 없는 계정에 비밀번호로 로그인되었습니다.");
console.log(`  ok  소셜 계정에 비밀번호 로그인 → ${byPassword.status}`);

// 확인되지 않은 이메일은 기존 계정에 붙으면 안 된다.
await post("/api/auth/signup", { email: "victim@example.com", password: "victimpassword1" });
const hijack = await check("미확인 이메일로 남의 계정 연결", false, {
  idToken: makeToken(base({ sub: "google-user-2", email: "victim@example.com", email_verified: false })),
});
if (hijack.json.code && hijack.json.code !== "email_taken") {
  problems.push(`미확인 이메일 처리 코드가 예상과 다릅니다: ${hijack.json.code}`);
}

// 세션이 실제로 동작하는지
const me = await fetch(`${API}/api/auth/me`, { headers: { Cookie: cookie ?? "" } });
const meJson = await me.json();
if (meJson.user?.id !== userId) problems.push("소셜 로그인 세션이 유지되지 않았습니다.");
console.log(`  ok  세션 유지 → ${meJson.user?.email}`);

// 제공자 목록: 애플은 설정하지 않았으므로 꺼져 있어야 한다.
const providers = await (await fetch(`${API}/api/auth/providers`)).json();
if (!providers.providers?.google) problems.push("구글이 켜져 있다고 나오지 않습니다.");
if (providers.providers?.apple !== false) problems.push("설정하지 않은 애플이 켜져 있다고 나옵니다.");
console.log(`  ok  제공자 목록 → 구글 ${Boolean(providers.providers?.google)} / 애플 ${Boolean(providers.providers?.apple)}`);

try {
  process.kill(-server.pid, "SIGKILL");
} catch {}
jwksServer.close();
fs.rmSync(dataDir, { recursive: true, force: true });

if (problems.length > 0) {
  console.error("\n실패:");
  for (const problem of problems) console.error(` - ${problem}`);
  process.exit(1);
}
console.log("\n소셜 로그인 검증 통과");
