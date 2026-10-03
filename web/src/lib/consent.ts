import { HEALTH_CONSENT_VERSION } from "../../../shared/billing";

/**
 * 건강 데이터 처리 동의를 이 기기에 기억한다.
 *
 * 로그인했으면 서버도 동의 시각과 문구 버전을 계정에 남긴다(분석할 때).
 * 브라우저 저장소를 못 쓰면 이번 방문 동안만 기억하고, 다음에 다시 묻는다.
 */

const KEY = "nailsense.healthConsent";

interface Stored {
  version: string;
  at: number;
}

let memory: Stored | null = null;

function read(): Stored | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Stored>;
      if (typeof parsed.version === "string" && typeof parsed.at === "number") {
        return { version: parsed.version, at: parsed.at };
      }
    }
  } catch {
    // 저장소를 못 쓰면 메모리 값을 본다.
  }
  return memory;
}

/** 지금 문구 버전에 동의했으면 그 시각, 아니면 null */
export function consentGivenAt(): number | null {
  const stored = read();
  return stored && stored.version === HEALTH_CONSENT_VERSION ? stored.at : null;
}

export function hasConsent(): boolean {
  return consentGivenAt() !== null;
}

export function giveConsent(at = Date.now()): void {
  const value: Stored = { version: HEALTH_CONSENT_VERSION, at };
  memory = value;
  try {
    localStorage.setItem(KEY, JSON.stringify(value));
  } catch {
    // 메모리에만 남는다.
  }
}

export function withdrawConsent(): void {
  memory = null;
  try {
    localStorage.removeItem(KEY);
  } catch {
    // 지울 것이 없다.
  }
}
