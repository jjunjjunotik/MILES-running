// 반드시 첫 import. 다른 모듈이 최상위에서 키를 읽기 전에 .env 를 로드한다.
import { ENV_FILE_PATH } from "./env.js";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AnalyzeError,
  SUPPORTED_MEDIA_TYPES,
  activeProvider,
  analyzeNailPhoto,
  hasCredentials,
  type SupportedMediaType,
} from "./analyze.js";
import { buildDemoAnalysis } from "../shared/demo.js";
import {
  FINGER_KEYS,
  FINGER_LABELS,
  type AnalyzeResponse,
  type FingerKey,
} from "../shared/analysis.js";
import { HEALTH_CONSENT_VERSION } from "../shared/billing.js";
import {
  auditCredentials,
  createRateLimiter,
  redact,
  appCors,
  sameOriginOnly,
  securityHeaders,
} from "./security.js";
import { attachUser } from "./auth.js";
import { api, recordHealthConsent, saveFailedScan, saveScan } from "./routes.js";
import {
  billing,
  handlePaddleWebhook,
  quotaMessage,
  reserveScan,
  scanAllowance,
  usageOf,
} from "./billing.js";
import { billingConfig, missingBillingSettings } from "./billing-config.js";
import { pruneUsage } from "./usage.js";
import { missingStoreSettings, storeConfig } from "./revenuecat.js";
import { localeMiddleware } from "./i18n.js";
import { publicPages } from "./public-pages.js";
import { DB_PATH, db } from "./db.js";
import { seedArticles } from "./seed-articles.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT ?? 8787);
const ALLOW_DEMO = process.env.ALLOW_DEMO_FALLBACK !== "false";

// 리버스 프록시 뒤에서도 실제 클라이언트 IP 로 속도 제한이 걸리게 한다.
app.set("trust proxy", process.env.TRUST_PROXY === "true" ? 1 : false);
app.disable("x-powered-by");
app.use(securityHeaders);
// 응답 문구의 언어(영어/한국어)를 정한다. 오류 문구도 여기서 바뀐다.
app.use(localeMiddleware);
// 휴대폰 앱 화면(다른 출처)에서 오는 API 요청을 허락한다.
app.use("/api", appCors);

/**
 * 결제 업체(Paddle)의 웹훅. 서명을 원본 본문으로 검증해야 하므로 JSON 파서보다 먼저,
 * 원본 그대로 받는다. 브라우저가 아니라 Paddle 서버가 부르므로 세션도 오리진도 없다.
 */
app.post(
  "/api/billing/webhook",
  express.raw({ type: "*/*", limit: "1mb" }),
  handlePaddleWebhook,
);

// 업로드 이미지는 클라이언트에서 미리 1280px 이하로 줄여 보낸다.
app.use(express.json({ limit: "6mb" }));

/**
 * 세션 쿠키로 로그인을 유지하므로, 상태를 바꾸는 요청은 모두 같은 출처에서 온 것만 받는다.
 * 쿠키의 SameSite=strict 와 이 검사가 함께 CSRF 를 막는다.
 */
app.use("/api", (req, res, next) => {
  if (req.method === "GET" || req.method === "HEAD") return next();
  return sameOriginOnly(req, res, next);
});

// 세션이 있으면 req.user 를 채운다. 없으면 그대로 지나간다.
app.use("/api", attachUser);

// 이미지가 들어오는 경로이므로 본문은 어떤 형태로도 로깅하지 않는다.
app.use((req, _res, next) => {
  if (req.path.startsWith("/api")) {
    console.log(`${req.method} ${req.path}`);
  }
  next();
});

function isFingerKey(value: unknown): value is FingerKey {
  return (FINGER_KEYS as readonly unknown[]).includes(value);
}

/**
 * 분석 한 번이 곧 API 비용이다. 엔드포인트가 노출되어도 남이 내 키로
 * 마음껏 호출하지 못하도록 같은 출처만 받고 횟수를 제한한다.
 */
const analyzeLimiter = createRateLimiter({
  perIp: Number(process.env.RATE_LIMIT_PER_IP ?? 12),
  global: Number(process.env.RATE_LIMIT_GLOBAL ?? 240),
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS ?? 5 * 60 * 1000),
});

app.get("/api/health", (req, res) => {
  const provider = activeProvider();
  res.json({
    ok: true,
    configured: provider.hasCredentials(),
    demoAvailable: ALLOW_DEMO,
    // 모델 이름은 공개해도 무해하다. 키는 어떤 형태로도 내보내지 않는다.
    provider: provider.label,
    model: provider.model,
    signedIn: Boolean(req.user),
  });
});

// 요금제 · 결제 · 사용량
app.use("/api/billing", billing);

// 계정 · 기록 · 설정 · 건강 정보
app.use("/api", api);

app.post("/api/analyze", sameOriginOnly, analyzeLimiter, async (req, res) => {
  const send = (status: number, body: AnalyzeResponse) =>
    res.status(status).json(body);

  const { image, mediaType, hand, fingerKey, note, keepPhoto } =
    req.body ?? {};

  if (typeof image !== "string" || image.length === 0) {
    return send(400, {
      ok: false,
      code: "bad_request",
      error: "No photo was received.",
    });
  }
  if (!SUPPORTED_MEDIA_TYPES.includes(mediaType)) {
    return send(400, {
      ok: false,
      code: "bad_request",
      error: "That image format isn't supported. Please try a JPG or PNG.",
    });
  }
  // base64 는 원본 대비 약 4/3 크기다. 4MB 를 넘으면 거절한다.
  if (image.length > 4 * 1024 * 1024) {
    return send(413, {
      ok: false,
      code: "bad_request",
      error: "That photo is too large. Please try a smaller one.",
    });
  }

  const input = {
    imageBase64: image,
    mediaType: mediaType as SupportedMediaType,
    hand: hand === "left" ? "left hand" : "right hand",
    finger: isFingerKey(fingerKey)
      ? FINGER_LABELS[fingerKey].toLowerCase()
      : "finger not specified",
    note: typeof note === "string" ? note.slice(0, 300) : "",
    locale: req.locale,
  };

  /**
   * 기록에 남길 값들. 사진 자체는 서버에 저장하지 않는다.
   * 로그인하지 않았으면 서버에는 아무것도 남기지 않는다. 그때 기록은 기기 안에만 쌓인다.
   */
  const record = req.user
    ? {
        userId: req.user.id,
        hand: hand === "left" ? "left" : "right",
        finger: isFingerKey(fingerKey) ? fingerKey : "index",
        note: input.note,
        capturedAt: Date.now(),
      }
    : null;

  // 건강 데이터 처리에 동의한 화면에서 온 요청만 받는다. 동의 문구가 바뀌면 다시 묻는다.
  if (req.body?.consentVersion !== HEALTH_CONSENT_VERSION) {
    return send(400, {
      ok: false,
      code: "consent_required",
      error: "Please review how your photo is processed and agree before scanning.",
    });
  }
  if (req.user) recordHealthConsent(req.user.id, HEALTH_CONSENT_VERSION);

  /**
   * 사용 한도. 분석을 시작하기 전에 한 번을 미리 세고, 결과를 돌려주지 못하면 되돌린다.
   * 결제 기능이 꺼져 있으면 한도가 없다(allowance.buckets 가 비어 있다).
   */
  const allowance = scanAllowance(req, res);
  const reservation = reserveScan(allowance);
  if (!reservation.ok) {
    // 걸린 것이 IP 한도여도 화면에는 "이번 기간 횟수를 다 썼다"로 보이게 한다.
    const usage = usageOf(allowance);
    return send(402, {
      ok: false,
      code: "quota_exceeded",
      error: quotaMessage(allowance, Boolean(req.user)),
      usage: { ...usage, used: Math.max(usage.used, allowance.limit ?? 0) },
    });
  }
  // 로그인하지 않은 사람이 기다리다 나가 버리면 결과를 다시 볼 길이 없다. 그때는 세지 않는다.
  let clientGone = false;
  res.on("close", () => {
    if (!res.writableFinished) clientGone = true;
  });
  const finish = (status: number, body: AnalyzeResponse) => {
    if (!body.ok || (clientGone && !req.user)) reservation.release();
    if (clientGone) return;
    return send(
      status,
      body.ok && allowance.buckets.length > 0
        ? { ...body, usage: usageOf(allowance) }
        : body,
    );
  };

  if (!hasCredentials()) {
    if (!ALLOW_DEMO) {
      return finish(503, {
        ok: false,
        code: "no_api_key",
        error:
          "The analysis service isn't set up yet. Please contact the app's administrator.",
      });
    }
    const analysis = buildDemoAnalysis(image.length % 13, req.locale);
    if (!record) {
      return finish(200, { ok: true, demo: true, model: "demo", analysis });
    }
    const scanId = saveScan({
      ...record,
      imageRef: null,
      hasImage: keepPhoto === true,
      provider: "demo",
      model: "demo",
      demo: true,
      analysis,
    });
    // 사진은 이 아이디로 브라우저 안에 저장된다. 서버는 아이디만 안다.
    markImageRef(scanId, keepPhoto === true);
    return finish(200, { ok: true, demo: true, model: "demo", analysis, scanId });
  }

  try {
    const analysis = await analyzeNailPhoto(input);

    if (!analysis.isNailPhoto) {
      const message =
        "We couldn't find a nail in this photo. Please retake it with the nail filling the frame.";
      if (record) saveFailedScan({ ...record, code: "not_a_nail_photo", message });
      return finish(422, { ok: false, code: "not_a_nail_photo", error: message });
    }
    if (!analysis.imageQuality.usable) {
      const message =
        analysis.imageQuality.issues.length > 0
          ? `This photo was hard to read: ${analysis.imageQuality.issues.join(", ")}`
          : "The photo is too blurry to observe. Please retake it in bright light.";
      if (record) saveFailedScan({ ...record, code: "unusable_image", message });
      return finish(422, { ok: false, code: "unusable_image", error: message });
    }

    const provider = activeProvider();
    if (!record) {
      // 로그인하지 않은 사람의 분석은 서버에 흔적을 남기지 않는다.
      return finish(200, { ok: true, demo: false, model: provider.model, analysis });
    }

    const scanId = saveScan({
      ...record,
      imageRef: null,
      hasImage: keepPhoto === true,
      provider: provider.label,
      model: provider.model,
      demo: false,
      analysis,
    });
    markImageRef(scanId, keepPhoto === true);

    return finish(200, {
      ok: true,
      demo: false,
      model: provider.model,
      analysis,
      scanId,
    });
  } catch (err) {
    if (err instanceof AnalyzeError) {
      // 오류 메시지만 남기고 이미지나 요청 본문은 남기지 않는다.
      console.error(redact(`analyze failed: ${err.code}`));
      if (record) saveFailedScan({ ...record, code: err.code, message: err.message });
      const status =
        err.code === "rate_limited" ? 429 : err.code === "declined" ? 422 : 502;
      return finish(status, { ok: false, code: err.code, error: err.message });
    }
    console.error("analyze failed: unexpected");
    return finish(500, {
      ok: false,
      code: "upstream_error",
      error: "Something went wrong during analysis. Please try again in a moment.",
    });
  }
});

/**
 * 사진을 이 기기에 보관하기로 했으면, 그 사진을 찾을 열쇠(스캔 아이디)를 남겨 둔다.
 * 사진 자체는 브라우저 저장소에만 있고 서버로 오지 않는다.
 */
function markImageRef(scanId: string, keep: boolean): void {
  if (!keep) return;
  db()
    .prepare("UPDATE nail_scans SET image_ref = ?, image_stored = 1 WHERE id = ?")
    .run(scanId, scanId);
}

// 스토어 등록에 필요한 공개 페이지(개인정보처리방침, 약관, 계정 삭제, 고객 지원)
app.use(publicPages);

// 프로덕션 빌드 결과를 같은 서버에서 서빙한다.
const distDir = path.resolve(here, "../dist");
/**
 * 이름에 내용 해시가 붙은 파일(/assets/…)은 바뀌면 이름도 바뀌므로 1년 동안 캐시해도 된다.
 * 브라우저와 앞단 CDN 이 한국에서도 이 파일들을 가까운 곳에서 다시 쓰게 된다.
 * index.html 은 늘 새로 확인하게 해서, 배포하면 바로 새 화면이 나가게 한다.
 */
app.use(
  express.static(distDir, {
    setHeaders: (res, filePath) => {
      res.setHeader(
        "Cache-Control",
        filePath.includes(`${path.sep}assets${path.sep}`)
          ? "public, max-age=31536000, immutable"
          : "no-cache",
      );
    },
  }),
);
app.get(/^\/(?!api\/).*/, (_req, res) => {
  res.setHeader("Cache-Control", "no-cache");
  res.sendFile(path.join(distDir, "index.html"), (err) => {
    if (err) res.status(404).end();
  });
});

// 데이터베이스를 열고(필요하면 마이그레이션) 건강 정보 글을 최신으로 맞춘다.
db();
seedArticles();

app.listen(PORT, () => {
  console.log(`NailSense API listening on http://localhost:${PORT}`);
  console.log(`데이터베이스: ${DB_PATH}`);

  const provider = activeProvider();
  const keyName =
    provider.id === "gemini" ? "GEMINI_API_KEY" : "ANTHROPIC_API_KEY";

  if (!provider.hasCredentials()) {
    console.log(
      ALLOW_DEMO
        ? `${keyName} 가 없어 데모 응답으로 동작합니다.`
        : `${keyName} 가 없고 데모도 꺼져 있어 분석 요청이 거절됩니다.`,
    );
  } else {
    // 키가 설정되었다는 사실만 알리고, 값이나 일부는 절대 찍지 않는다.
    console.log(
      `분석 프로바이더: ${provider.label} (${provider.model}) · ${keyName} 설정됨`,
    );
  }

  const paddle = billingConfig();
  const missing = missingBillingSettings();
  if (paddle.enabled) {
    console.log(`결제: Paddle ${paddle.environment} · 무료 사용 한도 적용`);
  } else if (missing.length > 0) {
    console.warn(
      `[결제] 설정이 일부만 되어 있어 결제를 끈 채로 동작합니다. 빠진 값: ${missing.join(", ")}`,
    );
  }

  const store = storeConfig();
  const missingStore = missingStoreSettings();
  if (store.enabled) {
    const platforms = [store.iosKey && "iOS", store.androidKey && "Android"].filter(Boolean).join(" · ");
    console.log(`인앱 구독: RevenueCat (${platforms}) · 권한 이름 ${store.entitlement} · 무료 사용 한도 적용`);
  } else if (missingStore.length > 0) {
    console.warn(
      `[인앱 구독] 설정이 일부만 되어 있어 끈 채로 동작합니다. 빠진 값: ${missingStore.join(", ")}`,
    );
  }

  for (const warning of auditCredentials(ENV_FILE_PATH)) {
    console.warn(`[보안] ${warning}`);
  }
});

// 지난 달 사용량과 오래된 웹훅 기록을 하루에 한 번 정리한다.
pruneUsage();
setInterval(pruneUsage, 24 * 60 * 60 * 1000).unref();

// 처리되지 않은 오류가 스택과 함께 응답으로 나가지 않게 막는다.
process.on("unhandledRejection", (reason) => {
  console.error(redact(`unhandled rejection: ${String(reason)}`));
});
