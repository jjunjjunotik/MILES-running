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

export default defineConfig({
  root: "web",
  plugins: [woff2Only(), react()],
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
    outDir: "../dist",
    emptyOutDir: true,
    // 작은 글꼴 조각도 data: 로 넣지 않는다. 서버 CSP 가 글꼴은 자기 출처에서만 받는다.
    assetsInlineLimit: (file) => (/\.woff2?$/.test(file) ? false : undefined),
  },
});
