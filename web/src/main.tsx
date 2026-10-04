import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./fonts";
import "./styles.css";
import { initPlatform } from "./lib/platform";

const container = document.getElementById("root");
if (!container) throw new Error("#root not found");

// 앱에서는 보안 저장소의 로그인 토큰을 먼저 읽어야 첫 요청부터 로그인 상태로 나간다.
void initPlatform().then(() => {
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
