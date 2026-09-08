/* ==========================================================================
   MILES · core
   Namespace, unit conversion, geometry and storage. Everything downstream
   works in metres and seconds; conversion happens only at the display edge.
   ========================================================================== */

window.MILES = window.MILES || {};

(function (M) {
  'use strict';

  /* --- Tiny helpers ------------------------------------------------------ */

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  const el = (tag, attrs, children) => {
    const node = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k === 'html') node.innerHTML = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2).toLowerCase(), v);
      else node.setAttribute(k, v === true ? '' : v);
    });
    (children || []).forEach((c) => node.appendChild(c));
    return node;
  };

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  /* Deterministic PRNG so the procedural map looks identical every reload. */
  const rng = (seed) => {
    let s = seed >>> 0 || 1;
    return () => {
      s ^= s << 13; s >>>= 0;
      s ^= s >> 17;
      s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
  };

  /* --- Units -------------------------------------------------------------
     One switch flips the entire app between metric and imperial. --------- */

  const M_PER_MI = 1609.344;

  const Units = {
    system: 'km',

    isMetric() { return this.system === 'km'; },

    /** metres → the display number in the active system */
    dist(metres) { return this.isMetric() ? metres / 1000 : metres / M_PER_MI; },

    distLabel() { return this.isMetric() ? 'km' : 'mi'; },

    /** metres → "12.43" */
    distText(metres, digits) {
      const d = this.dist(metres);
      return d.toFixed(digits === undefined ? (d >= 100 ? 0 : 2) : digits);
    },

    /** seconds per metre → "5'12\"" per km or per mile */
    paceText(secPerMetre) {
      if (!secPerMetre || !isFinite(secPerMetre)) return "--'--\"";
      const perUnit = secPerMetre * (this.isMetric() ? 1000 : M_PER_MI);
      if (perUnit > 3600) return "--'--\"";
      const mins = Math.floor(perUnit / 60);
      const secs = Math.round(perUnit % 60);
      return secs === 60 ? `${mins + 1}'00"` : `${mins}'${String(secs).padStart(2, '0')}"`;
    },

    paceLabel() { return this.isMetric() ? '/km' : '/mi'; },

    /** m/s → km/h or mph */
    speed(mps) { return this.isMetric() ? mps * 3.6 : mps * 2.236936; },

    speedLabel() { return this.isMetric() ? 'km/h' : 'mph'; },

    /** square metres → km² or mi² */
    area(sqm) { return this.isMetric() ? sqm / 1e6 : sqm / 2589988.11; },

    areaText(sqm) {
      const a = this.area(sqm);
      return a < 0.01 && a > 0 ? a.toFixed(3) : a.toFixed(2);
    },

    areaLabel() { return this.isMetric() ? 'km²' : 'mi²'; },
  };

  /* --- Time -------------------------------------------------------------- */

  const clock = (seconds) => {
    const s = Math.max(0, Math.floor(seconds));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const mm = String(m).padStart(h ? 2 : 1, '0');
    return (h ? `${h}:` : '') + `${mm}:${String(sec).padStart(2, '0')}`;
  };

  const relTime = (ts) => {
    const mins = Math.round((Date.now() - ts) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.round(hrs / 24);
    return days < 7 ? `${days}d ago` : new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const startOfWeek = (d) => {
    const date = new Date(d);
    date.setHours(0, 0, 0, 0);
    const day = (date.getDay() + 6) % 7; // Monday-first
    date.setDate(date.getDate() - day);
    return date.getTime();
  };

  const startOfMonth = (d) => {
    const date = new Date(d);
    date.setHours(0, 0, 0, 0);
    date.setDate(1);
    return date.getTime();
  };

  /* --- Geometry ----------------------------------------------------------
     Runs are short enough that a local equirectangular projection is exact
     to well under a metre, and it keeps area maths trivial. -------------- */

  const R_EARTH = 6371000;

  const Geo = {
    /** great-circle distance between two {lat,lng} in metres */
    distance(a, b) {
      const dLat = (b.lat - a.lat) * Math.PI / 180;
      const dLng = (b.lng - a.lng) * Math.PI / 180;
      const la1 = a.lat * Math.PI / 180;
      const la2 = b.lat * Math.PI / 180;
      const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
      return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(h)));
    },

    /** {lat,lng} → local metres relative to an origin */
    project(p, origin) {
      const k = Math.cos(origin.lat * Math.PI / 180);
      return {
        x: (p.lng - origin.lng) * (Math.PI / 180) * R_EARTH * k,
        y: -(p.lat - origin.lat) * (Math.PI / 180) * R_EARTH,
      };
    },

    /** local metres → {lat,lng} */
    unproject(pt, origin) {
      const k = Math.cos(origin.lat * Math.PI / 180);
      return {
        lat: origin.lat - (pt.y / R_EARTH) * (180 / Math.PI),
        lng: origin.lng + (pt.x / (R_EARTH * k)) * (180 / Math.PI),
      };
    },

    /** move a point by metres east/north */
    offset(p, east, north) {
      const k = Math.cos(p.lat * Math.PI / 180);
      return {
        lat: p.lat + (north / R_EARTH) * (180 / Math.PI),
        lng: p.lng + (east / (R_EARTH * k)) * (180 / Math.PI),
      };
    },

    /** signed area of a projected ring, in m² (shoelace) */
    ringArea(points) {
      if (!points || points.length < 3) return 0;
      let sum = 0;
      for (let i = 0; i < points.length; i++) {
        const a = points[i];
        const b = points[(i + 1) % points.length];
        sum += a.x * b.y - b.x * a.y;
      }
      return Math.abs(sum) / 2;
    },

    /** area of a lat/lng ring in m² */
    polygonArea(latlngs) {
      if (!latlngs || latlngs.length < 3) return 0;
      const origin = latlngs[0];
      return this.ringArea(latlngs.map((p) => this.project(p, origin)));
    },

    centroid(latlngs) {
      const lat = latlngs.reduce((s, p) => s + p.lat, 0) / latlngs.length;
      const lng = latlngs.reduce((s, p) => s + p.lng, 0) / latlngs.length;
      return { lat, lng };
    },

    /** Douglas–Peucker style thinning so stored routes stay small */
    simplify(points, toleranceM) {
      if (points.length < 3) return points.slice();
      const origin = points[0];
      const pts = points.map((p) => Object.assign({}, Geo.project(p, origin), { src: p }));
      const keep = new Array(pts.length).fill(false);
      keep[0] = keep[pts.length - 1] = true;

      const seg = (lo, hi) => {
        if (hi - lo < 2) return;
        const a = pts[lo];
        const b = pts[hi];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.hypot(dx, dy) || 1;
        let best = -1;
        let bestD = 0;
        for (let i = lo + 1; i < hi; i++) {
          const p = pts[i];
          const d = Math.abs(dy * (p.x - a.x) - dx * (p.y - a.y)) / len;
          if (d > bestD) { bestD = d; best = i; }
        }
        if (bestD > toleranceM && best > 0) {
          keep[best] = true;
          seg(lo, best);
          seg(best, hi);
        }
      };

      seg(0, pts.length - 1);
      return pts.filter((_, i) => keep[i]).map((p) => p.src);
    },
  };

  /* --- Storage -----------------------------------------------------------
     localStorage can throw (private mode, blocked site data), so every
     access is guarded and the app stays fully usable without it. -------- */

  const KEY = 'miles.v1';

  const Store = {
    read() {
      try {
        const raw = localStorage.getItem(KEY);
        return raw ? JSON.parse(raw) : null;
      } catch (err) {
        return null;
      }
    },
    write(data) {
      try {
        localStorage.setItem(KEY, JSON.stringify(data));
        return true;
      } catch (err) {
        return false;
      }
    },
  };

  /* --- Event bus --------------------------------------------------------- */

  const Bus = {
    map: new Map(),
    on(name, fn) {
      if (!this.map.has(name)) this.map.set(name, new Set());
      this.map.get(name).add(fn);
      return () => this.map.get(name).delete(fn);
    },
    emit(name, payload) {
      (this.map.get(name) || []).forEach((fn) => {
        try { fn(payload); } catch (err) { console.error('[miles]', name, err); }
      });
    },
  };

  Object.assign(M, { $, $$, el, clamp, lerp, uid, rng, Units, Geo, Store, Bus, clock, relTime, startOfWeek, startOfMonth, M_PER_MI });
})(window.MILES);
