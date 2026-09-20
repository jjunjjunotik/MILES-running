// Ranking up is the one thing in the app worth interrupting for, so it has to
// fire exactly once, for the right reason, and never for a reason the runner
// did not earn.
//   node test-rank.js
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
  await page.evaluate(() => { try { localStorage.removeItem('miles.v1'); } catch (e) { /* ignore */ } });
  await page.reload();
  await page.waitForTimeout(1000);

  let bad = 0;
  const ok = (label, cond, extra) => {
    console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${!cond && extra !== undefined ? '  → ' + extra : ''}`);
    if (!cond) bad++;
  };

  // --- 1. A fresh app owes you nothing ------------------------------------
  // The seeded weeks already carry several ranks' worth of XP, none of it just
  // earned. Announcing that on the first finished run would be a lie.
  const fresh = await page.evaluate(() => ({
    rank: MILES.Stats.rank(MILES.State.data).current.key,
    seen: MILES.State.data.rankSeen,
    claim: MILES.State.claimRankUp(),
  }));
  ok('a fresh save starts from the rank it is already at', fresh.seen === fresh.rank,
    `${fresh.seen} vs ${fresh.rank}`);
  ok('and owes no promotion', fresh.claim === null, JSON.stringify(fresh.claim));

  // An upgrade from a version without the field must behave the same way.
  const migrated = await page.evaluate(() => {
    const s = MILES.State.data;
    delete s.rankSeen;
    MILES.State.save();
    // Re-run the migration the way a reload would.
    if (!s.rankSeen) s.rankSeen = MILES.Stats.rank(s).current.key;
    return { seen: s.rankSeen, claim: MILES.State.claimRankUp() };
  });
  ok('upgrading the app does not fake a promotion', migrated.claim === null, JSON.stringify(migrated.claim));

  // --- 2. Earning one, for real -------------------------------------------
  const before = await page.evaluate(() => ({
    xp: MILES.Stats.xp(MILES.State.data),
    rank: MILES.Stats.rank(MILES.State.data).current.name,
    next: MILES.Stats.rank(MILES.State.data).next.xp,
    loops: MILES.State.data.territories.length,
  }));

  // A territory run closes the third loop, which completes Loop Hunter and
  // carries the XP across the next rank. No numbers are poked to make it.
  await page.click('#startSolo');
  await page.waitForTimeout(250);
  await page.click('.kind-option--territory');
  await page.waitForFunction(() => !MILES.Tracker.active, null, { timeout: 120000 });
  await page.waitForTimeout(1600);

  const after = await page.evaluate(() => ({
    xp: MILES.Stats.xp(MILES.State.data),
    rank: MILES.Stats.rank(MILES.State.data).current.name,
    rankKey: MILES.Stats.rank(MILES.State.data).current.key,
    seen: MILES.State.data.rankSeen,
    shown: !document.querySelector('#rankUp').hidden,
    name: document.querySelector('#rankUpName').textContent,
    from: document.querySelector('#rankUpFrom').textContent,
    line: document.querySelector('#rankUpLine').textContent,
    letter: document.querySelector('#rankUpLetter').textContent,
    behind: (document.querySelector('.screen[data-active="true"]') || {}).id,
  }));
  ok('a real run carried the XP over the line', after.xp > before.xp && after.xp >= before.next,
    `${before.xp} -> ${after.xp}, needed ${before.next}`);
  ok('the promotion is announced', after.shown);
  ok('it names the rank just reached', after.name === after.rank, `${after.name} vs ${after.rank}`);
  ok('it names where you came from', after.from === before.rank, `${after.from} vs ${before.rank}`);
  ok('it says something about the running', after.line.length > 10, after.line);
  ok('it carries the rank badge', after.letter.length === 1, after.letter);
  ok('it lands on the card that earned it', after.behind === 'screen-finish', after.behind);
  ok('and is recorded as already told', after.seen === after.rankKey,
    `${after.seen} vs ${after.rankKey}`);

  // --- 3. Once, and only once ---------------------------------------------
  await page.click('#rankUpDone');
  await page.waitForTimeout(300);
  ok('dismissing returns you to the card',
    await page.evaluate(() => document.querySelector('#rankUp').hidden
      && document.querySelector('.screen[data-active="true"]').id === 'screen-finish'));
  ok('the same promotion never fires twice',
    await page.evaluate(() => MILES.State.claimRankUp()) === null);
  await page.reload();
  await page.waitForTimeout(900);
  ok('and reloading the app does not re-announce it',
    await page.evaluate(() => MILES.State.claimRankUp()) === null);

  // --- 4. Two ranks in one go say so --------------------------------------
  const jump = await page.evaluate(() => {
    const s = MILES.State.data;
    s.rankSeen = MILES.RANKS[0].key;
    MILES.QUESTS.forEach((q) => { s.questClaims[q.id] = 1; });
    const up = MILES.State.claimRankUp();
    MILES.UI.celebrateRank(up);
    return { skipped: up && up.skipped, eyebrow: document.querySelector('#rankUpEyebrow').textContent };
  });
  ok('skipping ranks is stated, not hidden', jump.skipped > 0 && /at once/.test(jump.eyebrow),
    JSON.stringify(jump));

  // --- 5. Notifications are optional, and their absence is explained ------
  const alerts = await page.evaluate(() => {
    MILES.UI.go('profile');
    MILES.UI.renderAlerts();
    return {
      status: document.querySelector('#alertStatus').textContent,
      label: document.querySelector('#alertBtn').textContent,
      canNotify: MILES.UI.canNotify(),
    };
  });
  ok('the alerts row explains its state', alerts.status.length > 2, JSON.stringify(alerts));
  // Whatever the browser allows, the on-screen celebration is what carries it.
  ok('a blocked notification never blocks the celebration',
    await page.evaluate(() => {
      // The previous block left the overlay open; close it so "it opened" is
      // something this check actually establishes.
      document.querySelector('#rankUp').hidden = true;
      const before = document.querySelector('#rankUp').hidden;
      // Make the API throw the way a sandboxed frame does.
      const real = window.Notification;
      window.Notification = function () { throw new Error('blocked'); };
      window.Notification.permission = 'granted';
      MILES.UI.celebrateRank({ from: MILES.RANKS[0], to: MILES.RANKS[1], skipped: 0 });
      const shown = !document.querySelector('#rankUp').hidden;
      window.Notification = real;
      return before && shown;
    }));

  console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
  console.log(bad === 0 ? 'ALL PASS' : `${bad} FAILURES`);
  await browser.close();
  process.exit(bad === 0 && errors.length === 0 ? 0 : 1);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
