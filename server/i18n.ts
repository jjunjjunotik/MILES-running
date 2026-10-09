import type { NextFunction, Request, Response } from "express";
import { asLocale, type Locale } from "../shared/i18n.js";

/**
 * 서버가 사용자에게 돌려주는 문구의 언어.
 *
 * 화면은 모든 요청에 X-NailSense-Locale 헤더로 지금 언어를 실어 보낸다.
 * 헤더가 없으면(직접 부른 요청 등) 브라우저의 Accept-Language 를 본다.
 * 오류 문구는 코드 곳곳에서 영어로 만들고, 응답이 나가기 직전에 한 곳(아래 표)에서 바꾼다.
 * 표에 없는 문구는 영어 그대로 나간다.
 */

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      locale: Locale;
    }
  }
}

export function pickLocale(req: Request): Locale {
  const header = req.get("x-nailsense-locale");
  if (header) return asLocale(header);
  const accepted = (req.get("accept-language") ?? "").toLowerCase();
  return accepted.startsWith("ko") ? "ko" : "en";
}

const KO: Record<string, string> = {
  // 분석
  "No photo was received.": "사진이 전달되지 않았습니다.",
  "That image format isn't supported. Please try a JPG or PNG.":
    "지원하지 않는 이미지 형식입니다. JPG 또는 PNG로 시도해 주세요.",
  "That photo is too large. Please try a smaller one.":
    "사진 용량이 너무 큽니다. 조금 더 작은 사진으로 시도해 주세요.",
  "The analysis service isn't set up yet. Please contact the app's administrator.":
    "분석 서비스가 아직 설정되지 않았습니다. 관리자에게 문의해 주세요.",
  "We couldn't find a nail in this photo. Please retake it with the nail filling the frame.":
    "사진에서 손톱을 찾지 못했습니다. 손톱이 화면을 채우도록 다시 촬영해 주세요.",
  "The photo is too blurry to observe. Please retake it in bright light.":
    "사진이 흐려 관찰이 어려웠습니다. 밝은 곳에서 다시 촬영해 주세요.",
  "Something went wrong during analysis. Please try again in a moment.":
    "분석 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.",
  "Something went wrong during analysis.": "분석 중 알 수 없는 오류가 발생했습니다.",
  "Please review how your photo is processed and agree before scanning.":
    "사진이 어떻게 처리되는지 확인하고 동의한 뒤에 분석할 수 있습니다.",
  "This photo wasn't analyzed. Please try a different photo.":
    "이 사진은 분석하지 않았습니다. 다른 사진으로 시도해 주세요.",
  "The result was too long and got cut off. Please try again.":
    "결과가 너무 길어 중간에 끊겼습니다. 다시 시도해 주세요.",
  "No analysis result came back. Please try again in a moment.":
    "분석 결과를 받지 못했습니다. 잠시 후 다시 시도해 주세요.",
  "The analysis result couldn't be read. Please try again in a moment.":
    "분석 결과를 해석하지 못했습니다. 잠시 후 다시 시도해 주세요.",
  "The analysis result wasn't in the expected format. Please try again in a moment.":
    "분석 결과가 예상한 형식이 아닙니다. 잠시 후 다시 시도해 주세요.",
  "Too many requests right now. Please try again in a moment.":
    "요청이 많아 잠시 대기가 필요합니다. 잠시 후 다시 시도해 주세요.",
  "The analysis service is busy right now. Please try again in a moment.":
    "지금 분석 서비스가 혼잡합니다. 잠시 후 다시 시도해 주세요.",
  "Couldn't reach the analysis server. Please check your connection.":
    "분석 서버에 연결하지 못했습니다. 네트워크를 확인해 주세요.",
  "GEMINI_API_KEY is not set.": "GEMINI_API_KEY가 설정되지 않았습니다.",
  "ANTHROPIC_API_KEY is not set.": "ANTHROPIC_API_KEY가 설정되지 않았습니다.",
  "Please check GEMINI_API_KEY.": "GEMINI_API_KEY를 확인해 주세요.",
  "Please check the API key.": "API 키를 확인해 주세요.",
  // 사용 한도
  "You've used your free scans for this month. Upgrade to Pro to keep scanning.":
    "이번 달 무료 분석을 모두 썼어요. 계속하려면 Pro로 바꿔 주세요.",
  "You've used the free scans for this month. Log in or upgrade to Pro to keep scanning.":
    "이번 달 무료 분석을 모두 썼어요. 로그인하거나 Pro로 바꾸면 계속할 수 있어요.",
  // 요청 제한·보안
  "This request isn't allowed.": "허용되지 않은 요청입니다.",
  "There are a lot of requests right now. Please try again in a moment.":
    "지금은 요청이 많습니다. 잠시 후 다시 시도해 주세요.",
  // 계정
  "Please enter your email.": "이메일을 입력해 주세요.",
  "Please check your email address.": "이메일 형식을 확인해 주세요.",
  "Please enter your password.": "비밀번호를 입력해 주세요.",
  "Use at least 8 characters for your password.": "비밀번호는 8자 이상으로 만들어 주세요.",
  "That password is too long.": "비밀번호가 너무 깁니다.",
  "Please log in.": "로그인이 필요합니다.",
  "An account with this email already exists.": "이미 가입된 이메일입니다.",
  "An account with this email already exists. Please log in the way you did before.":
    "이미 가입된 이메일입니다. 기존 방법으로 로그인해 주세요.",
  "We didn't receive an email address from that sign-in provider. Please sign up with email.":
    "로그인 제공자에서 이메일을 받지 못했습니다. 이메일로 가입해 주세요.",
  "Incorrect email or password.": "이메일 또는 비밀번호가 올바르지 않습니다.",
  "No sign-in details were received.": "로그인 정보가 전달되지 않았습니다.",
  "The email doesn't match.": "이메일이 일치하지 않습니다.",
  "Couldn't reach the sign-in provider.": "로그인 제공자에 연결하지 못했습니다.",
  "We couldn't verify your sign-in.": "로그인 정보를 확인하지 못했습니다.",
  "Unsupported signature algorithm.": "지원하지 않는 서명 방식입니다.",
  "This sign-in was issued for a different app.": "다른 앱에서 발급된 로그인 정보입니다.",
  "Your sign-in expired. Please try again.": "로그인 정보가 만료되었습니다. 다시 시도해 주세요.",
  "Google sign-in isn't set up.": "구글 로그인이 설정되지 않았습니다.",
  "The Apple sign-in key isn't set up.": "애플 로그인 키가 설정되지 않았습니다.",
  "Apple sign-in isn't set up.": "애플 로그인이 설정되지 않았습니다.",
  "Apple sign-in failed. Please try again.": "애플 로그인에 실패했습니다. 다시 시도해 주세요.",
  // 기록·글
  "Something went wrong. Please try again in a moment.":
    "처리 중 문제가 생겼습니다. 잠시 후 다시 시도해 주세요.",
  "Scan not found.": "기록을 찾지 못했습니다.",
  "Guide not found.": "글을 찾지 못했습니다.",
  // 인앱 구독
  "Subscriptions aren't available right now.": "지금은 구독을 이용할 수 없습니다.",
  "We couldn't check your subscription right now. Please try again in a moment.":
    "지금은 구독 상태를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.",
};

/** 숫자나 덧붙는 내용이 들어가는 문구 */
const KO_PATTERNS: [RegExp, (match: RegExpMatchArray) => string][] = [
  [
    /^Too many analysis requests\. Please try again in (\d+) seconds\.$/,
    (m) => `분석 요청이 너무 잦습니다. ${m[1]}초 뒤에 다시 시도해 주세요.`,
  ],
  [
    /^You've reached today's limit of (\d+) scans\. It resets at midnight UTC\.$/,
    (m) => `오늘 분석 한도 ${m[1]}회를 모두 썼어요. 한국 시간 오전 9시(UTC 자정)에 다시 채워져요.`,
  ],
  [
    /^This photo was hard to read: (.*)$/s,
    (m) => `사진을 살펴보기 어려웠습니다: ${m[1]}`,
  ],
  [
    /^The analysis server returned an error\. \((.*)\)$/,
    (m) => `분석 서버에서 오류가 발생했습니다. (${m[1]})`,
  ],
  [
    /^Model "(.*)" wasn't found\.(.*)$/s,
    (m) => `모델 "${m[1]}" 을 찾지 못했습니다.${m[2]}`,
  ],
];

export function localize(message: string, locale: Locale): string {
  if (locale === "en") return message;
  const exact = KO[message];
  if (exact) return exact;
  for (const [pattern, render] of KO_PATTERNS) {
    const match = message.match(pattern);
    if (match) return render(match);
  }
  return message;
}

/**
 * 요청마다 언어를 정하고, JSON 응답의 error 문구를 그 언어로 바꾼다.
 * 라우트 코드는 언어를 신경 쓰지 않고 영어로 오류를 만들면 된다.
 */
export function localeMiddleware(req: Request, res: Response, next: NextFunction): void {
  req.locale = pickLocale(req);
  if (req.locale !== "en") {
    const json = res.json.bind(res);
    res.json = (body?: unknown) => {
      if (body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string") {
        const typed = body as { error: string };
        return json({ ...typed, error: localize(typed.error, req.locale) });
      }
      return json(body);
    };
  }
  next();
}
