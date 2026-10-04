import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

/**
 * 계정과 분석 기록을 담는 데이터베이스.
 *
 * Node 내장 SQLite 를 쓴다. 별도 설치 없이 돌아가고, 파일 하나로 백업된다.
 * 사진은 여기 저장하지 않는다. 사진은 촬영한 기기의 브라우저 안에만 두고,
 * 이 테이블에는 그 사진을 가리키는 참조 키(image_ref)만 남긴다.
 *
 * 마이그레이션은 오직 추가만 한다. 기존 테이블을 지우거나 컬럼을 떨어뜨리지 않는다.
 * user_version 으로 어디까지 적용했는지 기억하고, 새 버전만 이어서 실행한다.
 */

const DATA_DIR = process.env.DATA_DIR ?? path.resolve(process.cwd(), "data");
const DB_FILE = process.env.DB_FILE ?? path.join(DATA_DIR, "nailsense.db");

let instance: DatabaseSync | null = null;

export function db(): DatabaseSync {
  if (instance) return instance;

  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
  const database = new DatabaseSync(DB_FILE);

  // 쓰기 중에도 읽기가 막히지 않게 하고, 외래 키 제약을 실제로 걸리게 한다.
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA foreign_keys = ON");
  database.exec("PRAGMA busy_timeout = 5000");

  migrate(database);

  // 계정 파일에는 비밀번호 해시가 들어 있다. 같은 기계의 다른 사용자가 읽지 못하게 한다.
  try {
    fs.chmodSync(DB_FILE, 0o600);
  } catch {
    // 파일 시스템이 권한을 지원하지 않으면(예: 일부 컨테이너) 넘어간다.
  }

  instance = database;
  return database;
}

interface Migration {
  version: number;
  name: string;
  sql: string;
}

/**
 * 절대 기존 마이그레이션을 고치지 말 것. 고쳐야 할 일이 생기면 새 버전을 덧붙인다.
 * 이미 적용한 데이터베이스는 과거 버전을 다시 실행하지 않기 때문이다.
 */
const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "계정 · 기록 · 결과 · 설정 · 건강 정보",
    sql: `
      CREATE TABLE IF NOT EXISTS profiles (
        id            TEXT PRIMARY KEY,
        email         TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        display_name  TEXT NOT NULL DEFAULT '',
        created_at    INTEGER NOT NULL,
        updated_at    INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id    TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        last_seen  INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

      CREATE TABLE IF NOT EXISTS nail_scans (
        id           TEXT PRIMARY KEY,
        user_id      TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        hand         TEXT NOT NULL,
        finger       TEXT NOT NULL,
        note         TEXT NOT NULL DEFAULT '',
        -- 사진은 기기 안에만 있다. 여기 남는 것은 그 사진을 찾는 열쇠뿐이다.
        image_ref    TEXT,
        image_stored INTEGER NOT NULL DEFAULT 0,
        status       TEXT NOT NULL DEFAULT 'pending',
        error_code   TEXT,
        error_message TEXT,
        provider     TEXT,
        model        TEXT,
        demo         INTEGER NOT NULL DEFAULT 0,
        captured_at  INTEGER NOT NULL,
        created_at   INTEGER NOT NULL,
        updated_at   INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_scans_user_time
        ON nail_scans(user_id, captured_at DESC);

      CREATE TABLE IF NOT EXISTS scan_results (
        id            TEXT PRIMARY KEY,
        scan_id       TEXT NOT NULL UNIQUE REFERENCES nail_scans(id) ON DELETE CASCADE,
        -- 소유자 검사를 조인 없이 한 번에 하기 위해 사용자 아이디를 같이 둔다.
        user_id       TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        quality_json      TEXT NOT NULL,
        observations_json TEXT NOT NULL,
        general_json      TEXT NOT NULL,
        care_json         TEXT NOT NULL,
        consult_json      TEXT NOT NULL,
        analysis_json     TEXT NOT NULL,
        created_at    INTEGER NOT NULL,
        updated_at    INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_results_user ON scan_results(user_id);

      CREATE TABLE IF NOT EXISTS user_preferences (
        user_id           TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
        nickname          TEXT NOT NULL DEFAULT '',
        keep_photos       INTEGER NOT NULL DEFAULT 1,
        expand_by_default INTEGER NOT NULL DEFAULT 0,
        onboarded         INTEGER NOT NULL DEFAULT 0,
        created_at        INTEGER NOT NULL,
        updated_at        INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS health_articles (
        id         TEXT PRIMARY KEY,
        slug       TEXT NOT NULL UNIQUE,
        category   TEXT NOT NULL,
        title      TEXT NOT NULL,
        summary    TEXT NOT NULL,
        body       TEXT NOT NULL,
        tags       TEXT NOT NULL DEFAULT '',
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_articles_category ON health_articles(category);
    `,
  },
  {
    version: 2,
    name: "구글 · 애플 로그인 연결",
    sql: `
      -- 소셜 계정은 비밀번호가 없다. password_hash 에는 빈 문자열이 들어가고,
      -- 빈 해시는 어떤 비밀번호와도 맞지 않으므로 비밀번호로는 로그인되지 않는다.
      ALTER TABLE profiles ADD COLUMN google_sub TEXT;
      ALTER TABLE profiles ADD COLUMN apple_sub TEXT;
      ALTER TABLE profiles ADD COLUMN auth_provider TEXT NOT NULL DEFAULT 'password';
      ALTER TABLE profiles ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0;

      -- 같은 소셜 계정이 두 프로필에 붙지 않게 한다. NULL 은 여럿이어도 된다.
      CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_google
        ON profiles(google_sub) WHERE google_sub IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_apple
        ON profiles(apple_sub) WHERE apple_sub IS NOT NULL;
    `,
  },
  {
    version: 3,
    name: "구독 · 결제 이벤트 · 사용량 · 건강 데이터 동의",
    sql: `
      -- 결제 업체(Paddle)의 고객 아이디. 카드 정보는 결제 업체에만 있고 여기에는 없다.
      ALTER TABLE profiles ADD COLUMN paddle_customer_id TEXT;

      -- 구독 상태의 사본. 원본은 결제 업체에 있고, 웹훅과 API 조회로 맞춘다.
      CREATE TABLE IF NOT EXISTS subscriptions (
        id                  TEXT PRIMARY KEY,
        user_id             TEXT REFERENCES profiles(id) ON DELETE CASCADE,
        customer_id         TEXT,
        status              TEXT NOT NULL,
        price_id            TEXT,
        billing_interval    TEXT,
        current_period_end  INTEGER,
        scheduled_cancel_at INTEGER,
        -- 결제 업체 쪽에서 마지막으로 바뀐 시각. 늦게 도착한 옛 이벤트를 걸러 낸다.
        source_updated_at   INTEGER NOT NULL,
        created_at          INTEGER NOT NULL,
        updated_at          INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id);

      -- 서버가 만든 결제 거래. 어느 계정이 시작한 결제인지는 이 표로만 판단한다.
      CREATE TABLE IF NOT EXISTS billing_checkouts (
        transaction_id  TEXT PRIMARY KEY,
        user_id         TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        price_id        TEXT NOT NULL,
        subscription_id TEXT,
        created_at      INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_checkouts_subscription
        ON billing_checkouts(subscription_id);

      -- 같은 웹훅이 두 번 와도 한 번만 처리한다.
      CREATE TABLE IF NOT EXISTS billing_events (
        event_id    TEXT PRIMARY KEY,
        event_type  TEXT NOT NULL,
        received_at INTEGER NOT NULL
      );

      -- 무료 사용 한도. 주체는 계정, 또는 (로그인하지 않았으면) 기기와 IP 의 해시다.
      CREATE TABLE IF NOT EXISTS usage_counters (
        subject    TEXT NOT NULL,
        period     TEXT NOT NULL,
        count      INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (subject, period)
      );

      -- 서버가 스스로 만든 비밀값(사용량 해시용). 환경변수로 주면 그쪽이 우선한다.
      CREATE TABLE IF NOT EXISTS app_secrets (
        name       TEXT PRIMARY KEY,
        value      TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      -- 건강 데이터 처리 동의를 언제, 어느 문구 버전에 받았는지.
      ALTER TABLE user_preferences ADD COLUMN health_consent_at INTEGER;
      ALTER TABLE user_preferences ADD COLUMN health_consent_version TEXT;
    `,
  },
  {
    version: 4,
    name: "건강 정보 글을 언어별로",
    sql: `
      -- 같은 글(slug)을 언어마다 한 줄씩 둔다. 예전 표(health_articles)는 지우지 않고 그대로 둔다.
      CREATE TABLE IF NOT EXISTS health_article_texts (
        slug       TEXT NOT NULL,
        locale     TEXT NOT NULL,
        category   TEXT NOT NULL,
        title      TEXT NOT NULL,
        summary    TEXT NOT NULL,
        body       TEXT NOT NULL,
        tags       TEXT NOT NULL DEFAULT '',
        sort_order INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (slug, locale)
      );
      CREATE INDEX IF NOT EXISTS idx_article_texts_locale
        ON health_article_texts(locale, category);
    `,
  },
  {
    version: 5,
    name: "앱스토어·플레이스토어 구독(RevenueCat)",
    sql: `
      -- 휴대폰 앱의 인앱 구독. 계정마다 한 줄. RevenueCat 에서 확인한 Pro 권한 상태를 담는다.
      -- 결제 정보(카드 등)는 애플·구글이 갖고 있고 여기에는 오지 않는다.
      CREATE TABLE IF NOT EXISTS store_subscriptions (
        user_id          TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
        status           TEXT NOT NULL,
        store            TEXT,
        product_id       TEXT,
        billing_interval TEXT,
        expires_at       INTEGER,
        cancel_at        INTEGER,
        sandbox          INTEGER NOT NULL DEFAULT 0,
        checked_at       INTEGER NOT NULL
      );
    `,
  },
];

function migrate(database: DatabaseSync): void {
  const row = database.prepare("PRAGMA user_version").get() as
    | { user_version: number }
    | undefined;
  const current = row?.user_version ?? 0;

  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue;

    database.exec("BEGIN");
    try {
      database.exec(migration.sql);
      // PRAGMA 는 바인딩을 받지 않는다. 값은 코드 안의 정수뿐이라 안전하다.
      database.exec(`PRAGMA user_version = ${migration.version}`);
      database.exec("COMMIT");
      console.log(`[db] 마이그레이션 ${migration.version} 적용: ${migration.name}`);
    } catch (err) {
      database.exec("ROLLBACK");
      throw err;
    }
  }
}

export function now(): number {
  return Date.now();
}

/** 테스트에서 데이터베이스를 갈아 끼울 때만 쓴다. */
export function closeDb(): void {
  instance?.close();
  instance = null;
}

export const DB_PATH = DB_FILE;
