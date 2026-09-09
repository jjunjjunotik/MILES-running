/* ==========================================================================
   MILES · state
   The data model: profile, activities, territories, quests and rank.
   Distances are metres, durations seconds, areas square metres.
   ========================================================================== */

(function (M) {
  'use strict';

  const { Geo, Store, Bus, Units, startOfWeek, startOfMonth, uid } = M;

  /* --- Ranks --------------------------------------------------------------
     Earned with quest XP, never with raw distance: the ladder rewards what
     you set out to do, not only how far you went. ------------------------ */

  const RANKS = [
    { key: 'rookie',   name: 'Rookie',   badge: 'R', xp: 0 },
    { key: 'pacer',    name: 'Pacer',    badge: 'P', xp: 300 },
    { key: 'strider',  name: 'Strider',  badge: 'S', xp: 800 },
    { key: 'ranger',   name: 'Ranger',   badge: 'G', xp: 1600 },
    { key: 'vanguard', name: 'Vanguard', badge: 'V', xp: 2800 },
    { key: 'apex',     name: 'Apex',     badge: 'A', xp: 4500 },
  ];

  /* --- Intensity tiers ----------------------------------------------------
     Weekly volume decides how energetic the interface is allowed to be. -- */

  const TIERS = [
    { key: 'ember', name: 'Ember', from: 0 },
    { key: 'spark', name: 'Spark', from: 10000 },
    { key: 'blaze', name: 'Blaze', from: 20000 },
    { key: 'surge', name: 'Surge', from: 35000 },
    { key: 'storm', name: 'Storm', from: 55000 },
    { key: 'apex',  name: 'Apex',  from: 80000 },
  ];

  /* --- Run kinds ----------------------------------------------------------
     A plain run and a land grab are different intentions, so they are
     different modes. Only a Territory run can claim ground; a Race is scored
     by who reaches the agreed distance first. ---------------------------- */

  const KINDS = {
    free:      { key: 'free',      name: 'Free Run',      badge: 'RUN',       accent: '#c8ff2e' },
    territory: { key: 'territory', name: 'Territory Run', badge: 'TERRITORY', accent: '#8b5cf6' },
    race:      { key: 'race',      name: 'Race',          badge: 'RACE',      accent: '#ff3d8b' },
  };

  /** A race holds you plus up to four others. */
  const MAX_RIVALS = 4;

  const RACE_DISTANCES = [1000, 3000, 5000, 10000];

  const FRIEND_COLORS = ['#ff3d8b', '#2fe0ff', '#ffb020', '#2ee6a8', '#a855f7', '#ff8a4c', '#6ee7ff', '#f472b6'];

  /* --- Quests -------------------------------------------------------------
     Each quest measures itself against the live state, so progress is always
     consistent no matter how the state was reached (run, import, reset). - */

  const QUESTS = [
    {
      id: 'first-steps', icon: '👟', name: 'First Steps', xp: 60,
      note: 'Finish your first MILES run',
      progress: (s) => ({ have: s.activities.length, need: 1 }),
    },
    {
      id: 'weekly-20', icon: '📅', name: 'Weekly Twenty', xp: 180, repeatable: true,
      note: 'Cover 20 km in a single week',
      progress: (s) => ({ have: Stats.weekly(s).distance, need: 20000, format: 'dist' }),
    },
    {
      id: 'loop-hunter', icon: '🗺️', name: 'Loop Hunter', xp: 220,
      note: 'Close 3 loops on Territory runs',
      progress: (s) => ({ have: s.territories.length, need: 3 }),
    },
    {
      id: 'land-baron', icon: '🏴', name: 'Land Baron', xp: 320,
      note: 'Hold 2.5 km² of claimed territory',
      progress: (s) => ({ have: Stats.totalArea(s), need: 2.5e6, format: 'area' }),
    },
    {
      id: 'duel-win', icon: '🥇', name: 'First Blood', xp: 200,
      note: 'Win a race — cross the line first',
      progress: (s) => ({ have: s.activities.filter((a) => a.kind === 'race' && a.placing === 1).length, need: 1 }),
    },
    {
      id: 'duo-regular', icon: '🤝', name: 'Better Together', xp: 260,
      note: 'Line up for 5 races with friends',
      progress: (s) => ({ have: s.activities.filter((a) => a.kind === 'race').length, need: 5 }),
    },
    {
      id: 'full-grid', icon: '🏁', name: 'Full Grid', xp: 280,
      note: 'Race a full field — you and four rivals',
      progress: (s) => ({ have: s.activities.some((a) => a.kind === 'race' && a.fieldSize >= 5) ? 1 : 0, need: 1 }),
    },
    {
      id: 'streak-3', icon: '🔥', name: 'Three in a Row', xp: 240,
      note: 'Run on 3 consecutive days',
      progress: (s) => ({ have: Stats.streak(s), need: 3 }),
    },
    {
      id: 'long-haul', icon: '🛣️', name: 'Long Haul', xp: 300,
      note: 'Finish a single run of 10 km',
      progress: (s) => ({ have: s.activities.reduce((m, a) => Math.max(m, a.distance), 0), need: 10000, format: 'dist' }),
    },
    {
      id: 'sunrise', icon: '🌅', name: 'Sunrise Club', xp: 160,
      note: 'Start a run before 7:00 am',
      progress: (s) => ({ have: s.activities.some((a) => new Date(a.startedAt).getHours() < 7) ? 1 : 0, need: 1 }),
    },
  ];

  /* --- Derived statistics ------------------------------------------------- */

  const Stats = {
    since(state, ts) {
      const runs = state.activities.filter((a) => a.startedAt >= ts);
      return {
        runs: runs.length,
        distance: runs.reduce((s, a) => s + a.distance, 0),
        duration: runs.reduce((s, a) => s + a.duration, 0),
        elevation: runs.reduce((s, a) => s + (a.elevation || 0), 0),
      };
    },

    weekly(state, weeksAgo) {
      const base = startOfWeek(Date.now()) - (weeksAgo || 0) * 7 * 864e5;
      const end = base + 7 * 864e5;
      const runs = state.activities.filter((a) => a.startedAt >= base && a.startedAt < end);
      return {
        runs: runs.length,
        distance: runs.reduce((s, a) => s + a.distance, 0),
        duration: runs.reduce((s, a) => s + a.duration, 0),
      };
    },

    monthly(state, monthsAgo) {
      const now = new Date();
      now.setMonth(now.getMonth() - (monthsAgo || 0));
      const base = startOfMonth(now);
      const endDate = new Date(base);
      endDate.setMonth(endDate.getMonth() + 1);
      const runs = state.activities.filter((a) => a.startedAt >= base && a.startedAt < endDate.getTime());
      return {
        runs: runs.length,
        distance: runs.reduce((s, a) => s + a.distance, 0),
        duration: runs.reduce((s, a) => s + a.duration, 0),
      };
    },

    /** distance per day for the current week, Monday-first */
    weekDays(state) {
      const base = startOfWeek(Date.now());
      const days = new Array(7).fill(0);
      state.activities.forEach((a) => {
        const idx = Math.floor((a.startedAt - base) / 864e5);
        if (idx >= 0 && idx < 7) days[idx] += a.distance;
      });
      return days;
    },

    /** distance per month for the last six months, oldest first */
    monthBuckets(state) {
      return [5, 4, 3, 2, 1, 0].map((back) => this.monthly(state, back).distance);
    },

    /** Trailing seven days — what "how much are you running lately" means. */
    rolling7(state) {
      const since = Date.now() - 7 * 864e5;
      return state.activities
        .filter((a) => a.startedAt >= since)
        .reduce((sum, a) => sum + a.distance, 0);
    },

    totalArea(state) {
      return state.territories.reduce((s, t) => s + t.area, 0);
    },

    streak(state) {
      if (!state.activities.length) return 0;
      const days = new Set(state.activities.map((a) => new Date(a.startedAt).setHours(0, 0, 0, 0)));
      let streak = 0;
      let cursor = new Date().setHours(0, 0, 0, 0);
      if (!days.has(cursor)) cursor -= 864e5;           // yesterday still counts
      while (days.has(cursor)) { streak++; cursor -= 864e5; }
      return streak;
    },

    xp(state) {
      return QUESTS.reduce((sum, q) => {
        const done = state.questClaims[q.id] || 0;
        return sum + done * q.xp;
      }, 0);
    },

    rank(state) {
      const xp = this.xp(state);
      let current = RANKS[0];
      let next = null;
      for (let i = 0; i < RANKS.length; i++) {
        if (xp >= RANKS[i].xp) { current = RANKS[i]; next = RANKS[i + 1] || null; }
      }
      const span = next ? next.xp - current.xp : 1;
      return { xp, current, next, progress: next ? (xp - current.xp) / span : 1 };
    },

    tier(state) {
      const week = this.rolling7(state);
      let tier = TIERS[0];
      let next = null;
      for (let i = 0; i < TIERS.length; i++) {
        if (week >= TIERS[i].from) { tier = TIERS[i]; next = TIERS[i + 1] || null; }
      }
      // 0 → 1 energy across the whole ramp, used to drive motion and glow.
      const cap = TIERS[TIERS.length - 1].from;
      return { tier, next, week, energy: M.clamp(week / cap, 0, 1) };
    },
  };

  /* --- Quest evaluation --------------------------------------------------- */

  function questView(state, quest) {
    const p = quest.progress(state);
    const claims = state.questClaims[quest.id] || 0;
    const ratio = M.clamp(p.have / p.need, 0, 1);
    return {
      quest,
      have: p.have,
      need: p.need,
      format: p.format,
      ratio,
      complete: ratio >= 1,
      claimed: claims > 0 && (!quest.repeatable || ratio < 1),
    };
  }

  /** Awards XP for every quest that has just been satisfied. */
  function settleQuests(state) {
    const newly = [];
    QUESTS.forEach((q) => {
      const view = questView(state, q);
      if (view.complete && !(state.questClaims[q.id] > 0)) {
        state.questClaims[q.id] = 1;
        newly.push(q);
      }
    });
    return newly;
  }

  /* --- Demo seed ----------------------------------------------------------
     A first-time runner opening a fresh install should still see a living
     app, so we seed a plausible fortnight of history around their location. */

  function seed(home) {
    const rand = M.rng(20260908);
    const activities = [];
    const territories = [];
    const weekStart = startOfWeek(Date.now());
    const today = Math.floor((Date.now() - weekStart) / 864e5);

    // Offsets are measured from Monday so a fresh install always shows a
    // half-finished current week, whatever day it is opened.
    const plan = [
      { day: today - 0, dist: 5000, kind: 'race', placing: 1, fieldSize: 3 },
      { day: today - 1, dist: 3100, kind: 'territory' },
      { day: today - 2, dist: 12400, kind: 'free' },
      { day: today - 3, dist: 5000, kind: 'race', placing: 3, fieldSize: 4 },
      { day: today - 5, dist: 2600, kind: 'territory' },
      { day: today - 8, dist: 7400, kind: 'free' },
      { day: today - 9, dist: 10000, kind: 'race', placing: 2, fieldSize: 5 },
      { day: today - 12, dist: 5200, kind: 'free' },
    ];

    plan.forEach((p) => {
      const dayStart = weekStart + p.day * 864e5;
      const startedAt = dayStart + (6 + Math.floor(rand() * 13)) * 3600e3;
      if (startedAt > Date.now()) return;

      const isLoop = p.kind === 'territory';
      const paceSec = 300 + rand() * 90;                      // 5:00–6:30 per km
      const duration = Math.round((p.dist / 1000) * paceSec);
      const route = syntheticRoute(home, p.dist, isLoop, rand);
      const act = {
        id: uid(),
        startedAt,
        kind: p.kind,
        distance: p.dist,
        duration,
        elevation: Math.round(20 + rand() * 90),
        route,
        splits: [],
        loopClosed: isLoop,
        title: KINDS[p.kind].name,
        claimedArea: 0,
        target: p.kind === 'race' ? p.dist : null,
        placing: p.placing || null,
        fieldSize: p.fieldSize || null,
        finished: p.kind === 'race' ? true : null,
      };
      if (isLoop) {
        const area = Geo.polygonArea(route);
        act.claimedArea = area;
        territories.push({
          id: uid(), activityId: act.id, claimedAt: startedAt,
          polygon: route, area, owner: 'me',
        });
      }
      activities.push(act);
    });

    return {
      activities: activities.sort((a, b) => b.startedAt - a.startedAt),
      territories: territories.sort((a, b) => b.claimedAt - a.claimedAt),
    };
  }

  /** A believable route: a closed loop, or an out-and-back. */
  function syntheticRoute(home, distance, loop, rand) {
    const pts = [];
    const steps = 44;
    if (loop) {
      const radius = distance / (2 * Math.PI) * (0.8 + rand() * 0.15);
      const wobble = 0.18;
      const phase = rand() * Math.PI * 2;
      // Sit the loop in the neighbourhood rather than dead on the runner, so
      // claimed plots read as places on the map instead of a wash of colour.
      const centre = Geo.offset(home, (rand() - 0.5) * 1100, (rand() - 0.5) * 1100);
      for (let i = 0; i <= steps; i++) {
        const t = (i / steps) * Math.PI * 2;
        const r = radius * (1 + Math.sin(t * 3 + phase) * wobble);
        pts.push(Geo.offset(centre, Math.cos(t) * r, Math.sin(t) * r));
      }
    } else {
      const half = distance / 2;
      const heading = rand() * Math.PI * 2;
      const out = [];
      for (let i = 0; i <= steps / 2; i++) {
        const d = (i / (steps / 2)) * half;
        const drift = Math.sin(i * 0.7) * 60;
        out.push(Geo.offset(home, Math.cos(heading) * d + Math.cos(heading + 1.57) * drift,
                                  Math.sin(heading) * d + Math.sin(heading + 1.57) * drift));
      }
      pts.push(...out, ...out.slice(0, -1).reverse());
    }
    return pts;
  }

  /** Initials, colour and a race pace derived from how much they run. */
  function makeFriend(name, color, weekly, online) {
    return {
      id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + Math.random().toString(36).slice(2, 6),
      name,
      initials: name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase(),
      color,
      weekly: weekly || 0,
      online: online !== false,
      // Seconds per kilometre: the more they run, the quicker they line up.
      pace: Math.round(M.clamp(392 - (weekly || 0) / 1000 * 1.7, 255, 400)),
    };
  }

  /* --- The store ---------------------------------------------------------- */

  const DEFAULT_HOME = { lat: 37.5512, lng: 126.9882 };   // Namsan, Seoul

  const State = {
    data: null,

    init() {
      const saved = Store.read();
      if (saved && saved.version === 1) {
        this.data = saved;
      } else {
        const home = DEFAULT_HOME;
        const seeded = seed(home);
        this.data = {
          version: 1,
          profile: { name: 'You', handle: '@you', initials: 'YU', home },
          units: 'km',
          rangeMode: 'week',
          activities: seeded.activities,
          territories: seeded.territories,
          questClaims: {},
          crews: [],
          friends: [
            makeFriend('Alex Ryu', '#ff3d8b', 34200, true),
            makeFriend('Mina Park', '#2fe0ff', 51800, true),
            makeFriend('Theo Kim', '#ffb020', 18700, false),
            makeFriend('Sena Cho', '#2ee6a8', 62400, true),
          ],
        };
        settleQuests(this.data);
        this.save();
      }
      Units.system = this.data.units;

      // Migrations for state saved by an earlier version.
      if (!this.data.crews) this.data.crews = [];
      if (this.data.coach) delete this.data.coach;      // the coach feature is gone
      if (!this.data.crews.length && M.Crew) {
        this.data.crews = M.Crew.seedNearby(this.data.profile.home);
        this.save();
      }

      return this.data;
    },

    save() {
      Store.write(this.data);
      Bus.emit('state:changed', this.data);
    },

    setUnits(system) {
      this.data.units = system;
      Units.system = system;
      this.save();
    },

    setProfileName(name) {
      const clean = name.slice(0, 24);
      this.data.profile.name = clean;
      this.data.profile.handle = '@' + clean.toLowerCase().replace(/[^a-z0-9]+/g, '') || '@runner';
      this.data.profile.initials = clean.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || 'ME';
      this.save();
    },

    /** Adds a friend to race against. Returns the new friend, or null. */
    addFriend(name) {
      const clean = (name || '').trim().slice(0, 24);
      if (!clean) return null;
      const taken = this.data.friends.some((f) => f.name.toLowerCase() === clean.toLowerCase());
      if (taken) return null;
      const color = FRIEND_COLORS[this.data.friends.length % FRIEND_COLORS.length];
      const friend = makeFriend(clean, color, 0, true);
      this.data.friends.push(friend);
      this.save();
      return friend;
    },

    removeFriend(id) {
      this.data.friends = this.data.friends.filter((f) => f.id !== id);
      this.save();
    },

    /** Runs a Crew action against the live state and persists the result. */
    crewAction(fn) {
      const result = fn(this.data) || {};
      if (!result.error) this.save();
      return result;
    },

    setHome(home) {
      this.data.profile.home = home;
      this.save();
    },

    /** Records a finished run, claims any territory, and settles quests. */
    addActivity(activity) {
      this.data.activities.unshift(activity);
      let territory = null;
      // The claimable shape is the loop that was closed, which may be shorter
      // than the whole run if the runner carried on afterwards. Only a
      // Territory run takes ground — a free run or a race never does, however
      // neatly it happens to loop.
      const polygon = activity.territoryPolygon || activity.route;
      if (activity.kind === 'territory' && activity.loopClosed && polygon && polygon.length > 3) {
        const area = Geo.polygonArea(polygon);
        if (area > 1000) {                                   // ignore noise-sized loops
          territory = {
            id: uid(), activityId: activity.id, claimedAt: activity.startedAt,
            polygon, area, owner: 'me',
          };
          activity.claimedArea = area;
          this.data.territories.unshift(territory);
        }
      }
      const unlocked = settleQuests(this.data);
      this.save();
      return { territory, unlocked };
    },

    reset() {
      try { localStorage.removeItem('miles.v1'); } catch (err) { /* ignore */ }
      this.data = null;
      this.init();
      Bus.emit('state:changed', this.data);
    },
  };

  Object.assign(M, { State, Stats, QUESTS, RANKS, TIERS, KINDS, MAX_RIVALS, RACE_DISTANCES, questView, DEFAULT_HOME });
})(window.MILES);
