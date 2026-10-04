/**
 * 웹과 휴대폰 앱(Capacitor)의 차이를 한곳에 모은다.
 *
 * 웹: 화면과 API 가 같은 서버에 있다. 로그인은 httpOnly 쿠키로 유지된다.
 * 앱: 화면은 앱 안에 들어 있고(capacitor://localhost 등), API 는 배포한 서버에 있다.
 *     출처가 달라 쿠키를 쓸 수 없으므로, 로그인할 때 받은 세션 토큰을 기기의 보안 저장소
 *     (iOS 키체인, 안드로이드 키스토어)에 두고 요청마다 Authorization 헤더로 보낸다.
 *     토큰은 localStorage 에 두지 않는다.
 */

/** 앱용 빌드인지. `npm run build:app` 일 때만 true 가 된다. */
export const IS_APP = import.meta.env.VITE_APP_TARGET === "app";

/** API 서버 주소. 웹은 같은 서버라 비어 있다. */
export const API_BASE: string = IS_APP
  ? String(import.meta.env.VITE_API_BASE ?? "").replace(/\/+$/, "")
  : "";

export function apiUrl(path: string): string {
  return `${API_BASE}/api${path}`;
}

const TOKEN_KEY = "session";
const DEVICE_KEY = "device";

let sessionToken: string | null = null;
let deviceId: string | null = null;

type SecureStorageApi = typeof import("@aparajita/capacitor-secure-storage").SecureStorage;

/**
 * 보안 저장소 플러그인을 불러온다.
 * 플러그인 객체를 async 함수에서 그대로 돌려주면 Promise 가 그 객체의 then 을 부르려 해서
 * "then() is not implemented" 오류가 난다. 그래서 한 겹 감싸서 돌려준다.
 */
let storageReady: Promise<{ storage: SecureStorageApi }> | null = null;

function secureStorage(): Promise<{ storage: SecureStorageApi }> {
  storageReady ??= (async () => {
    const { SecureStorage, KeychainAccess } = await import(
      "@aparajita/capacitor-secure-storage"
    );
    await SecureStorage.setKeyPrefix("nailsense_");
    // 기기를 바꿔 백업을 옮겨도 로그인 토큰은 따라가지 않게 한다.
    await SecureStorage.setDefaultKeychainAccess(KeychainAccess.afterFirstUnlockThisDeviceOnly);
    await SecureStorage.setSynchronize(false);
    return { storage: SecureStorage };
  })();
  storageReady.catch(() => {
    storageReady = null;
  });
  return storageReady;
}

function randomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * 앱이 시작할 때 한 번 부른다. 저장해 둔 세션 토큰과 기기 아이디를 읽는다.
 * 웹에서는 아무것도 하지 않는다.
 */
export async function initPlatform(): Promise<void> {
  if (!IS_APP) return;
  try {
    const { storage } = await secureStorage();
    const token = await storage.getItem(TOKEN_KEY);
    sessionToken = token && /^[A-Za-z0-9_-]{20,128}$/.test(token) ? token : null;
    const device = await storage.getItem(DEVICE_KEY);
    if (device && /^[A-Za-z0-9_-]{16,64}$/.test(device)) {
      deviceId = device;
    } else {
      deviceId = randomId();
      await storage.setItem(DEVICE_KEY, deviceId);
    }
  } catch {
    // 보안 저장소를 못 쓰면 이번 실행 동안만 기억한다. 다음 실행에는 다시 로그인해야 한다.
    deviceId ??= randomId();
  }
}

export async function saveSessionToken(token: string | null): Promise<void> {
  if (!IS_APP) return;
  sessionToken = token;
  try {
    const { storage } = await secureStorage();
    if (token) await storage.setItem(TOKEN_KEY, token);
    else await storage.removeItem(TOKEN_KEY);
  } catch {
    // 저장에 실패해도 메모리의 값으로 이번 실행은 계속된다.
  }
}

/** 모든 API 요청에 붙이는 헤더. 웹에서는 언어만 보낸다. */
export function platformHeaders(): Record<string, string> {
  if (!IS_APP) return {};
  return {
    "X-NailSense-Client": "app",
    ...(deviceId ? { "X-NailSense-Device": deviceId } : {}),
    ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
  };
}

/** 쿠키를 보낼지. 앱은 토큰을 쓰므로 쿠키를 보내지 않는다. */
export const FETCH_CREDENTIALS: RequestCredentials = IS_APP ? "omit" : "same-origin";
