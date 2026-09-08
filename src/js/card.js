/* ==========================================================================
   MILES · record card
   The shareable artefact of a run: route, headline numbers, territory and
   the duel result, drawn to a 1080×1350 canvas and exportable as a PNG.
   ========================================================================== */

(function (M) {
  'use strict';

  const { Geo, Units, clock } = M;

  const W = 1080;
  const H = 1350;
  const PAD = 76;

  const THEMES = {
    lime:    { accent: '#c8ff2e', accent2: '#2fe0ff' },
    violet:  { accent: '#8b5cf6', accent2: '#2fe0ff' },
    magenta: { accent: '#ff3d8b', accent2: '#ffb020' },
    amber:   { accent: '#ffb020', accent2: '#c8ff2e' },
  };

  const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
  const MONO = '"SF Mono", "JetBrains Mono", "Roboto Mono", ui-monospace, monospace';

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

  /** Letter-spaced text, drawn manually so it renders the same everywhere. */
  function tracked(ctx, text, x, y, spacing) {
    let cursor = x;
    for (const ch of text) {
      ctx.fillText(ch, cursor, y);
      cursor += ctx.measureText(ch).width + spacing;
    }
    return cursor - spacing - x;
  }

  function trackedWidth(ctx, text, spacing) {
    let w = 0;
    for (const ch of text) w += ctx.measureText(ch).width + spacing;
    return w - spacing;
  }

  /**
   * Draws the card for an activity.
   * @param {HTMLCanvasElement} canvas
   * @param {object} activity
   * @param {object} [options] – { theme, athlete, rank }
   */
  function renderCard(canvas, activity, options) {
    const opts = options || {};
    const kind = activity.kind || 'free';
    const theme = THEMES[opts.theme || (kind === 'territory' ? 'violet' : kind === 'race' ? 'magenta' : 'lime')];
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');

    /* --- Backdrop -------------------------------------------------------- */
    const bg = ctx.createLinearGradient(0, 0, W * 0.4, H);
    bg.addColorStop(0, '#0c1219');
    bg.addColorStop(1, '#05070a');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    const glow = ctx.createRadialGradient(W * 0.78, H * 0.12, 0, W * 0.78, H * 0.12, W * 0.85);
    glow.addColorStop(0, theme.accent + '3a');
    glow.addColorStop(1, 'transparent');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);

    /* --- Header ---------------------------------------------------------- */
    ctx.fillStyle = '#f2f6fa';
    ctx.font = `800 40px ${FONT}`;
    ctx.textBaseline = 'alphabetic';
    tracked(ctx, 'MILES', PAD, PAD + 40, 11);

    const KIND_LABEL = { free: 'RUN', territory: 'TERRITORY', race: 'RACE' };
    const label = KIND_LABEL[kind] || 'RUN';
    // Measure the wordmark in the font it was actually drawn in, or the badge
    // lands on top of it.
    ctx.font = `800 40px ${FONT}`;
    const badgeX = PAD + trackedWidth(ctx, 'MILES', 11) + 30;
    ctx.font = `800 26px ${FONT}`;
    const labelW = trackedWidth(ctx, label, 4) + 44;
    roundRect(ctx, badgeX, PAD + 12, labelW, 44, 22);
    ctx.fillStyle = theme.accent;
    ctx.fill();
    ctx.fillStyle = '#05070a';
    tracked(ctx, label, badgeX + 22, PAD + 41, 4);

    const date = new Date(activity.startedAt).toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric',
    });
    const time = new Date(activity.startedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    ctx.font = `600 24px ${FONT}`;
    ctx.fillStyle = '#7d8b9d';
    ctx.textAlign = 'right';
    ctx.fillText(`${date} · ${time}`, W - PAD, PAD + 38);
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

    ctx.fillStyle = '#5f6d7e';
    ctx.font = `700 24px ${FONT}`;
    tracked(ctx, headline.caption.toUpperCase(), PAD, PAD + 122, 3);

    ctx.fillStyle = '#ffffff';
    ctx.font = `800 176px ${MONO}`;
    ctx.fillText(headline.value, PAD - 6, PAD + 292);
    const distW = ctx.measureText(headline.value).width;

    ctx.fillStyle = theme.accent;
    ctx.font = `800 50px ${FONT}`;
    ctx.fillText(headline.unit, PAD + distW + 14, PAD + 292);

    /* --- Route ------------------------------------------------------------ */
    const panel = { x: PAD, y: PAD + 360, w: W - PAD * 2, h: 520 };
    roundRect(ctx, panel.x, panel.y, panel.w, panel.h, 40);
    ctx.fillStyle = 'rgba(255,255,255,0.035)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.09)';
    ctx.stroke();

    drawRoute(ctx, activity, panel, theme);

    /* --- Outcome badge ---------------------------------------------------- */
    const badge = kind === 'territory'
      ? (activity.claimedArea > 0 ? { text: 'LOOP CLOSED · LAND TAKEN', fill: 'rgba(139, 92, 246, 0.92)' } : { text: 'LOOP NOT CLOSED', fill: 'rgba(255, 255, 255, 0.14)' })
      : kind === 'race'
        ? { text: activity.finished ? `CROSSED THE LINE ${ordinal(activity.placing).toUpperCase()}` : 'DID NOT FINISH', fill: activity.placing === 1 ? 'rgba(46, 230, 168, 0.92)' : 'rgba(255, 61, 139, 0.92)' }
        : null;

    if (badge) {
      ctx.font = `800 24px ${FONT}`;
      const bw = trackedWidth(ctx, badge.text, 3) + 52;
      roundRect(ctx, panel.x + 26, panel.y + panel.h - 74, bw, 50, 25);
      ctx.fillStyle = badge.fill;
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      tracked(ctx, badge.text, panel.x + 52, panel.y + panel.h - 40, 3);
    }

    /* --- Stat row ---------------------------------------------------------
       Whatever the headline took, distance always appears here, so the three
       cells read the same way on every card. --------------------------- */
    const stats = [
      { label: 'DISTANCE', value: Units.distText(activity.distance), suffix: Units.distLabel() },
      { label: 'TIME', value: clock(activity.duration) },
      { label: 'PACE', value: Units.paceText(activity.duration / Math.max(1, activity.distance)), suffix: Units.paceLabel() },
    ];

    const statY = panel.y + panel.h + 108;
    const colW = (W - PAD * 2) / stats.length;
    stats.forEach((s, i) => {
      const x = PAD + colW * i;
      ctx.fillStyle = '#6c7b8d';
      ctx.font = `800 22px ${FONT}`;
      tracked(ctx, s.label, x, statY - 52, 4);

      ctx.fillStyle = '#ffffff';
      ctx.font = `700 62px ${MONO}`;
      ctx.fillText(s.value, x, statY);
      if (s.suffix) {
        const vw = ctx.measureText(s.value).width;
        ctx.fillStyle = '#7d8b9d';
        ctx.font = `700 26px ${FONT}`;
        ctx.fillText(s.suffix, x + vw + 10, statY);
      }
    });

    /* --- Footer: duel result or athlete ---------------------------------- */
    const footY = H - PAD - 46;
    roundRect(ctx, PAD, footY - 44, W - PAD * 2, 92, 30);
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fill();

    const athlete = opts.athlete || 'You';
    ctx.fillStyle = theme.accent;
    ctx.font = `800 30px ${FONT}`;
    ctx.fillText(athlete, PAD + 34, footY + 10);

    let right = '';
    let rightColor = '#9dabbd';
    if (kind === 'race' && activity.placing) {
      const beat = activity.fieldSize - activity.placing;
      right = activity.placing === 1
        ? `WON · BEAT ${beat}`
        : `${ordinal(activity.placing).toUpperCase()} OF ${activity.fieldSize}`;
      rightColor = activity.placing === 1 ? '#2ee6a8' : '#ff8ab6';
    } else if (kind === 'territory') {
      right = `${Units.areaText(opts.totalArea || activity.claimedArea)} ${Units.areaLabel()} HELD`;
      rightColor = '#b79dfb';
    } else if (opts.rank) {
      right = opts.rank.toUpperCase();
    }
    ctx.textAlign = 'right';
    ctx.fillStyle = rightColor;
    ctx.font = `800 28px ${FONT}`;
    ctx.fillText(right, W - PAD - 34, footY + 10);
    ctx.textAlign = 'left';

    return canvas;
  }

  function drawRoute(ctx, activity, panel, theme) {
    const route = activity.route || [];
    if (route.length < 2) {
      ctx.fillStyle = '#4b5768';
      ctx.font = `600 26px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText('No GPS trace', panel.x + panel.w / 2, panel.y + panel.h / 2);
      ctx.textAlign = 'left';
      return;
    }

    const inner = 64;
    const origin = route[0];
    const proj = route.map((p) => Geo.project(p, origin));
    const minX = Math.min.apply(null, proj.map((p) => p.x));
    const maxX = Math.max.apply(null, proj.map((p) => p.x));
    const minY = Math.min.apply(null, proj.map((p) => p.y));
    const maxY = Math.max.apply(null, proj.map((p) => p.y));
    const scale = Math.min((panel.w - inner * 2) / Math.max(1, maxX - minX),
                           (panel.h - inner * 2) / Math.max(1, maxY - minY));
    const ox = panel.x + (panel.w - (maxX - minX) * scale) / 2 - minX * scale;
    const oy = panel.y + (panel.h - (maxY - minY) * scale) / 2 - minY * scale;
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
      ctx.fillStyle = 'rgba(139, 92, 246, 0.26)';
      ctx.fill();
    }

    ctx.lineJoin = ctx.lineCap = 'round';
    ctx.strokeStyle = theme.accent + '40';
    ctx.lineWidth = 26;
    ctx.stroke();
    ctx.strokeStyle = theme.accent;
    ctx.lineWidth = 9;
    ctx.stroke();

    // Start and finish pins.
    const start = at(proj[0]);
    const end = at(proj[proj.length - 1]);
    ctx.fillStyle = '#05070a';
    ctx.strokeStyle = theme.accent;
    ctx.lineWidth = 6;
    [start, end].forEach((pt, i) => {
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, i === 0 ? 15 : 12, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });
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
  M.ordinal = ordinal;
  M.downloadCard = downloadCard;
})(window.MILES);
