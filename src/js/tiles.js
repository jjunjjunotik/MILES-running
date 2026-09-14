/* ==========================================================================
   MILES · tiles
   Real map imagery under the routes and territories.

   Tiles are standard slippy-map PNGs in Web Mercator, but everything else in
   the app — routes, loops, territory subtraction — works in a local
   equirectangular metre projection anchored at your home. Rather than convert
   the whole app to Mercator, each tile is placed by projecting its OWN two
   corners through that same projection. The two projections disagree by a
   smooth scale factor in latitude, which over one tile (under a kilometre at
   street zoom) is well below a pixel, and placing each tile independently
   stops that error accumulating across the screen.

   The network is optional. Nothing here is required for the app to work: if
   the tiles are blocked, offline, or switched off, the map falls back to the
   drawn city and every other feature is untouched.
   ========================================================================== */

(function (M) {
  'use strict';

  const { Bus, clamp } = M;

  // Metres per pixel at zoom 0 on the equator — the Web Mercator constant.
  const EQUATOR_MPP = 156543.033928;
  const MAX_CACHE = 256;        // images held; roughly 4 screens' worth
  const FAIL_LIMIT = 8;         // consecutive misses before a source is given up on

  /* Sources that need no API key. Dark is the default because the app is dark:
     a bright basemap would drown the routes and the territory colours. */
  const SOURCES = {
    dark: {
      key: 'dark',
      name: 'Dark',
      url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
      subdomains: ['a', 'b', 'c', 'd'],
      retina: true,
      maxZoom: 20,
      dim: 0.18,
      attribution: '© OpenStreetMap · © CARTO',
    },
    light: {
      key: 'light',
      name: 'Light',
      url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
      subdomains: ['a', 'b', 'c', 'd'],
      retina: true,
      maxZoom: 20,
      dim: 0.5,
      attribution: '© OpenStreetMap · © CARTO',
    },
    osm: {
      key: 'osm',
      name: 'Street',
      url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      subdomains: [''],
      retina: false,
      maxZoom: 19,
      dim: 0.5,
      attribution: '© OpenStreetMap contributors',
    },
    drawn: { key: 'drawn', name: 'Drawn', url: null, attribution: '' },
  };

  const cache = new Map();      // 'key/z/x/y' -> HTMLImageElement | 'failed'
  let inflight = 0;
  let misses = 0;               // consecutive failures
  let hits = 0;                 // tiles that have ever loaded

  const Tiles = {
    SOURCES,
    source: SOURCES.dark,

    /** Switches basemap. 'drawn' turns imagery off entirely. */
    setSource(key) {
      const next = SOURCES[key] || SOURCES.drawn;
      if (next === this.source) return;
      this.source = next;
      misses = 0;
      hits = 0;
      cache.clear();
      Bus.emit('tiles:source', next);
    },

    /**
     * Whether to attempt imagery at all. A source is given up on only after a
     * run of failures with nothing having loaded — a few 404s at the edge of
     * coverage are normal and must not blank the map.
     */
    usable() {
      return !!this.source.url && !(misses >= FAIL_LIMIT && hits === 0);
    },

    /** True once the network has been tried and found wanting. */
    blocked() {
      return !!this.source.url && misses >= FAIL_LIMIT && hits === 0;
    },

    attribution() {
      return this.usable() ? this.source.attribution : '';
    },

    /**
     * How hard to knock the imagery back. A basemap is drawn to be read on its
     * own; here it is a backdrop for a route, so it gives up contrast to it —
     * and a bright basemap has far more to give up than a dark one.
     */
    dim() {
      return this.source.dim === undefined ? 0.3 : this.source.dim;
    },

    /* --- Slippy-map arithmetic -------------------------------------------- */

    lngToX(lng, z) { return (lng + 180) / 360 * Math.pow(2, z); },

    latToY(lat, z) {
      const r = clamp(lat, -85.05112878, 85.05112878) * Math.PI / 180;
      return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * Math.pow(2, z);
    },

    xToLng(x, z) { return x / Math.pow(2, z) * 360 - 180; },

    yToLat(y, z) {
      const n = Math.PI - 2 * Math.PI * y / Math.pow(2, z);
      return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
    },

    /**
     * The zoom whose tile pixels land closest to the screen's own pixels, so
     * imagery is neither blurry nor needlessly heavy.
     */
    zoomFor(mpp, lat) {
      const ground = EQUATOR_MPP * Math.cos(lat * Math.PI / 180);
      const z = Math.round(Math.log(ground / Math.max(mpp, 1e-6)) / Math.LN2);
      return clamp(z, 2, this.source.maxZoom || 19);
    },

    /* --- Fetching ---------------------------------------------------------- */

    _url(z, x, y, retina) {
      const subs = this.source.subdomains || [''];
      return this.source.url
        .replace('{s}', subs[(x + y) % subs.length])
        .replace('{z}', z)
        .replace('{x}', x)
        .replace('{y}', y)
        .replace('{r}', retina && this.source.retina ? '@2x' : '');
    },

    /**
     * The tile if it is ready, otherwise null while it loads. Callers draw
     * what they have and are redrawn by `tiles:loaded` as the rest arrive.
     */
    get(z, x, y, retina) {
      if (!this.usable()) return null;
      const n = Math.pow(2, z);
      if (y < 0 || y >= n) return null;               // above the pole
      const wrapped = ((x % n) + n) % n;              // round the world
      const id = `${this.source.key}/${z}/${wrapped}/${y}`;

      const held = cache.get(id);
      if (held) return held === 'failed' ? null : (held.complete && held.naturalWidth ? held : null);
      if (inflight > 12) return null;                 // let the queue drain first

      const img = new Image();
      // Keeps canvases exportable: without this the record card's toDataURL
      // would throw on a canvas that has ever seen a cross-origin tile.
      img.crossOrigin = 'anonymous';
      img.decoding = 'async';
      inflight++;
      img.onload = () => {
        inflight--;
        hits++;
        misses = 0;
        Bus.emit('tiles:loaded', id);
      };
      img.onerror = () => {
        inflight--;
        misses++;
        cache.set(id, 'failed');
        if (this.blocked()) Bus.emit('tiles:blocked', this.source);
      };
      cache.set(id, img);
      if (cache.size > MAX_CACHE) {
        // Oldest first; Map preserves insertion order.
        const oldest = cache.keys().next().value;
        if (oldest !== id) cache.delete(oldest);
      }
      img.src = this._url(z, wrapped, y, retina);
      return null;
    },
  };

  M.Tiles = Tiles;
})(window.MILES);
