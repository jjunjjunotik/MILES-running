import type { NextFunction, Request, Response } from "express";
import fs from "node:fs";

/**
 * 이 파일의 목적은 하나다: API 키가 새거나, 키로 돈이 새지 않게 하는 것.
 *
 * 키가 새는 경로는 크게 넷이다.
 *  1) 클라이언트 번들에 섞여 들어감  -> scripts/check-secrets.mjs 가 빌드에서 막는다.
 *  2) git 에 커밋됨                -> .gitignore + check-secrets 가 막는다.
 *  3) 로그/오류 응답에 찍힘         -> redact() 와 서버의 무로깅 정책이 막는다.
 *  4) 엔드포인트가 공개되어 남이 대신 씀 -> 아래 속도 제한과 오리진 검사가 막는다.
 */

const KEY_PATTERN = /sk-ant-[A-Za-z0-9_-]{8,}/g;

/** 로그나 오류 메시지에 키가 섞여도 밖으로 나가지 않게 지운다. */
export function redact(text: string): string {
  return text.replace(KEY_PATTERN, "sk-ant-***");
}

export function looksLikeApiKey(value: string): boolean {
  return /^sk-ant-/.test(value);
}

/**
 * 키 설정 상태를 점검한다. 값 자체는 절대 출력하지 않는다.
 * .env 파일이 남들이 읽을 수 있는 권한이면 경고한다.
 */
export function auditCredentials(envPath = ".env"): string[] {
  const warnings: string[] = [];
  const key = process.env.ANTHROPIC_API_KEY ?? "";

  if (key) {
    if (!looksLikeApiKey(key)) {
      warnings.push(
        "ANTHROPIC_API_KEY 형식이 예상과 다릅니다. 값을 다시 확인하세요.",
      );
    }
    if (key !== key.trim()) {
      warnings.push(
        "ANTHROPIC_API_KEY 앞뒤에 공백이 있습니다. 따옴표나 줄바꿈이 섞였는지 확인하세요.",
      );
    }
  }

  // VITE_ 로 시작하는 환경변수는 클라이언트 번들에 그대로 들어간다.
  for (const name of Object.keys(process.env)) {
    if (!name.startsWith("VITE_")) continue;
    if (/KEY|SECRET|TOKEN|PASSWORD/i.test(name)) {
      warnings.push(
        `${name} 은 VITE_ 접두사 때문에 브라우저로 그대로 노출됩니다. 이름을 바꾸고 서버에서만 읽으세요.`,
      );
    }
  }

  try {
    const stat = fs.statSync(envPath);
    // 그룹/타인 읽기 권한이 열려 있으면 같은 머신의 다른 계정이 키를 볼 수 있다.
    if (stat.mode & 0o077) {
      warnings.push(
        `${envPath} 권한이 느슨합니다. chmod 600 ${envPath} 로 본인만 읽게 하세요.`,
      );
    }
  } catch {
    // .env 가 없으면 환경변수로 주입된 것이므로 확인할 것이 없다.
  }

  return warnings;
}

/** 브라우저 앱에 필요한 최소한의 보안 헤더. */
export function securityHeaders(
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Permissions-Policy", "geolocation=(), microphone=()");
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      // 번들은 자기 출처에서만. 인라인 스타일은 React 인라인 style 때문에 허용한다.
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' blob: data:",
      "connect-src 'self'",
      "form-action 'none'",
      "frame-ancestors 'none'",
      "base-uri 'none'",
      "object-src 'none'",
    ].join("; "),
  );
  next();
}

/**
 * 같은 출처에서 온 요청만 받는다.
 *
 * CORS 헤더를 안 주면 브라우저가 응답을 막지만, 그때는 이미 요청이 처리된 뒤다.
 * 분석 한 번이 곧 비용이므로 처리 전에 끊는다.
 */
export function sameOriginOnly(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const origin = req.get("origin");
  if (!origin) {
    // 브라우저가 아닌 클라이언트(curl 등)는 오리진을 안 보낸다. 속도 제한이 받아 준다.
    next();
    return;
  }

  const allowed = (process.env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    res.status(403).json({
      ok: false,
      code: "bad_request",
      error: "허용되지 않은 요청입니다.",
    });
    return;
  }

  if (host === req.get("host") || allowed.includes(origin)) {
    next();
    return;
  }

  res.status(403).json({
    ok: false,
    code: "bad_request",
    error: "허용되지 않은 요청입니다.",
  });
}

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * IP별 + 전체 한도. 엔드포인트가 노출되어도 청구서가 무한정 늘지 않게 한다.
 * 프로세스 메모리에만 두므로 재시작하면 초기화된다. 여러 대로 띄운다면
 * 앞단(리버스 프록시나 API 게이트웨이)에 제대로 된 제한을 두는 편이 낫다.
 */
export function createRateLimiter(options: {
  perIp: number;
  global: number;
  windowMs: number;
}) {
  const buckets = new Map<string, Bucket>();
  const globalBucket: Bucket = {
    count: 0,
    resetAt: Date.now() + options.windowMs,
  };

  const take = (bucket: Bucket, limit: number, now: number): boolean => {
    if (now >= bucket.resetAt) {
      bucket.count = 0;
      bucket.resetAt = now + options.windowMs;
    }
    if (bucket.count >= limit) return false;
    bucket.count += 1;
    return true;
  };

  return function rateLimit(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    const now = Date.now();

    // 오래된 항목을 정리해 메모리가 무한정 늘지 않게 한다.
    if (buckets.size > 10_000) {
      for (const [key, bucket] of buckets) {
        if (now >= bucket.resetAt) buckets.delete(key);
      }
    }

    if (!take(globalBucket, options.global, now)) {
      res.status(429).json({
        ok: false,
        code: "rate_limited",
        error: "지금은 요청이 많습니다. 잠시 후 다시 시도해 주세요.",
      });
      return;
    }

    const ip = req.ip ?? "unknown";
    let bucket = buckets.get(ip);
    if (!bucket) {
      bucket = { count: 0, resetAt: now + options.windowMs };
      buckets.set(ip, bucket);
    }

    if (!take(bucket, options.perIp, now)) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      res.setHeader("Retry-After", String(retryAfter));
      res.status(429).json({
        ok: false,
        code: "rate_limited",
        error: `분석 요청이 너무 잦습니다. ${retryAfter}초 뒤에 다시 시도해 주세요.`,
      });
      return;
    }

    next();
  };
}
