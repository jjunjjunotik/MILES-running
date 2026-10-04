// Shared by test-online.js and test-billing.js; not a check of its own.
/* The bars every other screen is held to (test-type, test-contrast,
   test-touch), applied to the screens only a server shows: type no smaller
   than the design's 12px, text at WCAG AA against what it sits on, and every
   control big enough for a thumb — 44px, or 40px inside a segmented group. A
   link inside a sentence is part of the sentence and is not measured. */
const AUDIT = (selector) => `(() => {
  const parse = (c) => {
    const m = /rgba?\\(([^)]+)\\)/.exec(c);
    if (!m) return null;
    const p = m[1].split(',').map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const over = (fg, bg) => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 });
  const lum = (c) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const ratio = (a, b) => { const s = [lum(a), lum(b)].sort((x, y) => y - x); return (s[0] + 0.05) / (s[1] + 0.05); };
  const bgOf = (el) => {
    const layers = [];
    for (let n = el; n; n = n.parentElement) {
      const b = parse(getComputedStyle(n).backgroundColor);
      if (b && b.a > 0) layers.push(b);
      if (b && b.a >= 1) break;
    }
    let out = { r: 14, g: 13, b: 12, a: 1 };
    for (let i = layers.length - 1; i >= 0; i--) out = over(layers[i], out);
    return out;
  };
  const found = { type: [], contrast: [], touch: [], seen: 0 };
  document.querySelectorAll(${JSON.stringify(selector)}).forEach((root) => {
    root.querySelectorAll('*').forEach((el) => {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || cs.visibility === 'hidden' || cs.display === 'none' || el.closest('[hidden]')) return;
      const own = Array.prototype.filter.call(el.childNodes, (n) => n.nodeType === 3).map((n) => n.textContent.trim()).join('');
      if (own) {
        found.seen++;
        const size = parseFloat(cs.fontSize);
        if (size + 0.01 < 12) found.type.push(size + 'px ' + own.slice(0, 24));
        const bg = bgOf(el);
        const c = ratio(over(parse(cs.color), bg), bg);
        const large = size >= 24 || (size >= 18.66 && Number(cs.fontWeight) >= 700);
        if (c < (large ? 3 : 4.5)) found.contrast.push(c.toFixed(2) + ' ' + own.slice(0, 24));
      }
      if (el.matches('button, input:not([type=checkbox]), select, textarea, a, label.auth-check') && !el.closest('.auth-check span')) {
        const min = el.closest('.seg') ? 40 : 44;
        if (r.height + 0.5 < min || (!el.closest('.seg') && r.width + 0.5 < 44)) {
          found.touch.push(Math.round(r.width) + 'x' + Math.round(r.height) + ' ' + (el.textContent.trim() || el.id || el.tagName).slice(0, 24));
        }
      }
    });
  });
  return found;
})()`;

module.exports = { AUDIT };
