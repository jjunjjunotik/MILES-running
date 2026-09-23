import crypto from "node:crypto";
import { Router, type Request, type Response } from "express";
import { db, now } from "./db.js";
import {
  AuthError,
  authenticate,
  checkPassword,
  createAccount,
  deleteAccount,
  endAllSessions,
  endSession,
  normalizeEmail,
  requireUser,
  startSession,
} from "./auth.js";
import { createRateLimiter } from "./security.js";
import { METRIC_KEYS, type NailAnalysis } from "../shared/analysis.js";

/**
 * 계정 · 기록 · 설정 · 건강 정보 API.
 *
 * 규칙 하나: 사용자 데이터를 읽거나 쓰는 모든 질의는 WHERE user_id = ? 를 반드시 끼고 간다.
 * 아이디를 알아도 남의 기록에는 닿지 못한다. 없는 기록과 남의 기록은 똑같이 404 다.
 */

export const api = Router();

/** 로그인·가입은 통과당 비용이 크고 추측 공격의 표적이라 따로 더 좁게 막는다. */
const authLimiter = createRateLimiter({
  perIp: Number(process.env.AUTH_RATE_LIMIT_PER_IP ?? 20),
  global: Number(process.env.AUTH_RATE_LIMIT_GLOBAL ?? 200),
  windowMs: Number(process.env.AUTH_RATE_LIMIT_WINDOW_MS ?? 10 * 60 * 1000),
});

function fail(res: Response, err: unknown): void {
  if (err instanceof AuthError) {
    res.status(err.status).json({ ok: false, code: err.code, error: err.message });
    return;
  }
  // 예외 내용은 사용자에게 내보내지 않는다. 사진이나 이메일이 섞여 나갈 수 있다.
  console.error("api error");
  res.status(500).json({
    ok: false,
    code: "server_error",
    error: "처리 중 문제가 생겼습니다. 잠시 후 다시 시도해 주세요.",
  });
}

/* ---------------------------------- 인증 ---------------------------------- */

api.post("/auth/signup", authLimiter, (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const password = checkPassword(req.body?.password);
    const displayName =
      typeof req.body?.displayName === "string" ? req.body.displayName : "";

    const user = createAccount(email, password, displayName);
    startSession(res, user.id);
    res.status(201).json({ ok: true, user });
  } catch (err) {
    fail(res, err);
  }
});

api.post("/auth/login", authLimiter, (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const password =
      typeof req.body?.password === "string" ? req.body.password : "";
    const user = authenticate(email, password);
    startSession(res, user.id);
    res.json({ ok: true, user });
  } catch (err) {
    fail(res, err);
  }
});

api.post("/auth/logout", (req, res) => {
  try {
    endSession(req, res);
    res.json({ ok: true });
  } catch (err) {
    fail(res, err);
  }
});

api.get("/auth/me", (req, res) => {
  res.json({ ok: true, user: req.user ?? null });
});

api.delete("/auth/account", requireUser, authLimiter, (req, res) => {
  try {
    // 계정 삭제는 되돌릴 수 없다. 비밀번호를 한 번 더 확인한다.
    const password =
      typeof req.body?.password === "string" ? req.body.password : "";
    authenticate(req.user!.email, password);
    endAllSessions(req.user!.id);
    deleteAccount(req.user!.id);
    endSession(req, res);
    res.json({ ok: true });
  } catch (err) {
    fail(res, err);
  }
});

/* ---------------------------------- 기록 ---------------------------------- */

interface ScanRow {
  id: string;
  hand: string;
  finger: string;
  note: string;
  imageRef: string | null;
  imageStored: number;
  status: string;
  errorCode: string | null;
  errorMessage: string | null;
  provider: string | null;
  model: string | null;
  demo: number;
  capturedAt: number;
  createdAt: number;
  updatedAt: number;
  analysisJson?: string;
}

const SCAN_COLUMNS = `
  s.id, s.hand, s.finger, s.note,
  s.image_ref AS imageRef, s.image_stored AS imageStored,
  s.status, s.error_code AS errorCode, s.error_message AS errorMessage,
  s.provider, s.model, s.demo,
  s.captured_at AS capturedAt, s.created_at AS createdAt, s.updated_at AS updatedAt
`;

function toScan(row: ScanRow) {
  return {
    id: row.id,
    hand: row.hand,
    finger: row.finger,
    note: row.note,
    imageRef: row.imageRef,
    hasImage: row.imageStored === 1,
    status: row.status,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    provider: row.provider,
    model: row.model,
    demo: row.demo === 1,
    capturedAt: row.capturedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    analysis: row.analysisJson
      ? (JSON.parse(row.analysisJson) as NailAnalysis)
      : null,
  };
}

/**
 * 분석 결과를 기록으로 남긴다. analyze 경로와 가져오기 경로가 함께 쓴다.
 * 결과는 통째로도 저장하고, 화면이 나눠 쓰는 다섯 덩어리로도 나눠 둔다.
 */
export function saveScan(input: {
  userId: string;
  scanId?: string;
  hand: string;
  finger: string;
  note: string;
  imageRef: string | null;
  hasImage: boolean;
  capturedAt: number;
  provider: string | null;
  model: string | null;
  demo: boolean;
  analysis: NailAnalysis;
}): string {
  const scanId = input.scanId ?? crypto.randomUUID();
  const stamp = now();
  const a = input.analysis;

  db().exec("BEGIN");
  try {
    db()
      .prepare(
        `INSERT INTO nail_scans
           (id, user_id, hand, finger, note, image_ref, image_stored, status,
            provider, model, demo, captured_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'done', ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO NOTHING`,
      )
      .run(
        scanId,
        input.userId,
        input.hand,
        input.finger,
        input.note,
        input.imageRef,
        input.hasImage ? 1 : 0,
        input.provider,
        input.model,
        input.demo ? 1 : 0,
        input.capturedAt,
        stamp,
        stamp,
      );

    db()
      .prepare(
        `INSERT INTO scan_results
           (id, scan_id, user_id, quality_json, observations_json, general_json,
            care_json, consult_json, analysis_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(scan_id) DO NOTHING`,
      )
      .run(
        crypto.randomUUID(),
        scanId,
        input.userId,
        JSON.stringify({ isNailPhoto: a.isNailPhoto, ...a.imageQuality }),
        JSON.stringify({ metrics: a.metrics, findings: a.findings }),
        JSON.stringify({
          headline: a.headline,
          summary: a.summary,
          observationScore: a.observationScore,
        }),
        JSON.stringify({ tips: a.tips }),
        JSON.stringify({ consultSignals: a.consultSignals }),
        JSON.stringify(a),
        stamp,
        stamp,
      );

    db().exec("COMMIT");
  } catch (err) {
    db().exec("ROLLBACK");
    throw err;
  }

  return scanId;
}

/** 분석이 실패한 시도도 남긴다. 사용자가 "그때 왜 안 됐지"를 볼 수 있어야 한다. */
export function saveFailedScan(input: {
  userId: string;
  hand: string;
  finger: string;
  note: string;
  capturedAt: number;
  code: string;
  message: string;
}): void {
  const stamp = now();
  db()
    .prepare(
      `INSERT INTO nail_scans
         (id, user_id, hand, finger, note, image_ref, image_stored, status,
          error_code, error_message, captured_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, NULL, 0, 'failed', ?, ?, ?, ?, ?)`,
    )
    .run(
      crypto.randomUUID(),
      input.userId,
      input.hand,
      input.finger,
      input.note,
      input.code,
      input.message,
      input.capturedAt,
      stamp,
      stamp,
    );
}

api.get("/scans", requireUser, (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit ?? 100) || 100, 300);
    const rows = db()
      .prepare(
        `SELECT ${SCAN_COLUMNS}, r.analysis_json AS analysisJson
           FROM nail_scans s
           LEFT JOIN scan_results r ON r.scan_id = s.id
          WHERE s.user_id = ?
          ORDER BY s.captured_at DESC
          LIMIT ?`,
      )
      .all(req.user!.id, limit) as unknown as ScanRow[];
    res.json({ ok: true, scans: rows.map(toScan) });
  } catch (err) {
    fail(res, err);
  }
});

/** 사진만 지운다. 결과는 남기고 "사진 있음" 표시만 내린다. */
api.delete("/scans/images", requireUser, (req, res) => {
  try {
    const result = db()
      .prepare(
        "UPDATE nail_scans SET image_ref = NULL, image_stored = 0, updated_at = ? WHERE user_id = ? AND image_stored = 1",
      )
      .run(now(), req.user!.id);
    res.json({ ok: true, cleared: Number(result.changes) });
  } catch (err) {
    fail(res, err);
  }
});

api.get("/scans/:id", requireUser, (req, res) => {
  try {
    const row = db()
      .prepare(
        `SELECT ${SCAN_COLUMNS}, r.analysis_json AS analysisJson
           FROM nail_scans s
           LEFT JOIN scan_results r ON r.scan_id = s.id
          WHERE s.id = ? AND s.user_id = ?`,
      )
      .get(String(req.params.id), req.user!.id) as unknown as ScanRow | undefined;

    // 남의 기록도 없는 기록과 똑같이 취급한다. 존재 여부조차 알려 주지 않는다.
    if (!row) {
      res.status(404).json({ ok: false, code: "not_found", error: "기록을 찾지 못했습니다." });
      return;
    }
    res.json({ ok: true, scan: toScan(row) });
  } catch (err) {
    fail(res, err);
  }
});

api.delete("/scans/:id", requireUser, (req, res) => {
  try {
    const result = db()
      .prepare("DELETE FROM nail_scans WHERE id = ? AND user_id = ?")
      .run(String(req.params.id), req.user!.id);
    if (result.changes === 0) {
      res.status(404).json({ ok: false, code: "not_found", error: "기록을 찾지 못했습니다." });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    fail(res, err);
  }
});

api.delete("/scans", requireUser, (req, res) => {
  try {
    const result = db()
      .prepare("DELETE FROM nail_scans WHERE user_id = ?")
      .run(req.user!.id);
    res.json({ ok: true, deleted: Number(result.changes) });
  } catch (err) {
    fail(res, err);
  }
});

/**
 * 계정을 만들기 전에 이 기기에 쌓인 기록을 계정으로 옮긴다.
 * 같은 아이디가 이미 있으면 건너뛰므로 여러 번 눌러도 중복되지 않는다.
 */
api.post("/scans/import", requireUser, (req, res) => {
  try {
    const items = Array.isArray(req.body?.scans) ? req.body.scans.slice(0, 200) : [];
    let imported = 0;

    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      const analysis = item.analysis as NailAnalysis | undefined;
      // 형식이 맞지 않는 것은 조용히 건너뛴다. 하나가 깨졌다고 전체가 실패하면 안 된다.
      if (!analysis || !Array.isArray(analysis.metrics)) continue;
      if (analysis.metrics.length !== METRIC_KEYS.length) continue;

      const id = typeof item.id === "string" ? item.id : crypto.randomUUID();
      const exists = db()
        .prepare("SELECT 1 FROM nail_scans WHERE id = ?")
        .get(id);
      if (exists) continue;

      saveScan({
        userId: req.user!.id,
        scanId: id,
        hand: item.hand === "left" ? "left" : "right",
        finger: typeof item.finger === "string" ? item.finger : "index",
        note: typeof item.note === "string" ? item.note.slice(0, 300) : "",
        imageRef: typeof item.id === "string" ? item.id : null,
        hasImage: item.hasImage === true,
        capturedAt: Number(item.createdAt) || now(),
        provider: null,
        model: null,
        demo: false,
        analysis,
      });
      imported += 1;
    }

    res.json({ ok: true, imported });
  } catch (err) {
    fail(res, err);
  }
});

/* ---------------------------------- 설정 ---------------------------------- */

api.get("/preferences", requireUser, (req, res) => {
  try {
    res.json({ ok: true, preferences: readPreferences(req.user!.id) });
  } catch (err) {
    fail(res, err);
  }
});

api.put("/preferences", requireUser, (req, res) => {
  try {
    const current = readPreferences(req.user!.id);
    const body = req.body ?? {};
    const next = {
      nickname:
        typeof body.nickname === "string"
          ? body.nickname.trim().slice(0, 40)
          : current.nickname,
      keepPhotos:
        typeof body.keepPhotos === "boolean" ? body.keepPhotos : current.keepPhotos,
      expandByDefault:
        typeof body.expandByDefault === "boolean"
          ? body.expandByDefault
          : current.expandByDefault,
      onboarded:
        typeof body.onboarded === "boolean" ? body.onboarded : current.onboarded,
    };

    db()
      .prepare(
        `UPDATE user_preferences
            SET nickname = ?, keep_photos = ?, expand_by_default = ?, onboarded = ?, updated_at = ?
          WHERE user_id = ?`,
      )
      .run(
        next.nickname,
        next.keepPhotos ? 1 : 0,
        next.expandByDefault ? 1 : 0,
        next.onboarded ? 1 : 0,
        now(),
        req.user!.id,
      );

    res.json({ ok: true, preferences: next });
  } catch (err) {
    fail(res, err);
  }
});

function readPreferences(userId: string) {
  const row = db()
    .prepare(
      `SELECT nickname, keep_photos AS keepPhotos,
              expand_by_default AS expandByDefault, onboarded
         FROM user_preferences WHERE user_id = ?`,
    )
    .get(userId) as
    | { nickname: string; keepPhotos: number; expandByDefault: number; onboarded: number }
    | undefined;

  if (!row) {
    // 마이그레이션 전에 만들어진 계정이라도 화면이 빈손으로 돌아가지 않게 한다.
    const stamp = now();
    db()
      .prepare(
        `INSERT INTO user_preferences (user_id, created_at, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(user_id) DO NOTHING`,
      )
      .run(userId, stamp, stamp);
    return { nickname: "", keepPhotos: true, expandByDefault: false, onboarded: false };
  }

  return {
    nickname: row.nickname,
    keepPhotos: row.keepPhotos === 1,
    expandByDefault: row.expandByDefault === 1,
    onboarded: row.onboarded === 1,
  };
}

/* -------------------------------- 건강 정보 -------------------------------- */

api.get("/articles", (req, res) => {
  try {
    const category = typeof req.query.category === "string" ? req.query.category : "";
    const query = typeof req.query.q === "string" ? req.query.q.trim() : "";

    let sql = `SELECT id, slug, category, title, summary, tags
                 FROM health_articles WHERE 1 = 1`;
    const params: string[] = [];

    if (category && category !== "all") {
      sql += " AND category = ?";
      params.push(category);
    }
    if (query) {
      sql += " AND (title LIKE ? OR summary LIKE ? OR body LIKE ? OR tags LIKE ?)";
      const like = `%${query}%`;
      params.push(like, like, like, like);
    }
    sql += " ORDER BY sort_order ASC, title ASC";

    const rows = db().prepare(sql).all(...params);
    res.json({ ok: true, articles: rows });
  } catch (err) {
    fail(res, err);
  }
});

api.get("/articles/:slug", (req, res) => {
  try {
    const row = db()
      .prepare(
        `SELECT id, slug, category, title, summary, body, tags, updated_at AS updatedAt
           FROM health_articles WHERE slug = ?`,
      )
      .get(String(req.params.slug));
    if (!row) {
      res.status(404).json({ ok: false, code: "not_found", error: "글을 찾지 못했습니다." });
      return;
    }
    res.json({ ok: true, article: row });
  } catch (err) {
    fail(res, err);
  }
});

export type { Request };
