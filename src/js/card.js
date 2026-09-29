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

  /* --- Layouts ------------------------------------------------------------
     Three ways to lay out the same run, the runner's pick: the route on the
     map, the route's shape on its own like a poster, or a see-through sticker
     for their own photo. The numbers are the same three on every card. The
     splits are not a layout: they are listed under the card already. ------- */

  const TEMPLATES = { map: 'Map', poster: 'Poster', sticker: 'Sticker' };

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

  /**
   * Time, pace and the climb. A run whose phone gave no altitude has no climb
   * to show, and its third number is the distance instead — or, when the
   * distance is already the headline, the average speed.
   */
  function statsOf(activity) {
    const a = activity;
    const out = [
      { label: 'Time', value: clock(a.duration) },
      { label: 'Pace', value: Units.paceText(a.duration / Math.max(1, a.distance)), unit: Units.paceLabel() },
    ];
    if (typeof a.elevation === 'number') out.push({ label: 'Elevation gain', value: Units.elevText(a.elevation), unit: Units.elevLabel() });
    else if (!headlineOf(a).isDistance) out.push({ label: 'Distance', value: Units.distText(a.distance), unit: Units.distLabel() });
    else out.push({ label: 'Avg speed', value: Units.speed(a.distance / Math.max(1, a.duration)).toFixed(1), unit: Units.speedLabel() });
    return out;
  }

  /**
   * Draws the card for an activity.
   * @param {HTMLCanvasElement} canvas
   * @param {object} activity
   * @param {object} [options] – { theme, athlete, rank, totalArea, template }
   *
   * Every block it draws is recorded, with its box, on `canvas.cardLayout` —
   * which is how the tests prove that nothing on the card lands on anything
   * else, in any layout.
   */
  function renderCard(canvas, activity, options) {
    const opts = options || {};
    const kind = activity.kind || 'free';
    const K = M.KINDS[kind] || M.KINDS.free;
    const theme = THEMES[opts.theme] || { accent: K.accent, ink: K.ink };
    const template = TEMPLATES[opts.template] ? opts.template : 'map';
    const sticker = template === 'sticker';
    const seed = Math.floor((activity.startedAt || 7000) / 1000) % 9973;
    const headline = headlineOf(activity);
    const stats = statsOf(activity);

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
      const panel = { x: PAD, y: 528, w: W - PAD * 2, h: 478 };
      canvas._view = drawMapPanel(L, activity, panel, outcome, seed);
      drawStats(L, stats, 1140);
      drawFooter(L, activity, opts);
    } else if (template === 'poster') {
      // The shape of the run, large and on its own, with the number under it.
      drawHeader(L, K, headline.caption);
      drawDate(L, activity, 262);
      drawShape(L, activity, { x: PAD, y: 306, w: W - PAD * 2, h: 524 });
      drawHero(L, headline, 1018, 240);
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

  /** The three numbers: value, unit beside it, a plain word under it. */
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
  M.CARD_THEME_COLOURS = THEMES;
  M.ordinal = ordinal;
  M.downloadCard = downloadCard;
})(window.MILES);
