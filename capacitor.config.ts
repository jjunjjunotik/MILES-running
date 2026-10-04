import type { CapacitorConfig } from "@capacitor/cli";

/**
 * 휴대폰 앱(iOS · 안드로이드) 설정.
 *
 * 앱은 `npm run build:app` 으로 만든 화면(dist-app)을 앱 안에 담고,
 * 분석·계정 API 는 배포한 서버(APP_API_BASE, 기본 https://nailsense.fly.dev)를 부른다.
 *
 * appId 는 스토어에 한 번 올리면 바꿀 수 없다. 첫 업로드 전에 확정할 것.
 * (보통 소유한 도메인을 거꾸로 쓴다. 예: com.example.nailsense)
 */
const config: CapacitorConfig = {
  appId: "com.nailsense.app",
  appName: "NailSense",
  webDir: "dist-app",
  // 앱 화면의 출처. iOS 는 capacitor://localhost, 안드로이드는 https://localhost 가 되며
  // 서버의 CORS 허용 목록(APP_ORIGINS 기본값)과 맞춘다.
  server: {
    androidScheme: "https",
    iosScheme: "capacitor",
  },
  android: {
    // http 주소는 섞어 부르지 않는다.
    allowMixedContent: false,
    // 웹 디버깅은 디버그 빌드에서만 켠다.
    webContentsDebuggingEnabled: false,
  },
  ios: {
    contentInset: "never",
    limitsNavigationsToAppBoundDomains: false,
  },
};

export default config;
