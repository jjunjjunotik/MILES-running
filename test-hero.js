// The home picture swipes. Guards the things a swipe could quietly break:
//   node test-hero.js
// Needs Playwright, which the app itself does not: `npm i playwright`, or run
// with NODE_PATH pointing at an install that has it.
//
// What has to hold:
//   - a sideways drag moves to the next picture, and it is remembered
//   - the ends resist instead of wrapping or running off
//   - a vertical drag is a scroll, not a swipe
//   - a plain tap on a switch over the picture still presses it
//   - a drag that ends over a switch does NOT press it
//   - a picture whose file is missing shows something drawn, never a hole
//   - it moves on by itself every three seconds, loops, and holds still
//     when you have just swiped it or are on another screen
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const url = 'file://' + path.resolve(__dirname, 'index.html');
  await page.goto(url);
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
  await page.reload();
  await page.waitForTimeout(1200);
  const hold = () => page.evaluate(() => MILES.UI.heroAutoplay(false));
  await hold();

  let bad = 0;
  const ok = (label, cond, extra) => {
    console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${!cond && extra !== undefined ? '  → ' + extra : ''}`);
    if (!cond) bad++;
  };
  const idx = () => page.evaluate(() => MILES.UI.heroIndex);
  const box = await page.locator('#homeHero').boundingBox();
  const cy = box.y + box.height * 0.55;
  const drag = async (fromX, toX, fromY, toY) => {
    await page.mouse.move(fromX, fromY);
    await page.mouse.down();
    await page.mouse.move(toX, toY, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(500);
  };

  ok('starts on the drawn picture', (await idx()) === 0);
  ok('one dot per picture', await page.evaluate(() =>
    document.querySelectorAll('#heroDots i').length === document.querySelectorAll('.hero-slide').length));

  await drag(box.x + box.width * 0.8, box.x + box.width * 0.2, cy, cy);
  ok('a leftward swipe goes to the next picture', (await idx()) === 1, await idx());
  ok('the dot follows', await page.evaluate(() =>
    [...document.querySelectorAll('#heroDots i')].findIndex((d) => d.hasAttribute('data-on')) === 1));

  await drag(box.x + box.width * 0.3, box.x + box.width * 0.36, cy, cy);
  ok('a short nudge settles back', (await idx()) === 1, await idx());

  await drag(box.x + box.width * 0.5, box.x + box.width * 0.52, cy - 60, cy + 120);
  ok('a vertical drag is not a swipe', (await idx()) === 1, await idx());

  await page.reload(); await page.waitForTimeout(1200); await hold();
  ok('the choice survives a reload', (await idx()) === 1, await idx());

  for (let i = 0; i < 6; i++) await drag(box.x + box.width * 0.85, box.x + box.width * 0.1, cy, cy);
  const last = await page.evaluate(() => document.querySelectorAll('.hero-slide').length - 1);
  ok('the last picture is the end, not a wrap', (await idx()) === last, await idx());
  for (let i = 0; i < 6; i++) await drag(box.x + box.width * 0.1, box.x + box.width * 0.85, cy, cy);
  ok('the first picture is the other end', (await idx()) === 0, await idx());

  // A tap on the Month switch still switches.
  await page.click('[data-range="month"]');
  await page.waitForTimeout(250);
  ok('a tap on a switch over the picture still works',
    await page.evaluate(() => document.querySelector('[data-range="month"]').getAttribute('aria-pressed') === 'true'));

  // A swipe that ends on the Week switch must not press it.
  const week = await page.locator('[data-range="week"]').boundingBox();
  await drag(box.x + box.width * 0.9, week.x + week.width / 2, week.y + week.height / 2, week.y + week.height / 2);
  ok('a swipe ending on a switch does not press it',
    await page.evaluate(() => document.querySelector('[data-range="month"]').getAttribute('aria-pressed') === 'true'));
  ok('…but it was still a swipe', (await idx()) === 1, await idx());

  // Keyboard.
  await page.focus('#homeHero');
  await page.keyboard.press('ArrowRight'); await page.waitForTimeout(450);
  ok('the arrow keys move it too', (await idx()) === 2, await idx());

  // Every photograph arrived, and a missing one falls back to a drawing.
  await page.waitForTimeout(800);
  ok('every photograph loaded', await page.evaluate(() =>
    [...document.querySelectorAll('.hero-slide[data-photo]')].every((s) => {
      const img = s.querySelector('img.visual-photo');
      return img && img.naturalWidth > 0;
    })));
  const fallback = await page.evaluate(() => new Promise((resolve) => {
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:0;top:0;width:200px;height:200px';
    document.body.appendChild(host);
    MILES.Visual.photo(host, 'src/img/hero/does-not-exist.webp', { seed: 3 });
    setTimeout(() => resolve({
      img: !!host.querySelector('img'),
      canvas: !!host.querySelector('canvas'),
    }), 800);
  }));
  ok('a missing photograph shows a drawn picture, never a hole', fallback.canvas && !fallback.img, JSON.stringify(fallback));

  // --- It moves on by itself, every three seconds -------------------------
  await page.evaluate(() => MILES.UI.heroAutoplay(true));
  const t0 = await idx();
  await page.waitForTimeout(3400);
  ok('after three seconds it moves on by itself', (await idx()) === t0 + 1, `${t0} -> ${await idx()}`);
  const saved = await page.evaluate(() => MILES.State.data.heroBg);
  ok('…without overwriting the one you chose', saved !== (await idx()), `saved ${saved}`);

  // From the last picture it comes round to the first.
  const lastIdx = await page.evaluate(() => document.querySelectorAll('.hero-slide').length - 1);
  await page.evaluate(() => MILES.UI.heroAutoplay(false));
  for (let i = 0; i < 6; i++) await drag(box.x + box.width * 0.85, box.x + box.width * 0.1, cy, cy);
  ok('(at the last picture)', (await idx()) === lastIdx, await idx());
  await page.evaluate(() => MILES.UI.heroAutoplay(true));
  await page.waitForTimeout(3700);
  ok('after the last it comes round to the first', (await idx()) === 0, await idx());
  ok('…and is visible again after the fade', await page.evaluate(() =>
    getComputedStyle(document.querySelector('#heroTrack')).opacity === '1'));

  // A swipe restarts the clock: nothing moves for a full three seconds after.
  await drag(box.x + box.width * 0.85, box.x + box.width * 0.15, cy, cy);
  const afterSwipe = await idx();
  await page.waitForTimeout(2200);
  ok('a swipe buys a full three seconds', (await idx()) === afterSwipe, `${afterSwipe} -> ${await idx()}`);

  // Off Home, it stands still.
  await page.evaluate(() => MILES.UI.go('quests'));
  const away = await idx();
  await page.waitForTimeout(3500);
  ok('it does not run while another screen is showing', (await idx()) === away, `${away} -> ${await idx()}`);
  await page.evaluate(() => MILES.UI.go('home'));

  // A long month never runs off the edge of the picture.
  const fits = await page.evaluate(() => ['5.20', '125.50', '1025.50'].every((v) => {
    document.querySelector('#volumeValue').textContent = v;
    MILES.UI.fitHeroNumber();
    const n = document.querySelector('.hero-number');
    return n.scrollWidth <= n.clientWidth;
  }));
  ok('the distance always fits inside the picture', fits);

  ok('no errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(bad === 0 ? 'ALL PASS' : `${bad} FAILURES`);
  process.exit(bad === 0 ? 0 : 1);
})();
