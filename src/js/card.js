/* ==========================================================================
   MILES · record card
   The shareable artefact of a run: route, headline numbers, territory and
   the duel result, drawn to a 1080×1350 canvas and exportable as a PNG.

   It is the app's own page, not a poster in another style: the same warm
   ground, the same two faces, the run kind's own colour, and the route laid
   over the survey contours that sit behind every drawn card in the app.
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
  };

  const THEME_NAMES = { chalk: 'Chalk', flame: 'Flame', violet: 'Violet', rose: 'Rose' };

  /* The faces the card is set in. A canvas only draws a web font the page
     has already loaded, and on a first run nothing on screen may have asked
     for the italic wordmark yet — so the first paint can fall back, and the
     card is painted again once they arrive. */
  const FACES = [
    `italic 800 64px ${NUM}`, `700 100px ${NUM}`,
    `600 30px ${SANS}`, `700 30px ${SANS}`,
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

  /**
   * Draws the card for an activity.
   * @param {HTMLCanvasElement} canvas
   * @param {object} activity
   * @param {object} [options] – { theme, athlete, rank, totalArea }
   */
  function renderCard(canvas, activity, options) {
    const opts = options || {};
    const kind = activity.kind || 'free';
    const K = M.KINDS[kind] || M.KINDS.free;
    const theme = THEMES[opts.theme] || { accent: K.accent, ink: K.ink };
    const seed = Math.floor((activity.startedAt || 7000) / 1000) % 9973;
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';

    /* --- Ground ---------------------------------------------------------- */
    ctx.fillStyle = INK.ground;
    ctx.fillRect(0, 0, W, H);

    /* --- Header: the wordmark, what kind of run, when --------------------
       Set as the app sets it: the leaning condensed MILES, and the kind as a
       small outlined tag in sentence case rather than a neon pill. -------- */
    ctx.fillStyle = INK.hi;
    ctx.font = `italic 800 64px ${NUM}`;
    ctx.fillText('MILES', PAD - 2, PAD + 52);
    const markW = ctx.measureText('MILES').width;

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

    const date = new Date(activity.startedAt).toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric',
    });
    const time = new Date(activity.startedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    ctx.font = `600 26px ${SANS}`;
    ctx.fillStyle = INK.lo;
    ctx.textAlign = 'right';
    ctx.fillText(`${date}${SEP}${time}`, W - PAD, PAD + 42);
    ctx.textAlign = 'left';

    /* --- The one number this run was about --------------------------------
       A race is about where you came; a territory run is about how much
       ground you took; a free run is about the distance. Whichever it is
       gets the headline, and the other numbers fall in behind it. ---------- */

    const headline = kind === 'race' && activity.placing
      ? { value: ordinal(activity.placing), unit: `of ${activity.fieldSize}`, caption: activity.finished ? `Finished the ${Units.distText(activity.target)} ${Units.distLabel()}` : 'Did not finish' }
      : kind === 'territory' && activity.claimedArea
        ? { value: Units.areaText(activity.claimedArea), unit: Units.areaLabel(), caption: 'Claimed by closing the loop' }
        : { value: Units.distText(activity.distance), unit: Units.distLabel(), caption: kind === 'territory' ? 'No loop closed — no land taken' : activity.title || 'Run' };

    ctx.fillStyle = INK.mid;
    ctx.font = `600 32px ${SANS}`;
    ctx.fillText(headline.caption, PAD, 238);

    // A long distance steps down in size rather than running off the card.
    ctx.font = `700 56px ${SANS}`;
    const unitW = ctx.measureText(headline.unit).width;
    fitFont(ctx, headline.value, 700, 264, NUM, W - PAD * 2 - unitW - 20);
    ctx.fillStyle = INK.hi;
    ctx.fillText(headline.value, PAD - 8, 452);
    const valueW = ctx.measureText(headline.value).width;

    ctx.fillStyle = INK.mid;
    ctx.font = `700 56px ${SANS}`;
    ctx.fillText(headline.unit, PAD - 8 + valueW + 20, 452);

    /* --- The ground it covered ---------------------------------------------
       A panel of survey contours in the run's colour, with the route laid
       over it the way a map lays a line: a dark casing under a solid stroke.
       It used to glow, which is what a neon line on black always does. --- */
    const panel = { x: PAD, y: 500, w: W - PAD * 2, h: 510 };
    roundRect(ctx, panel.x, panel.y, panel.w, panel.h, 40);
    ctx.fillStyle = INK.panel;
    ctx.fill();
    ctx.save();
    roundRect(ctx, panel.x, panel.y, panel.w, panel.h, 40);
    ctx.clip();
    M.Visual.contours(ctx, panel, theme.accent, seed, { line: 0.1, index: 0.22, width: 2.2 });
    ctx.restore();
    roundRect(ctx, panel.x, panel.y, panel.w, panel.h, 40);
    ctx.lineWidth = 2;
    ctx.strokeStyle = INK.line;
    ctx.stroke();

    /* --- What came of it --------------------------------------------------
       One line on a dark plate in the panel's corner, the way the app labels
       its own map: a square of colour and the words, in sentence case. The
       route is fitted above the plate, so the plate never covers either end
       of it. ------------------------------------------------------------- */
    const outcome = kind === 'territory'
      ? (activity.claimedArea > 0 ? { text: `Loop closed${SEP}land taken`, color: theme.ink } : { text: 'Loop not closed', color: INK.lo })
      : kind === 'race'
        ? (activity.finished ? { text: `Crossed the line ${ordinal(activity.placing)}`, color: theme.ink } : { text: 'Did not finish', color: INK.lo })
        : null;

    drawRoute(ctx, activity, panel, theme, outcome ? 86 : 0);

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
    }

    /* --- Stat row ---------------------------------------------------------
       Whatever the headline took, distance always appears here, so the three
       cells read the same way on every card. Laid out like the app's own
       figures: the number, its unit beside it, and a plain word under it,
       with a hairline between the columns. -------------------------------- */
    const stats = [
      { label: 'Distance', value: Units.distText(activity.distance), unit: Units.distLabel() },
      { label: 'Time', value: clock(activity.duration) },
      { label: 'Pace', value: Units.paceText(activity.duration / Math.max(1, activity.distance)), unit: Units.paceLabel() },
    ];

    const colW = (W - PAD * 2) / stats.length;
    stats.forEach((s, i) => {
      const x = PAD + colW * i + (i ? 32 : 0);
      if (i) {
        ctx.fillStyle = INK.line;
        ctx.fillRect(PAD + colW * i, 1062, 2, 130);
      }
      // A ten-hour run's clock still fits its column.
      ctx.font = `600 28px ${SANS}`;
      const uw = s.unit ? ctx.measureText(s.unit).width + 10 : 0;
      fitFont(ctx, s.value, 700, 96, NUM, colW - (i ? 32 : 0) - 24 - uw);
      ctx.fillStyle = INK.hi;
      ctx.fillText(s.value, x, 1140);
      if (s.unit) {
        const vw = ctx.measureText(s.value).width;
        ctx.fillStyle = INK.mid;
        ctx.font = `600 28px ${SANS}`;
        ctx.fillText(s.unit, x + vw + 10, 1140);
      }
      ctx.fillStyle = INK.lo;
      ctx.font = `600 28px ${SANS}`;
      ctx.fillText(s.label, x, 1188);
    });

    /* --- Footer: who ran it, and what it came to --------------------------- */
    ctx.fillStyle = INK.line;
    ctx.fillRect(PAD, 1232, W - PAD * 2, 2);

    ctx.fillStyle = theme.ink;
    ctx.fillRect(PAD, 1270, 14, 14);
    ctx.fillStyle = INK.hi;
    ctx.font = `700 32px ${SANS}`;
    ctx.fillText(opts.athlete || 'You', PAD + 30, 1288);

    let right = '';
    if (kind === 'race' && activity.placing) {
      const beat = activity.fieldSize - activity.placing;
      right = activity.placing === 1
        ? `Won${SEP}beat ${beat}`
        : `${ordinal(activity.placing)} of ${activity.fieldSize}`;
    } else if (kind === 'territory') {
      right = `${Units.areaText(opts.totalArea || activity.claimedArea)} ${Units.areaLabel()} held`;
    } else if (opts.rank) {
      right = opts.rank;
    }
    ctx.textAlign = 'right';
    ctx.fillStyle = INK.mid;
    ctx.font = `600 30px ${SANS}`;
    ctx.fillText(right, W - PAD, 1288);
    ctx.textAlign = 'left';

    // The same fine grain that sits over the app, so the card is paper too.
    M.Visual._grain(ctx, W, H, seed + 3);

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

  /** `reserve` keeps that many pixels clear at the foot of the panel. */
  function drawRoute(ctx, activity, panel, theme, reserve) {
    const route = activity.route || [];
    if (route.length < 2) {
      ctx.fillStyle = INK.lo;
      ctx.font = `600 30px ${SANS}`;
      ctx.textAlign = 'center';
      ctx.fillText('No GPS trace', panel.x + panel.w / 2, panel.y + panel.h / 2);
      ctx.textAlign = 'left';
      return;
    }

    const inner = 72;
    const origin = route[0];
    const proj = route.map((p) => Geo.project(p, origin));
    const minX = Math.min.apply(null, proj.map((p) => p.x));
    const maxX = Math.max.apply(null, proj.map((p) => p.x));
    const minY = Math.min.apply(null, proj.map((p) => p.y));
    const maxY = Math.max.apply(null, proj.map((p) => p.y));
    const room = panel.h - (reserve || 0);
    const scale = Math.min((panel.w - inner * 2) / Math.max(1, maxX - minX),
                           (room - inner * 2) / Math.max(1, maxY - minY));
    const ox = panel.x + (panel.w - (maxX - minX) * scale) / 2 - minX * scale;
    const oy = panel.y + (room - (maxY - minY) * scale) / 2 - minY * scale;
    const at = (p) => ({ x: p.x * scale + ox, y: p.y * scale + oy });

    ctx.save();
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
  M.ordinal = ordinal;
  M.downloadCard = downloadCard;
})(window.MILES);
