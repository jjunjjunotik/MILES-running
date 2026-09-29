// Draws the source images for the app icon and the launch screen into
// assets/, from the app's own wordmark face. `npx capacitor-assets generate`
// then cuts every size Android and iOS need from them.
//   node scripts/draw-icons.js
// Needs Playwright, which the app itself does not.
const { chromium } = require('playwright');
const path = require('path');

const fs = require('fs');

// Inlined: a page set from a string may not load a file:// font.
const font = 'data:font/woff2;base64,' + fs.readFileSync(path.resolve(__dirname, '../src/fonts/barlow-condensed-700-italic.woff2')).toString('base64');
const INK = '#0e0d0c';
const CHALK = '#f1ead9';
const FLAME = '#f2642a';

const page = (size, body, bg) => `<!doctype html><html><head><style>
  @font-face { font-family: B; src: url("${font}"); font-style: italic; font-weight: 700; }
  html, body { margin: 0; width: ${size}px; height: ${size}px; background: ${bg}; }
  body { display: grid; place-items: center; font-family: B; font-style: italic; font-weight: 700; }
</style></head><body>${body}</body></html>`;

// The icon: one leaning M, a flame stroke under it like a finish line.
const mark = (size) => `
  <div style="display:flex; flex-direction:column; align-items:center; line-height:1">
    <div style="font-size:${size * 0.7}px; color:${CHALK}; line-height:0.74">M</div>
    <div style="height:${size * 0.055}px; width:${size * 0.4}px; margin-top:${size * 0.07}px; background:${FLAME}; border-radius:${size * 0.03}px; transform: skewX(-12deg)"></div>
  </div>`;
const word = (size) => `<div style="font-size:${size * 0.09}px; color:${CHALK}; line-height:1">MILES</div>`;

const shots = [
  { file: 'icon-only.png', size: 1024, body: mark(1024), bg: INK },
  // Android adaptive icon: the mark kept inside the middle 66% safe zone.
  { file: 'icon-foreground.png', size: 1024, body: mark(1024 * 0.62), bg: 'transparent' },
  { file: 'icon-background.png', size: 1024, body: '', bg: INK },
  { file: 'splash.png', size: 2732, body: word(2732), bg: INK },
  { file: 'splash-dark.png', size: 2732, body: word(2732), bg: INK },
];

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  for (const s of shots) {
    const p = await browser.newPage({ viewport: { width: s.size, height: s.size } });
    await p.setContent(page(s.size, s.body, s.bg));
    const loaded = await p.evaluate(async () => { await document.fonts.ready; return document.fonts.check('italic 700 40px B'); });
    if (s.body && !loaded) throw new Error('the wordmark face did not load');
    await p.screenshot({ path: path.resolve(__dirname, '../assets', s.file), omitBackground: s.bg === 'transparent' });
    await p.close();
    console.log('assets/' + s.file);
  }
  await browser.close();
})();
