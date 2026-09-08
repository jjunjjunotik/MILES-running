/* ==========================================================================
   MILES · map
   A self-contained canvas map. There is no tile server: the city is drawn
   procedurally from a fixed seed, which keeps the app fast, offline-capable
   and free of third-party requests. Routes, territories and live runners are
   real data drawn on top in true metres.
   ========================================================================== */

(function (M) {
  'use strict';

  const { Geo, clamp } = M;

  const CITY_ANGLE = -0.21;      // the grain of the street grid, radians
  const BLOCK = 92;              // metres between minor streets
  const AVENUE = 4;              // every Nth street is an avenue

  /* A stable hash so a block looks the same wherever you pan from. */
  function hash(i, j) {
    let h = (i * 374761393 + j * 668265263) ^ 0x5bf03635;
    h = (h ^ (h >> 13)) * 1274126177;
    return ((h ^ (h >> 16)) >>> 0) / 4294967296;
  }

  class MapView {
    constructor(canvas, options) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.opts = Object.assign({ mpp: 1.1, showGrid: true, padding: 26 }, options || {});
      this.anchor = M.DEFAULT_HOME;      // projection origin
      this.center = this.anchor;
      this.mpp = this.opts.mpp;
      this.layers = { territories: [], route: [], ghost: [], me: null, rivals: [] };
      this._dpr = 1;
      this._raf = null;
      this._resize();

      if (typeof ResizeObserver !== 'undefined') {
        this._ro = new ResizeObserver(() => { this._resize(); this.draw(); });
        this._ro.observe(canvas);
      }
    }

    destroy() {
      if (this._ro) this._ro.disconnect();
      if (this._raf) cancelAnimationFrame(this._raf);
    }

    _resize() {
      const rect = this.canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      const w = Math.max(1, Math.round(rect.width * dpr));
      const h = Math.max(1, Math.round(rect.height * dpr));
      if (this.canvas.width !== w || this.canvas.height !== h) {
        this.canvas.width = w;
        this.canvas.height = h;
      }
      this._dpr = dpr;
      this.w = rect.width || 1;
      this.h = rect.height || 1;
    }

    setAnchor(latlng) { this.anchor = latlng; }

    setCenter(latlng) { this.center = latlng; }

    /** Frames a set of points with padding; used after a run and on the map tab. */
    fit(pointGroups) {
      const pts = [].concat.apply([], pointGroups.filter(Boolean));
      if (!pts.length) return;
      const proj = pts.map((p) => Geo.project(p, this.anchor));
      const minX = Math.min(...proj.map((p) => p.x));
      const maxX = Math.max(...proj.map((p) => p.x));
      const minY = Math.min(...proj.map((p) => p.y));
      const maxY = Math.max(...proj.map((p) => p.y));
      const pad = this.opts.padding;
      const spanX = Math.max(40, maxX - minX);
      const spanY = Math.max(40, maxY - minY);
      this.mpp = clamp(Math.max(spanX / Math.max(1, this.w - pad * 2), spanY / Math.max(1, this.h - pad * 2)), 0.25, 40);
      this.center = Geo.unproject({ x: (minX + maxX) / 2, y: (minY + maxY) / 2 }, this.anchor);
    }

    toScreen(latlng) {
      const p = Geo.project(latlng, this.anchor);
      const c = Geo.project(this.center, this.anchor);
      return { x: (p.x - c.x) / this.mpp + this.w / 2, y: (p.y - c.y) / this.mpp + this.h / 2 };
    }

    /** Coalesces redraws into one frame. */
    invalidate() {
      if (this._raf) return;
      this._raf = requestAnimationFrame(() => { this._raf = null; this.draw(); });
    }

    draw() {
      const ctx = this.ctx;
      if (!this.w) this._resize();
      ctx.save();
      ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
      ctx.clearRect(0, 0, this.w, this.h);

      this._drawGround();
      if (this.opts.showGrid) this._drawCity();
      this._drawTerritories();
      this._drawGhost();
      this._drawRoute();
      this._drawRivals();
      this._drawMe();

      ctx.restore();
    }

    /* --- Layers ---------------------------------------------------------- */

    _drawGround() {
      const ctx = this.ctx;
      const g = ctx.createLinearGradient(0, 0, 0, this.h);
      g.addColorStop(0, '#0d131b');
      g.addColorStop(1, '#080c12');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, this.w, this.h);
    }

    _drawCity() {
      const ctx = this.ctx;
      const c = Geo.project(this.center, this.anchor);
      const reach = Math.hypot(this.w, this.h) * this.mpp * 0.62 + BLOCK * 3;

      ctx.save();
      ctx.translate(this.w / 2, this.h / 2);
      ctx.rotate(CITY_ANGLE);

      // The centre in the rotated street frame.
      const cos = Math.cos(-CITY_ANGLE);
      const sin = Math.sin(-CITY_ANGLE);
      const cx = c.x * cos - c.y * sin;
      const cy = c.x * sin + c.y * cos;

      const i0 = Math.floor((cx - reach) / BLOCK);
      const i1 = Math.ceil((cx + reach) / BLOCK);
      const j0 = Math.floor((cy - reach) / BLOCK);
      const j1 = Math.ceil((cy + reach) / BLOCK);

      // Blocks: parks, water and built-up land give the map somewhere to be.
      for (let i = i0; i < i1; i++) {
        for (let j = j0; j < j1; j++) {
          const n = hash(i, j);
          if (n > 0.9) ctx.fillStyle = 'rgba(46, 230, 168, 0.10)';        // park
          else if (n > 0.86) ctx.fillStyle = 'rgba(47, 224, 255, 0.09)';  // water
          else if (n > 0.5) ctx.fillStyle = 'rgba(255, 255, 255, 0.022)';
          else continue;
          const x = (i * BLOCK - cx) / this.mpp;
          const y = (j * BLOCK - cy) / this.mpp;
          const s = BLOCK / this.mpp;
          ctx.fillRect(x + s * 0.06, y + s * 0.06, s * 0.88, s * 0.88);
        }
      }

      // Streets.
      const drawLines = (isVertical) => {
        const start = isVertical ? i0 : j0;
        const end = isVertical ? i1 : j1;
        for (let k = start; k < end; k++) {
          const avenue = k % AVENUE === 0;
          const px = ((k * BLOCK) - (isVertical ? cx : cy)) / this.mpp;
          ctx.beginPath();
          ctx.lineWidth = avenue ? Math.max(1.6, 13 / this.mpp) : Math.max(0.7, 6 / this.mpp);
          ctx.strokeStyle = avenue ? 'rgba(255,255,255,0.115)' : 'rgba(255,255,255,0.05)';
          const span = reach / this.mpp;
          if (isVertical) { ctx.moveTo(px, -span); ctx.lineTo(px, span); }
          else { ctx.moveTo(-span, px); ctx.lineTo(span, px); }
          ctx.stroke();
        }
      };
      drawLines(true);
      drawLines(false);
      ctx.restore();
    }

    _drawTerritories() {
      const ctx = this.ctx;
      this.layers.territories.forEach((t) => {
        if (!t.polygon || t.polygon.length < 3) return;
        const mine = t.owner === 'me' || !t.owner;
        const stroke = t.color || (mine ? '#8b5cf6' : '#ff3d8b');
        ctx.beginPath();
        t.polygon.forEach((p, i) => {
          const s = this.toScreen(p);
          if (i === 0) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y);
        });
        ctx.closePath();
        // Rivals' land is tinted in their own colour so the map reads as a
        // contested neighbourhood at a glance.
        ctx.fillStyle = mine ? 'rgba(139, 92, 246, 0.19)' : stroke;
        ctx.globalAlpha = mine ? 1 : 0.15;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.lineWidth = 1.6;
        ctx.strokeStyle = stroke;
        ctx.globalAlpha = 0.85;
        ctx.stroke();
        ctx.globalAlpha = 1;
      });
    }

    _drawGhost() {
      const pts = this.layers.ghost;
      if (!pts || pts.length < 2) return;
      const ctx = this.ctx;
      ctx.save();
      ctx.setLineDash([5, 6]);
      ctx.strokeStyle = 'rgba(255, 61, 139, 0.85)';
      ctx.lineWidth = 3;
      ctx.lineJoin = ctx.lineCap = 'round';
      ctx.beginPath();
      pts.forEach((p, i) => {
        const s = this.toScreen(p);
        if (i === 0) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y);
      });
      ctx.stroke();
      ctx.restore();
    }

    _drawRoute() {
      const pts = this.layers.route;
      if (!pts || pts.length < 2) return;
      const ctx = this.ctx;
      ctx.save();
      ctx.lineJoin = ctx.lineCap = 'round';

      ctx.beginPath();
      pts.forEach((p, i) => {
        const s = this.toScreen(p);
        if (i === 0) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y);
      });

      ctx.strokeStyle = 'rgba(200, 255, 46, 0.28)';
      ctx.lineWidth = 11;
      ctx.stroke();
      ctx.strokeStyle = '#c8ff2e';
      ctx.lineWidth = 3.4;
      ctx.stroke();

      // Start pin — the anchor a loop has to come back to.
      const s0 = this.toScreen(pts[0]);
      ctx.beginPath();
      ctx.arc(s0.x, s0.y, 5.5, 0, Math.PI * 2);
      ctx.fillStyle = '#0b0f15';
      ctx.fill();
      ctx.lineWidth = 2.4;
      ctx.strokeStyle = '#c8ff2e';
      ctx.stroke();
      ctx.restore();
    }

    _drawRivals() {
      const ctx = this.ctx;
      (this.layers.rivals || []).forEach((r) => {
        if (!r.position) return;
        const s = this.toScreen(r.position);
        ctx.beginPath();
        ctx.arc(s.x, s.y, 8, 0, Math.PI * 2);
        ctx.fillStyle = r.color || '#ff3d8b';
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = 'rgba(8, 11, 16, 0.9)';
        ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.font = '700 9px ' + getComputedStyle(document.body).fontFamily;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText((r.initials || '?').slice(0, 2), s.x, s.y + 0.5);
      });
    }

    _drawMe() {
      const me = this.layers.me;
      if (!me) return;
      const ctx = this.ctx;
      const s = this.toScreen(me);
      const t = (Date.now() % 2000) / 2000;

      ctx.beginPath();
      ctx.arc(s.x, s.y, 10 + t * 20, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(200, 255, 46, ${0.22 * (1 - t)})`;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(s.x, s.y, 7, 0, Math.PI * 2);
      ctx.fillStyle = '#c8ff2e';
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = 'rgba(8, 11, 16, 0.95)';
      ctx.stroke();
    }
  }

  /* --- Thumbnails ---------------------------------------------------------
     Small route sketches for record cards and the feed. --------------------- */

  function drawRouteThumb(canvas, route, options) {
    const opts = Object.assign({ stroke: '#c8ff2e', fill: null, pad: 8, width: 2.5 }, options || {});
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const rect = canvas.getBoundingClientRect();
    const w = rect.width || canvas.width || 96;
    const h = rect.height || canvas.height || 96;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!route || route.length < 2) return;

    const origin = route[0];
    const proj = route.map((p) => Geo.project(p, origin));
    const minX = Math.min(...proj.map((p) => p.x));
    const maxX = Math.max(...proj.map((p) => p.x));
    const minY = Math.min(...proj.map((p) => p.y));
    const maxY = Math.max(...proj.map((p) => p.y));
    const scale = Math.min((w - opts.pad * 2) / Math.max(1, maxX - minX), (h - opts.pad * 2) / Math.max(1, maxY - minY));
    const ox = (w - (maxX - minX) * scale) / 2 - minX * scale;
    const oy = (h - (maxY - minY) * scale) / 2 - minY * scale;

    ctx.beginPath();
    proj.forEach((p, i) => {
      const x = p.x * scale + ox;
      const y = p.y * scale + oy;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    if (opts.fill) {
      ctx.closePath();
      ctx.fillStyle = opts.fill;
      ctx.fill();
    }
    ctx.lineJoin = ctx.lineCap = 'round';
    ctx.lineWidth = opts.width;
    ctx.strokeStyle = opts.stroke;
    ctx.stroke();
  }

  M.MapView = MapView;
  M.drawRouteThumb = drawRouteThumb;
})(window.MILES);
