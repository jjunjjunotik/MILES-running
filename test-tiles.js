// Real map imagery: the tile layer must line up with the routes drawn over it,
// leave no seams, keep canvases exportable, and fall back to the drawn city
// whenever the network is unavailable — which is most of the point.
//
// The real CDN is not needed (and is usually blocked in CI): the test serves
// its own tiles, each a solid colour encoding its own x/y, so a canvas pixel
// read back says exactly which tile painted it.
//   node test-tiles.js
// Needs Playwright, which the app itself does not: `npm i playwright`, or run
// with NODE_PATH pointing at an install that has it.
const { chromium } = require('playwright');
const http = require('http');
const zlib = require('zlib');
const path = require('path');

let PORT = 0;   // taken from the OS, so a busy port can never fail the run


function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = c ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, r, g, b) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2;                       // 8-bit RGB
  const row = Buffer.alloc(1 + size * 3);
  for (let i = 0; i < size; i++) { row[1 + i * 3] = r; row[2 + i * 3] = g; row[3 + i * 3] = b; }
  const raw = Buffer.concat(new Array(size).fill(row));
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}


let server;
function startTiles() {
  return new Promise((resolve) => {
    server = http.createServer((req, res) => {
      const m = req.url.match(/^\/(\d+)\/(\d+)\/(\d+)\.png/);
      if (!m) { res.writeHead(404).end(); return; }
      const [, , x, y] = m.map(Number);
      served++;
      res.writeHead(200, { 'Content-Type': 'image/png', 'Access-Control-Allow-Origin': '*' });
      // Neighbouring tiles sit 37 apart per channel so compositing rounding
      // can never make two of them look alike.
      res.end(png(256, (x * 37) & 255, (y * 37) & 255, 200));
    });
    served = 0;
    server.listen(0, '127.0.0.1', () => { PORT = server.address().port; resolve(); });
  });
}

(async () => {
  await startTiles();
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await b.newPage({ viewport: { width: 430, height: 932 } });
  const errs = [];
  p.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text()); });
  await p.goto('file://' + path.resolve(__dirname, 'index.html'));
  await p.waitForTimeout(500);

  let bad = 0;
  const ok = (l, c, extra) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${l}${extra !== undefined && !c ? '  → ' + extra : ''}`); if (!c) bad++; };

  // A bare map with no overlays, so every pixel read back is tile imagery.
  const setup = await p.evaluate((port) => {
    const cv = document.createElement('canvas');
    cv.style.cssText = 'position:fixed;left:0;top:0;width:400px;height:400px;z-index:9999';
    document.body.appendChild(cv);
    MILES.Tiles.SOURCES.test = {
      key: 'test', name: 'Test', url: 'http://127.0.0.1:' + port + '/{z}/{x}/{y}.png',
      subdomains: [''], retina: false, maxZoom: 19, dim: 0.3, attribution: '© Test',
    };
    MILES.Tiles.setSource('test');
    const m = new MILES.MapView(cv, { mpp: 2, padding: 0 });
    m.setAnchor(MILES.State.data.profile.home);
    m.setCenter(MILES.State.data.profile.home);
    m.mpp = 2;
    window.__m = m;
    m.draw();
    return { z: MILES.Tiles.zoomFor(2, MILES.State.data.profile.home.lat), dpr: m._dpr };
  }, PORT);
  console.log('  zoom chosen for 2 m/px:', setup.z, '| dpr', setup.dpr);

  await p.waitForTimeout(2500);
  await p.evaluate(() => window.__m.draw());
  await p.waitForTimeout(400);

  // 1. Tiles were actually requested and painted.
  ok('tiles were requested', served > 0, served);
  ok('the map reports imagery painted', await p.evaluate(() => window.__m._drawTiles()));

  // 2. Alignment: the pixel under a known lat/lng must come from the tile that
  //    independently-computed slippy math says covers that point. Rather than
  //    invert the map's dimming, predict what each candidate tile WOULD
  //    composite to and require the true one to be the closest match — the
  //    server spaces neighbouring tiles 37 apart per channel so they cannot be
  //    confused by rounding.
  const probes = await p.evaluate((z) => {
    const home = MILES.State.data.profile.home;
    const T = MILES.Tiles, m = window.__m;
    const out = [];
    [[0, 0], [300, -200], [-350, 250], [150, 400], [-420, -380]].forEach(([dx, dy]) => {
      const ll = MILES.Geo.unproject({ x: dx, y: dy }, home);
      const s = m.toScreen(ll);
      if (s.x < 4 || s.y < 4 || s.x > m.w - 4 || s.y > m.h - 4) return;
      const px = m.ctx.getImageData(Math.round(s.x * m._dpr), Math.round(s.y * m._dpr), 1, 1).data;
      out.push({
        dx, dy,
        tx: Math.floor(T.lngToX(ll.lng, z)),
        ty: Math.floor(T.latToY(ll.lat, z)),
        px: [px[0], px[1], px[2]],
      });
    });
    return out;
  }, setup.z);
  ok('probes landed on the canvas', probes.length >= 3, probes.length);

  // The layer is covered by rgba(8,11,16,0.30).
  const composite = (c) => [c[0] * 0.7 + 8 * 0.3, c[1] * 0.7 + 11 * 0.3, c[2] * 0.7 + 16 * 0.3];
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  probes.forEach((q) => {
    let best = null, bestD = Infinity, trueD = Infinity;
    for (let ox = -1; ox <= 1; ox++) {
      for (let oy = -1; oy <= 1; oy++) {
        const cand = composite([((q.tx + ox) * 37) & 255, ((q.ty + oy) * 37) & 255, 200]);
        const d = dist(q.px, cand);
        if (ox === 0 && oy === 0) trueD = d;
        if (d < bestD) { bestD = d; best = [ox, oy]; }
      }
    }
    ok(`pixel at (${q.dx},${q.dy}) m comes from its own tile ${q.tx}/${q.ty}`,
      best[0] === 0 && best[1] === 0,
      `nearest tile is offset ${best} (err ${trueD.toFixed(1)} vs ${bestD.toFixed(1)})`);
  });

  // 3. No seams: scan a horizontal line for any pixel darker than the dimmed
  //    imagery, which is what a gap between tiles would leave behind.
  const gaps = await p.evaluate(() => {
    const m = window.__m, d = m._dpr;
    const row = m.ctx.getImageData(0, Math.round(m.h * d / 2), Math.round(m.w * d), 1).data;
    let n = 0;
    for (let i = 0; i < row.length; i += 4) if (row[i + 2] < 100) n++;   // blue is 200*0.7=140
    return n;
  });
  ok('no seams or gaps along a full scanline', gaps === 0, gaps + ' dark pixels');

  // 4. Cross-origin tiles must not taint the canvas, or Save card dies.
  ok('canvas stays exportable with tiles drawn',
    await p.evaluate(() => { try { return window.__m.canvas.toDataURL().length > 100; } catch (e) { return false; } }));

  // 5. A dead source falls back to the drawn city rather than a blank map.
  const fallback = await p.evaluate(async () => {
    MILES.Tiles.SOURCES.dead = Object.assign({}, MILES.Tiles.SOURCES.test, { key: 'dead', url: 'http://127.0.0.1:8799/{z}/{x}/{y}.png' });
    MILES.Tiles.setSource('dead');
    for (let i = 0; i < 30 && !MILES.Tiles.blocked(); i++) { window.__m.draw(); await new Promise(r => setTimeout(r, 200)); }
    window.__m.draw();
    const px = window.__m.ctx.getImageData(0, 0, 1, 1).data;
    return { blocked: MILES.Tiles.blocked(), usable: MILES.Tiles.usable(), painted: [px[0], px[1], px[2]] };
  });
  ok('a dead tile source is given up on', fallback.blocked && !fallback.usable);
  ok('the map still paints after giving up', fallback.painted[0] > 0 || fallback.painted[2] > 0, JSON.stringify(fallback.painted));

  // 6. The Drawn setting turns imagery off and survives a reload.
  await p.evaluate(() => { MILES.UI.go('profile'); MILES.UI.setMapStyle('drawn'); });
  await p.waitForTimeout(300);
  ok('choosing Drawn stops imagery', await p.evaluate(() => !MILES.Tiles.usable() && MILES.State.data.mapStyle === 'drawn'));
  await p.reload(); await p.waitForTimeout(700);
  ok('the choice survives a reload', await p.evaluate(() => MILES.State.data.mapStyle === 'drawn' && MILES.Tiles.source.key === 'drawn'));
  // Choosing Drawn needs no caption: the Drawn button is lit. The note exists
  // for the case where the two disagree — you asked for imagery and the app is
  // showing you the drawn city because it could not reach any.
  ok('choosing Drawn is not captioned',
    (await p.evaluate(() => document.querySelector('#mapStyleNote').textContent)).trim() === '');
  await p.evaluate(() => MILES.UI.setMapStyle('dark'));
  await p.waitForTimeout(400);
  ok('a map that could not load says so',
    /drawn city/i.test(await p.evaluate(() => document.querySelector('#mapStyleNote').textContent)));

  const real = errs.filter((e) => !/Failed to load resource/.test(e));
  console.log('tile fetch failures (expected — CDN is blocked here):', errs.length - real.length);
  console.log('ERRORS:', real.length ? real.join(' | ') : 'none');
  if (real.length) bad++;
  console.log(bad === 0 ? 'ALL PASS' : `${bad} FAILURES`);
  await b.close();
  server.close();
  process.exit(bad === 0 ? 0 : 1);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
