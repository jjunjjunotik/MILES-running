// Crew missions: three of them, scaled by headcount alone, and reachable.
//   node test-mission.js
// Needs Playwright, which the app itself does not: `npm i playwright`, or run
// with NODE_PATH pointing at an install that has it.
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage({ viewport: { width: 430, height: 932 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('CONSOLE: ' + m.text());
  });
  await page.goto('file://' + path.resolve(__dirname, 'index.html'));
  await page.waitForTimeout(800);

  let bad = 0;
  const ok = (label, cond, extra) => {
    console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${!cond && extra !== undefined ? '  → ' + extra : ''}`);
    if (!cond) bad++;
  };

  // --- 1. Three, and the three that matter -------------------------------
  const keys = await page.evaluate(() => Object.keys(MILES.Crew.MISSIONS));
  ok('there are exactly three missions', keys.length === 3, JSON.stringify(keys));
  ok('they are distance, claimed and taken',
    ['distance', 'claimed', 'taken'].every((k) => keys.includes(k)), JSON.stringify(keys));
  ok('nothing sets a difficulty by hand', await page.evaluate(() => MILES.Crew.SIZES === undefined));

  // --- 2. Headcount is the difficulty ------------------------------------
  const scale = await page.evaluate(() => {
    const opts = (n) => MILES.Crew.missionOptions({
      members: Array.from({ length: n }, (_, i) => ({ id: 'm' + i })), memberIds: [],
    });
    const one = opts(1);
    const twelve = opts(12);
    return {
      count: one.length,
      ratios: one.map((o, i) => twelve[i].target / o.target),
      heads: twelve[0].heads,
      sameXp: one.every((o, i) => o.xp === twelve[i].xp),
    };
  });
  ok('the picker offers three options', scale.count === 3, scale.count);
  ok('twelve members is twelve times the ask',
    scale.ratios.every((r) => Math.abs(r - 12) < 0.01), JSON.stringify(scale.ratios));
  ok('the option records the crew it was priced for', scale.heads === 12, scale.heads);
  ok('a bigger crew is not worth more XP per clear', scale.sameXp);

  // --- 3. "Taken" is measured, and measured once -------------------------
  // A stranger holds a 400 m square. Two crew members each cut an overlapping
  // slab out of it; between them they take all of it, and exactly once.
  const taken = await page.evaluate(() => {
    const G = MILES.Geo;
    const home = MILES.State.data.profile.home;
    const box = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([x, y]) => G.offset(home, x, y));
    const victim = { owner: 'stranger', claimedAt: 1000, polygon: box(0, 0, 400, 400) };
    const mate = { owner: 'mate', claimedAt: 2000, polygon: box(-50, -50, 260, 450) };
    const me = { owner: 'me', claimedAt: 3000, polygon: box(140, -50, 450, 450) };
    const st = { territories: [], rivalLand: [victim, mate, me], profile: { home } };
    const crew = { members: [{ id: 'mate' }, { id: 'me' }], memberIds: ['me'] };
    return {
      victim: G.polygonArea(victim.polygon),
      both: MILES.Crew.takenSince(st, crew, 0),
      mateOnly: MILES.Crew.takenSince(st, { members: [{ id: 'mate' }], memberIds: [] }, 0),
      sinceLate: MILES.Crew.takenSince(st, crew, 2500),
      strangersOwn: MILES.Crew.takenSince(st, { members: [{ id: 'stranger' }], memberIds: [] }, 0),
    };
  });
  const near = (a, b) => Math.abs(a - b) <= Math.max(400, b * 0.02);
  ok('overlapping claims are not counted twice', near(taken.both, taken.victim),
    `${Math.round(taken.both)} vs ${Math.round(taken.victim)}`);
  ok('the first there gets the ground', near(taken.mateOnly, taken.victim * 0.65),
    Math.round(taken.mateOnly));
  ok('a week filter counts only that week\'s cuts', near(taken.sinceLate, taken.victim * 0.35),
    Math.round(taken.sinceLate));
  ok('taking from yourself is not taking', taken.strangersOwn === 0, taken.strangersOwn);

  // --- 4. The picker actually opens --------------------------------------
  // It used to fill the sheet's body without showing the sheet, so from the
  // crew screen the button did nothing at all.
  await page.evaluate(() => {
    MILES.State.crewAction((st) => MILES.Crew.create(st, {
      name: 'Night Owls', tagline: 'Quiet streets', days: ['Tue'], time: '18:30', spot: 'Gate', openJoin: true,
    }));
    MILES.State.save();
    MILES.UI.go('crew');
  });
  await page.waitForTimeout(600);
  await page.evaluate(() => [...document.querySelectorAll('#myCrew button')]
    .find((b) => /Set this week/.test(b.textContent)).click());
  await page.waitForTimeout(400);
  const picker = await page.evaluate(() => ({
    open: !document.querySelector('#crewSheet').hidden,
    options: document.querySelectorAll('#crewSheetBody .mission-option').length,
    names: [...document.querySelectorAll('#crewSheetBody .mission-option')].map((b) => b.textContent.slice(0, 22)),
  }));
  ok('the picker opens from the crew screen', picker.open);
  ok('and shows the three', picker.options === 3, JSON.stringify(picker.names));

  // Choosing one sets it, and the block reports it.
  await page.evaluate(() => document.querySelectorAll('#crewSheetBody .mission-option')[2].click());
  await page.waitForTimeout(500);
  const set = await page.evaluate(() => {
    const crew = MILES.Crew.mine(MILES.State.data);
    const status = MILES.Crew.missionStatus(MILES.State.data, crew);
    return { type: crew.mission.type, target: crew.mission.target, heads: crew.mission.heads, stale: status.stale, def: !!status.def };
  });
  ok('picking one sets it', !!set.type && !set.stale && set.def, JSON.stringify(set));
  ok('its target is the crew\'s size priced in', set.target > 0 && set.heads >= 1, JSON.stringify(set));

  // --- 5. A retired mission does not leave a dead bar --------------------
  const retired = await page.evaluate(() => {
    const crew = MILES.Crew.mine(MILES.State.data);
    crew.mission = { week: MILES.Crew.weekKey(), type: 'turnout', target: 4, xp: 300, completedAt: null };
    const status = MILES.Crew.missionStatus(MILES.State.data, crew);
    return { stale: status.stale, hasDef: !!status.def };
  });
  ok('a mission that no longer exists reads as stale', retired.stale && !retired.hasDef,
    JSON.stringify(retired));

  console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
  console.log(bad === 0 ? 'ALL PASS' : `${bad} FAILURES`);
  await browser.close();
  process.exit(bad === 0 && errors.length === 0 ? 0 : 1);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
