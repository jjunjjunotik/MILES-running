// Guards the size of every control: on a phone, a control you cannot hit is a
// control that does not exist. Run it:
//   node test-touch.js
// Needs Playwright, which the app itself does not: `npm i playwright`, or run
// with NODE_PATH pointing at an install that has it.
//
// The rule has two rungs, and the second is not a loophole:
//
//   Standalone control   44x44. There is nothing around it, so a near miss
//                        lands on nothing and the tap is simply lost.
//   Grouped control      40px in its short axis, provided the group it sits in
//                        clears 44px. Segments are flush against each other, so
//                        a near miss still lands on a segment. Holding each one
//                        to 44px would put a 50px pill on screen every time two
//                        words need switching between.
//
// A control may also be smaller than it is reachable: an inline section link
// keeps its 23px baseline and carries the reach in a pseudo-element, so the
// heading beside it does not grow. The test therefore measures what the browser
// would actually hit-test — walking out from the centre with elementsFromPoint
// — rather than the element's own box.
const { chromium } = require('playwright');
const path = require('path');

const TAP = 44;
const TAP_GROUP = 40;
const GROUPS = ['seg', 'rank-dots', 'run-controls', 'finish-actions', 'kinds'];

const measure = `(() => {
  const GROUPS = ${JSON.stringify(GROUPS)};
  const TAP = ${TAP}, TAP_GROUP = ${TAP_GROUP};
  const root = document.querySelector('.sheet-scrim:not([hidden])')
    || document.querySelector('.screen[data-active="true"]');
  const out = [];
  for (const el of root.querySelectorAll('button, a[href], [role="button"]')) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    if (getComputedStyle(el).visibility === 'hidden') continue;
    const group = GROUPS.some((g) => el.parentElement && el.parentElement.classList.contains(g));
    const need = group ? TAP_GROUP : TAP;

    // elementsFromPoint works in viewport coordinates, so a control below the
    // fold hit-tests as nothing at all. Bring it into view before probing.
    el.scrollIntoView({ block: 'center', inline: 'center' });
    const r2 = el.getBoundingClientRect();
    const cx = r2.x + r2.width / 2, cy = r2.y + r2.height / 2;
    const owns = (x, y) => document.elementsFromPoint(x, y).includes(el);
    const reach = (dx, dy) => {
      let n = 0;
      while (n < 60 && owns(cx + dx * (n + 1), cy + dy * (n + 1))) n++;
      return n;
    };
    const w = reach(-1, 0) + reach(1, 0) + 1;
    const h = reach(0, -1) + reach(0, 1) + 1;

    // A group only earns the lower bar if the group itself clears 44px.
    let groupOk = true;
    if (group) {
      const g = el.parentElement.getBoundingClientRect();
      groupOk = Math.min(g.width, g.height) >= TAP - 0.5;
    }
    if (w + 0.5 < need || h + 0.5 < need || !groupOk) {
      out.push({ cls: el.className || el.tagName, txt: (el.textContent || '').trim().slice(0, 20),
                 w: Math.round(w), h: Math.round(h), need, group, groupOk });
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
  let bad = 0, checked = 0;

  for (const size of [{ width: 360, height: 780 }, { width: 390, height: 844 }, { width: 430, height: 932 }]) {
    const page = await browser.newPage({ viewport: size });
    page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
    await page.goto('file://' + path.resolve(__dirname, 'index.html'));
    await page.waitForTimeout(900);

    for (const [name, open] of STOPS) {
      await page.evaluate(`document.querySelectorAll('.sheet-scrim').forEach(s => s.hidden = true)`);
      await page.evaluate(open);
      await page.waitForTimeout(450);
      for (const r of await page.evaluate(measure)) {
        bad++;
        console.log(`  TOO SMALL ${size.width}px ${name.padEnd(10)} ${r.w}x${r.h} (needs ${r.need}${r.group ? ', grouped' : ''}${r.groupOk ? '' : ', GROUP UNDER 44'})  .${r.cls}  "${r.txt}"`);
      }
      checked++;
    }
    await page.close();
  }

  await browser.close();
  console.log(bad === 0
    ? `EVERY CONTROL IS REACHABLE (${checked} screen/size combinations)`
    : `${bad} controls are too small to hit`);
  process.exit(bad === 0 ? 0 : 1);
})();
