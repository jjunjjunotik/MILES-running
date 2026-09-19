// One icon language. Every mark in the app is a sprite from the shared set,
// drawn at the app's own weight — not an emoji (which arrives as the viewer's
// font at the viewer's weight) and not a typed glyph (which arrives at the
// text font's). This is the guard that keeps one from creeping back in.
//   node test-icons.js
// Needs Playwright, which the app itself does not: `npm i playwright`, or run
// with NODE_PATH pointing at an install that has it.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

// Emoji, arrows, geometric shapes and dingbats — anything used as a picture.
const PICTOGRAPH = '[\\u{1F000}-\\u{1FAFF}\\u{2190}-\\u{21FF}\\u{2300}-\\u{23FF}\\u{25A0}-\\u{25FF}\\u{2600}-\\u{27BF}\\u{2B00}-\\u{2BFF}\\u{FE0F}]';

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

  // 1. The source itself carries no pictographic characters outside comments.
  const sourceHits = [];
  ['src/js/state.js', 'src/js/ui.js', 'src/js/crew.js', 'src/js/pro.js', 'index.html'].forEach((f) => {
    const re = new RegExp(PICTOGRAPH, 'u');
    fs.readFileSync(path.resolve(__dirname, f), 'utf8').split('\n').forEach((line, i) => {
      const code = line.replace(/\/\*.*?\*\//g, '').replace(/^\s*[*/].*$/, '').replace(/\/\/.*$/, '');
      if (re.test(code)) sourceHits.push(`${f}:${i + 1}  ${line.trim().slice(0, 60)}`);
    });
  });
  ok('no pictographs left in the source', sourceHits.length === 0, JSON.stringify(sourceHits, null, 1));

  // 2. Every quest names a sprite rather than carrying a character.
  const quests = await page.evaluate(() => MILES.QUESTS.map((q) => q.icon));
  ok('every quest icon is a sprite name', quests.every((i) => /^i-[a-z]+$/.test(i)), JSON.stringify(quests));
  ok('no two quests share a mark', new Set(quests).size === quests.length);

  // 3. Nothing pictographic is rendered on any screen, and every sprite a
  //    `use` points at exists — a missing one paints nothing, silently.
  await page.evaluate(() => {
    const S = MILES.State, C = MILES.Crew;
    S.crewAction((st) => C.create(st, { name: 'Night Owls', tagline: 'Quiet streets', days: ['Tue'], time: '18:30', spot: 'Gate', openJoin: true }));
    MILES.Pro.subscribe(S.data, 'pro_yearly');
    S.save();
  });

  const rendered = [];
  const missing = new Set();
  let uses = 0;
  for (const tab of ['home', 'crew', 'territory', 'quests', 'profile', 'feed']) {
    await page.evaluate((t) => MILES.UI.go(t), tab);
    await page.waitForTimeout(450);
    const found = await page.evaluate((src) => {
      const re = new RegExp(src, 'u');
      const out = [];
      document.querySelectorAll('.screen[data-active="true"] *').forEach((el) => {
        Array.prototype.filter.call(el.childNodes, (n) => n.nodeType === 3).forEach((n) => {
          if (re.test(n.textContent)) out.push(`${el.className || el.tagName} :: ${n.textContent.trim().slice(0, 30)}`);
        });
      });
      const all = [...document.querySelectorAll('use')];
      return {
        out,
        miss: all.map((u) => u.getAttribute('href').slice(1)).filter((id) => !document.getElementById(id)),
        uses: all.length,
      };
    }, PICTOGRAPH);
    found.out.forEach((t) => rendered.push(tab + ' → ' + t));
    found.miss.forEach((m) => missing.add(m));
    uses = Math.max(uses, found.uses);
  }
  ok('no pictograph is rendered on any screen', rendered.length === 0, JSON.stringify(rendered, null, 1));
  ok('every sprite reference resolves', missing.size === 0, JSON.stringify([...missing]));
  ok('the screens actually use sprites', uses > 10, uses);

  // 4. The sprite set is coherent: one drawing style, nothing orphaned.
  const sprites = await page.evaluate(() => {
    const defs = [...document.querySelectorAll('svg defs g')];
    return defs.map((g) => ({
      id: g.id,
      shapes: g.children.length,
      // A stroke icon must not rely on fills, or it cannot take its colour
      // from the text it sits with.
      filled: [...g.children].some((c) => {
        const f = c.getAttribute('fill');
        return f && f !== 'none';
      }),
      sized: [...g.children].every((c) => {
        const d = c.getAttribute('d') || '';
        const nums = d.match(/-?\d+(\.\d+)?/g) || [];
        return nums.every((n) => Math.abs(Number(n)) <= 24.5);
      }),
    }));
  });
  ok('the set is a real set', sprites.length >= 35, sprites.length);
  ok('every sprite has shapes in it', sprites.every((s) => s.shapes > 0),
    JSON.stringify(sprites.filter((s) => !s.shapes)));
  ok('no sprite hard-codes a fill', sprites.every((s) => !s.filled),
    JSON.stringify(sprites.filter((s) => s.filled).map((s) => s.id)));
  ok('every sprite stays inside its 24×24 box', sprites.every((s) => s.sized),
    JSON.stringify(sprites.filter((s) => !s.sized).map((s) => s.id)));
  ok('sprite ids are unique', new Set(sprites.map((s) => s.id)).size === sprites.length);

  console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
  console.log(bad === 0 ? 'ALL PASS' : `${bad} FAILURES`);
  await browser.close();
  process.exit(bad === 0 && errors.length === 0 ? 0 : 1);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
