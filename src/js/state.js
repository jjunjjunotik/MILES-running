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

  // `accent` draws shapes; `ink` writes words. A stroke colour that reads at
  // 2 px does not necessarily read at 11 px on a chip's lifted background.
  const KINDS = {
    free:      { key: 'free',      name: 'Free Run',      badge: 'RUN',       accent: '#c8ff2e', ink: '#c8ff2e' },
    territory: { key: 'territory', name: 'Territory Run', badge: 'TERRITORY', accent: '#a855f7', ink: '#c4a2fb' },
    race:      { key: 'race',      name: 'Race',          badge: 'RACE',      accent: '#ff3d8b', ink: '#ff7aae' },
  };

  /** A race holds you plus up to four others. */

  const RACE_DISTANCES = [1000, 3000, 5000, 10000];

  /* --- Owner colours -------------------------------------------------------
     Land is a map: any two plots can share a border, so these are validated as
     ALL pairs, not just neighbours in a list. Five is the measured ceiling on
     this surface — at six, the worst pair drops below the threshold where full
     colour vision can separate them. Slot 1 is always you.

     Worst pair across all ten: ΔE 16.2 simulated colour-blind, 16.6 normal
     (floors are 8 and 15). Past five owners the hues repeat, which is why every
     plot is also labelled with its owner — colour never carries identity alone. */
  const OWNER_COLORS = [
    '#a855f7',   // 1 · you, violet
    '#e66700',   // 2 · orange
    '#89dc88',   // 3 · green
    '#26dafe',   // 4 · cyan
    '#c14685',   // 5 · magenta
  ];
  const FRIEND_COLORS = OWNER_COLORS.slice(1);

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

  /** The neighbours' claims. Generated once, then resolved like any other. */
  /* Runners you have never met, holding ground in the districts around you.
     They exist so that panning the map is worth doing: the city keeps going
     past your own neighbourhood, and it is already spoken for. */
  const LOCAL_NAMES = [
    'Haru Jung', 'Bo Lim', 'Iris Nam', 'Dane Oh', 'Yuna Seo', 'Kai Moon',
    'Remy Baek', 'Nari Gu', 'Sol Hwang', 'Jae Min', 'Tae Yun', 'Mira Han',
    'Eun Ha', 'Orin Koo', 'Lia Shin', 'Doyun Ha', 'Vera Song', 'Nico Ahn',
  ];

  function initialsOf(name) {
    return name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  }

  /** A closed, slightly irregular ring around a point — one runner's loop. */
  function loopAround(centre, radius, wobble, rand) {
    const ring = [];
    for (let i = 0; i < 16; i++) {
      const t = (i / 16) * Math.PI * 2;
      const r = radius * (0.75 + Math.sin(t * 3 + wobble) * 0.2);
      ring.push(Geo.offset(centre, Math.cos(t) * r, Math.sin(t) * r));
    }
    return ring;
  }

  /**
   * Districts of claimed land spread across the wider city. Each district is a
   * cluster of a few runners, so panning somewhere new shows a neighbourhood
   * with its own owners rather than a thin scatter of strangers.
   */
  function seedDistrictLand(home) {
    const rand = M.rng(90210);
    const land = [];
    let n = 0;

    for (let d = 0; d < 12; d++) {
      // Ringed outwards so the districts do not all land in one direction, and
      // close enough together that panning finds one without a hunt.
      const bearing = (d / 12) * Math.PI * 2 + rand() * 0.4;
      const reach = 1800 + rand() * 5200;
      const hub = Geo.offset(home, Math.cos(bearing) * reach, Math.sin(bearing) * reach);
      const locals = 2 + Math.floor(rand() * 3);

      for (let k = 0; k < locals; k++) {
        const name = LOCAL_NAMES[n % LOCAL_NAMES.length];
        // Colours repeat between districts, never inside one — and every plot
        // carries its owner's initials, so colour is never the only cue.
        const color = FRIEND_COLORS[k % FRIEND_COLORS.length];
        const claims = 1 + Math.floor(rand() * 2);
        for (let c = 0; c < claims; c++) {
          const centre = Geo.offset(hub, (rand() - 0.5) * 1700, (rand() - 0.5) * 1700);
          const polygon = loopAround(centre, 230 + rand() * 340, n + c, rand);
          land.push({
            id: `local-${n}-${c}`,
            owner: `local-${n}`,
            ownerName: name,
            initials: initialsOf(name),
            color,
            polygon,
            area: Geo.polygonArea(polygon),
            claimedAt: Date.now() - Math.floor(rand() * 1400 + 1) * 864e5,
          });
        }
        n++;
      }
    }
    return land;
  }

  /**
   * One deliberate border war. Territory only means something once somebody
   * has taken some of yours, and with everyone else's claims seeded older than
   * your own nobody ever had — so the map opened with a contest that had never
   * happened. This puts a neighbour's loop across your newest plot, run the
   * morning after you claimed it.
   */
  function seedContested(state) {
    const mine = (state.territories || []).slice().sort((a, b) => b.claimedAt - a.claimedAt)[0];
    const rival = (state.friends || [])[2] || (state.friends || [])[0];
    if (!mine || !rival || !mine.polygon || mine.polygon.length < 3) return null;

    const ring = mine.polygon;
    const centre = {
      lat: ring.reduce((a, p) => a + p.lat, 0) / ring.length,
      lng: ring.reduce((a, p) => a + p.lng, 0) / ring.length,
    };
    // Offset by about a radius so the loops overlap in a lens, not a swallow:
    // a neighbour taking a bite out of one edge, which is what it looks like.
    const radius = Math.sqrt(Math.max(1, Geo.polygonArea(ring)) / Math.PI);
    const hub = Geo.offset(centre, radius * 1.05, radius * 0.35);
    const polygon = loopAround(hub, radius * 0.95, 4, null);

    return {
      id: 'contest-0',
      owner: rival.id,
      ownerName: rival.name,
      initials: rival.initials,
      color: rival.color,
      polygon,
      area: Geo.polygonArea(polygon),
      claimedAt: mine.claimedAt + 11 * 36e5,
    };
  }

  function seedRivalLand(state) {
    const home = state.profile.home;
    const land = [];
    state.friends.forEach((friend, idx) => {
      const rand = M.rng(1000 + idx * 77);
      const count = 2 + Math.floor(rand() * 2);
      for (let c = 0; c < count; c++) {
        const centre = Geo.offset(home, (rand() - 0.5) * 2600, (rand() - 0.5) * 2600);
        const radius = 260 + rand() * 320;
        const polygon = [];
        for (let i = 0; i < 16; i++) {
          const t = (i / 16) * Math.PI * 2;
          const r = radius * (0.75 + Math.sin(t * 3 + idx) * 0.2);
          polygon.push(Geo.offset(centre, Math.cos(t) * r, Math.sin(t) * r));
        }
        land.push({
          id: `${friend.id}-${c}`,
          owner: friend.id,
          ownerName: friend.name,
          initials: friend.initials,
          color: friend.color,
          polygon,
          area: Geo.polygonArea(polygon),
          claimedAt: Date.now() - Math.floor(rand() * 900 + 1) * 864e5,
        });
      }
    });
    const contested = seedContested(state);
    return land.concat(seedDistrictLand(home), contested ? [contested] : []);
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
          mapStyle: 'dark',
          pro: { plan: null, trialEndsAt: null },
          rangeMode: 'week',
          activities: seeded.activities,
          territories: seeded.territories,
          questClaims: {},
          crews: [],
          rivalLand: [],
          friends: [
            makeFriend('Alex Ryu', FRIEND_COLORS[0], 34200, true),
            makeFriend('Mina Park', FRIEND_COLORS[1], 51800, true),
            makeFriend('Theo Kim', FRIEND_COLORS[2], 18700, false),
            makeFriend('Sena Cho', FRIEND_COLORS[3], 62400, true),
          ],
        };
        settleQuests(this.data);
        this.save();
      }
      Units.system = this.data.units;

      // Migrations for state saved by an earlier version.
      if (!this.data.crews) this.data.crews = [];
      // Crews saved before notices, missions, levels, photos or multi-day
      // schedules existed.
      (this.data.crews || []).forEach((crew) => {
        if (crew.photo === undefined) crew.photo = null;
        if (crew.schedule && !crew.schedule.days) {
          crew.schedule.days = M.Crew.days(crew);
          delete crew.schedule.day;
        }
        delete crew.emoji;
        if (!crew.notices) crew.notices = [];
        if (crew.xp === undefined) crew.xp = 0;
        if (crew.missionsDone === undefined) crew.missionsDone = 0;
        if (crew.mission === undefined) crew.mission = null;
      });

      if (!this.data.rivalLand) this.data.rivalLand = [];
      // Saved before the map could show real imagery.
      if (!this.data.mapStyle) this.data.mapStyle = 'dark';
      // Saved before there was anything to buy.
      if (!this.data.pro) this.data.pro = { plan: null, trialEndsAt: null };

      // Owners painted before the palette was validated keep colours that are
      // indistinguishable from each other; restate them in slot order.
      const stale = this.data.friends.some((f, i) => f.color !== FRIEND_COLORS[i % FRIEND_COLORS.length]);
      if (stale) {
        this.data.friends.forEach((f, i) => { f.color = FRIEND_COLORS[i % FRIEND_COLORS.length]; });
        (this.data.rivalLand || []).forEach((claim) => {
          const owner = this.data.friends.find((f) => f.id === claim.owner);
          if (owner) { claim.color = owner.color; claim.initials = owner.initials; }
        });
      }
      if (!this.data.rivalLand.length) {
        this.data.rivalLand = seedRivalLand(this.data);
        this.resolveLand();
      } else if (!this.data.rivalLand.some((t) => t.id === 'contest-0')) {
        // Saved before anyone had ever taken ground from you.
        const contested = seedContested(this.data);
        if (contested) {
          this.data.rivalLand = this.data.rivalLand.concat([contested]);
          this.resolveLand();
        }
      }
      if (!this.data.rivalLand.some((t) => String(t.owner).indexOf('local-') === 0)) {
        // Saved before the map could be panned, when land stopped at the edge
        // of your own neighbourhood. Give the rest of the city its owners.
        this.data.rivalLand = this.data.rivalLand.concat(seedDistrictLand(this.data.profile.home));
        this.resolveLand();
      }
      // Claims saved before territory became exclusive have no `pieces`.
      if (this.data.territories.some((t) => !t.pieces)) this.resolveLand();
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

    /**
     * Recomputes who holds what. Every claim — yours and your neighbours' —
     * gives up any ground a later claim encloses, so no two plots overlap.
     */
    resolveLand() {
      const claims = this.data.territories.concat(this.data.rivalLand || []);
      if (claims.length) M.Land.resolve(claims, this.data.profile.home);
      return claims;
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
      if (territory) this.resolveLand();
      const unlocked = settleQuests(this.data);
      this.save();
      // The claim may have been trimmed by a later one, though a brand new run
      // is normally the latest thing on the map.
      if (territory) activity.claimedArea = territory.area;
      return { territory, unlocked };
    },

    reset() {
      try { localStorage.removeItem('miles.v1'); } catch (err) { /* ignore */ }
      this.data = null;
      this.init();
      Bus.emit('state:changed', this.data);
    },
  };

  Object.assign(M, { State, Stats, QUESTS, RANKS, TIERS, KINDS, RACE_DISTANCES, OWNER_COLORS, FRIEND_COLORS, questView, DEFAULT_HOME });
})(window.MILES);
