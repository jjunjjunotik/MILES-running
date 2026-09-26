/**
 * 구글 · 애플 로그인 버튼을 띄우는 부분.
 *
 * 두 제공자 모두 자기 스크립트를 불러와야 동작한다. 그 스크립트는 서버가
 * "이 제공자를 설정했다"고 알려 줄 때만 불러온다. 설정하지 않았다면 외부 스크립트가
 * 아예 오지 않는다. 쓰지도 않을 제3자 스크립트를 로그인 화면에 올려 두지 않기 위해서다.
 */

const GOOGLE_SRC = "https://accounts.google.com/gsi/client";
const APPLE_SRC =
  "https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js";

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (options: {
            client_id: string;
            callback: (response: { credential?: string }) => void;
            auto_select?: boolean;
            cancel_on_tap_outside?: boolean;
          }) => void;
          renderButton: (
            parent: HTMLElement,
            options: Record<string, unknown>,
          ) => void;
        };
      };
    };
    AppleID?: {
      auth: {
        init: (options: {
          clientId: string;
          scope: string;
          redirectURI: string;
          usePopup: boolean;
          nonce?: string;
        }) => void;
        signIn: () => Promise<{
          authorization?: { id_token?: string; code?: string };
          user?: { name?: { firstName?: string; lastName?: string } };
        }>;
      };
    };
  }
}

const loaded = new Map<string, Promise<void>>();

function loadScript(src: string): Promise<void> {
  const existing = loaded.get(src);
  if (existing) return existing;

  const promise = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => {
      loaded.delete(src);
      reject(new Error("로그인 제공자를 불러오지 못했습니다."));
    };
    document.head.appendChild(script);
  });

  loaded.set(src, promise);
  return promise;
}

/** 구글이 그려 주는 공식 버튼을 넣는다. 토큰은 콜백으로 돌아온다. */
export async function mountGoogleButton(options: {
  clientId: string;
  parent: HTMLElement;
  onToken: (idToken: string) => void;
}): Promise<void> {
  await loadScript(GOOGLE_SRC);
  const api = window.google?.accounts.id;
  if (!api) throw new Error("구글 로그인을 불러오지 못했습니다.");

  api.initialize({
    client_id: options.clientId,
    callback: (response) => {
      if (response.credential) options.onToken(response.credential);
    },
    cancel_on_tap_outside: true,
  });
  // 구글 버튼은 구글이 직접 그린다. 화면의 밝기와 모서리 규칙(10px)에 가깝게 고른다.
  const chosen = document.documentElement.dataset.theme;
  const dark =
    chosen === "dark" ||
    (chosen !== "light" &&
      typeof matchMedia === "function" &&
      matchMedia("(prefers-color-scheme: dark)").matches);
  api.renderButton(options.parent, {
    type: "standard",
    theme: dark ? "filled_black" : "outline",
    size: "large",
    shape: "rectangular",
    text: "continue_with",
    locale: "ko",
    width: Math.min(options.parent.clientWidth || 320, 400),
  });
}

export async function signInWithApplePopup(clientId: string): Promise<{
  idToken?: string;
  code?: string;
  name?: string;
}> {
  await loadScript(APPLE_SRC);
  const api = window.AppleID?.auth;
  if (!api) throw new Error("애플 로그인을 불러오지 못했습니다.");

  api.init({
    clientId,
    scope: "name email",
    redirectURI: window.location.origin,
    usePopup: true,
  });

  const result = await api.signIn();
  const person = result.user?.name;
  const name = [person?.lastName, person?.firstName].filter(Boolean).join("");

  return {
    idToken: result.authorization?.id_token,
    code: result.authorization?.code,
    name: name || undefined,
  };
}
