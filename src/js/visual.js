/* ==========================================================================
   MILES · visual
   The app's photography, drawn rather than shot.

   ── Why not photographs ─────────────────────────────────────────────────
   A premium sports app leans on imagery, and a running app's imagery should
   be of running. But a stock photo of somebody else's run is a stock photo:
   it is the same picture in every app that bought it, it needs a licence for
   release, it is a download that can fail, and it knows nothing about the
   person looking at it.

   So these are generated instead — the same hour of day you are running in,
   the skyline of the city the map is drawing, and your own most recent route
   laid through it. They cost no request, cannot 404, carry no licence, and
   are different for every runner because they are made of that runner's
   week. `Visual.photo()` is the seam: give it a real image and it will use
   it, with one of these underneath as the fallback.
   ========================================================================== */

(function (M) {
  'use strict';

  const { Geo, clamp, rng } = M;

  /* Dawn, day, dusk, night. Running happens at the edges of the day and the
     sky is the cheapest way to say which edge you are on. */
  const SKIES = {
    dawn:  { top: '#1b1030', mid: '#7a2b4d', low: '#ff8a4c', sun: '#ffc46b', horizon: 0.72 },
    day:   { top: '#0b2233', mid: '#17506b', low: '#4fa3b8', sun: '#cfeaf2', horizon: 0.74 },
    dusk:  { top: '#120a24', mid: '#5b1f52', low: '#ff6a1f', sun: '#ffab6b', horizon: 0.70 },
    night: { top: '#04060c', mid: '#0d1a2e', low: '#1d3a5c', sun: '#9fc0e8', horizon: 0.76 },
  };

  function skyFor(date) {
    const h = (date || new Date()).getHours();
    if (h < 5) return SKIES.night;
    if (h < 9) return SKIES.dawn;
    if (h < 16) return SKIES.day;
    if (h < 20) return SKIES.dusk;
    return SKIES.night;
  }

  function fit(canvas) {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const w = Math.max(1, Math.round((rect.width || canvas.width || 320) * dpr));
    const h = Math.max(1, Math.round((rect.height || canvas.height || 200) * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w: w / dpr, h: h / dpr };
  }

  /** A city skyline, seeded so the same screen draws the same place twice. */
  function skyline(ctx, w, h, base, seed, shade, depth) {
    const rand = rng(seed);
    ctx.fillStyle = shade;
    let x = -20;
    while (x < w + 20) {
      const bw = 14 + rand() * 46;
      const bh = (18 + rand() * 96) * depth;
      const top = base - bh;
      ctx.fillRect(x, top, bw - 3, bh);
      // A few lit windows, because a skyline at dusk is not a silhouette.
      if (depth > 0.8 && rand() > 0.45) {
        ctx.save();
        ctx.fillStyle = 'rgba(255, 214, 150, 0.5)';
        for (let i = 0; i < 3; i++) {
          if (rand() > 0.55) ctx.fillRect(x + 4 + rand() * (bw - 12), top + 6 + rand() * (bh - 14), 2.5, 3.5);
        }
        ctx.restore();
      }
      x += bw;
    }
  }

  const Visual = {
    SKIES,

    /**
     * The home hero: the sky you are running under, the city the map draws,
     * and your latest route through it. `route` is optional — without one the
     * scene is still a place, just an empty one.
     */
    scene(canvas, options) {
      const opts = options || {};
      const { ctx, w, h } = fit(canvas);
      const sky = opts.sky || skyFor(opts.at ? new Date(opts.at) : null);
      const seed = opts.seed || 4021;
      const horizon = h * sky.horizon;

      ctx.clearRect(0, 0, w, h);

      // Sky.
      const g = ctx.createLinearGradient(0, 0, 0, horizon);
      g.addColorStop(0, sky.top);
      g.addColorStop(0.55, sky.mid);
      g.addColorStop(1, sky.low);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, horizon);

      // Sun, low and wide, doing the work of a lens flare.
      const sx = w * 0.72;
      const sy = horizon - h * 0.06;
      const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, h * 0.55);
      glow.addColorStop(0, sky.sun);
      glow.addColorStop(0.25, 'rgba(255, 180, 110, 0.35)');
      glow.addColorStop(1, 'rgba(255, 180, 110, 0)');
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, w, horizon);
      ctx.globalAlpha = 1;

      // Two ranks of buildings: far and hazy, near and solid.
      skyline(ctx, w, horizon + 1, horizon + 1, seed, 'rgba(10, 14, 22, 0.55)', 0.7);
      skyline(ctx, w, horizon + 1, horizon + 1, seed + 97, 'rgba(5, 8, 13, 0.92)', 1);

      // Ground.
      const gg = ctx.createLinearGradient(0, horizon, 0, h);
      gg.addColorStop(0, '#080c12');
      gg.addColorStop(1, '#05070a');
      ctx.fillStyle = gg;
      ctx.fillRect(0, horizon, w, h - horizon);

      if (opts.route && opts.route.length > 3) this._route(ctx, w, h, horizon, opts.route, opts.stroke);
      this._grain(ctx, w, h, seed);
      return { ctx, w, h };
    },

    /** The runner's own route, laid into the ground in perspective. */
    _route(ctx, w, h, horizon, route, stroke) {
      const origin = route[0];
      const pts = route.map((p) => Geo.project(p, origin));
      const xs = pts.map((p) => p.x);
      const ys = pts.map((p) => p.y);
      const minX = Math.min.apply(null, xs);
      const maxX = Math.max.apply(null, xs);
      const minY = Math.min.apply(null, ys);
      const maxY = Math.max.apply(null, ys);
      const span = Math.max(maxX - minX, maxY - minY, 1);

      // Sits low and small: the route is the ground this picture stands on,
      // not a chart over the number the hero is actually about.
      const band = h - horizon;
      const scale = (w * 0.52) / span;
      const ox = w * 0.66 - ((minX + maxX) / 2) * scale;
      const oy = horizon + band * 0.46 - ((minY + maxY) / 2) * scale * 0.38;

      ctx.save();
      // Flattened towards the horizon, so the route lies on the ground rather
      // than floating as a chart on top of a picture.
      const place = (p) => ({ x: p.x * scale + ox, y: p.y * scale * 0.38 + oy });
      ctx.beginPath();
      pts.forEach((p, i) => {
        const s = place(p);
        if (i === 0) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y);
      });
      ctx.lineJoin = ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
      ctx.lineWidth = 9;
      ctx.stroke();
      ctx.globalAlpha = 0.85;
      ctx.strokeStyle = stroke || '#f1ead9';
      ctx.lineWidth = 3;
      ctx.shadowColor = stroke || '#f1ead9';
      ctx.shadowBlur = 14;
      ctx.stroke();
      ctx.restore();
    },

    /** Film grain. Two per cent of noise is what stops a gradient looking cheap. */
    _grain(ctx, w, h, seed) {
      const rand = rng(seed + 5);
      ctx.save();
      ctx.globalAlpha = 0.045;
      for (let i = 0; i < Math.round(w * h * 0.03); i++) {
        ctx.fillStyle = rand() > 0.5 ? '#ffffff' : '#000000';
        ctx.fillRect(rand() * w, rand() * h, 1, 1);
      }
      ctx.restore();
    },

    /**
     * Contour lines of a hill, as on a survey map, stroked in one ink into a
     * box of a canvas that is already sized. It is the one motif behind every
     * drawn surface in the app — the start cards, the crew, the record card —
     * so they read as made by the same hand. `look` sets the line alphas and
     * the stroke width for the scale the box is drawn at.
     */
    contours(ctx, box, ink, seed, look) {
      const rand = rng(seed || 11);
      const { x, y, w, h } = box;
      const L = Object.assign({ line: 0.2, index: 0.42, width: 1 }, look || {});
      // One summit, off-centre, and the rings of ground falling away from it.
      const cx = x + w * (0.62 + rand() * 0.3);
      const cy = y + h * (0.18 + rand() * 0.5);
      const waves = [0, 1, 2].map(() => ({ f: 2 + Math.floor(rand() * 3), p: rand() * Math.PI * 2, a: 0.05 + rand() * 0.07 }));
      const step = Math.max(w, h) * 0.075;
      const rings = Math.ceil(Math.hypot(w, h) / step) + 2;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, w, h);
      ctx.clip();
      ctx.lineJoin = 'round';
      ctx.strokeStyle = ink;
      for (let k = 1; k <= rings; k++) {
        const base = k * step;
        ctx.globalAlpha = k % 5 === 0 ? L.index : L.line;   // every fifth an index line
        ctx.lineWidth = (k % 5 === 0 ? 1.5 : 1) * L.width;
        ctx.beginPath();
        for (let i = 0; i <= 96; i++) {
          const t = (i / 96) * Math.PI * 2;
          let r = base;
          waves.forEach((wv) => { r += base * wv.a * Math.sin(wv.f * t + wv.p + k * 0.23); });
          const px = cx + Math.cos(t) * r * 1.25;
          const py = cy + Math.sin(t) * r;
          if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
        }
        ctx.closePath();
        ctx.stroke();
      }
      ctx.restore();
    },

    /**
     * The picture for a card that has no route or photo to show — a crew, a
     * run mode: the contours above, in the card's one ink. It used to be two
     * glowing blobs and a few speed lines, which is what every generated
     * sports app reaches for.
     */
    band(canvas, options) {
      const opts = options || {};
      const { ctx, w, h } = fit(canvas);
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#12110f';
      ctx.fillRect(0, 0, w, h);
      this.contours(ctx, { x: 0, y: 0, w, h }, opts.from || '#f2642a', opts.seed || 11);
      this._grain(ctx, w, h, (opts.seed || 11) + 3);
      return { ctx, w, h };
    },

    /**
     * THE SEAM for real photography. Points an element at an image and falls
     * back to a drawn band if it is missing, slow or blocked — which is every
     * time in a sandboxed frame, and offline. Nothing here invents a URL: with
     * no `src` it goes straight to the drawn version.
     */
    photo(host, src, fallback) {
      const draw = () => {
        const canvas = host.querySelector('canvas') || host.appendChild(document.createElement('canvas'));
        canvas.className = 'visual-canvas';
        requestAnimationFrame(() => this.band(canvas, fallback || {}));
      };
      if (!src) { draw(); return; }

      const img = new Image();
      img.decoding = 'async';
      img.alt = '';
      img.className = 'visual-photo';
      img.onload = () => { host.innerHTML = ''; host.appendChild(img); };
      img.onerror = draw;
      img.src = src;
      draw();                       // something is on screen while it loads
    },
  };

  M.Visual = Visual;
})(window.MILES);
