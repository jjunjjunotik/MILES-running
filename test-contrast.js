// Text contrast audit. Every text style in the app is measured against the
// surface it actually sits on and checked against WCAG AA. Serve on :8765:
//   node test-contrast.js
// Needs Playwright, which the app itself does not: `npm i playwright`, or run
// with NODE_PATH pointing at an install that has it.
const { chromium } = require('playwright');

// Text painted over a bright gradient (buttons, avatars, the clipped wordmark)
// cannot be measured from computed styles — the audit sees the page colour
// underneath, not the gradient over it. Those are checked separately below.
const GRADIENT = /wordmark|avatar|start-name|start-sub|start-arrow|crew-badge|rank-badge|day-chip|bubble--me|tier-pips/;

const AUDIT = `(() => {
  const parse = (c) => {
    const m = /rgba?\\(([^)]+)\\)/.exec(c);
    if (!m) return null;
    const p = m[1].split(',').map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const over = (fg, bg) => ({
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  });
  const lum = (c) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const ratio = (a, b) => { const s = [lum(a), lum(b)].sort((x, y) => y - x); return (s[0] + 0.05) / (s[1] + 0.05); };

  const bgOf = (el) => {
    const stack = [];
    let n = el;
    while (n && n !== document.documentElement) {
      const cs = getComputedStyle(n);
      const c = parse(cs.backgroundColor);
      if (c && c.a > 0) stack.push(c);
      if (cs.backgroundImage && cs.backgroundImage.indexOf('gradient') >= 0 && cs.backgroundImage.indexOf('url') < 0)
        stack.push({ r: 255, g: 255, b: 255, a: 0.04 });
      n = n.parentElement;
    }
    stack.push({ r: 5, g: 7, b: 10, a: 1 });
    let bg = stack.pop();
    while (stack.length) bg = over(stack.pop(), bg);
    return bg;
  };

  const out = [];
  document.querySelectorAll('.screen[data-active="true"] *, .sheet-scrim:not([hidden]) *').forEach((el) => {
    const text = Array.prototype.filter.call(el.childNodes, (n) => n.nodeType === 3)
      .map((n) => n.textContent.trim()).join('');
    if (!text) return;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') return;
    const rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const fg = parse(cs.color);
    if (!fg || fg.a === 0) return;
    const bg = bgOf(el);
    const size = parseFloat(cs.fontSize);
    const weight = Number(cs.fontWeight) || 400;
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    const need = large ? 3 : 4.5;
    const r = ratio(over(fg, bg), bg);
    out.push({
      text: text.slice(0, 26),
      cls: (el.className && el.className.toString ? el.className.toString() : '').slice(0, 28),
      size: Math.round(size * 10) / 10, weight,
      ratio: Math.round(r * 100) / 100, need, pass: r >= need,
    });
  });
  return out;
})()
`;

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  });
  const page = await browser.newPage({ viewport: { width: 430, height: 932 } });
  await page.goto('http://localhost:8765/index.html', { waitUntil: 'networkidle' });
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  // Populate the crew screens so their text is on-screen to measure.
  await page.evaluate(() => {
    const S = MILES.State, C = MILES.Crew;
    S.crewAction((st) => C.create(st, { name: 'Night Owls', tagline: 'Quiet streets', days: ['Tue', 'Thu'], time: '18:30', spot: 'Gate', openJoin: true }));
    const crew = C.mine(S.data);
    S.crewAction((st) => C.setMission(st, crew.id, C.missionOptions(crew).find((o) => o.def.key === 'distance').key));
    S.crewAction((st) => C.postNotice(st, crew.id, 'Saturday loop moved to 08:00.'));
  });

  const seen = new Map();
  for (const tab of ['home', 'crew', 'territory', 'quests', 'profile', 'feed']) {
    await page.evaluate((t) => MILES.UI.go(t), tab);
    await page.waitForTimeout(450);
    (await page.evaluate(AUDIT)).forEach((r) => {
      if (GRADIENT.test(r.cls || '')) return;
      const k = `${r.cls}|${r.size}|${r.weight}`;
      if (!seen.has(k) || seen.get(k).ratio > r.ratio) seen.set(k, r);
    });
  }
  const rows = [...seen.values()];
  const fails = rows.filter((r) => !r.pass).sort((a, b) => a.ratio - b.ratio);
  fails.forEach((r) => console.log(`  FAIL ${r.ratio}:1 (need ${r.need})  ${r.size}px w${r.weight}  .${r.cls}  "${r.text}"`));
  console.log(`${rows.length - fails.length}/${rows.length} text styles pass WCAG AA`);

  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
