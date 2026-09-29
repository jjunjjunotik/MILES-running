// The record card. Checked here: every layout draws for every kind of run and
// colour with nothing on the card landing on anything else; the three numbers
// are time, pace and the climb, and never repeat the headline; the sticker is
// see-through; the climb comes from altitude rather than from thin air; and
// the layout the runner picks, from a picture of each, is kept.
//   node test-card.js
// Needs Playwright, which the app itself does not: `npm i playwright`, or run
// with NODE_PATH pointing at an install that has it.
const { chromium } = require('playwright');
const path = require('path');

// Runs in the page: draws a card and reports every overlap and overflow in the
// layout it recorded. Top-level blocks must not touch each other; a block
// drawn inside another (a split row inside the splits) must stay inside it.
const CHECK = `(activity, options) => {
  const c = document.createElement('canvas');
  MILES.renderCard(c, activity, options);
  const L = c.cardLayout || [];
  const bad = [];
  const hit = (a, b) => a.x < b.x + b.w - 1 && b.x < a.x + a.w - 1 && a.y < b.y + b.h - 1 && b.y < a.y + a.h - 1;
  const inside = (a, b) => a.x >= b.x - 1 && a.y >= b.y - 1 && a.x + a.w <= b.x + b.w + 1 && a.y + a.h <= b.y + b.h + 1;
  const top = L.filter((b) => !b.parent);
  for (let i = 0; i < top.length; i++) {
    for (let j = i + 1; j < top.length; j++) {
      if (hit(top[i], top[j])) bad.push(top[i].name + ' × ' + top[j].name);
    }
  }
  L.forEach((b) => {
    if (b.x < -1 || b.y < -1 || b.x + b.w > c.width + 1 || b.y + b.h > c.height + 1) bad.push(b.name + ' off the card');
    if (b.parent) {
      const p = L.find((x) => x.name === b.parent && !x.parent);
      if (!p || !inside(b, p)) bad.push(b.name + ' outside ' + b.parent);
    }
  });
  return { bad, template: c.cardTemplate, names: L.map((b) => b.name), layout: L, w: c.width, h: c.height };
}`;

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  await page.goto('file://' + path.resolve(__dirname, 'index.html'));
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
  await page.reload();
  await page.waitForTimeout(1000);

  let bad = 0;
  const ok = (label, cond, extra) => {
    console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${!cond && extra !== undefined ? '  → ' + extra : ''}`);
    if (!cond) bad++;
  };

  // --- 1. Every layout, every kind, every colour -------------------------
  const sweep = await page.evaluate(`(async () => {
    const check = ${CHECK};
    const S = MILES.State.data;
    const runs = [
      S.activities.find((a) => a.kind === 'free' && a.distance > 10000),
      S.activities.find((a) => a.kind === 'territory' && a.claimedArea > 0),
      S.activities.find((a) => a.kind === 'race'),
      Object.assign({}, S.activities.find((a) => a.kind === 'free'), { route: [] }),
      Object.assign({}, S.activities.find((a) => a.kind === 'free'), { distance: 123456, duration: 36600 }),
    ];
    const problems = [];
    let drawn = 0;
    for (const a of runs) {
      for (const t of Object.keys(MILES.CARD_TEMPLATES)) {
        for (const theme of [undefined].concat(MILES.cardThemesFor(a.kind))) {
          const r = check(a, { template: t, theme, athlete: 'You', rank: 'Strider', totalArea: 720000 });
          drawn++;
          if (r.template !== t) problems.push(a.kind + '/' + t + ' drew ' + r.template);
          r.bad.forEach((b) => problems.push(a.kind + '/' + t + '/' + (theme || 'default') + ': ' + b));
        }
      }
    }
    return { problems, drawn, layouts: Object.keys(MILES.CARD_TEMPLATES) };
  })()`);
  ok('three layouts: Map, Poster and Sticker — the splits are listed under the card, not a layout',
    JSON.stringify(sweep.layouts) === JSON.stringify(['map', 'poster', 'sticker']), JSON.stringify(sweep.layouts));
  ok(`${sweep.drawn} cards across every layout, kind and colour: nothing lands on anything`,
    sweep.drawn >= 60 && sweep.problems.length === 0, sweep.problems.slice(0, 6).join(' | '));

  // --- 2. The numbers --------------------------------------------------------
  const numbers = await page.evaluate(`(() => {
    const check = ${CHECK};
    const S = MILES.State.data;
    const free = S.activities.find((a) => a.kind === 'free' && a.distance > 10000);
    const terr = S.activities.find((a) => a.kind === 'territory' && a.claimedArea > 0);
    const labels = (a) => {
      const c = document.createElement('canvas');
      MILES.renderCard(c, a, { template: 'map' });
      return c.cardLayout.filter((b) => b.name === 'stat').length;
    };
    const words = (a) => {
      const seen = [];
      const c = document.createElement('canvas');
      const ctx = c.getContext('2d');
      const fill = ctx.fillText;
      CanvasRenderingContext2D.prototype.fillText = function (t) { seen.push(String(t)); return fill.apply(this, arguments); };
      try { MILES.renderCard(c, a, { template: 'map' }); } finally { CanvasRenderingContext2D.prototype.fillText = fill; }
      return seen;
    };
    return {
      free: words(free),
      noAlt: words(Object.assign({}, free, { elevation: null })),
      terrNoAlt: words(Object.assign({}, terr, { elevation: null })),
      count: labels(free),
    };
  })()`);
  ok('the numbers are time, pace and elevation gain',
    ['Time', 'Pace', 'Elevation gain'].every((w) => numbers.free.includes(w)), JSON.stringify(numbers.free));
  ok('a free run says its distance once', !numbers.free.includes('Distance'), JSON.stringify(numbers.free));
  ok('with no altitude the climb is not made up: speed, or the distance when the headline is not it',
    !numbers.noAlt.includes('Elevation gain') && numbers.noAlt.includes('Avg speed') && numbers.terrNoAlt.includes('Distance'),
    JSON.stringify([numbers.noAlt, numbers.terrNoAlt]));

  // --- 5. The sticker is see-through, the others are not ---------------------
  const alpha = await page.evaluate(() => {
    const a = MILES.State.data.activities.find((x) => x.kind === 'free' && x.distance > 10000);
    const corner = (t) => {
      const c = document.createElement('canvas');
      MILES.renderCard(c, a, { template: t });
      return c.getContext('2d').getImageData(4, 4, 1, 1).data[3];
    };
    return { sticker: corner('sticker'), map: corner('map') };
  });
  ok('a sticker is saved with a transparent background', alpha.sticker === 0, alpha.sticker);
  ok('a map card is not', alpha.map === 255, alpha.map);

  // --- 6. The climb comes from altitude ---------------------------------------
  const climb = await page.evaluate(() => {
    const f = MILES.climbOf;
    const out = {
      jitter: f([10, 11, 9, 12, 10, 11, 9, 10]),
      hill: f([0, 5, 10, 15, 20, 25, 30]),
      dipThenClimb: f([30, 20, 10, 25]),
    };
    // A real run through the tracker: GPS fixes with a gentle, noisy climb.
    const T = MILES.Tracker;
    const home = MILES.State.data.profile.home;
    const feed = (alts) => {
      T.start({ kind: 'free' });
      T.pause();                                    // no simulated steps
      T.state.source = 'gps';
      T.state.elevation = 0;
      alts.forEach((alt, i) => T._push(MILES.Geo.offset(home, i * 12, 0), alt));
      return T.stop();
    };
    const rising = Array.from({ length: 40 }, (_, i) => 20 + i * 0.5 + (i % 2 ? 1 : -1));
    out.gps = feed(rising).elevation;
    out.noAlt = feed(Array.from({ length: 40 }, () => null)).elevation;
    out.flat = feed(Array.from({ length: 40 }, (_, i) => 20 + (i % 3) - 1)).elevation;
    return out;
  });
  ok('GPS jitter of a few metres is not a climb', climb.jitter === 0 && climb.flat === 0, JSON.stringify(climb));
  ok('a steady hill is its height', climb.hill === 30 && climb.dipThenClimb === 15, JSON.stringify(climb));
  ok('a real run climbs what its altitudes climbed', climb.gps >= 15 && climb.gps <= 22, climb.gps);
  ok('a phone that gives no altitude records the climb as unknown, not as flat', climb.noAlt === null, climb.noAlt);

  // --- 7. Picking a layout, from a picture of each -----------------------------
  await page.evaluate(() => { const a = MILES.State.data.activities.find((x) => x.kind === 'free' && x.distance > 10000); MILES.UI.showCardPreview(a); });
  await page.waitForTimeout(300);
  const picker = await page.evaluate(() => ({
    options: [...document.querySelectorAll('#cardTemplates .style-option')].map((b) => b.textContent.trim()),
    thumbs: [...document.querySelectorAll('#cardTemplates canvas')].map((c) => c.width),
    swatches: document.querySelectorAll('#cardThemes .style-swatch').length,
    splitsUnder: !!document.querySelector('#finishSplits .split'),
    oldControls: !!document.querySelector('#cardStats, #cardHighlights, #cardProfile'),
  }));
  ok('each layout is offered as a picture of the card in that layout',
    JSON.stringify(picker.options) === JSON.stringify(['Map', 'Poster', 'Sticker']) && picker.thumbs.every((w) => w > 0) && picker.thumbs.length === 3,
    JSON.stringify(picker));
  ok('the default colour and four others, as swatches', picker.swatches === 5, picker.swatches);
  ok('the splits are listed under the card, and nothing else is left to set', picker.splitsUnder && !picker.oldControls, JSON.stringify(picker));
  await page.click('#cardTemplates .style-option[data-layout="poster"]');
  await page.reload();
  await page.waitForTimeout(900);
  const kept = await page.evaluate(() => {
    const a = MILES.State.data.activities.find((x) => x.kind === 'free' && x.distance > 10000);
    MILES.UI.showCardPreview(a);
    return {
      design: JSON.stringify(MILES.State.data.cardDesign),
      drawn: document.querySelector('#cardCanvas').cardTemplate,
      pressed: document.querySelector('#cardTemplates [aria-pressed="true"]').dataset.layout,
    };
  });
  ok('the layout the runner picked is there after a reload',
    kept.design === '{"template":"poster"}' && kept.drawn === 'poster' && kept.pressed === 'poster', JSON.stringify(kept));
  // A card laid out under the old controls — a Splits layout, picked numbers,
  // highlight and elevation switches — opens as a Map card and keeps nothing else.
  await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('miles.v1'));
    saved.cardDesign = { template: 'splits', stats: ['speed'], highlights: true, profile: true };
    localStorage.setItem('miles.v1', JSON.stringify(saved));
  });
  await page.reload();
  await page.waitForTimeout(900);
  const migrated = await page.evaluate(() => JSON.stringify(MILES.State.data.cardDesign));
  ok('an old Splits layout comes back as Map, with the old switches gone', migrated === '{"template":"map"}', migrated);

  await browser.close();
  errors.forEach((e) => console.log(e));
  const failed = bad + errors.length;
  console.log(failed === 0 ? 'THE CARD HOLDS TOGETHER IN EVERY LAYOUT' : `${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
})();
