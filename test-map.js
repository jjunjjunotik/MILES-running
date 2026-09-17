// The Territory map is the one you drive yourself: it must pan, zoom, keep the
// view you put it in, tell you whose land is on screen, and point the way to
// land when none is. The standings board it replaced must be gone.
//   node test-map.js
// Needs Playwright, which the app itself does not: `npm i playwright`, or run
// with NODE_PATH pointing at an install that has it.
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage({ viewport: { width: 430, height: 932 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  // A basemap tile that cannot be fetched is a network condition the app is
  // built to survive, not a defect.
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('CONSOLE: ' + m.text());
  });
  await page.goto('file://' + path.resolve(__dirname, 'index.html'));
  await page.waitForTimeout(700);

  let bad = 0;
  const ok = (label, cond, extra) => {
    console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${!cond && extra !== undefined ? '  \u2192 ' + extra : ''}`);
    if (!cond) bad++;
  };

  await page.evaluate(() => MILES.UI.go('territory'));
  await page.waitForTimeout(800);

  const view = () => page.evaluate(() => {
    const m = MILES.UI.maps.territory;
    return {
      moved: !!m.moved, mpp: +m.mpp.toFixed(3),
      lat: +m.center.lat.toFixed(6), lng: +m.center.lng.toFixed(6),
      legend: [...document.querySelectorAll('#terrLegend .legend-item')].map((e) => e.textContent),
      height: Math.round(document.querySelector('.territory-map').getBoundingClientRect().height),
    };
  });

  // 1. The standings board is gone and the map has the room instead.
  ok('the standings board is gone', await page.evaluate(() => !document.querySelector('#terrBoard')));
  const start = await view();
  ok('the map is given real height', start.height >= 300, start.height);
  ok('the legend names who is on screen', start.legend.length > 0 && /You/.test(start.legend.join(' ')), JSON.stringify(start.legend));

  // 2. Dragging pans the map.
  const box = await page.locator('.territory-map').boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const drag = async (dx, dy, times) => {
    for (let i = 0; i < times; i++) {
      await page.mouse.move(cx - dx / 2, cy - dy / 2);
      await page.mouse.down();
      await page.mouse.move(cx + dx / 2, cy + dy / 2, { steps: 10 });
      await page.mouse.up();
      await page.waitForTimeout(120);
    }
  };
  await drag(-240, -120, 5);
  const panned = await view();
  ok('dragging moves the view', panned.lng !== start.lng && panned.lat !== start.lat,
    `${panned.lat},${panned.lng}`);
  ok('dragging does not change the zoom', panned.mpp === start.mpp);
  ok('the view is marked as yours once dragged', panned.moved);

  // 3. Panning away from your own ground still says where land is.
  ok('the legend answers for the new view',
    panned.legend.length > 0 && panned.legend.join(' ') !== start.legend.join(' '),
    JSON.stringify(panned.legend));

  // 4. The wheel zooms, and a re-render leaves the view alone.
  await page.mouse.move(cx, cy);
  for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, 200); await page.waitForTimeout(90); }
  const zoomed = await view();
  ok('the wheel zooms out', zoomed.mpp > panned.mpp, `${panned.mpp} -> ${zoomed.mpp}`);
  await page.evaluate(() => MILES.UI.renderTerritory());
  await page.waitForTimeout(250);
  const after = await view();
  ok('a re-render keeps the view you chose',
    after.mpp === zoomed.mpp && after.lat === zoomed.lat && after.lng === zoomed.lng);

  // 5. The zoom buttons work, and recentre gives the view back.
  await page.click('#terrZoomIn');
  await page.waitForTimeout(200);
  ok('the zoom-in button zooms in', (await view()).mpp < after.mpp);
  await page.click('#terrRecentre');
  await page.waitForTimeout(500);
  const home = await view();
  ok('recentre returns to your own ground',
    !home.moved && home.lat === start.lat && home.lng === start.lng && home.mpp === start.mpp,
    JSON.stringify(home));

  // 6. There is land to find out there, in every direction.
  const compass = await page.evaluate(async () => {
    const m = MILES.UI.maps.territory;
    const origin = MILES.State.data.profile.home;
    const rows = [];
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      m.center = MILES.Geo.offset(origin, Math.cos(a) * 3000, Math.sin(a) * 3000);
      m.moved = true;
      m.draw();
      MILES.UI.renderTerrLegend();
      await new Promise((r) => setTimeout(r, 30));
      rows.push([...document.querySelectorAll('#terrLegend .legend-item')].map((e) => e.textContent).join(' | '));
    }
    return rows;
  });
  ok('every direction either shows land or points to it',
    compass.every((r) => r.length > 0 && !/No claimed land anywhere/.test(r)),
    JSON.stringify(compass));
  ok('some directions land on someone else\'s district',
    compass.some((r) => !/Nearest land/.test(r)), JSON.stringify(compass));

  // 7. The nearest-land signpost names the right bearing.
  const bearings = await page.evaluate(() => {
    const m = MILES.UI.maps.territory;
    const origin = MILES.State.data.profile.home;
    m.center = origin;
    m.moved = true;
    // Geo.offset takes (east, north), so these are true compass directions.
    return [[3000, 0, 'east'], [2100, 2100, 'northeast'], [0, 3000, 'north'], [-2100, 2100, 'northwest'],
            [-3000, 0, 'west'], [-2100, -2100, 'southwest'], [0, -3000, 'south'], [2100, -2100, 'southeast']]
      .map(([e, n, want]) => {
        const c = MILES.Geo.offset(origin, e, n);
        const ring = [];
        for (let i = 0; i < 12; i++) {
          const t = (i / 12) * Math.PI * 2;
          ring.push(MILES.Geo.offset(c, Math.cos(t) * 200, Math.sin(t) * 200));
        }
        m.layers.territories = [{ owner: 'x', polygon: ring, area: 1e5 }];
        return { want, got: MILES.UI.nearestLandHint() };
      });
  });
  bearings.forEach((r) => ok(`nearest land to the ${r.want} reads as ${r.want}`,
    r.got.endsWith(r.want), r.got));

  console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
  console.log(bad === 0 ? 'ALL PASS' : `${bad} FAILURES`);
  await browser.close();
  process.exit(bad === 0 && errors.length === 0 ? 0 : 1);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
