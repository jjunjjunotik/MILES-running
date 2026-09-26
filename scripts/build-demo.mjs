/**
 * 서버 없이 열리는 단일 HTML 데모를 만든다.
 *
 *   npm run build:demo
 *
 * 산출물
 *   demo/nailsense-demo.html   브라우저에서 바로 열 수 있는 완결된 파일
 *   demo/artifact.html         <html>/<head>/<body> 래퍼 없이 본문만 담은 파일
 *
 * 분석 요청은 네트워크로 나가지 않고 샘플 결과로 대체된다(VITE_STANDALONE_DEMO=1).
 *
 * 글꼴: 앱은 글꼴 파일을 직접 호스팅하지만, 한 파일에 한글 글꼴을 모두 넣으면 수 MB가
 * 된다. 데모는 Artifact 가 허용하는 Google Fonts 에서 같은 글꼴을 불러온다.
 */
import { build } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";

const OUT_DIR = "demo";
const TMP_DIR = path.join(OUT_DIR, ".build");

// 글꼴 서버에는 이 페이지 주소를 보내지 않는다.
const FONT_LINKS = [
  '<link rel="preconnect" href="https://fonts.googleapis.com" referrerpolicy="no-referrer">',
  '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin referrerpolicy="no-referrer">',
  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@500&family=IBM+Plex+Sans+KR:wght@400;600&display=swap" referrerpolicy="no-referrer">',
].join("\n");

/** 직접 호스팅용 글꼴 CSS 를 빈 CSS 로 바꿔 끼운다. */
const skipSelfHostedFonts = {
  name: "demo-skip-self-hosted-fonts",
  enforce: "pre",
  resolveId(id) {
    return id.startsWith("@fontsource/") ? "\0demo-font.css" : null;
  },
  load(id) {
    return id === "\0demo-font.css" ? "" : null;
  },
};

await build({
  root: "web",
  plugins: [skipSelfHostedFonts, react()],
  define: { "import.meta.env.VITE_STANDALONE_DEMO": '"1"' },
  build: {
    outDir: path.resolve(TMP_DIR),
    emptyOutDir: true,
    // 청크를 쪼개지 않아야 한 파일로 합칠 수 있다.
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
  logLevel: "warn",
});

const html = fs.readFileSync(path.join(TMP_DIR, "index.html"), "utf8");
const assets = path.join(TMP_DIR, "assets");
const read = (suffix) => {
  const file = fs
    .readdirSync(assets)
    .find((name) => name.endsWith(suffix));
  if (!file) throw new Error(`${suffix} 산출물을 찾지 못했습니다.`);
  return fs.readFileSync(path.join(assets, file), "utf8");
};

const css = read(".css");
const js = read(".js");

// </script> 가 인라인 스크립트를 조기에 닫지 않도록 막는다.
const safeJs = js.replace(/<\/script>/gi, "<\\/script>");

// 치환 문자열에 함수를 쓴다. 번들 안의 `$&` 같은 시퀀스가
// 치환 패턴으로 해석되어 원본 태그가 되살아나는 것을 막는다.
const inlined = html
  .replace(
    /<link rel="stylesheet"[^>]*href="[^"]*\.css"[^>]*>/i,
    () => `<style>\n${css}\n</style>`,
  )
  .replace(
    /<script type="module"[^>]*src="[^"]*\.js"[^>]*><\/script>/i,
    () => `<script type="module">\n${safeJs}\n</script>`,
  );

if (inlined.includes("/assets/") || /\.woff2?\b/.test(inlined)) {
  throw new Error("인라인되지 않은 자산이 남아 있습니다.");
}

const withFonts = inlined.replace("</title>", () => `</title>\n${FONT_LINKS}`);
if (withFonts === inlined) throw new Error("글꼴 링크를 넣을 자리를 찾지 못했습니다.");

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, "nailsense-demo.html"), withFonts);

// Artifact 로 게시할 때는 바깥 래퍼 없이 본문만 넘긴다.
const head = inlined.match(/<head>([\s\S]*?)<\/head>/i)?.[1] ?? "";
const body = inlined.match(/<body>([\s\S]*?)<\/body>/i)?.[1] ?? "";
const pick = (source, re) => source.match(re)?.[0] ?? "";
// Artifact 갤러리에서는 설명이 붙지 않은 제품 이름만 쓴다.
const title = "<title>NailSense</title>";
if (!pick(head, /<title>[\s\S]*?<\/title>/i)) {
  throw new Error("빌드 결과에 title 이 없습니다.");
}
const style = pick(head, /<style>[\s\S]*?<\/style>/i);
// 스크립트는 head 에 들어가 있으므로 본문 뒤로 옮겨 붙인다.
const script = pick(head, /<script type="module">[\s\S]*?<\/script>/i);
if (!title || !style || !script) {
  throw new Error("artifact.html 에 담을 조각을 찾지 못했습니다.");
}
fs.writeFileSync(
  path.join(OUT_DIR, "artifact.html"),
  `${title}\n${FONT_LINKS}\n${style}\n${body.trim()}\n${script}\n`,
);

fs.rmSync(TMP_DIR, { recursive: true, force: true });

const size = (file) =>
  `${(fs.statSync(path.join(OUT_DIR, file)).size / 1024).toFixed(0)} KB`;
console.log(`demo/nailsense-demo.html  ${size("nailsense-demo.html")}`);
console.log(`demo/artifact.html        ${size("artifact.html")}`);
