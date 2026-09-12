import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "web",
  plugins: [react()],
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
  },
});
