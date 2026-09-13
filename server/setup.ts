import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { NextFunction, Request, Response } from "express";
import { GoogleGenAI } from "@google/genai";
import { ENV_FILE_PATH } from "./env.js";

/**
 * 로컬에서 API 키를 넣기 위한 설정 API.
 *
 * 키를 받아 디스크에 쓰는 엔드포인트이므로, 열어 둘 조건을 좁게 잡는다.
 *  - 루프백(같은 기기)에서 온 요청만 받는다.
 *  - 프로덕션에서는 기본으로 꺼진다.
 *  - 키는 어떤 응답으로도 돌려주지 않는다. 끝 4자리만 확인용으로 보여 준다.
 */

export const SETUP_KEYS = {
  gemini: "GEMINI_API_KEY",
  claude: "ANTHROPIC_API_KEY",
} as const;

export type SetupProviderId = keyof typeof SETUP_KEYS;

export function isSetupEnabled(): boolean {
  const flag = process.env.ALLOW_SETUP;
  if (flag === "true") return true;
  if (flag === "false") return false;
  // 명시하지 않으면 개발 중에만 열어 둔다.
  return process.env.NODE_ENV !== "production";
}

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

/** 같은 기기에서 온 요청만 통과시킨다. */
export function loopbackOnly(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!isSetupEnabled()) {
    res.status(404).json({ ok: false, error: "사용할 수 없는 경로입니다." });
    return;
  }

  // req.ip 는 TRUST_PROXY 설정에 따라 헤더에서 올 수 있으므로 소켓 주소를 쓴다.
  const address = req.socket.remoteAddress ?? "";
  if (!LOOPBACK.has(address)) {
    res.status(403).json({
      ok: false,
      error: "이 설정은 앱을 실행 중인 기기에서만 열 수 있습니다.",
    });
    return;
  }
  next();
}

/** 끝 4자리만 남긴다. 전체 값은 어떤 경우에도 응답에 싣지 않는다. */
function maskTail(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 4) return "****";
  return `${"*".repeat(8)}${trimmed.slice(-4)}`;
}

export interface SetupStatus {
  enabled: boolean;
  envFile: string;
  envFileDisplay: string;
  writable: boolean;
  keys: {
    provider: SetupProviderId;
    envName: string;
    configured: boolean;
    masked: string | null;
    source: "env-file" | "environment" | "none";
  }[];
}

export function readStatus(): SetupStatus {
  const fileText = fs.existsSync(ENV_FILE_PATH)
    ? fs.readFileSync(ENV_FILE_PATH, "utf8")
    : "";
  const resolved = path.resolve(ENV_FILE_PATH);

  return {
    enabled: isSetupEnabled(),
    envFile: resolved,
    envFileDisplay: displayPath(resolved),
    writable: canWrite(),
    keys: (Object.keys(SETUP_KEYS) as SetupProviderId[]).map((provider) => {
      const envName = SETUP_KEYS[provider];
      const value = process.env[envName]?.trim() ?? "";
      const inFile = new RegExp(`^${envName}=.+$`, "m").test(fileText);
      return {
        provider,
        envName,
        configured: Boolean(value),
        masked: value ? maskTail(value) : null,
        source: value
          ? inFile
            ? ("env-file" as const)
            : ("environment" as const)
          : ("none" as const),
      };
    }),
  };
}

function canWrite(): boolean {
  try {
    const dir = path.dirname(path.resolve(ENV_FILE_PATH));
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

export class SetupError extends Error {}

/** 눈에 보이지 않는 문자가 섞여 들어오면 나중에 원인 찾기가 아주 어렵다. */
export function validateKey(provider: SetupProviderId, raw: string): string {
  const key = raw.trim();

  if (!key) throw new SetupError("키가 비어 있습니다.");
  if (key.length > 400) throw new SetupError("키가 지나치게 깁니다.");

  // 제어문자나 공백이 남아 있으면 .env 한 줄이 깨지거나 인증이 조용히 실패한다.
  const hasBadChar = [...key].some((char) => {
    const code = char.codePointAt(0) ?? 0;
    return code < 0x20 || code === 0x7f || /\s/.test(char);
  });
  if (hasBadChar) {
    throw new SetupError(
      "키에 공백이나 줄바꿈이 섞여 있습니다. 앞뒤를 잘라내고 다시 붙여넣어 주세요.",
    );
  }
  if (/^["'].*["']$/.test(key)) {
    throw new SetupError("따옴표는 빼고 키 값만 붙여넣어 주세요.");
  }

  if (provider === "gemini" && !key.startsWith("AIza")) {
    throw new SetupError(
      "Gemini 키는 보통 AIza 로 시작합니다. 값을 다시 확인해 주세요.",
    );
  }
  if (provider === "claude" && !key.startsWith("sk-ant-")) {
    throw new SetupError(
      "Anthropic 키는 sk-ant- 로 시작합니다. 값을 다시 확인해 주세요.",
    );
  }

  return key;
}

/**
 * .env 의 해당 줄만 바꾸고 나머지는 그대로 둔다.
 * 임시 파일에 쓴 뒤 교체해, 쓰다 만 파일이 남지 않게 한다.
 */
export function writeKeyToEnvFile(envName: string, key: string): void {
  const target = path.resolve(ENV_FILE_PATH);
  const existing = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : "";

  const line = `${envName}=${key}`;
  const pattern = new RegExp(`^${envName}=.*$`, "m");
  let next: string;

  if (pattern.test(existing)) {
    next = existing.replace(pattern, line);
  } else if (existing.length === 0) {
    next = `${line}\n`;
  } else {
    next = `${existing.replace(/\n*$/, "\n")}${line}\n`;
  }

  const temp = path.join(
    path.dirname(target),
    `.env.tmp-${process.pid}-${Date.now()}`,
  );
  try {
    // 0600 으로 만들어, 잠깐이라도 남이 읽을 수 있는 상태를 만들지 않는다.
    fs.writeFileSync(temp, next, { mode: 0o600 });
    fs.renameSync(temp, target);
    fs.chmodSync(target, 0o600);
  } catch {
    try {
      fs.rmSync(temp, { force: true });
    } catch {
      // 정리 실패는 무시한다.
    }
    throw new SetupError(
      `${displayPath(target)} 에 쓰지 못했습니다. 파일 권한을 확인해 주세요.`,
    );
  }
}

/**
 * 키가 실제로 통하는지 확인한다.
 * countTokens 는 토큰을 생성하지 않아 비용이 거의 들지 않는다.
 */
export async function verifyGeminiKey(key: string): Promise<void> {
  const baseUrl = process.env.GEMINI_BASE_URL?.trim();
  const client = new GoogleGenAI({
    apiKey: key,
    ...(baseUrl ? { httpOptions: { baseUrl } } : {}),
  });

  try {
    await client.models.countTokens({
      model: process.env.GEMINI_MODEL ?? "gemini-2.5-flash",
      contents: "ping",
    });
  } catch (err) {
    const status = (err as { status?: number } | null)?.status;
    if (status === 400 || status === 401 || status === 403) {
      throw new SetupError(
        "이 키로는 인증되지 않았습니다. 값을 다시 확인해 주세요.",
      );
    }
    if (status === 429) {
      throw new SetupError(
        "요청 한도에 걸려 확인하지 못했습니다. 키는 저장되었습니다.",
      );
    }
    throw new SetupError(
      "키 확인 중 연결 문제가 있었습니다. 키는 저장되었습니다.",
    );
  }
}

/** 설정 화면에 보여 줄, 사람이 읽는 홈 경로 표시용. */
export function displayPath(target: string): string {
  const home = os.homedir();
  return target.startsWith(home) ? target.replace(home, "~") : target;
}
