/**
 * 테스트용 앱 서버를 띄운다. 빈 데이터베이스, 데모 분석(키 없음), 실제 .env 는 읽지 않는다.
 * check-store.mjs(서버 검증)와 e2e-store.mjs(화면 검증)가 함께 쓴다.
 *
 * env 로 넘긴 값이 기본값을 덮는다. 예: 가짜 RevenueCat 주소, 무료 한도 횟수.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export async function startAppServer({ port, env = {} }) {
  // 지난 테스트의 서버가 같은 포트에 남아 있으면, 새 코드가 아니라 옛 서버를 시험하게 된다. 먼저 막는다.
  const leftover = await fetch(`http://127.0.0.1:${port}/api/health`).then(
    () => true,
    () => false,
  );
  if (leftover) {
    throw new Error(`포트 ${port} 에 이미 서버가 떠 있습니다. 지난 테스트의 서버를 끄고 다시 실행하세요.`);
  }

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "nailsense-test-"));
  const server = spawn("npx", ["tsx", "server/index.ts"], {
    env: {
      ...process.env,
      PORT: String(port),
      DATA_DIR: dataDir,
      DB_FILE: path.join(dataDir, "test.db"),
      // 개발자 컴퓨터의 진짜 .env(키·비밀값)를 읽지 않게 없는 파일을 가리킨다.
      ENV_FILE: path.join(dataDir, "none.env"),
      GEMINI_API_KEY: "",
      ANTHROPIC_API_KEY: "",
      ALLOW_DEMO_FALLBACK: "true",
      NODE_ENV: "development",
      RATE_LIMIT_PER_IP: "500",
      AUTH_RATE_LIMIT_PER_IP: "500",
      BILLING_RATE_LIMIT_PER_IP: "500",
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  let output = "";
  server.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  server.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });

  const api = `http://127.0.0.1:${port}`;
  const stop = () => {
    try {
      process.kill(-server.pid, "SIGTERM");
    } catch {}
    fs.rmSync(dataDir, { recursive: true, force: true });
  };

  for (let i = 0; i < 60; i += 1) {
    try {
      const response = await fetch(`${api}/api/health`);
      if (response.ok) return { api, stop, output: () => output, errors: () => output };
    } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  stop();
  throw new Error(`서버가 뜨지 않았습니다.\n${output.slice(-2000)}`);
}
