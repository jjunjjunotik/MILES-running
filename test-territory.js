// A territory run has exactly one ending: the loop closing. It must end by
// itself when the runner meets their own start, and there must be no way to
// finish one early with land in hand.
//   node test-territory.js
// Needs Playwright, which the app itself does not: `npm i playwright`, or run
// with NODE_PATH pointing at an install that has it.
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage({ viewport: { width: 430, height: 932 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  await page.goto('file://' + path.resolve(__dirname, 'index.html'));
  await page.waitForTimeout(400);

  let bad = 0;
  const ok = (label, cond) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}`); if (!cond) bad++; };
  const screen = () => page.evaluate(() => (document.querySelector('.screen[data-active="true"]') || {}).id);
  const startTerritory = async () => {
    await page.evaluate(() => MILES.UI.go('home'));
    await page.waitForTimeout(250);
    await page.click('#startSolo');
    await page.waitForTimeout(200);
    await page.click('.kind-option--territory');
    await page.waitForTimeout(400);
  };

  // 1. The run screen offers no way to finish, and says what it is waiting for.
  await startTerritory();
  const open = await page.evaluate(() => ({
    label: document.querySelector('#finishBtn').textContent,
    danger: document.querySelector('#finishBtn').classList.contains('btn--danger'),
    primary: document.querySelector('#finishBtn').classList.contains('btn--primary'),
    hint: document.querySelector('#loopHintText').textContent,
    hidden: document.querySelector('#loopHint').hidden,
  }));
  ok('no Finish button on an open loop', open.label === 'Abandon loop' && open.danger && !open.primary);
  ok('the banner counts down to a closable loop', !open.hidden && /before the loop can close/.test(open.hint));

  // 2. Pressing it asks first, and cancelling keeps the run alive.
  await page.click('#finishBtn');
  await page.waitForTimeout(350);
  ok('abandoning asks first', await page.evaluate(() => !document.querySelector('#askSheet').hidden));
  await page.evaluate(() => [...document.querySelectorAll('#askSheet .btn')].find((b) => b.textContent === 'Keep running').click());
  await page.waitForTimeout(350);
  ok('cancelling keeps the run going', await page.evaluate(() => MILES.Tracker.active) && (await screen()) === 'screen-run');

  // 3. Confirming keeps the kilometres and claims nothing. Run far enough
  // first that the result is a saved run rather than a discarded scrap.
  await page.waitForFunction(() => MILES.Tracker.state && MILES.Tracker.state.distance > 150, null, { timeout: 60000 });
  const landBefore = await page.evaluate(() => MILES.State.data.territories.length);
  await page.click('#finishBtn');
  await page.waitForTimeout(350);
  await page.evaluate(() => [...document.querySelectorAll('#askSheet .btn')].find((b) => b.textContent === 'Abandon').click());
  await page.waitForTimeout(600);
  const abandoned = await page.evaluate(() => ({
    a: MILES.UI.lastActivity,
    land: MILES.State.data.territories.length,
  }));
  ok('an abandoned loop is filed as an ordinary run', abandoned.a.kind === 'free' && !abandoned.a.loopClosed);
  ok('an abandoned loop keeps its distance', abandoned.a.distance > 60);
  ok('an abandoned loop claims no land', abandoned.land === landBefore);

  // 4. Meeting the start ends the run with no input at all.
  await startTerritory();
  await page.waitForFunction(() => !MILES.Tracker.active, null, { timeout: 120000 });
  await page.waitForTimeout(500);
  const closed = await page.evaluate(() => ({
    screen: (document.querySelector('.screen[data-active="true"]') || {}).id,
    a: MILES.UI.lastActivity,
    land: MILES.State.data.territories.length,
  }));
  ok('closing the loop ends the run by itself', closed.screen === 'screen-finish');
  ok('the closed loop is a territory capture', closed.a.kind === 'territory' && closed.a.loopClosed);
  ok('the closed loop claims land', closed.a.claimedArea > 0 && closed.land > landBefore);

  // 5. A free run still finishes on its own button.
  await page.evaluate(() => MILES.UI.go('home'));
  await page.waitForTimeout(250);
  await page.click('#startSolo');
  await page.waitForTimeout(200);
  await page.click('.kind-option--free');
  await page.waitForTimeout(2500);
  const free = await page.evaluate(() => ({
    label: document.querySelector('#finishBtn').textContent,
    primary: document.querySelector('#finishBtn').classList.contains('btn--primary'),
    hint: document.querySelector('#loopHint').hidden,
  }));
  ok('a free run still has a Finish button', free.label === 'Finish' && free.primary && free.hint);
  await page.click('#finishBtn');
  await page.waitForTimeout(500);
  ok('a free run finishes on one press', (await screen()) === 'screen-finish');

  console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
  console.log(bad === 0 ? 'ALL PASS' : `${bad} FAILURES`);
  await browser.close();
  process.exit(bad === 0 && errors.length === 0 ? 0 : 1);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
