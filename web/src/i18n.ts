import type { Locale } from "../../shared/i18n";

/**
 * 화면 언어.
 *
 * 프로필에서 고른 언어가 있으면 그것을, 없으면 기기(브라우저) 언어를 따른다.
 * 한국어 기기면 한국어, 나머지는 영어. 언어를 바꾸면 페이지를 다시 불러온다.
 * 그래서 화면 코드는 어디서든 L("영어", "한국어") 로 바로 고를 수 있다.
 */

const KEY = "nailsense.locale";
export type LocalePreference = "auto" | Locale;

export function localePreference(): LocalePreference {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored === "en" || stored === "ko") return stored;
  } catch {
    // 저장소를 못 쓰면 기기 언어를 따른다.
  }
  return "auto";
}

function detect(): Locale {
  const preference = localePreference();
  if (preference !== "auto") return preference;
  const languages =
    typeof navigator === "undefined"
      ? []
      : navigator.languages?.length
        ? navigator.languages
        : [navigator.language];
  return languages[0]?.toLowerCase().startsWith("ko") ? "ko" : "en";
}

export const LOCALE: Locale = detect();
export const KO = LOCALE === "ko";

/** 지금 언어에 맞는 문구를 고른다. */
export function L(en: string, ko: string): string {
  return KO ? ko : en;
}

/** 날짜·숫자 형식에 쓰는 언어 태그 */
export const INTL_LOCALE = KO ? "ko-KR" : "en-US";

export const RETURN_TAB_KEY = "nailsense.returnTab";

export function setLocalePreference(next: LocalePreference): void {
  try {
    if (next === "auto") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, next);
    // 다시 불러온 뒤에도 언어를 고르던 프로필 화면으로 돌아온다.
    sessionStorage.setItem(RETURN_TAB_KEY, "profile");
  } catch {
    // 저장하지 못하면 이번 방문 동안만 바뀐다.
  }
  window.location.reload();
}

if (typeof document !== "undefined") {
  document.documentElement.lang = LOCALE;
  if (KO) document.title = "NailSense · 손톱 관찰 도우미";
}
