// Every confirmation and text entry must work where window.confirm and
// window.prompt do not — a sandboxed iframe. Serve on :8765, then:
//   node test-dialogs.js
// Needs Playwright, which the app itself does not: `npm i playwright`, or run
// with NODE_PATH pointing at an install that has it.
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  await page.goto('http://localhost:8765/index.html', { waitUntil: 'networkidle' });
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  const shot = (n) => page.screenshot({ path: `${process.env.SP || '.'}/nm-${n}.png` });

  // Reproduce the sandbox exactly: modals blocked, silently.
  await page.evaluate(() => { window.confirm = () => false; window.prompt = () => null; });
  let bad = 0;
  const ok = (label, cond) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}`); if (!cond) bad++; };

  // Set up a crew with members.
  await page.evaluate(() => {
    const S = MILES.State, C = MILES.Crew;
    S.crewAction((st) => C.create(st, { name: 'Night Owls', tagline: 'Quiet streets', days: ['Tue','Thu'], time: '18:30', spot: 'Gate', openJoin: true }));
    const crew = C.mine(S.data);
    crew.requests.slice(0, 2).forEach((r) => S.crewAction((st) => C.approve(st, crew.id, r.id)));
  });
  await page.click('#tabbar [data-tab="crew"]');
  await page.waitForTimeout(600);
  await page.evaluate(() => MILES.UI.openCrewSheet(MILES.Crew.mine(MILES.State.data).id));
  await page.waitForTimeout(400);

  // 1. No "+ Post" chip; the board itself composes.
  ok('no + Post chip', await page.evaluate(() => !document.body.textContent.includes('+ Post')));
  ok('board is a compose button', await page.evaluate(() => !!document.querySelector('.notice-compose')));
  await shot('01-board');

  await page.click('.notice-compose');
  await page.waitForTimeout(400);
  ok('composer opens with modals blocked', await page.evaluate(() => !document.getElementById('askSheet').hidden));
  await shot('02-composer');
  await page.evaluate(() => {
    document.querySelector('#askBody textarea').value = 'Saturday loop moved to 08:00. Meet at the fountain.';
    [...document.querySelectorAll('#askBody button')].find(b => b.textContent === 'Post').click();
  });
  await page.waitForTimeout(600);
  ok('notice actually posted', await page.evaluate(() => MILES.Crew.mine(MILES.State.data).notices.length === 1));

  // 2. Disband with members present must ask for a successor, not delete.
  await page.evaluate(() => [...document.querySelectorAll('#crewSheetBody button')].find(b => b.textContent.trim() === 'Disband').click());
  await page.waitForTimeout(500);
  const picker = await page.evaluate(() => document.getElementById('crewSheetBody').textContent);
  ok('Disband asks for the next captain', /Choose the next captain/.test(picker));
  ok('crew still exists', await page.evaluate(() => !!MILES.Crew.mine(MILES.State.data)));
  await shot('03-successor');

  // Picking one hands the crew over.
  await page.evaluate(() => document.querySelector('#crewSheetBody .friend').click());
  await page.waitForTimeout(400);
  await page.evaluate(() => [...document.querySelectorAll('#askBody button')].find(b => b.textContent === 'Hand over').click());
  await page.waitForTimeout(700);
  const after = await page.evaluate(() => {
    const c = MILES.Crew.mine(MILES.State.data);
    return { exists: !!c, iAmCaptain: c ? MILES.Crew.isLeader(c) : null, members: c ? c.members.length : 0 };
  });
  ok('crew survives the hand-over', after.exists && after.members === 3);
  ok('I am no longer captain', after.iAmCaptain === false);
  await shot('04-handed-over');

  // 3. A crew of one can still be disbanded outright.
  const solo = await page.evaluate(async () => {
    const S = MILES.State, C = MILES.Crew;
    S.crewAction((st) => C.leave(st, C.mine(st).id));
    S.crewAction((st) => C.create(st, { name: 'Solo', tagline: 'x', days: ['Sat'], time: '08:00', spot: 'y', openJoin: true }));
    const crew = C.mine(S.data);
    crew.requests = [];
    S.save();
    MILES.UI.openCrewSheet(crew.id);
    return crew.members.length;
  });
  await page.waitForTimeout(300);
  await page.evaluate(() => [...document.querySelectorAll('#crewSheetBody button')].find(b => b.textContent.trim() === 'Disband').click());
  await page.waitForTimeout(400);
  ok('solo crew asks to confirm', await page.evaluate(() => document.getElementById('askBody').textContent.includes('only runner')));
  await page.evaluate(() => [...document.querySelectorAll('#askBody button')].find(b => b.textContent === 'Disband').click());
  await page.waitForTimeout(600);
  ok('solo crew is actually disbanded', await page.evaluate(() => !MILES.Crew.mine(MILES.State.data)));

  // 4. The other actions that used blocked modals now work too.
  const others = await page.evaluate(async () => {
    const before = MILES.State.data.friends.length;
    MILES.UI.promptFriend();
    await new Promise(r => setTimeout(r, 200));
    document.querySelector('#askBody input').value = 'Rae Ito';
    [...document.querySelectorAll('#askBody button')].find(b => b.textContent === 'Add').click();
    await new Promise(r => setTimeout(r, 300));
    return { before, after: MILES.State.data.friends.length };
  });
  ok('add friend works with modals blocked', others.after === others.before + 1);

  console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
  console.log(bad === 0 ? 'ALL PASS' : `${bad} FAILURES`);
  await browser.close();
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
