/* ==========================================================================
   MILES · api
   The server, when there is one. With no address configured MILES is the
   self-contained demo it has always been: every runner, crew and plot made
   up on the phone. With one, it is a real account on a shared map, and
   everything that talks to the server goes through here.

   The address comes from <meta name="miles-api"> (scripts/build-www.js
   writes it for the phone builds from MILES_API_URL), or for development
   from ?api=http://localhost:8080 — remembered until ?api=off, and only
   honoured on file:// or localhost.
   ========================================================================== */

(function (M) {
  'use strict';

  const { Bus } = M;
  const SESSION_KEY = 'miles.session';
  const API_KEY = 'miles.api';
  const TIMEOUT_MS = 20000;

  function read(key) {
    try { return localStorage.getItem(key); } catch (err) { return null; }
  }
  function write(key, value) {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch (err) { /* private mode: the session lasts as long as the page */ }
  }

  function readConfig() {
    let api = null;
    let sim = false;
    try {
      const meta = document.querySelector('meta[name="miles-api"]');
      if (meta && meta.content.trim()) api = meta.content.trim();
      const params = new URLSearchParams(location.search);
      // ?api= is for development, on this machine. Anywhere else a link with
      // ?api=https://somebody-else could point the app — and its sign-in
      // form — at a server that is not ours.
      const local = location.protocol === 'file:' || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
      if (local && params.has('api')) {
        const asked = params.get('api');
        if (!asked || asked === 'off') { write(API_KEY, null); api = null; } else { write(API_KEY, asked); api = asked; }
      } else if (local && read(API_KEY)) {
        api = read(API_KEY);
      }
      // Development only: lets the simulator run against a server started
      // with ALLOW_SIMULATED_RUNS. A real server refuses simulated runs.
      sim = params.get('sim') === '1';
    } catch (err) { /* no document or URL: no server */ }
    return { api: api ? api.replace(/\/+$/, '') : null, sim };
  }

  /** An error the app can show as it is: `message` is written for runners. */
  class ApiError extends Error {
    constructor(status, code, message, feature) {
      super(message);
      this.status = status;
      this.code = code;
      this.feature = feature || null;
    }
    get offline() { return this.status === 0; }
  }

  const Api = {
    ApiError,
    enabled: false,
    base: null,
    simulate: false,
    token: null,
    user: null,

    init() {
      const config = readConfig();
      this.base = config.api;
      this.enabled = !!this.base;
      this.simulate = config.sim;
      if (!this.enabled) return this;
      try {
        const saved = JSON.parse(read(SESSION_KEY) || 'null');
        if (saved && saved.token && saved.user && saved.base === this.base) {
          this.token = saved.token;
          this.user = saved.user;
        }
      } catch (err) { /* a corrupt session is no session */ }
      return this;
    },

    signedIn() { return this.enabled && !!this.token; },

    /** Absolute address of one of the server's own pages. */
    page(path) { return this.base + path; },

    async request(method, path, body, options) {
      if (!this.base) throw new ApiError(0, 'no_server', 'MILES has no server to talk to.');
      const headers = { 'content-type': 'application/json' };
      const token = this.token;
      if (token) headers.authorization = 'Bearer ' + token;
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
      let res;
      try {
        res = await fetch(this.base + path, {
          method, headers, signal: abort.signal,
          body: body === undefined ? undefined : JSON.stringify(body),
        });
      } catch (err) {
        throw new ApiError(0, 'offline', 'MILES cannot reach its server. Check your connection and try again.');
      } finally {
        clearTimeout(timer);
      }
      const text = await res.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch (err) { /* not JSON */ }
      if (!res.ok) {
        const e = (data && data.error) || {};
        // A session the server no longer knows is over, wherever it is noticed —
        // but only the one this request was sent with. A slow request from
        // before signing in again must not sign the new session out.
        if (res.status === 401 && token && token === this.token && !(options && options.keepSession)) this._ended(true);
        throw new ApiError(res.status, e.code || 'error', e.message || 'Something went wrong. Try again.', e.feature);
      }
      return data;
    },

    get(path) { return this.request('GET', path); },
    post(path, body, options) { return this.request('POST', path, body === undefined ? {} : body, options); },
    put(path, body) { return this.request('PUT', path, body === undefined ? {} : body); },
    patch(path, body) { return this.request('PATCH', path, body === undefined ? {} : body); },
    del(path, body, options) { return this.request('DELETE', path, body, options); },

    /* --- The session ------------------------------------------------------- */

    _save() {
      write(SESSION_KEY, this.token ? JSON.stringify({ base: this.base, token: this.token, user: this.user }) : null);
    },

    setUser(user) {
      this.user = user;
      this._save();
    },

    _start(token, user) {
      this.token = token;
      this.user = user;
      this._save();
      Bus.emit('auth:changed', { signedIn: true, user });
      Live.connect();
    },

    _ended(expired) {
      if (!this.token) return;
      this.token = null;
      this.user = null;
      this._save();
      Live.disconnect();
      Bus.emit('auth:changed', { signedIn: false, expired: !!expired });
    },

    async signUp(fields) {
      const res = await this.post('/v1/auth/signup', fields);
      this._start(res.token, res.user);
      return res.user;
    },

    async signIn(email, password) {
      const res = await this.post('/v1/auth/login', { email, password });
      this._start(res.token, res.user);
      return res.user;
    },

    async resetPassword(email, code, password) {
      const res = await this.post('/v1/auth/password/reset', { email, code, password });
      this._start(res.token, res.user);
      return res.user;
    },

    async signOut() {
      try { await this.post('/v1/auth/logout', {}, { keepSession: true }); } catch (err) { /* signed out here either way */ }
      this._ended(false);
    },

    /** After the account itself is deleted: nothing left to sign out of. */
    forget() { this._ended(false); },
  };

  /* --- The live channel -------------------------------------------------------
     One socket per signed-in app: presence for the friend list, race invites
     the moment they are sent, and race telemetry. It reconnects by itself,
     backing off, and rejoins whatever race it was in. --------------------- */

  const Live = {
    ws: null,
    ready: false,
    rooms: new Map(),
    retry: 0,
    _timer: null,

    connect() {
      if (!Api.signedIn() || this.ws || typeof WebSocket === 'undefined') return;
      let ws;
      try { ws = new WebSocket(Api.base.replace(/^http/, 'ws') + '/v1/live'); } catch (err) { this._again(); return; }
      this.ws = ws;
      ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', token: Api.token }));
      ws.onmessage = (event) => {
        let msg;
        try { msg = JSON.parse(event.data); } catch (err) { return; }
        if (msg.type === 'ready') {
          this.ready = true;
          this.retry = 0;
          this.rooms.forEach((_, race) => this.send({ type: 'join', race }));
          Bus.emit('live:connected');
          return;
        }
        if (msg.race && this.rooms.has(msg.race)) this.rooms.get(msg.race)(msg);
        if (msg.type === 'invite') Bus.emit('live:invite', msg.race);
      };
      ws.onclose = (event) => {
        this.ws = null;
        this.ready = false;
        if (event.code === 4001) return;           // the server refused the session
        this._again();
      };
      ws.onerror = () => { /* close follows */ };
    },

    _again() {
      if (!Api.signedIn() || this._timer) return;
      const wait = Math.min(30000, 1000 * Math.pow(2, this.retry++));
      this._timer = setTimeout(() => { this._timer = null; this.connect(); }, wait);
    },

    disconnect() {
      clearTimeout(this._timer);
      this._timer = null;
      this.rooms.clear();
      if (this.ws) { try { this.ws.close(); } catch (err) { /* gone already */ } }
      this.ws = null;
      this.ready = false;
    },

    send(msg) {
      if (this.ws && this.ready) {
        try { this.ws.send(JSON.stringify(msg)); } catch (err) { /* reconnecting */ }
      }
    },

    /** Joins a race's room; `onMessage` hears everyone else in it. */
    room(race, onMessage) {
      this.rooms.set(race, onMessage);
      this.send({ type: 'join', race });
      return {
        send: (msg) => this.send(Object.assign({}, msg, { race })),
        leave: () => {
          this.rooms.delete(race);
          this.send({ type: 'leave', race });
        },
      };
    },
  };

  Api.live = Live;
  M.Api = Api;
  // Read now, before state.js and sync.js decide which world they are in.
  Api.init();
})(window.MILES);
