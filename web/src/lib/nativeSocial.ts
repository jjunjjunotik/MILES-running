import { Capacitor } from "@capacitor/core";
import { SocialLogin } from "@capgo/capacitor-social-login";
import type { Providers } from "./server";
import { KO } from "../i18n";

/**
 * 휴대폰 앱의 구글 · 애플 로그인(네이티브). 이 파일은 앱 빌드에만 들어간다.
 *
 * 구글은 앱 안 웹뷰에서 로그인 창을 막으므로 웹 방식(구글 스크립트)을 쓸 수 없다.
 * 운영체제의 계정 선택 화면으로 로그인하고, 받은 ID 토큰을 서버에 보내 검증한다(웹과 같은 /auth/google).
 * 애플은 아이폰에서만 네이티브로 제공한다(안드로이드 앱에는 애플 로그인 의무가 없다).
 */

export const PLATFORM = Capacitor.getPlatform();

let initializedFor: string | null = null;

async function ensureInitialized(providers: Providers): Promise<void> {
  const google = providers.google || null;
  const key = JSON.stringify([google?.clientId, google?.iosClientId, PLATFORM]);
  if (initializedFor === key) return;
  await SocialLogin.initialize({
    ...(google
      ? {
          google: {
            webClientId: google.clientId,
            ...(google.iosClientId ? { iOSClientId: google.iosClientId } : {}),
            mode: "online" as const,
          },
        }
      : {}),
    ...(PLATFORM === "ios" ? { apple: {} } : {}),
  });
  initializedFor = key;
}

/** 이 기기에서 보여 줄 수 있는 버튼 */
export function nativeButtons(providers: Providers): { google: boolean; apple: boolean } {
  const google =
    Boolean(providers.google) &&
    (PLATFORM === "android" || (PLATFORM === "ios" && Boolean(providers.google && providers.google.iosClientId)));
  const apple = PLATFORM === "ios" && Boolean(providers.apple && providers.apple.native);
  return { google, apple };
}

export async function nativeGoogleIdToken(providers: Providers): Promise<string> {
  await ensureInitialized(providers);
  const { result } = await SocialLogin.login({ provider: "google", options: { scopes: ["email", "profile"] } });
  const idToken = "idToken" in result ? result.idToken : null;
  if (!idToken) throw new Error("no id token");
  return idToken;
}

export async function nativeApple(providers: Providers): Promise<{ idToken: string; name?: string }> {
  await ensureInitialized(providers);
  const { result } = await SocialLogin.login({ provider: "apple", options: { scopes: ["email", "name"] } });
  if (!result.idToken) throw new Error("no id token");
  // 애플은 처음 로그인할 때만 이름을 준다. 한국어는 성+이름을 붙여서, 영어는 이름 성 순서로.
  const { familyName, givenName } = result.profile;
  const name = KO
    ? [familyName, givenName].filter(Boolean).join("")
    : [givenName, familyName].filter(Boolean).join(" ");
  return { idToken: result.idToken, name: name || undefined };
}
