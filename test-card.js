// The record card the runner lays out. Checked here: every layout draws for
// every kind of run with nothing on the card landing on anything else, however
// the switches are set; the splits fit their room however many there are; the
// numbers on offer are ones the run actually has; the highlights are true; the
// sticker is see-through; the climb comes from altitude rather than from thin
// air; and the runner's layout is still there next time.
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

  // --- 1. Every layout, every kind, every switch ---------------------------
  const sweep = await page.evaluate(`(async () => {
    const check = ${CHECK};
    const S = MILES.State.data;
    const runs = [
      S.activities.find((a) => a.kind === 'free' && a.distance > 10000),
      S.activities.find((a) => a.kind === 'territory' && a.claimedArea > 0),
      S.activities.find((a) => a.kind === 'race'),
    ];
    const problems = [];
    let drawn = 0;
    for (const a of runs) {
      const lines = ['Longest run of September', 'Fastest km 5:18'];
      for (const t of MILES.cardTemplatesFor(a)) {
        for (const highlights of [[], lines]) {
          for (const profile of [false, true]) {
            for (const stats of [['time'], ['time', 'pace'], ['time', 'pace', 'elev'], ['speed', 'fastest', 'distance']]) {
              const r = check(a, { template: t, highlights, profile, stats, athlete: 'You', rank: 'Strider', totalArea: 720000 });
              drawn++;
              if (r.template !== t) problems.push(a.kind + '/' + t + ' drew ' + r.template);
              r.bad.forEach((b) => problems.push(a.kind + '/' + t + (highlights.length ? '+hl' : '') + (profile ? '+elev' : '') + ' ' + stats.join(',') + ': ' + b));
            }
          }
        }
      }
    }
    return { problems, drawn };
  })()`);
  ok(`${sweep.drawn} cards across every layout, kind and switch: nothing lands on anything`,
    sweep.drawn > 100 && sweep.problems.length === 0, sweep.problems.slice(0, 6).join(' | '));

  // --- 2. The splits fit their room, however many there are ----------------
  const splits = await page.evaluate(`(async () => {
    const check = ${CHECK};
    const base = MILES.State.data.activities.find((a) => a.kind === 'free' && a.distance > 10000);
    const out = [];
    for (const n of [2, 5, 9, 12, 21, 42]) {
      const a = Object.assign({}, base, {
        distance: n * 1000 + 300, duration: n * 330,
        splits: Array.from({ length: n }, (_, i) => ({ km: i + 1, seconds: 300 + ((i * 37) % 41) })),
      });
      for (const highlights of [[], ['Longest run yet', 'Negative split']]) {
        for (const profile of [false, true]) {
          const r = check(a, { template: 'splits', highlights, profile, stats: ['time', 'pace', 'elev'] });
          const times = r.layout.filter((b) => b.name === 'split-time');
          out.push({
            n, hl: highlights.length > 0, profile, bad: r.bad,
            mode: r.names.includes('split-chart') ? 'columns' : 'rows',
            rows: times.length,
            smallest: times.length ? Math.min.apply(null, times.map((b) => b.h)) : null,
          });
        }
      }
    }
    return out;
  })()`);
  ok('2 to 42 splits, with and without highlights and the elevation line: nothing overlaps',
    splits.every((s) => s.bad.length === 0), JSON.stringify(splits.filter((s) => s.bad.length).map((s) => [s.n, s.hl, s.profile, s.bad[0]])));
  ok('as rows, every split is on the card and its time is at least 20px tall',
    splits.filter((s) => s.mode === 'rows').every((s) => s.rows === s.n && s.smallest >= 20),
    JSON.stringify(splits.filter((s) => s.mode === 'rows').map((s) => [s.n, s.rows, s.smallest])));
  ok('a long run switches to columns instead of squeezing rows',
    splits.filter((s) => s.n >= 21).every((s) => s.mode === 'columns'), JSON.stringify(splits.map((s) => [s.n, s.mode])));

  // --- 3. The numbers on offer are ones the run has -------------------------
  const offers = await page.evaluate(() => {
    const S = MILES.State.data;
    const free = S.activities.find((a) => a.kind === 'free' && a.distance > 10000);
    const terr = S.activities.find((a) => a.kind === 'territory' && a.claimedArea > 0);
    const keys = (a) => MILES.cardStatsFor(a).map((s) => s.key);
    return {
      free: keys(free),
      terr: keys(terr),
      noAlt: keys(Object.assign({}, free, { elevation: null })),
      noSplits: keys(Object.assign({}, free, { splits: [] })),
      refill: MILES.cardPickStats(free, ['distance', 'time']),
      cap: MILES.cardPickStats(free, ['time', 'pace', 'elev', 'speed']),
      layouts: MILES.cardTemplatesFor(Object.assign({}, free, { splits: [] })),
    };
  });
  ok('a free run does not offer its distance twice', !offers.free.includes('distance'), JSON.stringify(offers.free));
  ok('a territory card, whose headline is area, offers the distance', offers.terr.includes('distance'), JSON.stringify(offers.terr));
  ok('no altitude, no climb on offer', !offers.noAlt.includes('elev'), JSON.stringify(offers.noAlt));
  ok('no splits, no fastest km and no Splits layout',
    !offers.noSplits.includes('fastest') && !offers.layouts.includes('splits'), JSON.stringify([offers.noSplits, offers.layouts]));
  ok('a pick the run cannot show is refilled, keeping the count', JSON.stringify(offers.refill) === JSON.stringify(['time', 'pace']), JSON.stringify(offers.refill));
  ok('never more than three numbers', offers.cap.length === 3, JSON.stringify(offers.cap));

  // --- 4. The highlights are true -------------------------------------------
  const truth = await page.evaluate(() => {
    const day = (d, h) => new Date(2026, 8, d, h || 7).getTime();
    const run = (id, d, km, secPerKm, extra) => Object.assign({
      id, startedAt: day(d), kind: 'free', distance: km * 1000, duration: km * secPerKm, elevation: 20, splits: [],
    }, extra || {});
    const a = run('a', 3, 5, 330);
    const b = run('b', 10, 8, 340);
    const c = run('c', 20, 6, 320);
    const d = run('d', 25, 10, 345);
    const state = { activities: [d, c, b, a] };
    const H = (x) => MILES.Stats.highlights(state, x);
    const neg = run('n', 26, 4, 300, { splits: [{ km: 1, seconds: 310 }, { km: 2, seconds: 305 }, { km: 3, seconds: 296 }, { km: 4, seconds: 289 }] });
    const pos = run('p', 26, 4, 300, { splits: [{ km: 1, seconds: 289 }, { km: 2, seconds: 296 }, { km: 3, seconds: 305 }, { km: 4, seconds: 310 }] });
    const streak = { activities: [run('s1', 12, 5, 330), run('s2', 13, 5, 330), run('s3', 14, 5, 330)] };
    return {
      b: H(b), c: H(c), d: H(d),
      neg: MILES.Stats.highlights({ activities: [neg] }, neg),
      pos: MILES.Stats.highlights({ activities: [pos] }, pos),
      streak: MILES.Stats.highlights(streak, streak.activities[2]),
    };
  });
  ok('the longest of the month so far says so', truth.b.includes('Longest run of September'), JSON.stringify(truth.b));
  ok('a shorter run does not claim to be the longest', !truth.c.some((l) => /Longest/.test(l)), JSON.stringify(truth.c));
  ok('the longest of all, with a history behind it, is "Longest run yet"', truth.d[0] === 'Longest run yet', JSON.stringify(truth.d));
  ok('a quicker second half is a negative split', truth.neg.includes('Negative split'), JSON.stringify(truth.neg));
  ok('a slower second half is not', !truth.pos.includes('Negative split'), JSON.stringify(truth.pos));
  ok('three days running is a 3-day streak', truth.streak.includes('3-day streak'), JSON.stringify(truth.streak));

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

  // --- 7. The layout sticks, and a long split list folds -----------------------
  await page.evaluate(() => { const a = MILES.State.data.activities.find((x) => x.kind === 'free' && x.distance > 10000); MILES.UI.showCardPreview(a); });
  await page.waitForTimeout(300);
  const folded = await page.evaluate(() => ({
    rows: document.querySelectorAll('#finishSplits .split').length,
    button: !!document.querySelector('#finishSplits button'),
  }));
  ok('twelve splits open folded to five, with a way to the rest', folded.rows === 5 && folded.button, JSON.stringify(folded));
  await page.click('#finishSplits button');
  ok('and show all twelve on a tap', await page.evaluate(() => document.querySelectorAll('#finishSplits .split').length === 12));
  await page.click('#cardTemplates button:nth-child(2)');
  await page.click('#cardStats button:nth-child(4)');
  await page.click('#cardHighlights');
  const chosen = await page.evaluate(() => JSON.stringify(MILES.State.data.cardDesign));
  await page.reload();
  await page.waitForTimeout(900);
  const kept = await page.evaluate(() => {
    const a = MILES.State.data.activities.find((x) => x.kind === 'free' && x.distance > 10000);
    MILES.UI.showCardPreview(a);
    return {
      design: JSON.stringify(MILES.State.data.cardDesign),
      drawn: document.querySelector('#cardCanvas').cardTemplate,
      pressed: [...document.querySelectorAll('#cardStats [aria-pressed="true"]')].map((b) => b.textContent),
    };
  });
  ok('the layout, numbers and switches the runner chose survive a reload', kept.design === chosen && kept.drawn === 'poster',
    `${chosen} → ${kept.design}, drew ${kept.drawn}`);
  ok('picking a fourth number lets go of the oldest', JSON.stringify(kept.pressed) === JSON.stringify(['Pace', 'Elevation gain', 'Avg speed']),
    JSON.stringify(kept.pressed));

  await browser.close();
  errors.forEach((e) => console.log(e));
  const failed = bad + errors.length;
  console.log(failed === 0 ? 'THE CARD IS THE RUNNER\'S, AND NOTHING ON IT COLLIDES' : `${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
})();
