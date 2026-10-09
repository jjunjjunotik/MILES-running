/**
 * 데이터베이스 마이그레이션 점검.
 *
 *   npm run check:db
 *
 * 1) 빈 데이터베이스에서 시작하면 모든 마이그레이션이 적용되고, 웹 결제(Paddle) 표는 남지 않는다.
 * 2) 웹 결제를 쓰던 때(버전 5)의 데이터베이스에 Paddle 기록을 넣어 두고 지금 서버를 켜면,
 *    Paddle 표 · 열 · 웹훅 기록만 사라지고 계정 · 분석 기록 · 인앱 구독 · 동의 기록은 그대로 남는다.
 */
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startAppServer } from "./lib/app-server.mjs";

const PORT = 8891;
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

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "nailsense-db-"));

async function stopAndWait(app) {
  app.stop();
  for (let i = 0; i < 50; i += 1) {
    const alive = await fetch(`${app.api}/api/health`).then(
      () => true,
      () => false,
    );
    if (!alive) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("서버가 꺼지지 않았습니다.");
}

const tables = (db) =>
  db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name);
const columns = (db, table) => db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name);

try {
  console.log("빈 데이터베이스에서 시작");
  let app = await startAppServer({ port: PORT, dataDir });
  const signup = await fetch(`${app.api}/api/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "capacitor://localhost", "X-NailSense-Client": "app" },
    body: JSON.stringify({ email: "keep@example.com", password: "password123", displayName: "Keep" }),
  });
  const { user, sessionToken } = await signup.json();
  const scan = await fetch(`${app.api}/api/analyze`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "capacitor://localhost",
      "X-NailSense-Client": "app",
      Authorization: `Bearer ${sessionToken}`,
    },
    body: JSON.stringify({
      image: Buffer.from("not really a photo").toString("base64"),
      mediaType: "image/jpeg",
      hand: "left",
      fingerKey: "ring",
      note: "",
      keepPhoto: false,
      consentVersion: CONSENT_VERSION,
    }),
  });
  check(signup.status === 201 && scan.ok, "가입과 분석 기록 만들기");
  await stopAndWait(app);

  let db = new DatabaseSync(app.dbFile);
  check(db.prepare("PRAGMA user_version").get().user_version === 6, "마이그레이션 6까지 적용");
  check(!tables(db).includes("subscriptions") && !tables(db).includes("billing_checkouts"), "새 데이터베이스에는 Paddle 표가 없음");
  check(!columns(db, "profiles").includes("paddle_customer_id"), "profiles 에 Paddle 열이 없음");

  console.log("웹 결제를 쓰던 때의 데이터베이스(버전 5)를 흉내 냄");
  const at = Date.now();
  db.exec(`
    ALTER TABLE profiles ADD COLUMN paddle_customer_id TEXT;
    CREATE TABLE subscriptions (
      id TEXT PRIMARY KEY, user_id TEXT REFERENCES profiles(id) ON DELETE CASCADE, customer_id TEXT,
      status TEXT NOT NULL, price_id TEXT, billing_interval TEXT, current_period_end INTEGER,
      scheduled_cancel_at INTEGER, source_updated_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE INDEX idx_subscriptions_user ON subscriptions(user_id);
    CREATE TABLE billing_checkouts (
      transaction_id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      price_id TEXT NOT NULL, subscription_id TEXT, created_at INTEGER NOT NULL
    );
    CREATE INDEX idx_checkouts_subscription ON billing_checkouts(subscription_id);
  `);
  db.prepare("UPDATE profiles SET paddle_customer_id = ? WHERE id = ?").run("ctm_sandbox000001", user.id);
  db.prepare(
    `INSERT INTO subscriptions VALUES ('sub_sandbox000001', ?, 'ctm_sandbox000001', 'canceled', 'pri_x', 'month', ?, NULL, ?, ?, ?)`,
  ).run(user.id, at, at, at, at);
  db.prepare(`INSERT INTO billing_checkouts VALUES ('txn_sandbox000001', ?, 'pri_x', 'sub_sandbox000001', ?)`).run(user.id, at);
  db.prepare("INSERT INTO billing_events (event_id, event_type, received_at) VALUES (?, ?, ?)").run("evt_paddle0001", "subscription.created", at);
  db.prepare("INSERT INTO billing_events (event_id, event_type, received_at) VALUES (?, ?, ?)").run("rc:evt-0001", "rc:RENEWAL", at);
  db.prepare(
    `INSERT INTO store_subscriptions (user_id, status, store, product_id, billing_interval, expires_at, cancel_at, sandbox, checked_at)
     VALUES (?, 'active', 'app_store', 'nailsense_pro_monthly', 'month', ?, NULL, 1, ?)`,
  ).run(user.id, at + 86400000, at);
  db.exec("PRAGMA user_version = 5");
  const before = {
    profiles: db.prepare("SELECT COUNT(*) AS n FROM profiles").get().n,
    scans: db.prepare("SELECT COUNT(*) AS n FROM nail_scans").get().n,
    consent: db.prepare("SELECT health_consent_version AS v FROM user_preferences WHERE user_id = ?").get(user.id).v,
  };
  db.close();

  console.log("지금 서버로 다시 켬");
  app = await startAppServer({ port: PORT, dataDir });
  check(app.output().includes("마이그레이션 6 적용"), "마이그레이션 6이 실행됨");
  const login = await fetch(`${app.api}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "capacitor://localhost", "X-NailSense-Client": "app" },
    body: JSON.stringify({ email: "keep@example.com", password: "password123" }),
  });
  const loginBody = await login.json();
  check(login.ok && loginBody.user?.id === user.id, "기존 계정으로 로그인 됨");
  const scans = await (
    await fetch(`${app.api}/api/scans`, { headers: { Authorization: `Bearer ${loginBody.sessionToken}` } })
  ).json();
  check(scans.scans?.length === 1, "분석 기록이 그대로 있음");
  await stopAndWait(app);

  db = new DatabaseSync(app.dbFile);
  check(db.prepare("PRAGMA user_version").get().user_version === 6, "버전 6");
  check(!tables(db).includes("subscriptions") && !tables(db).includes("billing_checkouts"), "Paddle 표가 지워짐");
  check(!columns(db, "profiles").includes("paddle_customer_id"), "Paddle 고객 아이디 열이 지워짐");
  const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map((row) => row.name);
  check(!indexes.includes("idx_subscriptions_user") && !indexes.includes("idx_checkouts_subscription"), "Paddle 색인도 함께 지워짐");
  const events = db.prepare("SELECT event_id AS id FROM billing_events ORDER BY event_id").all().map((row) => row.id);
  check(events.length === 1 && events[0] === "rc:evt-0001", "Paddle 웹훅 기록만 지우고 인앱 구독 기록은 남김");
  check(db.prepare("SELECT COUNT(*) AS n FROM profiles").get().n === before.profiles, "계정 수 그대로");
  check(db.prepare("SELECT COUNT(*) AS n FROM nail_scans").get().n === before.scans, "분석 기록 수 그대로");
  check(
    db.prepare("SELECT health_consent_version AS v FROM user_preferences WHERE user_id = ?").get(user.id).v === before.consent,
    "동의 기록 그대로",
  );
  check(db.prepare("SELECT status FROM store_subscriptions WHERE user_id = ?").get(user.id)?.status === "active", "인앱 구독 기록 그대로");
  check(db.prepare("PRAGMA integrity_check").get().integrity_check === "ok", "무결성 검사 통과");
  check(db.prepare("PRAGMA foreign_key_check").all().length === 0, "외래 키 어긋남 없음");
  db.close();
} catch (err) {
  problems.push(`예외: ${err.message.split("\n")[0]}`);
  console.log(`실패  예외: ${err.message.split("\n")[0]}`);
} finally {
  fs.rmSync(dataDir, { recursive: true, force: true });
}

if (problems.length > 0) {
  console.error(`\n실패 ${problems.length}건:`);
  for (const problem of problems) console.error(` - ${problem}`);
  process.exit(1);
}
console.log("\n데이터베이스 마이그레이션 점검 통과.");
