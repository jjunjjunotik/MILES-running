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
import type { AnalyzeResponse } from "../shared/analysis.js";
import {
  auditCredentials,
  createRateLimiter,
  redact,
  sameOriginOnly,
  securityHeaders,
} from "./security.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT ?? 8787);
const ALLOW_DEMO = process.env.ALLOW_DEMO_FALLBACK !== "false";

// 리버스 프록시 뒤에서도 실제 클라이언트 IP 로 속도 제한이 걸리게 한다.
app.set("trust proxy", process.env.TRUST_PROXY === "true" ? 1 : false);
app.disable("x-powered-by");
app.use(securityHeaders);

// 업로드 이미지는 클라이언트에서 미리 1280px 이하로 줄여 보낸다.
app.use(express.json({ limit: "6mb" }));

// 이미지가 들어오는 경로이므로 본문은 어떤 형태로도 로깅하지 않는다.
app.use((req, _res, next) => {
  if (req.path.startsWith("/api")) {
    console.log(`${req.method} ${req.path}`);
  }
  next();
});

/**
 * 분석 한 번이 곧 API 비용이다. 엔드포인트가 노출되어도 남이 내 키로
 * 마음껏 호출하지 못하도록 같은 출처만 받고 횟수를 제한한다.
 */
const analyzeLimiter = createRateLimiter({
  perIp: Number(process.env.RATE_LIMIT_PER_IP ?? 12),
  global: Number(process.env.RATE_LIMIT_GLOBAL ?? 240),
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS ?? 5 * 60 * 1000),
});

app.get("/api/health", (_req, res) => {
  const provider = activeProvider();
  res.json({
    ok: true,
    configured: provider.hasCredentials(),
    demoAvailable: ALLOW_DEMO,
    // 모델 이름은 공개해도 무해하다. 키는 어떤 형태로도 내보내지 않는다.
    provider: provider.label,
    model: provider.model,
  });
});

app.post("/api/analyze", sameOriginOnly, analyzeLimiter, async (req, res) => {
  const send = (status: number, body: AnalyzeResponse) =>
    res.status(status).json(body);

  const { image, mediaType, hand, finger, note } = req.body ?? {};

  if (typeof image !== "string" || image.length === 0) {
    return send(400, {
      ok: false,
      code: "bad_request",
      error: "사진이 전달되지 않았습니다.",
    });
  }
  if (!SUPPORTED_MEDIA_TYPES.includes(mediaType)) {
    return send(400, {
      ok: false,
      code: "bad_request",
      error: "지원하지 않는 이미지 형식입니다. JPG 또는 PNG로 시도해 주세요.",
    });
  }
  // base64 는 원본 대비 약 4/3 크기다. 4MB 를 넘으면 거절한다.
  if (image.length > 4 * 1024 * 1024) {
    return send(413, {
      ok: false,
      code: "bad_request",
      error: "사진 용량이 너무 큽니다. 조금 더 작은 사진으로 시도해 주세요.",
    });
  }

  const input = {
    imageBase64: image,
    mediaType: mediaType as SupportedMediaType,
    hand: hand === "left" ? "왼손" : "오른손",
    finger: typeof finger === "string" ? finger : "손톱",
    note: typeof note === "string" ? note.slice(0, 300) : "",
  };

  if (!hasCredentials()) {
    if (!ALLOW_DEMO) {
      return send(503, {
        ok: false,
        code: "no_api_key",
        error:
          "분석 서버에 API 키가 설정되지 않았습니다. 관리자에게 문의해 주세요.",
      });
    }
    return send(200, {
      ok: true,
      demo: true,
      model: "demo",
      analysis: buildDemoAnalysis(image.length % 13),
    });
  }

  try {
    const analysis = await analyzeNailPhoto(input);

    if (!analysis.isNailPhoto) {
      return send(422, {
        ok: false,
        code: "not_a_nail_photo",
        error:
          "사진에서 손톱을 찾지 못했습니다. 손톱이 화면을 채우도록 다시 촬영해 주세요.",
      });
    }
    if (!analysis.imageQuality.usable) {
      return send(422, {
        ok: false,
        code: "unusable_image",
        error:
          analysis.imageQuality.issues.length > 0
            ? `사진을 살펴보기 어려웠습니다: ${analysis.imageQuality.issues.join(", ")}`
            : "사진이 흐려 관찰이 어려웠습니다. 밝은 곳에서 다시 촬영해 주세요.",
      });
    }

    return send(200, {
      ok: true,
      demo: false,
      model: activeProvider().model,
      analysis,
    });
  } catch (err) {
    if (err instanceof AnalyzeError) {
      // 오류 메시지만 남기고 이미지나 요청 본문은 남기지 않는다.
      console.error(redact(`analyze failed: ${err.code}`));
      const status =
        err.code === "rate_limited" ? 429 : err.code === "declined" ? 422 : 502;
      return send(status, { ok: false, code: err.code, error: err.message });
    }
    console.error("analyze failed: unexpected");
    return send(500, {
      ok: false,
      code: "upstream_error",
      error: "분석 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.",
    });
  }
});

// 프로덕션 빌드 결과를 같은 서버에서 서빙한다.
const distDir = path.resolve(here, "../dist");
app.use(express.static(distDir));
app.get(/^\/(?!api\/).*/, (_req, res) => {
  res.sendFile(path.join(distDir, "index.html"), (err) => {
    if (err) res.status(404).end();
  });
});

app.listen(PORT, () => {
  console.log(`NailSense API listening on http://localhost:${PORT}`);

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

  for (const warning of auditCredentials(ENV_FILE_PATH)) {
    console.warn(`[보안] ${warning}`);
  }
});

// 처리되지 않은 오류가 스택과 함께 응답으로 나가지 않게 막는다.
process.on("unhandledRejection", (reason) => {
  console.error(redact(`unhandled rejection: ${String(reason)}`));
});
