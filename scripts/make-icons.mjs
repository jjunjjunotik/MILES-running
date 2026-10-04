/**
 * 앱 아이콘과 시작 화면(스플래시) 이미지를 만든다. 원본은 assets/icon.svg 하나.
 *
 *   npm run make:icons
 *
 * - iOS 아이콘(1024×1024)은 투명도(알파 채널)가 없어야 스토어에 올라간다. RGB 로 저장한다.
 * - 안드로이드는 적응형 아이콘(배경색 + 가운데 안전 영역에 그린 전경)과 예전 방식 아이콘을 함께 만든다.
 * - 스플래시는 배경색 위에 작은 표시 하나. 기존 파일과 같은 크기로 덮어쓴다.
 *
 * 그리기는 Chromium 캔버스로 하고, PNG 는 이 파일의 작은 인코더로 쓴다(별도 이미지 라이브러리 없이).
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { chromium } from "playwright";

const SVG = fs.readFileSync("assets/icon.svg", "utf8");
/** 안드로이드 적응형 아이콘 전경: 배경을 빼고 안전 영역(가운데 66/108)에 맞춘다. */
const FOREGROUND = SVG.replace(/<rect id="bg"[^>]*\/>/, "");
const BG = /<rect id="bg"[^>]*fill="(#[0-9a-fA-F]{6})"/.exec(SVG)[1];

/* ------------------------------- PNG 인코더 ------------------------------- */

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}
/** rgba: 픽셀 배열(RGBA). alpha=false 면 RGB 로 쓴다(투명도 없음). */
function encodePng(width, height, rgba, alpha) {
  const channels = alpha ? 4 : 3;
  const raw = Buffer.alloc((width * channels + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * channels + 1);
    raw[row] = 0; // 필터 없음
    for (let x = 0; x < width; x += 1) {
      const src = (y * width + x) * 4;
      const dst = row + 1 + x * channels;
      raw[dst] = rgba[src];
      raw[dst + 1] = rgba[src + 1];
      raw[dst + 2] = rgba[src + 2];
      if (alpha) raw[dst + 3] = rgba[src + 3];
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // 비트 깊이
  header[9] = alpha ? 6 : 2; // RGBA : RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* --------------------------------- 그리기 --------------------------------- */

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const page = await browser.newPage();
await page.setContent("<!doctype html><html><body></body></html>");

/**
 * svg 를 width×height 캔버스에 그린다.
 * scale: 캔버스 짧은 변 대비 그림 크기. background: 채울 색(없으면 투명). round: 원형으로 잘라 냄.
 */
async function render(svg, { width, height, scale = 1, background = null, round = false, encode = "pixels" }) {
  const result = await page.evaluate(
    async ({ svg, width, height, scale, background, round, encode }) => {
      const image = new Image();
      image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (round) {
        ctx.beginPath();
        ctx.arc(width / 2, height / 2, Math.min(width, height) / 2, 0, Math.PI * 2);
        ctx.clip();
      }
      if (background) {
        ctx.fillStyle = background;
        ctx.fillRect(0, 0, width, height);
      }
      const size = Math.min(width, height) * scale;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(image, (width - size) / 2, (height - size) / 2, size, size);
      // 투명도가 있어도 되는 그림은 브라우저가 PNG 로 바로 만든다(빠르다).
      if (encode === "browser") return canvas.toDataURL("image/png").split(",")[1];
      // iOS 앱 아이콘처럼 알파 채널이 없어야 하는 것만 픽셀을 base64 로 넘겨 직접 RGB 로 쓴다.
      const data = ctx.getImageData(0, 0, width, height).data;
      let binary = "";
      for (let i = 0; i < data.length; i += 0x8000) {
        binary += String.fromCharCode.apply(null, data.subarray(i, i + 0x8000));
      }
      return btoa(binary);
    },
    { svg, width, height, scale, background, round, encode },
  );
  return Buffer.from(result, "base64");
}

/** alpha=false: 알파 채널 없는 RGB PNG(iOS 아이콘). true: 브라우저가 만든 RGBA PNG 그대로. */
async function write(file, options, alpha) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (alpha) {
    fs.writeFileSync(file, await render(options.svg ?? SVG, { ...options, encode: "browser" }));
  } else {
    const pixels = await render(options.svg ?? SVG, options);
    fs.writeFileSync(file, encodePng(options.width, options.height, pixels, false));
  }
  console.log(`  ${file} (${options.width}×${options.height}${alpha ? ", RGBA" : ", RGB"})`);
}

const RES = "android/app/src/main/res";
const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };

console.log("iOS");
await write("ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png", { width: 1024, height: 1024 }, false);

console.log("안드로이드 아이콘");
for (const [density, factor] of Object.entries(DENSITIES)) {
  const legacy = Math.round(48 * factor);
  const fg = Math.round(108 * factor);
  await write(`${RES}/mipmap-${density}/ic_launcher.png`, { width: legacy, height: legacy }, true);
  await write(`${RES}/mipmap-${density}/ic_launcher_round.png`, { width: legacy, height: legacy, round: true }, true);
  // 전경은 108dp 중 가운데 72dp 정도에 그린다(안전 영역 66dp 안에 핵심이 들어가게).
  await write(`${RES}/mipmap-${density}/ic_launcher_foreground.png`, { svg: FOREGROUND, width: fg, height: fg, scale: 0.72 }, true);
}
fs.writeFileSync(
  `${RES}/values/ic_launcher_background.xml`,
  `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${BG}</color>\n</resources>\n`,
);

console.log("스플래시");
const splashes = [
  ["ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732.png", 2732, 2732],
  ["ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732-1.png", 2732, 2732],
  ["ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732-2.png", 2732, 2732],
  [`${RES}/drawable/splash.png`, 480, 320],
  ...Object.entries({ mdpi: [320, 480], hdpi: [480, 800], xhdpi: [720, 1280], xxhdpi: [960, 1600], xxxhdpi: [1280, 1920] }).flatMap(
    ([density, [w, h]]) => [
      [`${RES}/drawable-port-${density}/splash.png`, w, h],
      [`${RES}/drawable-land-${density}/splash.png`, h, w],
    ],
  ),
];
for (const [file, width, height] of splashes) {
  // 배경색을 꽉 채우고 가운데에 아이콘 그림을 작게(짧은 변의 28%).
  // 배경이 꽉 차 있어 보이는 투명 부분은 없다. 알파 채널 제한은 iOS 앱 아이콘에만 있으므로 빠른 방식으로 쓴다.
  await write(file, { svg: FOREGROUND, width, height, scale: 0.28, background: BG }, true);
}

await browser.close();
console.log("완료");
