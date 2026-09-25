// Text legibility audit. Every text style in the app is measured against the
// surface it actually sits on and checked against WCAG AA, and against a
// minimum weight for its size — light strokes on a dark ground bloom and thin
// out, so small type needs more weight than a ratio alone can tell you.
// Serve on :8765:
//   node test-contrast.js
// Needs Playwright, which the app itself does not: `npm i playwright`, or run
// with NODE_PATH pointing at an install that has it.
const { chromium } = require('playwright');

// Text painted over a bright gradient cannot be measured from the composited
// background alone — the audit sees the page colour underneath, not the
// gradient over it. These are measured in a second pass instead, against every
// colour stop of the gradient they actually sit on, so the list below is an
// exception to the method, never an exemption from the standard.
const GRADIENT = /wordmark|avatar|start-name|start-sub|start-arrow|rank-badge|day-chip|bubble--me|tier-pips|btn--pro/;

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

    // The colour stops of the nearest gradient this text sits on, if any, and
    // whether the gradient is the text itself rather than its background.
    let stops = null;
    let clipText = false;
    // Only the nearest thing actually painting behind this text counts. Walking
    // past a background to reach some distant ancestor's gradient would measure
    // the text against a colour it never sits on.
    for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
      const s2 = getComputedStyle(n);
      const img = s2.backgroundImage || '';
      const own = parse(s2.backgroundColor);
      if (img.indexOf('gradient') >= 0 && img.indexOf('url') < 0) {
        if ((s2.webkitBackgroundClip || s2.backgroundClip) === 'text') { clipText = true; break; }
        stops = (img.match(/rgba?\\([^)]+\\)/g) || []).map(parse).filter(Boolean);
        break;
      }
      if (own && own.a > 0) break;              // an opaque-enough backdrop won
    }

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
      fg, stops, clipText,
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
  const onGradient = new Map();
  const collect = (rows) => rows.forEach((r) => {
    const k = `${r.cls}|${r.size}|${r.weight}`;
    // An element whose backdrop really is a gradient goes to the gradient
    // pass whether or not anybody remembered to list it. "Really is" means
    // opaque: a gradient of rgba(...,0.14) is a tint over the surface below,
    // and the composited measurement already handles that correctly —
    // measuring against its raw stops would be measuring a colour that is
    // never actually on screen.
    const solidGradient = r.stops && r.stops.length && r.stops.every((c) => c.a >= 0.9);
    const bucket = solidGradient || GRADIENT.test(r.cls || '') ? onGradient : seen;
    if (!bucket.has(k) || bucket.get(k).ratio > r.ratio) bucket.set(k, r);
  });
  for (const tab of ['home', 'crew', 'territory', 'quests', 'profile', 'feed']) {
    await page.evaluate((t) => MILES.UI.go(t), tab);
    await page.waitForTimeout(450);
    collect(await page.evaluate(AUDIT));
  }

  // The captain's sheets, each opened the way the crew screen opens it. Two
  // requests are let in first so the roster has people in it to measure, and
  // one is left waiting so the request row is on screen too.
  await page.evaluate(() => {
    const S = MILES.State, C = MILES.Crew;
    const crew = C.mine(S.data);
    crew.requests.slice(0, 2).map((q) => q.id).forEach((id) => S.crewAction((st) => C.approve(st, crew.id, id)));
    MILES.UI.go('crew');
  });
  const mine = `MILES.Crew.mine(MILES.State.data)`;
  for (const open of [
    `MILES.UI.openCrewSheet(${mine}.id)`,
    `MILES.UI.openMissionPicker(${mine}.id)`,
    `(() => { const c = ${mine}; MILES.UI.openCrewSheet(c.id); MILES.UI.manageMember(c.id, c.members.find((m) => m.id !== 'me').id); })()`,
    `(() => { const c = ${mine}; MILES.UI.openCrewSheet(c.id); MILES.UI.editCrew(c.id); })()`,
    `(() => { const c = ${mine}; MILES.UI.openCrewSheet(c.id); MILES.UI.chooseSuccessor(c.id); })()`,
  ]) {
    await page.evaluate(`document.querySelectorAll('.sheet-scrim').forEach(s => s.hidden = true)`);
    await page.evaluate(open);
    await page.waitForTimeout(450);
    collect(await page.evaluate(AUDIT));
  }

  // Gradient-backed text, measured against every stop of its own gradient.
  const lum = (c) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const ratio = (a, b) => { const s = [lum(a), lum(b)].sort((x, y) => y - x); return (s[0] + 0.05) / (s[1] + 0.05); };
  const gradFails = [];
  let gradChecked = 0;
  let gradSkipped = 0;
  [...onGradient.values()].forEach((r) => {
    if (r.clipText) { gradSkipped++; return; }        // the gradient IS the text
    if (!r.stops || !r.stops.length) { gradSkipped++; return; }
    const worst = Math.min.apply(null, r.stops.map((s2) => ratio(r.fg, s2)));
    gradChecked++;
    if (worst < r.need) gradFails.push({ r, worst });
  });
  gradFails.forEach(({ r, worst }) => console.log(
    `  FAIL ${Math.round(worst * 100) / 100}:1 (need ${r.need})  on gradient  .${r.cls}  "${r.text}"`));
  console.log(`${gradChecked - gradFails.length}/${gradChecked} gradient-backed styles pass (${gradSkipped} not measurable)`);
  const rows = [...seen.values()];

  // The weight floor. Contrast is measured on a solid stroke; real text on a
  // dark ground is thinner than its colour suggests, and the smaller it is the
  // more of the difference weight has to make up.
  const floorFor = (size) => (size <= 12 ? 700 : 600);
  const light = rows.concat([...onGradient.values()])
    .filter((r) => r.weight < floorFor(r.size))
    .sort((a, b) => a.weight - b.weight);
  light.forEach((r) => console.log(
    `  FAIL w${r.weight} (need w${floorFor(r.size)} at ${r.size}px)  .${r.cls}  "${r.text}"`));
  console.log(`${rows.length + onGradient.size - light.length}/${rows.length + onGradient.size} styles meet the weight floor`);

  const fails = rows.filter((r) => !r.pass).sort((a, b) => a.ratio - b.ratio);
  fails.forEach((r) => console.log(`  FAIL ${r.ratio}:1 (need ${r.need})  ${r.size}px w${r.weight}  .${r.cls}  "${r.text}"`));
  console.log(`${rows.length - fails.length}/${rows.length} text styles pass WCAG AA`);

  await browser.close();
  process.exit(fails.length || gradFails.length || light.length ? 1 : 0);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
