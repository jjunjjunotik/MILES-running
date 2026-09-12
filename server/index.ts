import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AnalyzeError,
  SUPPORTED_MEDIA_TYPES,
  analyzeNailPhoto,
  hasCredentials,
  MODEL,
  type SupportedMediaType,
} from "./analyze.js";
import { buildDemoAnalysis } from "./demo.js";
import type { AnalyzeResponse } from "../shared/analysis.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT ?? 8787);
const ALLOW_DEMO = process.env.ALLOW_DEMO_FALLBACK !== "false";

// 업로드 이미지는 3MB 이내로 제한한다. 클라이언트에서 미리 1600px 이하로 줄여 보낸다.
app.use(express.json({ limit: "6mb" }));

// 이미지가 들어오는 경로이므로 본문은 어떤 형태로도 로깅하지 않는다.
app.use((req, _res, next) => {
  if (req.path.startsWith("/api")) {
    console.log(`${req.method} ${req.path}`);
  }
  next();
});

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    configured: hasCredentials(),
    demoAvailable: ALLOW_DEMO,
    model: MODEL,
  });
});

app.post("/api/analyze", async (req, res) => {
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

    return send(200, { ok: true, demo: false, model: MODEL, analysis });
  } catch (err) {
    if (err instanceof AnalyzeError) {
      // 오류 메시지만 남기고 이미지나 요청 본문은 남기지 않는다.
      console.error(`analyze failed: ${err.code}`);
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
  if (!hasCredentials()) {
    console.log(
      ALLOW_DEMO
        ? "ANTHROPIC_API_KEY 가 없어 데모 응답으로 동작합니다."
        : "ANTHROPIC_API_KEY 가 없고 데모도 꺼져 있어 분석 요청이 거절됩니다.",
    );
  }
});
