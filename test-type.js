// The floor under the type. A screen full of 10 and 11px labels is legible on
// a desktop browser at 100% and unreadable on the phone it was drawn for, and
// nothing else in the suite would notice — contrast passes at any size, and a
// control can be perfectly hittable with an illegible label on it.
//   node test-type.js
// Needs Playwright, which the app itself does not: `npm i playwright`, or run
// with NODE_PATH pointing at an install that has it.
//
// The floor is 11px and it applies to text a person reads. It is deliberately
// below the 12px the design uses, so that a considered exception does not fail
// the run while an accident — a hard-coded 8px badge, a class that lost its
// font-size — does.
const { chromium } = require('playwright');
const path = require('path');

const FLOOR = 11;

const measure = `(() => {
  const root = document.querySelector('.sheet-scrim:not([hidden])')
    || document.querySelector('.screen[data-active="true"]');
  const out = [];
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walk.nextNode())) {
    const text = n.textContent.trim();
    if (!text) continue;
    const el = n.parentElement;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    const size = parseFloat(cs.fontSize);
    if (size + 0.01 < ${FLOOR}) {
      out.push({ size: Math.round(size * 10) / 10, cls: el.className || el.tagName, text: text.slice(0, 30) });
    }
  }
  return out;
})()`;

const STOPS = [
  ['home', `MILES.UI.go('home')`],
  ['crew', `MILES.UI.go('crew')`],
  ['territory', `MILES.UI.go('territory')`],
  ['quests', `MILES.UI.go('quests')`],
  ['profile', `MILES.UI.go('profile')`],
  ['feed', `MILES.UI.go('feed')`],
  ['soloSheet', `MILES.UI.openSheet('#soloSheet')`],
  ['duoSheet', `MILES.UI.openRaceLobby()`],
  ['proSheet', `MILES.UI.openPro()`],
];

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
  await page.goto('file://' + path.resolve(__dirname, 'index.html'));
  await page.waitForTimeout(1000);

  let bad = 0, smallest = Infinity, checked = 0;
  for (const [name, open] of STOPS) {
    await page.evaluate(`document.querySelectorAll('.sheet-scrim').forEach(s => s.hidden = true)`);
    await page.evaluate(open);
    await page.waitForTimeout(450);
    const rows = await page.evaluate(measure);
    for (const r of rows) {
      bad++;
      smallest = Math.min(smallest, r.size);
      console.log(`  TOO SMALL ${name.padEnd(10)} ${r.size}px  .${r.cls}  "${r.text}"`);
    }
    checked++;
  }

  await browser.close();
  console.log(bad === 0
    ? `NOTHING RENDERS BELOW ${FLOOR}px (${checked} screens and sheets)`
    : `${bad} runs of text below ${FLOOR}px, smallest ${smallest}px`);
  process.exit(bad === 0 ? 0 : 1);
})();
