/**
 * 빌드 산출물과 추적 중인 소스에 자격증명이 섞여 있는지 검사한다.
 *
 *   npm run check:secrets
 *
 * 빌드(npm run build, npm run build:demo)가 끝난 뒤 자동으로 돌며,
 * 하나라도 걸리면 0이 아닌 코드로 끝난다.
 *
 * 왜 필요한가: Vite 는 VITE_ 로 시작하는 환경변수를 클라이언트 번들에
 * 그대로 새겨 넣는다. 키 이름을 한 번 잘못 지으면 브라우저를 여는 누구나
 * 키를 볼 수 있고, 그 사실을 알아채기 어렵다.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const PATTERNS = [
  { name: "Anthropic API 키", re: /sk-ant-[A-Za-z0-9_-]{8,}/ },
  { name: "OpenAI 계열 키", re: /\bsk-[A-Za-z0-9]{32,}\b/ },
  { name: "AWS 액세스 키", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "GitHub 토큰", re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/ },
  { name: "Google API 키", re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: "PEM 개인키", re: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
];

/** 이 파일 자신과 예시 파일은 패턴을 일부러 담고 있으므로 건너뛴다. */
const SKIP = new Set([
  "scripts/check-secrets.mjs",
  ".env.example",
]);

const findings = [];

function scan(label, text) {
  for (const { name, re } of PATTERNS) {
    const hit = text.match(re);
    if (hit) {
      // 값 자체는 출력하지 않는다. 어디서 걸렸는지만 알린다.
      findings.push(`${label}: ${name} 으로 보이는 문자열 (${hit[0].length}자)`);
    }
  }
}

function walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
    } else if (entry.isFile()) {
      scan(full, fs.readFileSync(full, "utf8"));
    }
  }
}

// 1) 빌드 산출물 — 브라우저로 그대로 나가는 것들
for (const dir of ["dist", "demo"]) walk(dir);

// 2) git 이 추적 중인 파일 — 커밋되면 남에게 보인다
let tracked = [];
try {
  tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
    .split("\0")
    .filter(Boolean);
} catch {
  console.warn("git 추적 파일 목록을 읽지 못해 소스 검사는 건너뜁니다.");
}

for (const file of tracked) {
  if (SKIP.has(file)) continue;
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    continue; // 바이너리 등
  }
  scan(file, text);
}

// 3) .env 가 실수로 추적되고 있지 않은지
for (const file of tracked) {
  if (file === ".env" || file.startsWith(".env.") && file !== ".env.example") {
    findings.push(`${file}: 환경변수 파일이 git 에 추적되고 있습니다.`);
  }
}

// 4) 클라이언트로 노출되는 VITE_ 변수에 비밀이 들어가 있지 않은지
for (const name of Object.keys(process.env)) {
  if (name.startsWith("VITE_") && /KEY|SECRET|TOKEN|PASSWORD/i.test(name)) {
    findings.push(
      `환경변수 ${name}: VITE_ 접두사는 브라우저로 그대로 노출됩니다.`,
    );
  }
}

if (findings.length > 0) {
  console.error("자격증명으로 보이는 값이 발견되었습니다:\n");
  for (const finding of findings) console.error(` - ${finding}`);
  console.error(
    "\n키가 이미 커밋되었거나 배포되었다면, 지우는 것만으로는 부족합니다." +
      "\nconsole.anthropic.com 에서 해당 키를 폐기하고 새로 발급하세요.",
  );
  process.exit(1);
}

console.log("자격증명 검사 통과: 산출물과 추적 파일에서 발견된 것이 없습니다.");
