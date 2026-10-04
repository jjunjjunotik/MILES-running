import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/**
 * 글꼴 CSS 에서 woff(구형 형식) 대체 경로와 주석을 걷어 낸다.
 * 대상 브라우저는 모두 woff2 를 읽으므로, 렌더링을 막는 CSS 가 가벼워지고
 * 쓰이지 않을 woff 파일 수백 개가 산출물에서 빠진다.
 */
function woff2Only(): Plugin {
  return {
    name: "nailsense-woff2-only",
    enforce: "pre",
    transform(code, id) {
      if (!/@fontsource\/.+\.css(\?|$)/.test(id)) return null;
      return code
        .replace(/,\s*url\([^)]*\.woff\)\s*format\(["']woff["']\)/g, "")
        .replace(/\/\*[\s\S]*?\*\//g, "");
    },
  };
}

/**
 * 휴대폰 앱용 빌드(`vite build --mode app`)가 부를 API 서버 주소.
 * 앱 안의 화면은 서버와 출처가 달라 주소를 알아야 한다. https 만 받는다.
 */
function appApiBase(): string {
  const value = (process.env.APP_API_BASE ?? "https://nailsense.fly.dev").replace(/\/+$/, "");
  const url = new URL(value);
  const local = ["localhost", "127.0.0.1", "10.0.2.2"].includes(url.hostname);
  if (url.protocol !== "https:" && !local) {
    throw new Error(`APP_API_BASE 는 https 주소여야 합니다: ${value}`);
  }
  return value;
}

/**
 * 브라우저 테스트(npm run e2e:store) 전용: 스토어 결제 플러그인을 가짜로 바꿔 끼운다.
 * 이 환경변수를 켜지 않은 빌드(실제 앱)에는 영향이 없다.
 */
const FAKE_STORE = process.env.NAILSENSE_FAKE_STORE === "1";

export default defineConfig(({ mode }) => ({
  root: "web",
  plugins: [woff2Only(), react()],
  resolve: FAKE_STORE
    ? {
        alias: {
          "@revenuecat/purchases-capacitor": new URL("./scripts/fakes/purchases.ts", import.meta.url).pathname,
          "@capacitor/app-launcher": new URL("./scripts/fakes/app-launcher.ts", import.meta.url).pathname,
        },
      }
    : undefined,
  define: {
    // 웹 빌드에서는 앱 전용 코드(보안 저장소 등)가 통째로 빠지도록 상수로 박는다.
    "import.meta.env.VITE_APP_TARGET": JSON.stringify(mode === "app" ? "app" : ""),
    "import.meta.env.VITE_API_BASE": JSON.stringify(mode === "app" ? appApiBase() : ""),
  },
  server: {
    port: 5173,
    proxy: {
      // 이미지는 브라우저에서 직접 Anthropic으로 가지 않고,
      // 반드시 이 프록시를 거쳐 서버에서만 API 키와 함께 처리된다.
      "/api": {
        target: "http://localhost:8787",
        changeOrigin: true,
      },
    },
  },
  build: {
    // 앱 화면은 dist-app 에 따로 만든다. 서버가 서빙하는 dist 와 섞이지 않게.
    outDir: mode === "app" ? "../dist-app" : "../dist",
    emptyOutDir: true,
    // 작은 글꼴 조각도 data: 로 넣지 않는다. 서버 CSP 가 글꼴은 자기 출처에서만 받는다.
    assetsInlineLimit: (file) => (/\.woff2?$/.test(file) ? false : undefined),
  },
}));
