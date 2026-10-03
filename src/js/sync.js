/* ==========================================================================
   MILES · sync
   Keeps a signed-in account in step with the server.

   The screens never talk to the server. They draw State.data exactly as they
   do in the demo; this file fills State.data from the server in the shapes
   the demo's own data has — your id as 'me', friends and crews and plots as
   the screens expect them — and sends what the runner does back.

   Finished runs go into an outbox and are uploaded as soon as there is a
   connection; a run finished in a tunnel arrives when the phone is back.
   Crew actions apply on the phone at once and are confirmed or undone by
   the server a moment later.
   ========================================================================== */

(function (M) {
  'use strict';

  const { Api, State, Bus, Geo, Crew, esc } = M;
  const ME_COLOR = '#f1ead9';
  const LAND_REACH = 4000;            // metres either side of you that the map loads
  const STALE_MS = 60 * 1000;

  /* Colours belong to the app, not the server: a runner keeps the same one
     wherever they appear — friend list, map, race board. */
  function hashIndex(id, n) {
    let h = 0;
    const s = String(id);
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h % n;
  }
  const ownerColor = (id) => M.FRIEND_COLORS[hashIndex(id, M.FRIEND_COLORS.length)];
  const memberColor = (id) => Crew.COLORS[hashIndex(id, Crew.COLORS.length)];

  const meId = () => (Api.user ? Api.user.id : null);
  const asMe = (id) => (id && id === meId() ? 'me' : id);
  const S = () => State.data;
  const toast = (html, kind) => { if (M.UI) M.UI.toast(html, kind); };

  function boxAround(p, metres) {
    const ne = Geo.offset(p, metres, metres);
    const sw = Geo.offset(p, -metres, -metres);
    return { west: sw.lng, south: sw.lat, east: ne.lng, north: ne.lat };
  }
  function boundsOf(ring) {
    const b = { west: Infinity, south: Infinity, east: -Infinity, north: -Infinity };
    (ring || []).forEach((p) => {
      if (p.lng < b.west) b.west = p.lng;
      if (p.lng > b.east) b.east = p.lng;
      if (p.lat < b.south) b.south = p.lat;
      if (p.lat > b.north) b.north = p.lat;
    });
    return b;
  }
  const overlaps = (a, b) => !(a.east < b.west || b.east < a.west || a.north < b.south || b.north < a.south);
  const covers = (outer, inner) => outer.west <= inner.west && outer.east >= inner.east && outer.south <= inner.south && outer.north >= inner.north;

  /* What a crew action on the phone means on the server. Each is called with
     the same arguments crew.js was. */
  const CREW_OPS = {
    create: (state, form) => ['POST', '/v1/crews', {
      name: form.name, tagline: form.tagline, days: form.days, time: form.time, spot: form.spot,
      openJoin: form.openJoin !== false, home: state.profile.home,
    }],
    join: (state, crewId) => ['POST', `/v1/crews/${crewId}/join`],
    leave: (state, crewId) => ['POST', `/v1/crews/${crewId}/leave`],
    approve: (state, crewId, personId) => ['POST', `/v1/crews/${crewId}/requests/${personId}/approve`],
    decline: (state, crewId, personId) => ['POST', `/v1/crews/${crewId}/requests/${personId}/decline`],
    setRole: (state, crewId, memberId, role) => ['PATCH', `/v1/crews/${crewId}/members/${memberId}`, { role }],
    remove: (state, crewId, memberId) => ['DELETE', `/v1/crews/${crewId}/members/${memberId}`],
    handOver: (state, crewId, memberId) => ['POST', `/v1/crews/${crewId}/handover`, { userId: memberId }],
    setPhoto: (state, crewId, dataUrl) => ['PATCH', `/v1/crews/${crewId}`, { photo: dataUrl || null }],
    edit: (state, crewId, patch) => ['PATCH', `/v1/crews/${crewId}`, patch],
    disband: (state, crewId) => ['DELETE', `/v1/crews/${crewId}`],
    postNotice: (state, crewId, text) => ['POST', `/v1/crews/${crewId}/notices`, { text }],
    removeNotice: (state, crewId, noticeId) => ['DELETE', `/v1/crews/${crewId}/notices/${noticeId}`],
    setMission: (state, crewId, key) => ['PUT', `/v1/crews/${crewId}/mission`, { key, week: Crew.weekKey() }],
  };
  // These change which crews you are in or can see; the whole list is fetched again.
  const RELIST = ['create', 'join', 'leave', 'disband'];

  const UPLOAD_FIELDS = ['id', 'startedAt', 'kind', 'title', 'distance', 'duration', 'elevation', 'route', 'splits',
    'loopClosed', 'territoryPolygon', 'source', 'target', 'placing', 'fieldSize', 'finished', 'results', 'raceId'];

  const Sync = {
    ownerColor,
    memberColor,
    // Bumped whenever the account changes. Every answer from the server is
    // applied only if it was asked for under the same account.
    epoch: 0,
    pulled: {},
    landBoxes: [],
    lastPrefs: null,
    flushing: false,

    /* --- From the server into the app's shapes ------------------------------ */

    applyMe(me) {
      const s = S();
      Api.setUser(me);
      s.account = { id: me.id, email: me.email, friendCode: me.friendCode };
      s.profile.name = me.name;
      s.profile.handle = me.handle;
      s.profile.initials = me.initials;
      const p = me.prefs || {};
      ['units', 'mapStyle', 'heroBg', 'rangeMode', 'cardDesign'].forEach((k) => { if (p[k] !== undefined) s[k] = p[k]; });
      // Quests and ranks only ever go up: whichever phone got further wins.
      const claims = Object.assign({}, p.questClaims || {});
      Object.keys(s.questClaims || {}).forEach((k) => { claims[k] = Math.max(claims[k] || 0, s.questClaims[k]); });
      s.questClaims = claims;
      const order = M.RANKS.map((r) => r.key);
      if (p.rankSeen && order.indexOf(p.rankSeen) > order.indexOf(s.rankSeen)) s.rankSeen = p.rankSeen;
      M.Units.system = s.units;
      // Shaped so Pro.verify() reads it as it reads the demo's.
      s.pro = { plan: me.pro.plan, trialEndsAt: me.pro.trialEndsAt, renewsAt: me.pro.renewsAt, willRenew: me.pro.willRenew };
      if (M.Tiles && M.Tiles.SOURCES[s.mapStyle]) M.Tiles.setSource(s.mapStyle);
      this.lastPrefs = JSON.stringify(this.prefsOf(s));
    },

    prefsOf(s) {
      return {
        units: s.units, mapStyle: s.mapStyle, heroBg: s.heroBg, rangeMode: s.rangeMode,
        rankSeen: s.rankSeen, cardDesign: s.cardDesign, questClaims: s.questClaims,
      };
    },

    mapRun(r) {
      return Object.assign({}, r, { pending: false });
    },

    applyRuns(runs) {
      const s = S();
      const known = new Set(runs.map((r) => r.id));
      const waiting = s.activities.filter((a) => a.pending && !known.has(a.id));
      s.activities = waiting.concat(runs.map((r) => this.mapRun(r))).sort((a, b) => b.startedAt - a.startedAt);
    },

    mapMyClaim(c) {
      const run = c.runId ? S().activities.find((a) => a.serverId === c.runId) : null;
      const t = {
        id: c.id, serverId: c.id, activityId: run ? run.id : null, claimedAt: c.claimedAt,
        polygon: c.polygon, pieces: c.pieces, area: c.area, lost: c.lost || 0, owner: 'me',
      };
      if (c.name) t.name = c.name;
      if (c.color) t.color = c.color;
      return t;
    },

    applyMyLand(claims) {
      const s = S();
      // Plots from runs still in the outbox stay until the server answers for them.
      const waiting = new Set(s.activities.filter((a) => a.pending).map((a) => a.id));
      const local = s.territories.filter((t) => !t.serverId && waiting.has(t.activityId));
      s.territories = local.concat(claims.map((c) => this.mapMyClaim(c)));
    },

    mapOtherClaim(c) {
      const t = {
        id: c.id, owner: c.owner, ownerName: c.ownerName, initials: c.initials,
        color: c.color || ownerColor(c.owner), crewId: c.crewId || undefined,
        polygon: c.polygon, pieces: c.pieces, area: c.area, claimedAt: c.claimedAt,
      };
      if (c.name) t.name = c.name;
      return t;
    },

    /** Replaces everything known inside `box` with what the server says now. */
    applyLand(box, claims) {
      const s = S();
      const kept = s.rivalLand.filter((t) => !overlaps(boundsOf(t.polygon), box));
      s.rivalLand = kept.concat(claims.filter((c) => !c.mine).map((c) => this.mapOtherClaim(c)));
      this.landBoxes = this.landBoxes.filter((b) => !covers(box, b.box)).concat([{ box, at: Date.now() }]).slice(-12);
    },

    mapFriend(f) {
      return {
        id: f.id, name: f.name, initials: f.initials, color: ownerColor(f.id),
        weekly: f.weekly || 0, pace: f.pace || null, online: !!f.online,
      };
    },

    mapCrew(c) {
      const me = meId();
      const home = S().profile.home;
      return {
        id: c.id, name: c.name, tagline: c.tagline, photo: c.photo || null, color: c.color, foundedAt: c.foundedAt,
        home: c.home,
        distance: typeof c.distance === 'number' ? c.distance : Geo.distance(home, c.home),
        leaderId: asMe(c.leaderId),
        members: c.members.map((m) => Object.assign({}, m, { id: asMe(m.id), color: m.id === me ? ME_COLOR : memberColor(m.id) })),
        memberIds: c.memberIds.map(asMe),
        requests: (c.requests || []).map((r) => Object.assign({}, r, { color: memberColor(r.id) })),
        schedule: c.schedule, openJoin: c.openJoin, xp: c.xp, missionsDone: c.missionsDone,
        notices: c.notices || [], mission: c.mission, missionHave: c.missionHave, pendingMe: !!c.pendingMe,
      };
    },

    applyCrew(view) {
      const s = S();
      const crew = this.mapCrew(view);
      const at = s.crews.findIndex((c) => c.id === crew.id);
      if (at >= 0) s.crews[at] = crew;
      else s.crews.unshift(crew);
      return crew;
    },

    applyCrews(res) {
      const s = S();
      const before = Crew.mine(s);
      s.crews = (res.mine ? [this.mapCrew(res.mine)] : []).concat(res.nearby.map((c) => this.mapCrew(c)));
      const after = Crew.mine(s);
      // The week was cleared by somebody else's run: say so here too.
      if (before && after && before.id === after.id && after.mission && after.mission.completedAt
        && !(before.mission && before.mission.completedAt) && before.mission && before.mission.week === after.mission.week) {
        toast(`Mission cleared — <b>${esc(after.name)}</b> +${after.mission.xp} crew XP`, 'reward');
      }
    },

    mapFeedItem(i) {
      return {
        who: i.who.name, whoId: i.who.id, initials: i.who.initials, color: ownerColor(i.who.id), me: false,
        activity: i.activity, kudos: i.kudos || 0, kudosMine: !!i.kudosMine,
      };
    },

    /* --- Fetching --------------------------------------------------------------- */

    week: () => M.startOfWeek(Date.now()),

    /** GETs a path; resolves to null if the account changed meanwhile. */
    async fetch(path) {
      const epoch = this.epoch;
      const res = await Api.get(path);
      return epoch === this.epoch ? res : null;
    },

    async pullMe() { const me = await this.fetch('/v1/me'); if (me) this.applyMe(me); },

    async pullRuns() {
      let runs = [];
      let before = null;
      for (let page = 0; page < 10; page++) {
        const res = await this.fetch('/v1/runs?limit=500' + (before ? '&before=' + before : ''));
        if (!res) return;
        runs = runs.concat(res.runs);
        if (!res.next) break;
        before = res.next;
      }
      this.applyRuns(runs);
    },

    async pullMyLand() { const res = await this.fetch('/v1/land/mine'); if (res) this.applyMyLand(res.claims); },

    async pullLand(box) {
      const b = box || boxAround(S().profile.home, LAND_REACH);
      // The time machine replays ground already taken, so Pro loads that too.
      const history = M.Pro.can('timeMachine') ? '&history=1' : '';
      const res = await this.fetch(`/v1/land?bbox=${b.west},${b.south},${b.east},${b.north}${history}`);
      if (res) this.applyLand(b, res.claims);
    },

    async pullRaiders() { const res = await this.fetch('/v1/land/raiders'); if (res) S().server.raiders = res; },

    async pullFriends() {
      const res = await this.fetch('/v1/friends?week=' + this.week());
      if (!res) return;
      S().friends = res.friends.map((f) => this.mapFriend(f));
      if (S().account) S().account.friendCode = res.code;
      this.pulled.friends = Date.now();
    },

    async pullCrews() {
      const h = S().profile.home;
      const res = await this.fetch(`/v1/crews?lat=${h.lat}&lng=${h.lng}&week=${this.week()}`);
      if (!res) return;
      this.applyCrews(res);
      this.pulled.crews = Date.now();
    },

    async pullFeed() {
      const res = await this.fetch('/v1/feed');
      if (!res) return;
      S().feed = res.items.map((i) => this.mapFeedItem(i));
      this.pulled.feed = Date.now();
    },

    /** Everything, after signing in or coming back to the app. */
    async pullAll() {
      if (!Api.signedIn() || this.pulling) return this.pulling;
      const s = S();
      this.pulling = (async () => {
        try {
          await this.pullMe();
          await this.pullRuns();                  // plots point at runs, so runs first
          await Promise.all([this.pullMyLand(), this.pullFriends(), this.pullCrews(), this.pullFeed(), this.pullRaiders()]);
          await this.pullLand();
          if (S() !== s) return;                  // signed out meanwhile
          this.pulled.all = Date.now();
          State.save();
          await this.flush();
          this.checkInvites();
        } catch (err) {
          this.trouble(err);
        } finally {
          this.pulling = null;
        }
      })();
      return this.pulling;
    },

    /** Only what changes while you look away: crews, the feed, the map, friends. */
    async refresh() {
      if (!Api.signedIn()) return;
      if (Date.now() - (this.pulled.all || 0) > 10 * STALE_MS) { await this.pullAll(); return; }
      try {
        // Your own plots too: somebody may have run through them since.
        await Promise.all([this.pullMyLand(), this.pullCrews(), this.pullFeed(), this.pullFriends(), this.pullRaiders(), this.pullLand()]);
        State.save();
        await this.flush();
      } catch (err) { this.trouble(err); }
    },

    /** A different account (or none): nothing remembered about the last one. */
    reset() {
      this.epoch += 1;
      this.pulled = {};
      this.landBoxes = [];
      this.lastPrefs = null;
      clearTimeout(this._prefsTimer);
      clearTimeout(this._landTimer);
    },

    /** The territory map moved: load the ground in view if it is not loaded. */
    viewLand(bounds) {
      if (!Api.signedIn() || !bounds) return;
      const view = { west: bounds.west, south: bounds.south, east: bounds.east, north: bounds.north };
      // A map not laid out yet has no view to load.
      if (![view.west, view.south, view.east, view.north].every(Number.isFinite) || view.north <= view.south || view.east <= view.west) return;
      const fresh = this.landBoxes.some((b) => Date.now() - b.at < 2 * STALE_MS && covers(b.box, view));
      if (fresh) return;
      clearTimeout(this._landTimer);
      this._landTimer = setTimeout(() => {
        // A little more than the view, so a small pan does not ask again.
        const padLat = (view.north - view.south) * 0.25;
        const padLng = (view.east - view.west) * 0.25;
        const box = {
          west: view.west - padLng, east: view.east + padLng,
          south: view.south - padLat, north: view.north + padLat,
        };
        if (box.north - box.south > 0.55 || box.east - box.west > 0.55) return;   // zoomed out past what the server serves
        this.pullLand(box).then(() => State.save()).catch((err) => this.trouble(err));
      }, 350);
    },

    /** A screen was opened: fetch what it shows, if what we have is old. */
    onTab(tab) {
      if (!Api.signedIn()) return;
      const old = (key) => Date.now() - (this.pulled[key] || 0) > STALE_MS / 2;
      const pull = { crew: ['crews', 'pullCrews'], feed: ['feed', 'pullFeed'], profile: ['friends', 'pullFriends'] }[tab];
      if (!pull || !old(pull[0])) return;
      this[pull[1]]().then(() => State.save()).catch((err) => this.trouble(err));
    },

    /** You moved (or found where you are): crews and ground near you. */
    async nearby() {
      if (!Api.signedIn()) return;
      try {
        await Promise.all([this.pullCrews(), this.pullLand()]);
        State.save();
      } catch (err) { this.trouble(err); }
    },

    trouble(err) {
      // An ended session is handled where it is noticed (api.js). Being offline
      // is normal on a run; everything waits in the outbox.
      if (err && err.offline) return;
      if (err && err.status === 401) return;
      console.warn('[miles] sync:', err && err.message);
    },

    /* --- Sending ---------------------------------------------------------------- */

    uploadable(activity) {
      const out = {};
      UPLOAD_FIELDS.forEach((k) => { if (activity[k] !== undefined) out[k] = activity[k]; });
      return out;
    },

    /** Uploads whatever is waiting, oldest first. Safe to call any time. */
    async flush() {
      const s = S();
      if (!Api.signedIn() || this.flushing || !s.outbox || !s.outbox.length) return;
      this.flushing = true;
      let sent = 0;
      let lastClaim = null;
      try {
        while (s.outbox.length && S() === s) {
          const id = s.outbox[0];
          const activity = s.activities.find((a) => a.id === id);
          if (!activity) { s.outbox.shift(); continue; }
          let res;
          try {
            res = await Api.post('/v1/runs', { run: this.uploadable(activity) });
          } catch (err) {
            // No connection, or the server is struggling: it waits for next time.
            if (err.offline || err.status >= 500 || err.status === 429 || err.status === 401) break;
            // The server will not keep it, and the map is the server's: say
            // why, and take it off this phone too.
            s.outbox.shift();
            this.dropRun(activity);
            toast(`Not saved to your account — ${esc(err.message)}`);
            State.save();
            continue;
          }
          s.outbox.shift();
          lastClaim = this.applyUpload(activity, res) || lastClaim;
          sent++;
          State.save();
        }
      } finally {
        this.flushing = false;
      }
      if (sent && S() === s) {
        try {
          await Promise.all([
            this.pullMyLand(), this.pullCrews(), this.pullRaiders(),
            this.pullLand(lastClaim ? boxAround(Geo.centroid(lastClaim.polygon), LAND_REACH) : null),
          ]);
          State.save();
        } catch (err) { this.trouble(err); }
      }
    },

    applyUpload(activity, res) {
      const s = S();
      Object.assign(activity, this.mapRun(res.run));
      s.territories = s.territories.filter((t) => !(t.activityId === activity.id && !t.serverId));
      let claim = null;
      if (res.claim) {
        claim = this.mapMyClaim(res.claim);
        claim.activityId = activity.id;
        s.territories.unshift(claim);
      }
      if (res.crew && res.crew.missionCleared) {
        const c = res.crew.missionCleared;
        toast(`Mission cleared — <b>${esc(c.name)}</b> +${c.xp} crew XP`, 'reward');
      }
      return claim;
    },

    dropRun(activity) {
      const s = S();
      s.activities = s.activities.filter((a) => a !== activity);
      s.territories = s.territories.filter((t) => t.activityId !== activity.id || t.serverId);
    },

    /** Deletes one of your runs, and whatever ground it holds. */
    async deleteRun(activity) {
      if (activity.serverId) await Api.del('/v1/runs/' + activity.serverId);
      const s = S();
      s.outbox = s.outbox.filter((id) => id !== activity.id);
      s.activities = s.activities.filter((a) => a.id !== activity.id);
      s.territories = s.territories.filter((t) => t.activityId !== activity.id);
      State.save();
      this.refresh();
    },

    async rename(name, before) {
      try {
        this.applyMe(await Api.patch('/v1/me', { name }));
        State.save();
        toast(`You are now <b>${esc(S().profile.name)}</b>`);
      } catch (err) {
        const s = S();
        s.profile.name = before;
        State.save();
        toast(esc(err.message));
        this.pullMe().then(() => State.save()).catch(() => {});
      }
    },

    watchPrefs() {
      Bus.on('state:changed', () => {
        const s = S();
        if (!s || !s.connected || !Api.signedIn() || this.lastPrefs === null) return;
        if (JSON.stringify(this.prefsOf(s)) === this.lastPrefs) return;
        clearTimeout(this._prefsTimer);
        this._prefsTimer = setTimeout(() => {
          const snapshot = this.prefsOf(S());
          const json = JSON.stringify(snapshot);
          if (json === this.lastPrefs || !Api.signedIn()) return;
          this.lastPrefs = json;
          Api.patch('/v1/me', { prefs: snapshot }).catch((err) => { this.lastPrefs = null; this.trouble(err); });
        }, 1200);
      });
    },

    /* --- Friends, kudos, plots, races, Pro ------------------------------------- */

    async addFriend(code) {
      const res = await Api.post('/v1/friends', { code });
      const friend = this.mapFriend(res.friend);
      const s = S();
      s.friends = s.friends.filter((f) => f.id !== friend.id).concat([friend]);
      State.save();
      this.pullFeed().then(() => State.save()).catch((err) => this.trouble(err));
      return friend;
    },

    async removeFriend(id) {
      try {
        await Api.del('/v1/friends/' + id);
        await this.pullFeed();
        State.save();
      } catch (err) {
        toast(esc(err.message));
        await this.pullFriends().catch(() => {});
        State.save();
      }
    },

    async kudos(item) {
      const id = item.activity.serverId;
      const res = item.kudosMine ? await Api.del(`/v1/runs/${id}/kudos`) : await Api.post(`/v1/runs/${id}/kudos`);
      item.kudos = res.kudos;
      item.kudosMine = res.kudosMine;
      State.save();
      return item;
    },

    async stylePlot(territory, name, color) {
      const res = await Api.patch('/v1/claims/' + territory.serverId, { name: name || null, color: color || null });
      if (res.claim.name) territory.name = res.claim.name; else delete territory.name;
      territory.color = res.claim.color || undefined;
      State.save();
    },

    async createRace(target, rivals) {
      return (await Api.post('/v1/races', { target, rivals: rivals.map((r) => r.id) })).race;
    },

    /** Everyone in a race but you, as the race screen's rivals. */
    raceRivals(race) {
      const me = meId();
      const people = [race.host].concat(race.entrants).filter((p) => p && p.id !== me);
      return people.map((p) => {
        const known = S().friends.find((f) => f.id === p.id);
        return {
          id: p.id, name: p.name, initials: p.initials, color: ownerColor(p.id),
          pace: (known && known.pace) || 330, weekly: known ? known.weekly : 0, online: !!p.online,
        };
      });
    },

    /** Races you were invited to while the app was closed. */
    async checkInvites() {
      try {
        const res = await this.fetch('/v1/races/invites');
        if (!res) return;
        const fresh = res.races.filter((r) => Date.now() - r.createdAt < 10 * 60 * 1000);
        if (fresh.length) Bus.emit('live:invite', fresh[0]);
      } catch (err) { this.trouble(err); }
    },

    async startTrial() {
      this.applyMe(await Api.post('/v1/me/trial'));
      State.save();
      // The time machine needs the ground already taken.
      this.pullLand().then(() => State.save()).catch((err) => this.trouble(err));
    },

    /* --- Wiring ------------------------------------------------------------------ */

    /** Crew actions run on the phone as before, then on the server. */
    wrapCrew() {
      Object.keys(CREW_OPS).forEach((name) => {
        const original = Crew[name];
        Crew[name] = function (state, ...args) {
          const result = original.apply(Crew, [state].concat(args));
          if (!state.connected || (result && result.error)) return result;
          const [method, path, body] = CREW_OPS[name](state, ...args);
          Sync.crewRequest(method, path, body, name);
          return result;
        };
      });
    },

    crewRequest(method, path, body, name) {
      const epoch = this.epoch;
      Api.request(method, path, body).then((res) => {
        if (epoch !== this.epoch) return null;
        if (res && res.crew) this.applyCrew(res.crew);
        if (RELIST.indexOf(name) >= 0) return this.pullCrews().then(() => State.save());
        State.save();
        return null;
      }).catch((err) => {
        toast(esc(err.message));
        if (err.status === 402 && err.feature && M.UI) M.UI.openPro(err.feature);
        // Whatever the phone did, the server's crew is the real one.
        this.pullCrews().then(() => State.save()).catch(() => {});
      });
    },

    init() {
      if (!Api.enabled) return;
      this.wrapCrew();
      this.watchPrefs();
      document.addEventListener('visibilitychange', () => { if (!document.hidden) this.refresh(); });
      window.addEventListener('online', () => this.flush());
      Bus.on('live:connected', () => this.flush());
    },
  };

  M.Sync = Sync;
  Sync.init();
})(window.MILES);
