/**
 * 지원 언어. 화면, 건강 정보 글, 약관, 분석 결과가 모두 이 두 언어로 나온다.
 * 기기 언어가 한국어면 한국어, 그 밖에는 영어가 기본이고, 프로필에서 바꿀 수 있다.
 */
export const LOCALES = ["en", "ko"] as const;
export type Locale = (typeof LOCALES)[number];

export function asLocale(value: unknown): Locale {
  return value === "ko" ? "ko" : "en";
}
