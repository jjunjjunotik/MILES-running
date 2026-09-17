// Guards the sheet/shell scroll bug. Serve the app on :8765, then:
//   node test-sheets.js
// Needs Playwright, which the app itself does not: `npm i playwright`, or run
// with NODE_PATH pointing at an install that has it.
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage({ viewport: { width: 430, height: 932 } });
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
  await page.goto('http://localhost:8765/index.html', { waitUntil: 'networkidle' });
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  const shell = () => page.evaluate(() => Math.round(document.getElementById('app').scrollTop));
  let bad = 0;
  const check = (label, v) => { if (v !== 0) { bad++; console.log(`  SHIFTED ${label}: ${v}`); } };

  // A. Tap every field in the create sheet, then cancel.
  await page.click('#tabbar [data-tab="crew"]');
  await page.waitForTimeout(500);
  // Founding a crew is a Pro capability now, so the form this test drives is
  // only reachable with it. Joining a crew stays free and is covered elsewhere.
  await page.evaluate(() => { MILES.Pro.subscribe(MILES.State.data, 'pro_yearly'); MILES.State.save(); });
  await page.waitForTimeout(200);
  await page.click('#createCrewBtn');
  await page.waitForTimeout(400);
  const fields = await page.evaluate(() => document.querySelectorAll('#crewSheetBody input, #crewSheetBody select').length);
  for (let i = 0; i < fields; i++) {
    await page.evaluate((n) => document.querySelectorAll('#crewSheetBody input, #crewSheetBody select')[n].focus(), i);
    await page.waitForTimeout(90);
  }
  const afterTaps = await shell();
  await page.evaluate(() => [...document.querySelectorAll('#crewSheetBody button')].find((b) => b.textContent.trim() === 'Cancel').click());
  await page.waitForTimeout(400);
  console.log(`A create sheet: shell while typing=${afterTaps}, after cancel=${await shell()}`);
  check('A after cancel', await shell());

  // B. Dismiss by tapping the scrim instead of Cancel.
  await page.click('#createCrewBtn');
  await page.waitForTimeout(300);
  await page.evaluate(() => document.querySelectorAll('#crewSheetBody input')[2].focus());
  await page.waitForTimeout(200);
  await page.evaluate(() => document.getElementById('crewSheet').click());
  await page.waitForTimeout(400);
  console.log(`B scrim dismiss: ${await shell()}`);
  check('B scrim dismiss', await shell());

  // C. Found a crew, then open Edit crew (also full of fields) and go Back.
  await page.click('#createCrewBtn');
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const i = document.querySelectorAll('#crewSheetBody input');
    i[0].value = 'Owls'; i[1].value = 'quiet';
    [...document.querySelectorAll('#crewSheetBody button')].find((b) => b.textContent.includes('Found it')).click();
  });
  await page.waitForTimeout(600);
  await page.evaluate(() => [...document.querySelectorAll('#myCrew button')].find((b) => b.textContent.includes('Manage crew')).click());
  await page.waitForTimeout(400);
  await page.evaluate(() => [...document.querySelectorAll('#crewSheetBody button')].find((b) => b.textContent.includes('Edit crew')).click());
  await page.waitForTimeout(400);
  await page.evaluate(() => { const f = document.querySelectorAll('#crewSheetBody input'); f[f.length - 1].focus(); });
  await page.waitForTimeout(300);
  const inEdit = await shell();
  await page.evaluate(() => [...document.querySelectorAll('#crewSheetBody button')].find((b) => b.textContent.trim() === 'Back').click());
  await page.waitForTimeout(400);
  console.log(`C edit sheet: while focused=${inEdit}, after back=${await shell()}`);
  check('C after back', await shell());

  // D. Race lobby and solo sheet. (Back returns to the crew sheet, so shut it.)
  await page.evaluate(() => MILES.UI.closeSheet('#crewSheet'));
  await page.waitForTimeout(300);
  await page.click('#tabbar [data-tab="home"]');
  await page.waitForTimeout(400);
  await page.click('#startDuo');
  await page.waitForTimeout(400);
  await page.click('#duoCancel');
  await page.waitForTimeout(400);
  console.log(`D race lobby: ${await shell()}`);
  check('D race lobby', await shell());

  await page.click('#startSolo');
  await page.waitForTimeout(300);
  await page.evaluate(() => document.getElementById('soloSheet').click());
  await page.waitForTimeout(400);
  console.log(`E solo sheet: ${await shell()}`);
  check('E solo sheet', await shell());

  // F. And switching tabs never leaves it displaced.
  await page.evaluate(() => { document.getElementById('app').scrollTop = 300; });
  await page.click('#tabbar [data-tab="quests"]');
  await page.waitForTimeout(400);
  console.log(`F after tab change from a displaced shell: ${await shell()}`);
  check('F tab change', await shell());

  console.log(bad === 0 ? 'SHELL NEVER LEFT DISPLACED' : `${bad} FAILURES`);
  await browser.close();
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
