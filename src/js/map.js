/* ==========================================================================
   MILES · map
   A canvas map in two halves. Real imagery is drawn underneath when it can be
   reached (see tiles.js); when it cannot — offline, blocked, or switched off —
   the same view falls back to a city drawn procedurally from a fixed seed, so
   the map is never blank and never depends on a third party being up. Routes,
   territories and live runners are real data drawn on top in true metres.
   ========================================================================== */

(function (M) {
  'use strict';

  const { Geo, clamp } = M;

  const MIN_MPP = 0.3;          // closest zoom: a street fills the screen
  const MAX_MPP = 60;           // furthest: a whole city's worth of claims
  const CITY_ANGLE = -0.21;     // the grain of the street grid, radians
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

      // Tiles arrive one at a time, and switching basemap invalidates them all.
      // Bus.on hands back its own unsubscriber, which is what destroy uses.
      const redraw = () => this.invalidate();
      this._offTiles = ['tiles:loaded', 'tiles:source', 'tiles:blocked'].map((e) => M.Bus.on(e, redraw));
    }

    destroy() {
      if (this._ro) this._ro.disconnect();
      if (this._raf) cancelAnimationFrame(this._raf);
      (this._offTiles || []).forEach((off) => off());
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

    /**
     * Whether this map is the one being looked at. Off-screen maps still draw
     * (cheaply, from local geometry) but must not fetch imagery: three maps
     * pulling tiles for screens nobody is on wastes the viewer's bandwidth and
     * the tile provider's.
     */
    setVisible(on) {
      const was = this.visible !== false;
      this.visible = !!on;
      if (on && !was) this.invalidate();
    }

    setAnchor(latlng) { this.anchor = latlng; }

    setCenter(latlng) { this.center = latlng; }

    /* --- Gestures ----------------------------------------------------------
       Only the Territory map is driven by hand; the home and run maps frame
       themselves and must not move under a scrolling finger. ---------------- */

    /** Screen pixels to projected metres, in the anchor's frame. */
    _toWorld(sx, sy) {
      const c = Geo.project(this.center, this.anchor);
      return { x: (sx - this.w / 2) * this.mpp + c.x, y: (sy - this.h / 2) * this.mpp + c.y };
    }

    /** Moves the view so a world point sits under a given screen pixel. */
    _anchorWorldAt(world, sx, sy) {
      this.center = Geo.unproject({
        x: world.x - (sx - this.w / 2) * this.mpp,
        y: world.y - (sy - this.h / 2) * this.mpp,
      }, this.anchor);
    }

    /** Zooms about a screen point, keeping whatever is under it in place. */
    zoomAt(factor, sx, sy) {
      const x = sx === undefined ? this.w / 2 : sx;
      const y = sy === undefined ? this.h / 2 : sy;
      const before = this._toWorld(x, y);
      const next = clamp(this.mpp / factor, MIN_MPP, MAX_MPP);
      if (next === this.mpp) return;
      this.mpp = next;
      this._anchorWorldAt(before, x, y);
      this.moved = true;
      this._announce();
      this.invalidate();
    }

    /** The visible world, so callers can ask what is on screen right now. */
    bounds() {
      const nw = Geo.unproject(this._toWorld(0, 0), this.anchor);
      const se = Geo.unproject(this._toWorld(this.w, this.h), this.anchor);
      return { north: nw.lat, west: nw.lng, south: se.lat, east: se.lng };
    }

    _announce() {
      if (!this.opts.onMove || this._movePending) return;
      this._movePending = true;
      requestAnimationFrame(() => { this._movePending = false; this.opts.onMove(this); });
    }

    /**
     * Drag to pan, pinch or wheel to zoom. `moved` latches so whoever framed
     * this map knows not to snatch the view back on the next render.
     */
    enableGestures() {
      const cv = this.canvas;
      const pts = new Map();
      let lastMid = null;
      let lastSpread = 0;

      const local = (e) => {
        const r = cv.getBoundingClientRect();
        return { x: e.clientX - r.left, y: e.clientY - r.top };
      };
      const midpoint = () => {
        const all = [...pts.values()];
        return {
          x: all.reduce((a, p) => a + p.x, 0) / all.length,
          y: all.reduce((a, p) => a + p.y, 0) / all.length,
        };
      };
      const spread = () => {
        const all = [...pts.values()];
        return all.length < 2 ? 0 : Math.hypot(all[0].x - all[1].x, all[0].y - all[1].y);
      };

      cv.addEventListener('pointerdown', (e) => {
        cv.setPointerCapture(e.pointerId);
        pts.set(e.pointerId, local(e));
        lastMid = midpoint();
        lastSpread = spread();
      });

      cv.addEventListener('pointermove', (e) => {
        if (!pts.has(e.pointerId)) return;
        e.preventDefault();
        pts.set(e.pointerId, local(e));
        const mid = midpoint();

        // Pinch first: the zoom has to be applied about the same midpoint the
        // pan then uses, or the two fight each other.
        const now = spread();
        if (pts.size >= 2 && lastSpread > 0 && now > 0) {
          const next = clamp(this.mpp * (lastSpread / now), MIN_MPP, MAX_MPP);
          const before = this._toWorld(mid.x, mid.y);
          this.mpp = next;
          this._anchorWorldAt(before, mid.x, mid.y);
        }
        lastSpread = now;

        if (lastMid) {
          const c = Geo.project(this.center, this.anchor);
          this.center = Geo.unproject({
            x: c.x - (mid.x - lastMid.x) * this.mpp,
            y: c.y - (mid.y - lastMid.y) * this.mpp,
          }, this.anchor);
        }
        lastMid = mid;
        this.moved = true;
        this._announce();
        this.invalidate();
      });

      const release = (e) => {
        pts.delete(e.pointerId);
        lastMid = pts.size ? midpoint() : null;
        lastSpread = spread();
      };
      cv.addEventListener('pointerup', release);
      cv.addEventListener('pointercancel', release);

      cv.addEventListener('wheel', (e) => {
        e.preventDefault();
        const p = local(e);
        this.zoomAt(Math.pow(2, -e.deltaY / 380), p.x, p.y);
      }, { passive: false });

      cv.addEventListener('dblclick', (e) => {
        const p = local(e);
        this.zoomAt(2, p.x, p.y);
      });
    }

    /** Frames a set of points with padding; used after a run and on the map tab. */
    fit(pointGroups) {
      const pts = [].concat.apply([], pointGroups.filter(Boolean));
      if (!pts.length) return;
      this.moved = false;
      const proj = pts.map((p) => Geo.project(p, this.anchor));
      const minX = Math.min(...proj.map((p) => p.x));
      const maxX = Math.max(...proj.map((p) => p.x));
      const minY = Math.min(...proj.map((p) => p.y));
      const maxY = Math.max(...proj.map((p) => p.y));
      const pad = this.opts.padding;
      const spanX = Math.max(40, maxX - minX);
      const spanY = Math.max(40, maxY - minY);
      this.mpp = clamp(Math.max(spanX / Math.max(1, this.w - pad * 2), spanY / Math.max(1, this.h - pad * 2)), MIN_MPP, MAX_MPP);
      this.center = Geo.unproject({ x: (minX + maxX) / 2, y: (minY + maxY) / 2 }, this.anchor);
    }

    /**
     * Widens the framing without moving it. Fitting tight to your own land
     * fills the screen with it and hides the neighbours it borders, which is
     * exactly the context this map exists to show.
     */
    pullBack(factor) {
      this.mpp = clamp(this.mpp * factor, MIN_MPP, MAX_MPP);
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
      const imagery = this.opts.tiles === false ? false : this._drawTiles();
      if (!imagery && this.opts.showGrid) this._drawCity();
      this._drawTerritories();
      this._drawGhost();
      this._drawRoute();
      this._drawRivals();
      this._drawMe();
      if (this.opts.scale) this._drawScale();
      if (imagery) this._drawAttribution();

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

    /**
     * Paints whatever imagery has arrived for the current view, and returns
     * whether any of it landed — the caller draws the city instead if not.
     *
     * Each tile is positioned from its own corners rather than from a single
     * screen-wide transform, which is what lets Mercator imagery sit under an
     * equirectangular overlay without drifting away from the routes.
     */
    _drawTiles() {
      const T = M.Tiles;
      if (!T || !T.usable() || this.visible === false) return false;

      const ctx = this.ctx;
      const z = T.zoomFor(this.mpp, this.center.lat);
      const retina = this._dpr > 1.4;

      // The visible world, from the two canvas corners.
      const c = Geo.project(this.center, this.anchor);
      const corner = (sx, sy) => Geo.unproject({
        x: (sx - this.w / 2) * this.mpp + c.x,
        y: (sy - this.h / 2) * this.mpp + c.y,
      }, this.anchor);
      const nw = corner(0, 0);
      const se = corner(this.w, this.h);

      const x0 = Math.floor(T.lngToX(nw.lng, z));
      const x1 = Math.floor(T.lngToX(se.lng, z));
      const y0 = Math.floor(T.latToY(nw.lat, z));
      const y1 = Math.floor(T.latToY(se.lat, z));
      // A sane view is a handful of tiles. Anything wilder means the zoom
      // choice is wrong, and requesting hundreds of tiles would be rude.
      if ((x1 - x0 + 1) * (y1 - y0 + 1) > 48) return false;

      let drawn = 0;
      for (let x = x0; x <= x1; x++) {
        for (let y = y0; y <= y1; y++) {
          const img = T.get(z, x, y, retina);
          if (!img) continue;
          const a = this.toScreen({ lat: T.yToLat(y, z), lng: T.xToLng(x, z) });
          const b = this.toScreen({ lat: T.yToLat(y + 1, z), lng: T.xToLng(x + 1, z) });
          // Round outwards: neighbouring tiles share an edge, and letting it
          // land on a half pixel leaves hairline seams across the map.
          const left = Math.floor(a.x);
          const top = Math.floor(a.y);
          ctx.drawImage(img, left, top, Math.ceil(b.x) - left, Math.ceil(b.y) - top);
          drawn++;
        }
      }

      if (!drawn) return false;
      // Imagery is made for reading street names; this map is made for reading
      // a route on top of it. Knocking it back buys the overlay its contrast.
      const dim = M.Tiles.dim();
      if (dim > 0) {
        ctx.save();
        ctx.fillStyle = `rgba(8, 11, 16, ${dim})`;
        ctx.fillRect(0, 0, this.w, this.h);
        ctx.restore();
      }
      return true;
    }

    /**
     * A scale bar, because once the map can be zoomed by hand the only honest
     * answer to "how big is that" is a measured one. The bar picks a round
     * distance that fits in about a quarter of the width.
     */
    _drawScale() {
      const want = this.w * 0.26 * this.mpp;                   // metres, roughly
      const pow = Math.pow(10, Math.floor(Math.log10(want)));
      const metres = [1, 2, 5, 10].map((m) => m * pow).filter((m) => m <= want).pop() || pow;
      const px = metres / this.mpp;
      const label = M.Units.isMetric()
        ? (metres >= 1000 ? `${metres / 1000} km` : `${metres} m`)
        : (metres >= 1609 ? `${(metres / 1609.344).toFixed(metres / 1609.344 < 10 ? 1 : 0)} mi` : `${Math.round(metres * 3.28084)} ft`);

      const ctx = this.ctx;
      const x = 12;
      const y = this.h - 14;
      ctx.save();
      ctx.lineCap = 'butt';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(8, 11, 16, 0.75)';
      ctx.beginPath();
      ctx.moveTo(x, y); ctx.lineTo(x + px, y);
      ctx.moveTo(x, y - 4); ctx.lineTo(x, y + 4);
      ctx.moveTo(x + px, y - 4); ctx.lineTo(x + px, y + 4);
      ctx.stroke();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(226, 232, 240, 0.85)';
      ctx.stroke();
      ctx.font = '700 10px ui-sans-serif, system-ui, sans-serif';
      ctx.textBaseline = 'bottom';
      ctx.fillStyle = 'rgba(8, 11, 16, 0.75)';
      ctx.fillText(label, x + 1, y - 6);
      ctx.fillText(label, x - 1, y - 6);
      ctx.fillStyle = 'rgba(226, 232, 240, 0.92)';
      ctx.fillText(label, x, y - 7);
      ctx.restore();
    }

    /** Tile licences require visible credit wherever the imagery is shown. */
    _drawAttribution() {
      const text = M.Tiles.attribution();
      if (!text) return;
      const ctx = this.ctx;
      ctx.save();
      ctx.font = '500 9px ui-sans-serif, system-ui, sans-serif';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';
      const w = ctx.measureText(text).width;
      ctx.fillStyle = 'rgba(8, 11, 16, 0.55)';
      ctx.fillRect(this.w - w - 10, this.h - 15, w + 10, 15);
      ctx.fillStyle = 'rgba(226, 232, 240, 0.75)';
      ctx.fillText(text, this.w - 5, this.h - 3);
      ctx.restore();
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
        const mine = t.owner === 'me' || !t.owner;
        const stroke = t.color || (mine ? '#a855f7' : '#c14685');

        // `pieces` is what is still held after later claims took their share;
        // fall back to the raw loop for anything not yet resolved. A piece may
        // carry voids, so the path is filled even-odd.
        const pieces = t.pieces && t.pieces.length
          ? t.pieces
          : (t.polygon && t.polygon.length >= 3 ? [{ ring: t.polygon, holes: [] }] : []);
        if (!pieces.length) return;

        ctx.beginPath();
        pieces.forEach((piece) => {
          const trace = (ring) => {
            ring.forEach((p, i) => {
              const s = this.toScreen(p);
              if (i === 0) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y);
            });
            ctx.closePath();
          };
          trace(piece.ring);
          (piece.holes || []).forEach(trace);
        });
        // Fill strongly enough that the hue actually reads, then separate
        // neighbours with a ring of the map's own ground: plots share borders
        // now, and two fills meeting edge to edge blur into one shape.
        ctx.fillStyle = stroke;
        ctx.globalAlpha = mine ? 0.34 : 0.26;
        ctx.fill('evenodd');
        ctx.globalAlpha = 1;

        ctx.lineJoin = ctx.lineCap = 'round';
        ctx.strokeStyle = 'rgba(8, 12, 18, 0.9)';
        ctx.lineWidth = mine ? 5 : 4;
        ctx.stroke();

        ctx.strokeStyle = stroke;
        ctx.lineWidth = mine ? 2.4 : 1.8;
        ctx.stroke();
      });

      this._labelTerritories();
    }

    /**
     * Writes each owner's initials on their land. Five hues is the most this
     * surface can carry before pairs stop being separable, so past that the
     * colours repeat — the label is what actually names the owner.
     */
    _labelTerritories() {
      const ctx = this.ctx;
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      this.layers.territories.forEach((t) => {
        const pieces = t.pieces && t.pieces.length
          ? t.pieces
          : (t.polygon && t.polygon.length >= 3 ? [{ ring: t.polygon, holes: [] }] : []);
        if (!pieces.length) return;

        // Label the biggest piece only, and only when there is room for it.
        let best = null;
        let bestSpan = 0;
        pieces.forEach((piece) => {
          const pts = piece.ring.map((p) => this.toScreen(p));
          const xs = pts.map((p) => p.x);
          const ys = pts.map((p) => p.y);
          const span = Math.min(Math.max.apply(null, xs) - Math.min.apply(null, xs),
                                Math.max.apply(null, ys) - Math.min.apply(null, ys));
          if (span > bestSpan) { bestSpan = span; best = pts; }
        });
        if (!best || bestSpan < 34) return;

        // Area-weighted centroid, so the label sits in the body of the plot.
        let area2 = 0;
        let cx = 0;
        let cy = 0;
        for (let i = 0; i < best.length; i++) {
          const a = best[i];
          const b = best[(i + 1) % best.length];
          const cross = a.x * b.y - b.x * a.y;
          area2 += cross;
          cx += (a.x + b.x) * cross;
          cy += (a.y + b.y) * cross;
        }
        if (Math.abs(area2) < 1e-6) return;
        cx /= 3 * area2;
        cy /= 3 * area2;

        const mine = t.owner === 'me' || !t.owner;
        const label = mine ? 'YOU' : (t.initials || '??');
        const size = Math.max(9, Math.min(13, bestSpan * 0.2));
        ctx.font = `800 ${size}px ${getComputedStyle(document.body).fontFamily}`;

        // A dark plate keeps the initials legible over any fill.
        const w = ctx.measureText(label).width + 10;
        const h = size + 7;
        ctx.fillStyle = 'rgba(6, 9, 14, 0.72)';
        if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(cx - w / 2, cy - h / 2, w, h, h / 2); ctx.fill(); }
        else ctx.fillRect(cx - w / 2, cy - h / 2, w, h);

        // Lime means "you" everywhere else in the app, so it means it here too;
        // everyone else's initials wear their own plot colour.
        ctx.fillStyle = mine ? '#c8ff2e' : (t.color || '#f2f6fa');
        ctx.fillText(label, cx, cy + 0.5);
      });

      ctx.restore();
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

  /** Thumbnail of land actually held: rings with their voids, filled even-odd. */
  function drawLandThumb(canvas, pieces, options) {
    const opts = Object.assign({ stroke: '#a855f7', fill: 'rgba(168,85,247,0.30)', pad: 6, width: 1.8 }, options || {});
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const rect = canvas.getBoundingClientRect();
    const w = rect.width || canvas.width || 52;
    const h = rect.height || canvas.height || 52;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!pieces || !pieces.length) return;

    const origin = pieces[0].ring[0];
    const rings = [];
    pieces.forEach((piece) => {
      rings.push(piece.ring.map((p) => Geo.project(p, origin)));
      (piece.holes || []).forEach((hole) => rings.push(hole.map((p) => Geo.project(p, origin))));
    });

    const all = [].concat.apply([], rings);
    const minX = Math.min.apply(null, all.map((p) => p.x));
    const maxX = Math.max.apply(null, all.map((p) => p.x));
    const minY = Math.min.apply(null, all.map((p) => p.y));
    const maxY = Math.max.apply(null, all.map((p) => p.y));
    const scale = Math.min((w - opts.pad * 2) / Math.max(1, maxX - minX), (h - opts.pad * 2) / Math.max(1, maxY - minY));
    const ox = (w - (maxX - minX) * scale) / 2 - minX * scale;
    const oy = (h - (maxY - minY) * scale) / 2 - minY * scale;

    ctx.beginPath();
    rings.forEach((ring) => {
      ring.forEach((p, i) => {
        const x = p.x * scale + ox;
        const y = p.y * scale + oy;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.closePath();
    });
    ctx.fillStyle = opts.fill;
    ctx.fill('evenodd');
    ctx.lineJoin = ctx.lineCap = 'round';
    ctx.lineWidth = opts.width;
    ctx.strokeStyle = opts.stroke;
    ctx.stroke();
  }

  M.MapView = MapView;
  M.drawRouteThumb = drawRouteThumb;
  M.drawLandThumb = drawLandThumb;
})(window.MILES);
