/* ==========================================================================
   MILES · record card
   The shareable artefact of a run: route, headline numbers, territory and
   the duel result, drawn to a 1080×1350 canvas and exportable as a PNG.

   It is the app's own page, not a poster in another style: the same warm
   ground, the same two faces, the run kind's own colour, and the route laid
   on the same map the app draws it on.
   ========================================================================== */

(function (M) {
  'use strict';

  const { Geo, Units, clock } = M;

  const W = 1080;
  const H = 1350;
  const PAD = 80;

  /* The app's surfaces and type colours (tokens.css). A canvas cannot read
     CSS variables, so they are restated here — change them together. */
  const INK = {
    ground: '#12110f',                  // the drawn cards' ground (visual.js)
    panel:  '#1b1a17',                  // --ink-700
    hi:     '#f4efe7',                  // --text-hi
    mid:    '#c9c1b5',                  // --text-mid
    lo:     '#a59d91',                  // --text-lo
    line:   'rgba(243, 236, 224, 0.12)',
    plate:  'rgba(18, 17, 15, 0.9)',
  };

  const SANS = '"Instrument Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  const NUM = '"Barlow Condensed", "Arial Narrow", sans-serif';

  // A canvas has no word-spacing to lean on, and Instrument Sans sets its
  // spaces tight: a plain " · " ran the words either side into the dot.
  const SEP = '\u2005·\u2005';

  /** The largest size up to `size` at which `text` fits in `max` pixels. */
  function fitFont(ctx, text, weight, size, family, max) {
    let px = size;
    ctx.font = `${weight} ${px}px ${family}`;
    while (px > 24 && ctx.measureText(text).width > max) {
      px -= 4;
      ctx.font = `${weight} ${px}px ${family}`;
    }
    return px;
  }

  /* Colourways. With none chosen the card wears its run kind's colour — the
     one that kind wears everywhere else in the app (state.js KINDS). Choosing
     another is what Supporter buys. `ink` is the same hue, lifted so it still
     reads as small type. These were four neons with a second neon each. */
  const THEMES = {
    chalk:  { accent: '#f1ead9', ink: '#f1ead9' },
    flame:  { accent: '#f2642a', ink: '#ff9a6c' },
    violet: { accent: '#a855f7', ink: '#c4a2fb' },
    rose:   { accent: '#e8587a', ink: '#f2879f' },
    amber:  { accent: '#eab052', ink: '#f0c46e' },
  };

  /** The colourways worth offering for a kind: never one that is its default. */
  function themesFor(kind) {
    const own = (M.KINDS[kind] || M.KINDS.free).accent;
    return Object.keys(THEMES).filter((k) => THEMES[k].accent !== own);
  }

  const THEME_NAMES = { chalk: 'Chalk', flame: 'Flame', violet: 'Violet', rose: 'Rose', amber: 'Amber' };

  /* The faces the card is set in. A canvas only draws a web font the page
     has already loaded, and on a first run nothing on screen may have asked
     for the italic wordmark yet — so the first paint can fall back, and the
     card is painted again once they arrive. */
  const FACES = [
    `italic 800 64px ${NUM}`, `700 100px ${NUM}`,
    `italic 700 100px ${NUM}`, `600 30px ${SANS}`, `700 30px ${SANS}`,
  ];

  function roundRect(ctx, x, y, w, h, r) {
    if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); return; }
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /* --- What a card can hold -----------------------------------------------
     The runner lays the card out: which of four layouts, which numbers, and
     whether the highlights and the elevation line are on it. What they can
     choose depends on what the run actually recorded — a run with no splits
     has no Splits layout, and one whose phone gave no altitude has no climb. */

  const TEMPLATES = { map: 'Map', poster: 'Poster', splits: 'Splits', sticker: 'Sticker' };
  const STAT_ORDER = ['time', 'pace', 'elev', 'speed', 'fastest', 'distance'];

  /** The one number this run was about, and the line that says what it is. */
  function headlineOf(activity) {
    const kind = activity.kind || 'free';
    const dist = `${Units.distText(activity.distance)} ${Units.distLabel()}`;
    if (kind === 'race' && activity.placing) {
      return {
        value: ordinal(activity.placing), unit: `of ${activity.fieldSize}`, isDistance: false,
        caption: activity.finished ? `Finished the ${Units.distText(activity.target)} ${Units.distLabel()}` : `Did not finish${SEP}${dist}`,
      };
    }
    if (kind === 'territory' && activity.claimedArea) {
      return { value: Units.areaText(activity.claimedArea), unit: Units.areaLabel(), isDistance: false, caption: `Claimed with a ${dist} loop` };
    }
    return {
      value: Units.distText(activity.distance), unit: Units.distLabel(), isDistance: true,
      caption: kind === 'territory' ? 'No loop closed — no land taken' : activity.title || 'Run',
    };
  }

  /** Every number this run can put on its card, keyed. */
  function statsFor(activity) {
    const a = activity;
    const splits = a.splits || [];
    const out = {
      time: { label: 'Time', value: clock(a.duration) },
      pace: { label: 'Pace', value: Units.paceText(a.duration / Math.max(1, a.distance)), unit: Units.paceLabel() },
    };
    if (typeof a.elevation === 'number') out.elev = { label: 'Elevation gain', value: Units.elevText(a.elevation), unit: Units.elevLabel() };
    if (a.duration > 0) out.speed = { label: 'Avg speed', value: Units.speed(a.distance / a.duration).toFixed(1), unit: Units.speedLabel() };
    if (splits.length >= 2) out.fastest = { label: 'Fastest km', value: clock(Math.min.apply(null, splits.map((x) => x.seconds))) };
    // Said once: when the headline is the distance, it is not offered again.
    if (!headlineOf(a).isDistance) out.distance = { label: 'Distance', value: Units.distText(a.distance), unit: Units.distLabel() };
    return out;
  }

  /**
   * The runner's picks that this run can show. A pick this run cannot show —
   * a fastest km with no splits, a climb with no altitude — is replaced from
   * the usual order, so the card keeps the number of columns they chose.
   */
  function pickStats(activity, keys) {
    const all = statsFor(activity);
    const want = Math.min(3, (keys && keys.length) || 3);
    const picked = (keys || []).filter((k, i, xs) => all[k] && xs.indexOf(k) === i).slice(0, 3);
    STAT_ORDER.forEach((k) => { if (picked.length < want && all[k] && picked.indexOf(k) < 0) picked.push(k); });
    return picked;
  }

  function templatesFor(activity) {
    return Object.keys(TEMPLATES).filter((t) => t !== 'splits' || (activity.splits || []).length >= 2);
  }

  /** Altitude along the run, resampled evenly by distance; null without it. */
  function profileOf(activity) {
    const pts = (activity.route || []).filter((p) => typeof p.alt === 'number');
    if (pts.length < 8) return null;
    const along = [0];
    for (let i = 1; i < pts.length; i++) along.push(along[i - 1] + Geo.distance(pts[i - 1], pts[i]));
    const total = along[along.length - 1];
    if (!total) return null;
    const out = [];
    let j = 0;
    for (let k = 0; k < 90; k++) {
      const d = (k / 89) * total;
      while (j < along.length - 2 && along[j + 1] < d) j++;
      const t = (d - along[j]) / Math.max(1e-6, along[j + 1] - along[j]);
      out.push(pts[j].alt + (pts[j + 1].alt - pts[j].alt) * Math.min(1, Math.max(0, t)));
    }
    return out;
  }

  /**
   * Draws the card for an activity.
   * @param {HTMLCanvasElement} canvas
   * @param {object} activity
   * @param {object} [options] – { theme, athlete, rank, totalArea, template,
   *   stats: keys, highlights: lines to show, profile: draw the elevation line }
   *
   * Every block it draws is recorded, with its box, on `canvas.cardLayout` —
   * which is how the tests prove that nothing on the card lands on anything
   * else, whatever the runner switches on.
   */
  function renderCard(canvas, activity, options) {
    const opts = options || {};
    const kind = activity.kind || 'free';
    const K = M.KINDS[kind] || M.KINDS.free;
    const theme = THEMES[opts.theme] || { accent: K.accent, ink: K.ink };
    const templates = templatesFor(activity);
    const template = templates.indexOf(opts.template) >= 0 ? opts.template : 'map';
    const sticker = template === 'sticker';
    const seed = Math.floor((activity.startedAt || 7000) / 1000) % 9973;
    const headline = headlineOf(activity);
    const stats = pickStats(activity, opts.stats).map((k) => statsFor(activity)[k]);
    const badges = (opts.highlights || []).slice(0, 2);
    const profile = opts.profile && (template === 'map' || template === 'splits') ? profileOf(activity) : null;

    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    const layout = [];
    const L = { ctx, layout, theme, sticker };
    canvas._view = null;

    /* --- Ground ---------------------------------------------------------
       A sticker is the one card with none: it goes on the runner's own photo,
       so it is saved with a transparent background and its words carry a soft
       shadow to stay readable on whatever is under them. ------------------ */
    ctx.clearRect(0, 0, W, H);
    if (!sticker) {
      ctx.fillStyle = INK.ground;
      ctx.fillRect(0, 0, W, H);
    } else {
      ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
      ctx.shadowBlur = 18;
    }

    const outcome = kind === 'territory'
      ? (activity.claimedArea > 0 ? { text: `Loop closed${SEP}land taken`, color: theme.ink } : { text: 'Loop not closed', color: INK.lo })
      : kind === 'race'
        ? (activity.finished ? { text: `Crossed the line ${ordinal(activity.placing)}`, color: theme.ink } : { text: 'Did not finish', color: INK.lo })
        : null;

    if (template === 'map') {
      drawHeader(L, K, headline.caption);
      drawDate(L, activity, 262);
      drawHero(L, headline, 484, 240);
      const badgeY = drawBadges(L, badges, 504);
      const top = badgeY ? 568 : 520;
      const bottom = profile ? 930 : 1008;
      const panel = { x: PAD, y: top, w: W - PAD * 2, h: bottom - top };
      const view = drawMapPanel(L, activity, panel, outcome, seed);
      if (profile) drawProfile(L, profile, { x: PAD, y: 948, w: W - PAD * 2, h: 60 });
      drawStats(L, stats, 1140);
      drawFooter(L, activity, opts);
      canvas._view = view;
    } else if (template === 'poster') {
      // The shape of the run, large and on its own, with the number under it.
      drawHeader(L, K, headline.caption);
      drawDate(L, activity, 262);
      const badgeY = drawBadges(L, badges, 300);
      const top = badgeY ? 366 : 306;
      drawShape(L, activity, { x: PAD, y: top, w: W - PAD * 2, h: 830 - top });
      drawHero(L, headline, 1018, 240);
      drawStats(L, stats, 1140);
      drawFooter(L, activity, opts);
    } else if (template === 'splits') {
      drawHeader(L, K, headline.caption);
      drawDate(L, activity, 262);
      drawHero(L, headline, 448, 180);
      const badgeY = drawBadges(L, badges, 468);
      const top = badgeY ? 534 : 486;
      const bottom = profile ? 930 : 1008;
      drawSplits(L, activity.splits || [], { x: PAD, y: top, w: W - PAD * 2, h: bottom - top });
      if (profile) drawProfile(L, profile, { x: PAD, y: 948, w: W - PAD * 2, h: 60 });
      drawStats(L, stats, 1140);
      drawFooter(L, activity, opts);
    } else {
      drawShape(L, activity, { x: PAD, y: 64, w: W - PAD * 2, h: 640 });
      drawHero(L, headline, 944, 240);
      drawStats(L, stats, 1080, true);
      drawStickerFoot(L, activity);
    }

    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    // The same fine grain that sits over the app, so the card is paper too.
    if (!sticker) M.Visual._grain(ctx, W, H, seed + 3);

    canvas.cardLayout = layout;
    canvas.cardTemplate = template;

    // Street tiles arrive one at a time. Paint again as they land, for a few
    // seconds after the card first appears, so the saved card has its map.
    if (canvas._offTiles) canvas._offTiles();
    canvas._offTiles = null;
    const until = opts._tilesUntil || Date.now() + 8000;
    if (template === 'map' && canvas._view && M.Tiles && M.Tiles.usable() && Date.now() < until) {
      let timer = null;
      const off = M.Bus.on('tiles:loaded', () => {
        clearTimeout(timer);
        timer = setTimeout(() => renderCard(canvas, activity, Object.assign({}, opts, { _tilesUntil: until })), 150);
      });
      canvas._offTiles = () => { off(); clearTimeout(timer); };
    }

    // A face that had not loaded yet was drawn in its fallback: paint again
    // once they are in. Once only, so a face that never arrives cannot loop.
    if (!opts._afterFonts && document.fonts && document.fonts.load) {
      const missing = FACES.filter((f) => { try { return !document.fonts.check(f); } catch (e) { return false; } });
      if (missing.length) {
        Promise.all(missing.map((f) => document.fonts.load(f)))
          .then(() => renderCard(canvas, activity, Object.assign({}, opts, { _afterFonts: true })), () => {});
      }
    }

    return canvas;
  }

  /* --- Blocks --------------------------------------------------------------
     Each draws one part of the card and records the box it took. ---------- */

  /** Draws text and records its inked box. */
  function text(L, str, x, y, name, parent) {
    const { ctx } = L;
    ctx.fillText(str, x, y);
    const m = ctx.measureText(str);
    const left = ctx.textAlign === 'right' ? x - m.width : x;
    L.layout.push({
      name, parent: parent || null,
      x: left, y: y - (m.actualBoundingBoxAscent || 0),
      w: m.width, h: (m.actualBoundingBoxAscent || 0) + (m.actualBoundingBoxDescent || 0),
    });
    return m.width;
  }

  function drawHeader(L, K, caption) {
    const { ctx, theme } = L;
    ctx.fillStyle = INK.hi;
    ctx.font = `italic 800 64px ${NUM}`;
    const markW = text(L, 'MILES', PAD - 2, PAD + 52, 'mark');

    ctx.font = `700 26px ${SANS}`;
    const tagW = ctx.measureText(K.badge).width + 32;
    const tagX = PAD + markW + 26;
    roundRect(ctx, tagX, PAD + 10, tagW, 46, 8);
    ctx.lineWidth = 2;
    ctx.strokeStyle = theme.ink;
    ctx.globalAlpha = 0.6;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = theme.ink;
    ctx.fillText(K.badge, tagX + 16, PAD + 42);
    L.layout.push({ name: 'tag', parent: null, x: tagX, y: PAD + 10, w: tagW, h: 46 });

    // What the run came to, small, opposite the wordmark — and never so long
    // that it runs into the tag.
    ctx.fillStyle = INK.lo;
    fitFont(ctx, caption, 600, 26, SANS, W - PAD - (tagX + tagW + 32));
    ctx.textAlign = 'right';
    text(L, caption, W - PAD, PAD + 42, 'caption');
    ctx.textAlign = 'left';
  }

  /** The date is half of what a run was: large, in the numbers' face. */
  function drawDate(L, activity, baseline) {
    const { ctx } = L;
    const at = new Date(activity.startedAt);
    const date = at.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    const time = at.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    ctx.fillStyle = INK.hi;
    ctx.font = `700 116px ${NUM}`;
    const dateW = text(L, date, PAD - 4, baseline, 'date');
    ctx.fillStyle = INK.mid;
    ctx.font = `600 40px ${SANS}`;
    text(L, time, PAD - 4 + dateW + 22, baseline, 'time');
  }

  /** The headline number, leaning like the wordmark. Long ones step down. */
  function drawHero(L, headline, baseline, size) {
    const { ctx } = L;
    ctx.font = `700 ${Math.round(size * 0.23)}px ${SANS}`;
    const unitW = ctx.measureText(headline.unit).width;
    fitFont(ctx, headline.value, 'italic 700', size, NUM, W - PAD * 2 - unitW - 24);
    ctx.fillStyle = INK.hi;
    const valueW = text(L, headline.value, PAD - 8, baseline, 'hero');
    ctx.fillStyle = INK.mid;
    ctx.font = `700 ${Math.round(size * 0.23)}px ${SANS}`;
    text(L, headline.unit, PAD - 8 + valueW + 24, baseline, 'unit');
  }

  /** Highlights as plates in a row; one that would not fit is left off. */
  function drawBadges(L, lines, top) {
    const { ctx, theme } = L;
    if (!lines.length) return 0;
    ctx.font = `700 26px ${SANS}`;
    let x = PAD;
    let drawn = 0;
    lines.forEach((line, i) => {
      const w = ctx.measureText(line).width + 72;
      if (x + w > W - PAD) return;
      roundRect(ctx, x, top, w, 50, 12);
      ctx.fillStyle = INK.plate;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = INK.line;
      ctx.stroke();
      ctx.fillStyle = i ? '#eab052' : theme.accent;
      ctx.fillRect(x + 22, top + 19, 12, 12);
      ctx.fillStyle = INK.hi;
      ctx.fillText(line, x + 48, top + 34);
      L.layout.push({ name: 'badge', parent: null, x, y: top, w, h: 50 });
      x += w + 14;
      drawn++;
    });
    return drawn ? top + 50 : 0;
  }

  function drawMapPanel(L, activity, panel, outcome, seed) {
    const { ctx, theme } = L;
    const view = routeMap(activity, panel, outcome ? 86 : 0);
    roundRect(ctx, panel.x, panel.y, panel.w, panel.h, 40);
    ctx.fillStyle = INK.panel;
    ctx.fill();
    ctx.save();
    roundRect(ctx, panel.x, panel.y, panel.w, panel.h, 40);
    ctx.clip();
    if (view) ctx.drawImage(view.canvas, panel.x, panel.y, panel.w, panel.h);
    else M.Visual.contours(ctx, panel, theme.accent, seed, { line: 0.1, index: 0.22, width: 2.2 });
    ctx.restore();
    roundRect(ctx, panel.x, panel.y, panel.w, panel.h, 40);
    ctx.lineWidth = 2;
    ctx.strokeStyle = INK.line;
    ctx.stroke();
    L.layout.push({ name: 'panel', parent: null, x: panel.x, y: panel.y, w: panel.w, h: panel.h });

    drawRoute(ctx, activity, panel, theme, view);

    if (outcome) {
      ctx.font = `700 26px ${SANS}`;
      const ow = ctx.measureText(outcome.text).width + 76;
      const ox = panel.x + 28;
      const oy = panel.y + panel.h - 28 - 58;
      roundRect(ctx, ox, oy, ow, 58, 12);
      ctx.fillStyle = INK.plate;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = INK.line;
      ctx.stroke();
      ctx.fillStyle = outcome.color;
      ctx.fillRect(ox + 22, oy + 23, 12, 12);
      ctx.fillText(outcome.text, ox + 50, oy + 38);
      L.layout.push({ name: 'outcome', parent: 'panel', x: ox, y: oy, w: ow, h: 58 });
    }
    return view;
  }

  /** The route alone, fitted into a box — the poster's and the sticker's. */
  function drawShape(L, activity, box) {
    const { ctx, theme, sticker } = L;
    const route = activity.route || [];
    L.layout.push({ name: 'shape', parent: null, x: box.x, y: box.y, w: box.w, h: box.h });
    if (route.length < 2) {
      ctx.fillStyle = INK.lo;
      ctx.font = `600 30px ${SANS}`;
      ctx.textAlign = 'center';
      ctx.fillText('No GPS trace', box.x + box.w / 2, box.y + box.h / 2);
      ctx.textAlign = 'left';
      return;
    }
    const origin = route[0];
    const proj = route.map((p) => Geo.project(p, origin));
    const xs = proj.map((p) => p.x);
    const ys = proj.map((p) => p.y);
    const minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs);
    const minY = Math.min.apply(null, ys), maxY = Math.max.apply(null, ys);
    const inner = 40;
    const scale = Math.min((box.w - inner * 2) / Math.max(1, maxX - minX), (box.h - inner * 2) / Math.max(1, maxY - minY));
    const ox = box.x + (box.w - (maxX - minX) * scale) / 2 - minX * scale;
    const oy = box.y + (box.h - (maxY - minY) * scale) / 2 - minY * scale;
    const at = (p) => ({ x: p.x * scale + ox, y: p.y * scale + oy });

    ctx.save();
    ctx.beginPath();
    proj.forEach((p, i) => { const q = at(p); if (i) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y); });
    if (activity.claimedArea > 0) {
      ctx.closePath();
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = theme.accent;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.lineJoin = ctx.lineCap = 'round';
    ctx.strokeStyle = sticker ? 'rgba(0, 0, 0, 0.35)' : INK.ground;
    ctx.lineWidth = 30;
    ctx.stroke();
    ctx.strokeStyle = theme.accent;
    ctx.lineWidth = 14;
    ctx.stroke();
    const a = at(proj[0]);
    const b = at(proj[proj.length - 1]);
    ctx.lineWidth = 8;
    ctx.fillStyle = sticker ? 'rgba(0, 0, 0, 0.6)' : INK.ground;
    ctx.beginPath(); ctx.arc(a.x, a.y, 20, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = theme.accent;
    ctx.beginPath(); ctx.arc(b.x, b.y, 14, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  /**
   * The splits, fitted to the room they are given. As rows while each row
   * can be at least 36px tall; past that — a long run, or the highlights and
   * the elevation line both on — as columns, which fit any number. Either
   * way the block is drawn inside its box and nothing outside it moves.
   */
  function drawSplits(L, splits, box) {
    const { ctx, theme } = L;
    L.layout.push({ name: 'splits', parent: null, x: box.x, y: box.y, w: box.w, h: box.h });
    const n = splits.length;
    if (!n) return;
    const secs = splits.map((x) => x.seconds);
    const fastest = Math.min.apply(null, secs);
    const slowest = Math.max.apply(null, secs);
    const rowH = Math.min(64, box.h / n);

    if (rowH >= 36) {
      const labelPx = Math.round(Math.max(22, Math.min(30, rowH * 0.5)));
      const timePx = Math.round(Math.max(30, Math.min(50, rowH * 0.78)));
      const barH = Math.round(Math.max(10, Math.min(16, rowH * 0.28)));
      const top = box.y + (box.h - rowH * n) / 2;
      const barX = box.x + 130;
      const barW = box.w - 130 - 150;
      splits.forEach((sp, i) => {
        const y = top + rowH * i;
        const mid = y + rowH / 2;
        const best = sp.seconds === fastest;
        ctx.fillStyle = best ? theme.ink : INK.lo;
        ctx.font = `600 ${labelPx}px ${SANS}`;
        text(L, `${sp.km} km`, box.x, mid + labelPx * 0.36, 'split-label', 'splits');
        ctx.fillStyle = 'rgba(243, 236, 224, 0.07)';
        ctx.fillRect(barX, mid - barH / 2, barW, barH);
        ctx.fillStyle = best ? theme.accent : 'rgba(243, 236, 224, 0.4)';
        ctx.fillRect(barX, mid - barH / 2, barW * (fastest / sp.seconds), barH);
        L.layout.push({ name: 'split-bar', parent: 'splits', x: barX, y: mid - barH / 2, w: barW, h: barH });
        ctx.fillStyle = INK.hi;
        ctx.font = `700 ${timePx}px ${NUM}`;
        ctx.textAlign = 'right';
        text(L, clock(sp.seconds), box.x + box.w, mid + timePx * 0.35, 'split-time', 'splits');
        ctx.textAlign = 'left';
      });
      return;
    }

    // Columns: one per kilometre, taller for quicker, the quickest in colour
    // with its time over it. Kilometre numbers every five under the axis.
    const labelH = 40;
    const headH = 52;
    const chart = { x: box.x, y: box.y + headH, w: box.w, h: box.h - headH - labelH };
    const gap = Math.max(2, Math.min(10, chart.w / n * 0.25));
    const colW = (chart.w - gap * (n - 1)) / n;
    const range = Math.max(1e-6, fastest / fastest - fastest / slowest);
    let bestX = 0;
    let bestTop = 0;
    splits.forEach((sp, i) => {
      const speed = (fastest / sp.seconds - fastest / slowest) / range;       // 0 slowest … 1 quickest
      const h = chart.h * (0.35 + 0.65 * speed);
      const x = chart.x + i * (colW + gap);
      const y = chart.y + chart.h - h;
      const best = sp.seconds === fastest;
      ctx.fillStyle = best ? theme.accent : 'rgba(243, 236, 224, 0.35)';
      ctx.fillRect(x, y, colW, h);
      if (best) { bestX = x + colW / 2; bestTop = y; }
      if (sp.km === 1 || sp.km % 5 === 0) {
        ctx.fillStyle = INK.lo;
        ctx.font = `600 24px ${SANS}`;
        ctx.textAlign = 'center';
        text(L, String(sp.km), x + colW / 2, chart.y + chart.h + 32, 'split-axis', 'splits');
        ctx.textAlign = 'left';
      }
    });
    L.layout.push({ name: 'split-chart', parent: 'splits', x: chart.x, y: chart.y, w: chart.w, h: chart.h });
    ctx.fillStyle = theme.ink;
    ctx.font = `700 40px ${NUM}`;
    const label = `Fastest ${clock(fastest)}`;
    const lw = ctx.measureText(label).width;
    const lx = Math.max(box.x, Math.min(box.x + box.w - lw, bestX - lw / 2));
    text(L, label, lx, Math.min(bestTop - 12, chart.y - 10), 'split-best', 'splits');
  }

  /** The climb along the run, as a thin line over a faint fill. */
  function drawProfile(L, alts, box) {
    const { ctx } = L;
    const lo = Math.min.apply(null, alts);
    const hi = Math.max.apply(null, alts);
    const span = Math.max(4, hi - lo);                  // a flat run stays flat
    const pt = (v, i) => [box.x + (i / (alts.length - 1)) * box.w, box.y + box.h - 4 - ((v - lo) / span) * (box.h - 8)];
    ctx.beginPath();
    alts.forEach((v, i) => { const [x, y] = pt(v, i); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
    ctx.lineTo(box.x + box.w, box.y + box.h);
    ctx.lineTo(box.x, box.y + box.h);
    ctx.closePath();
    ctx.fillStyle = 'rgba(243, 236, 224, 0.07)';
    ctx.fill();
    ctx.beginPath();
    alts.forEach((v, i) => { const [x, y] = pt(v, i); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
    ctx.strokeStyle = 'rgba(243, 236, 224, 0.55)';
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.stroke();
    L.layout.push({ name: 'profile', parent: null, x: box.x, y: box.y, w: box.w, h: box.h });
  }

  /**
   * The chosen numbers: the value, its unit beside it, a plain word under it,
   * a hairline between columns. One, two or three, sharing the width.
   */
  function drawStats(L, stats, baseline, bare) {
    const { ctx } = L;
    const n = Math.max(1, stats.length);
    const colW = (W - PAD * 2) / n;
    stats.forEach((s, i) => {
      const x = PAD + colW * i + (i ? 32 : 0);
      if (i && !bare) {
        ctx.fillStyle = INK.line;
        ctx.fillRect(PAD + colW * i, baseline - 78, 2, 130);
      }
      ctx.font = `600 28px ${SANS}`;
      const uw = s.unit ? ctx.measureText(s.unit).width + 10 : 0;
      fitFont(ctx, s.value, 700, 96, NUM, colW - (i ? 32 : 0) - 24 - uw);
      ctx.fillStyle = INK.hi;
      const vw = text(L, s.value, x, baseline, 'stat', null);
      if (s.unit) {
        ctx.fillStyle = INK.mid;
        ctx.font = `600 28px ${SANS}`;
        text(L, s.unit, x + vw + 10, baseline, 'stat', null);
      }
      ctx.fillStyle = INK.lo;
      ctx.font = `600 28px ${SANS}`;
      text(L, s.label, x, baseline + 48, 'stat', null);
    });
  }

  function drawFooter(L, activity, opts) {
    const { ctx, theme } = L;
    const kind = activity.kind || 'free';
    ctx.fillStyle = INK.line;
    ctx.fillRect(PAD, 1232, W - PAD * 2, 2);
    ctx.fillStyle = theme.ink;
    ctx.fillRect(PAD, 1270, 14, 14);
    ctx.fillStyle = INK.hi;
    ctx.font = `700 32px ${SANS}`;
    text(L, opts.athlete || 'You', PAD + 30, 1288, 'footer');

    let right = '';
    if (kind === 'race' && activity.placing) {
      const beat = activity.fieldSize - activity.placing;
      right = activity.placing === 1 ? `Won${SEP}beat ${beat}` : `${ordinal(activity.placing)} of ${activity.fieldSize}`;
    } else if (kind === 'territory') {
      right = `${Units.areaText(opts.totalArea || activity.claimedArea)} ${Units.areaLabel()} held`;
    } else if (opts.rank) {
      right = opts.rank;
    }
    if (!right) return;
    ctx.textAlign = 'right';
    ctx.fillStyle = INK.mid;
    ctx.font = `600 30px ${SANS}`;
    text(L, right, W - PAD, 1288, 'footer');
    ctx.textAlign = 'left';
  }

  /** The sticker's foot: the wordmark and when, and nothing else. */
  function drawStickerFoot(L, activity) {
    const { ctx } = L;
    ctx.fillStyle = INK.hi;
    ctx.font = `italic 800 64px ${NUM}`;
    text(L, 'MILES', PAD - 2, 1268, 'mark');
    const at = new Date(activity.startedAt);
    const when = `${at.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}${SEP}${at.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
    ctx.fillStyle = INK.hi;
    ctx.font = `600 32px ${SANS}`;
    ctx.textAlign = 'right';
    text(L, when, W - PAD, 1262, 'when');
    ctx.textAlign = 'left';
  }

  /* The card's map is drawn at a phone's density, so its streets and labels
     come out at the weight they have in the app rather than hairline-thin. */
  const MAP_DPR = 2.4;

  /**
   * The app's own map, drawn off-screen at the panel's size and framed on the
   * route. `reserve` keeps that many card pixels clear at the foot of the
   * panel. Returns null when there is no route to frame.
   */
  function routeMap(activity, panel, reserve) {
    const route = activity.route || [];
    if (route.length < 2 || !M.MapView) return null;
    const view = new M.MapView(document.createElement('canvas'), {
      size: { w: panel.w / MAP_DPR, h: panel.h / MAP_DPR }, dpr: MAP_DPR, padding: 30,
    });
    view.setAnchor(route[0]);
    // Frame in the room above the reserve, then slide the frame so the route
    // sits in that room rather than in the middle of the whole panel.
    const fullH = view.h;
    view.h = (panel.h - reserve) / MAP_DPR;
    view.fit([route]);
    view.h = fullH;
    const c = Geo.project(view.center, view.anchor);
    c.y += (reserve / MAP_DPR / 2) * view.mpp;
    view.center = Geo.unproject(c, view.anchor);
    view.draw();
    view.destroy();
    return view;
  }

  function drawRoute(ctx, activity, panel, theme, view) {
    const route = activity.route || [];
    if (route.length < 2) {
      ctx.fillStyle = INK.lo;
      ctx.font = `600 30px ${SANS}`;
      ctx.textAlign = 'center';
      ctx.fillText('No GPS trace', panel.x + panel.w / 2, panel.y + panel.h / 2);
      ctx.textAlign = 'left';
      return;
    }

    // Points go through the map's own projection, so the line lands on the
    // streets it was run along.
    const at = (latlng) => {
      const s = view.toScreen(latlng);
      return { x: panel.x + s.x * MAP_DPR, y: panel.y + s.y * MAP_DPR };
    };
    const proj = route;

    ctx.save();
    ctx.beginPath();
    roundRect(ctx, panel.x, panel.y, panel.w, panel.h, 40);
    ctx.clip();
    ctx.beginPath();
    proj.forEach((p, i) => {
      const s = at(p);
      if (i === 0) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y);
    });

    // A closed loop is land: fill it before stroking the route.
    if (activity.claimedArea > 0) {
      ctx.closePath();
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = theme.accent;
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    ctx.lineJoin = ctx.lineCap = 'round';
    ctx.strokeStyle = INK.ground;
    ctx.lineWidth = 22;
    ctx.stroke();
    ctx.strokeStyle = theme.accent;
    ctx.lineWidth = 9;
    ctx.stroke();

    // Start is a ring, finish is a dot — the two ends told apart by shape,
    // not by a second colour.
    const start = at(proj[0]);
    const end = at(proj[proj.length - 1]);
    ctx.lineWidth = 6;
    ctx.strokeStyle = theme.accent;
    ctx.fillStyle = INK.ground;
    ctx.beginPath();
    ctx.arc(start.x, start.y, 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(end.x, end.y, 15, 0, Math.PI * 2);
    ctx.fillStyle = INK.ground;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(end.x, end.y, 10, 0, Math.PI * 2);
    ctx.fillStyle = theme.accent;
    ctx.fill();
    ctx.restore();
  }

  function ordinal(n) {
    if (!n) return '—';
    const tens = n % 100;
    if (tens >= 11 && tens <= 13) return n + 'th';
    return n + (['th', 'st', 'nd', 'rd'][n % 10] || 'th');
  }

  /** Saves the card as a PNG. Falls back to opening it in a tab. */
  function downloadCard(canvas, filename) {
    try {
      const url = canvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = url;
      a.download = filename || 'miles-run.png';
      document.body.appendChild(a);
      a.click();
      a.remove();
      return true;
    } catch (err) {
      try { window.open(canvas.toDataURL('image/png'), '_blank'); } catch (e2) { /* ignore */ }
      return false;
    }
  }

  M.renderCard = renderCard;
  M.CARD_THEMES = THEME_NAMES;
  M.CARD_TEMPLATES = TEMPLATES;
  M.cardThemesFor = themesFor;
  M.cardTemplatesFor = templatesFor;
  M.cardStatsFor = (activity) => {
    const all = statsFor(activity);
    return STAT_ORDER.filter((k) => all[k]).map((k) => ({ key: k, label: all[k].label }));
  };
  M.cardPickStats = pickStats;
  M.cardHasProfile = (activity) => !!profileOf(activity);
  M.ordinal = ordinal;
  M.downloadCard = downloadCard;
})(window.MILES);
