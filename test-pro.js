// The paid tier. Two things have to hold: the entitlement boundary is where it
// says it is, and the numbers Pro sells are right — attribution that double
// counts, or a time machine that quietly rewrites the live map, would be worse
// than not shipping the feature.
//   node test-pro.js
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
  await page.waitForTimeout(700);

  let bad = 0;
  const ok = (label, cond, extra) => {
    console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${!cond && extra !== undefined ? '  → ' + extra : ''}`);
    if (!cond) bad++;
  };

  // --- 1. Attribution, against squares whose answer is arithmetic ----------
  // Mine is a 300 m square (90,000 m²). One rival takes the right half
  // (45,000), a second then takes the bottom-left quarter of what is left
  // (22,500), leaving 22,500. Overlapping ground is credited once, to whoever
  // reached it first, so the two must sum to exactly what was lost.
  const exact = await page.evaluate(() => {
    const G = MILES.Geo;
    const home = MILES.State.data.profile.home;
    const box = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([x, y]) => G.offset(home, x, y));
    const mine = { owner: 'me', claimedAt: 1000, polygon: box(0, 0, 300, 300) };
    const a = { owner: 'a', ownerName: 'A', claimedAt: 2000, polygon: box(150, -50, 450, 350) };
    const b = { owner: 'b', ownerName: 'B', claimedAt: 3000, polygon: box(-50, -50, 300, 150) };
    const rows = MILES.Land.raiders(mine, [mine, a, b], home);
    const held = [mine, a, b].map((c) => Object.assign({}, c));
    MILES.Land.resolve(held, home);
    return {
      rows: rows.map((r) => ({ owner: r.owner, area: Math.round(r.area) })),
      mineHeld: Math.round(held[0].area),
      polygonArea: Math.round(G.polygonArea(mine.polygon)),
    };
  });
  const near = (got, want, tol) => Math.abs(got - want) <= (tol === undefined ? want * 0.02 : tol);
  const byOwner = Object.fromEntries(exact.rows.map((r) => [r.owner, r.area]));
  ok('the square starts at 90,000 m²', near(exact.polygonArea, 90000), exact.polygonArea);
  ok('the first rival is credited the half it took', near(byOwner.a, 45000), byOwner.a);
  ok('the second is credited only what was still there', near(byOwner.b, 22500), byOwner.b);
  ok('attribution equals what was actually lost',
    near((byOwner.a || 0) + (byOwner.b || 0), exact.polygonArea - exact.mineHeld, 800),
    `${(byOwner.a || 0) + (byOwner.b || 0)} vs ${exact.polygonArea - exact.mineHeld}`);

  // --- 2. The same invariant on the real seeded world ----------------------
  const live = await page.evaluate(() => {
    const s = MILES.State.data, G = MILES.Geo;
    const claimed = s.territories.reduce((a, t) => a + G.polygonArea(t.polygon), 0);
    const held = s.territories.reduce((a, t) => a + t.area, 0);
    const raiders = MILES.Pro.raiders(s);
    return {
      lost: claimed - held,
      attributed: raiders.reduce((a, r) => a + r.area, 0),
      raiders: raiders.map((r) => ({ name: r.name, km2: +(r.area / 1e6).toFixed(3) })),
      selfCounted: raiders.some((r) => r.owner === 'me'),
    };
  });
  ok('attribution never exceeds the ground actually lost', live.attributed <= live.lost + 1,
    `${Math.round(live.attributed)} vs ${Math.round(live.lost)}`);
  ok('your own later loops are not raids', !live.selfCounted);
  ok('the map you open ships with a real contest on it',
    live.raiders.length > 0 && live.attributed > 1000, JSON.stringify(live.raiders));

  // --- 3. The time machine reconstructs without disturbing the present -----
  const tm = await page.evaluate(() => {
    const s = MILES.State.data;
    const from = MILES.Pro.firstClaimAt(s);
    const now = Date.now();
    const snap = (t) => MILES.Pro.mapAt(s, t).length;
    const before = JSON.stringify(s.territories.map((t) => [t.id, Math.round(t.area)]));
    const counts = [0, 0.25, 0.5, 0.75, 1].map((f) => snap(from + (now - from) * f));
    return {
      counts,
      mutated: JSON.stringify(s.territories.map((t) => [t.id, Math.round(t.area)])) !== before,
      liveCount: s.territories.length + s.rivalLand.length,
      heldThen: Math.round(MILES.Pro.heldAt(s, from + (now - from) * 0.1)),
      heldNow: Math.round(MILES.Pro.heldAt(s, now)),
    };
  });
  ok('the past has fewer claims than the present', tm.counts[0] < tm.counts[4], JSON.stringify(tm.counts));
  ok('claims only ever accumulate as time runs forward',
    tm.counts.every((c, i) => i === 0 || c >= tm.counts[i - 1]), JSON.stringify(tm.counts));
  ok('the present reconstructs to the whole live map', tm.counts[4] === tm.liveCount,
    `${tm.counts[4]} vs ${tm.liveCount}`);
  ok('reconstructing the past does not touch the live map', !tm.mutated);
  ok('you held less land early on than you do now', tm.heldThen < tm.heldNow, `${tm.heldThen} vs ${tm.heldNow}`);

  // --- 4. The entitlement boundary ----------------------------------------
  await page.evaluate(() => MILES.UI.go('territory'));
  await page.waitForTimeout(500);
  const locked = await page.evaluate(() => ({
    pro: MILES.Pro.active(),
    tm: !document.querySelector('#tmLocked').hidden,
    panel: !document.querySelector('#tmPanel').hidden,
    rows: document.querySelectorAll('#raidList .raid-row').length,
    tease: document.querySelector('#raidTease').textContent,
  }));
  ok('free opens locked', !locked.pro && locked.tm && !locked.panel && locked.rows === 0);
  ok('the free tease states the fact without the breakdown',
    /has been taken/.test(locked.tease), locked.tease);

  await page.click('#tmUnlock');
  await page.waitForTimeout(350);
  ok('the offer opens', await page.evaluate(() => !document.querySelector('#proSheet').hidden));
  await page.click('#proPrimary');
  await page.waitForTimeout(500);
  const unlocked = await page.evaluate(() => ({
    pro: MILES.Pro.active(),
    trial: MILES.Pro.verify(MILES.State.data).trial,
    panel: !document.querySelector('#tmPanel').hidden,
    rows: document.querySelectorAll('#raidList .raid-row').length,
    again: MILES.Pro.trialAvailable(),
  }));
  ok('the trial unlocks both features', unlocked.pro && unlocked.trial && unlocked.panel && unlocked.rows > 0,
    JSON.stringify(unlocked));
  ok('the trial is offered only once', !unlocked.again);

  // Scrubbing, then leaving the tab, must not strand the map in the past.
  await page.evaluate(() => {
    const s = document.querySelector('#tmScrub');
    s.value = 300;
    s.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(400);
  ok('scrubbing shows the past', await page.evaluate(() => !!MILES.UI.scrubAt));
  await page.evaluate(() => MILES.UI.go('home'));
  await page.waitForTimeout(300);
  ok('leaving the tab returns the map to the present',
    await page.evaluate(() => !MILES.UI.scrubAt));

  // An expired trial locks again, and loses nothing.
  const expired = await page.evaluate(() => {
    const s = MILES.State.data;
    const landBefore = s.territories.length;
    s.pro.trialEndsAt = Date.now() - 1000;
    MILES.UI.go('territory');
    return { pro: MILES.Pro.active(), landAfter: s.territories.length, landBefore };
  });
  await page.waitForTimeout(400);
  ok('an expired trial locks again', !expired.pro);
  ok('and takes none of your land with it', expired.landAfter === expired.landBefore);
  ok('the locked panel comes back',
    await page.evaluate(() => document.querySelector('#tmPanel').hidden && !document.querySelector('#tmLocked').hidden));

  // --- 5. Two tiers, and a ladder between them ----------------------------
  const tiers = await page.evaluate(() => {
    const S = MILES.State.data, P = MILES.Pro;
    const caps = () => Object.keys(P.FEATURES).filter((f) => P.can(f));
    P.cancel(S);
    const free = { tier: P.tier(), caps: caps(), rivals: P.maxRivals() };
    P.subscribe(S, 'supporter_monthly');
    const sup = { tier: P.tier(), caps: caps(), rivals: P.maxRivals() };
    P.subscribe(S, 'pro_yearly');
    const pro = { tier: P.tier(), caps: caps(), rivals: P.maxRivals() };
    return { free, sup, pro, plans: Object.keys(P.PLANS) };
  });
  ok('there are two paid tiers, each monthly or yearly', tiers.plans.length === 4, JSON.stringify(tiers.plans));
  ok('free buys no capability', tiers.free.caps.length === 0, JSON.stringify(tiers.free.caps));
  ok('Supporter buys expression only',
    tiers.sup.caps.length === 2 && tiers.sup.caps.every((c) => ['plotStyle', 'cardThemes'].includes(c)),
    JSON.stringify(tiers.sup.caps));
  ok('Pro contains everything Supporter has',
    tiers.sup.caps.every((c) => tiers.pro.caps.includes(c)) && tiers.pro.caps.length > tiers.sup.caps.length,
    JSON.stringify(tiers.pro.caps));
  ok('no tier buys a bigger claim, a longer hold, or faster XP',
    !Object.keys(await page.evaluate(() => MILES.Pro.FEATURES))
      .some((f) => /claim|hold|xp|rank|defen|protect|boost/i.test(f)));
  ok('only the host pays for a wider race field',
    tiers.free.rivals === 4 && tiers.sup.rivals === 4 && tiers.pro.rivals === 16,
    `${tiers.free.rivals}/${tiers.sup.rivals}/${tiers.pro.rivals}`);

  // --- 6. Scout points at ground that is genuinely empty -------------------
  await page.evaluate(() => MILES.UI.go('territory'));
  await page.waitForTimeout(600);
  const scout = await page.evaluate(() => {
    const m = MILES.UI.maps.territory;
    const found = MILES.Pro.scout(MILES.State.data, m.bounds(), m.layers.territories);
    if (!found) return null;
    // Checked against the claims themselves, not against the sampler that
    // found it — a sampled maximum that overlaps a claim would be a lie.
    let nearest = Infinity;
    m.layers.territories.forEach((t) => {
      const ring = (t.pieces && t.pieces.length ? t.pieces[0].ring : t.polygon) || [];
      ring.forEach((pt) => {
        const d = MILES.Geo.distance(found.centre, pt);
        if (d < nearest) nearest = d;
      });
    });
    return { radius: found.radius, nearest };
  });
  ok('scout finds open ground', scout && scout.radius >= 120, JSON.stringify(scout));
  ok('the ground it finds is actually unclaimed', scout && scout.nearest >= scout.radius - 1,
    scout && `radius ${Math.round(scout.radius)} vs nearest claim ${Math.round(scout.nearest)}`);

  // --- 7. The offer is reachable, and leads with the right tier ------------
  await page.evaluate(() => { MILES.Pro.cancel(MILES.State.data); MILES.State.save(); MILES.UI.go('profile'); });
  await page.waitForTimeout(400);
  ok('the You screen has a Pro card above the fold',
    await page.evaluate(() => {
      const c = document.querySelector('#proCard');
      if (!c) return false;
      const screen = document.querySelector('#screen-profile');
      return c.getBoundingClientRect().top - screen.getBoundingClientRect().top < screen.clientHeight;
    }));
  await page.click('#proCard');
  await page.waitForTimeout(300);
  ok('the card opens the offer', await page.evaluate(() => !document.querySelector('#proSheet').hidden));
  await page.click('#proLater');
  await page.waitForTimeout(200);

  const leads = await page.evaluate(async () => {
    const out = {};
    for (const f of ['cardThemes', 'timeMachine', 'plotStyle', 'crewCreate']) {
      MILES.UI.openPro(f);
      out[f] = document.querySelector('#proTiers button[aria-pressed="true"]').dataset.tier;
      MILES.UI.closeSheet('#proSheet');
    }
    return out;
  });
  ok('a cosmetic lock offers Supporter, not analysis',
    leads.cardThemes === 'supporter' && leads.plotStyle === 'supporter', JSON.stringify(leads));
  ok('an analysis lock offers Pro', leads.timeMachine === 'pro' && leads.crewCreate === 'pro',
    JSON.stringify(leads));

  // --- 8. Everything the offer advertises actually exists ------------------
  const advertised = await page.evaluate(() => {
    const U = MILES.UI, P = MILES.Pro;
    return {
      benefits: P.BENEFITS.supporter.length + P.BENEFITS.pro.length,
      // Each headline benefit maps to something that runs.
      hasPlotStyle: typeof U.openPlotStyle === 'function',
      hasThemes: !!MILES.CARD_THEMES && Object.keys(MILES.CARD_THEMES).length >= 4,
      hasScout: typeof P.scout === 'function',
      hasTimeMachine: typeof P.mapAt === 'function',
      hasRaiders: typeof P.raiders === 'function',
      hasBigRaces: P.MAX_RIVALS_PRO > P.MAX_RIVALS_FREE,
      hasMapStyles: Object.keys(MILES.Tiles.SOURCES).length >= 4,
    };
  });
  ok('the offer lists eight benefits', advertised.benefits === 8, advertised.benefits);
  Object.keys(advertised).filter((k) => k.startsWith('has')).forEach((k) => {
    ok(`${k.replace('has', '')} is implemented, not just advertised`, advertised[k]);
  });

  console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
  console.log(bad === 0 ? 'ALL PASS' : `${bad} FAILURES`);
  await browser.close();
  process.exit(bad === 0 && errors.length === 0 ? 0 : 1);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
