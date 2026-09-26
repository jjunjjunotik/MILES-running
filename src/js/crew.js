/* ==========================================================================
   MILES · crews
   A crew is a running club with a home turf. You can start one, find the ones
   near you, and — if you lead one — decide who runs under its name.
   ========================================================================== */

(function (M) {
  'use strict';

  const { Geo, uid, clamp } = M;

  const ROLES = { leader: 'Captain', pacer: 'Pacer', member: 'Member' };

  /* --- Crew levels ---------------------------------------------------------
     Four tiers, earned only by finishing the weekly mission together. A crew
     cannot climb by being large or by one member running a lot — the whole
     crew has to clear the week. ------------------------------------------- */

  const CREW_TIERS = [
    { index: 1, name: 'Startline', xp: 0,    note: 'Newly founded. Clear a week to start climbing.' },
    { index: 2, name: 'Pack',      xp: 600,  note: 'Running as a unit. The mission is habit now.' },
    { index: 3, name: 'Legion',    xp: 1800, note: 'A crew with a reputation on this map.' },
    { index: 4, name: 'Dynasty',   xp: 4200, note: 'Top tier. Nothing above this one.' },
  ];

  /* --- Weekly missions -----------------------------------------------------
     The captain sets one each week; every member's running counts toward it.
     Targets scale with crew size, so a mission is the same ask whether there
     are three of you or twelve. ------------------------------------------- */

  /* --- What one member's week is worth -------------------------------------
     The three missions are only comparable if their targets are the same
     multiple of what a member actually produces in each unit — and the first
     set was not: distance asked for less than half a week's running while the
     two territory missions asked for four times a week's claiming. Guessing at
     each one separately is how that happens, so these are measured from the
     app's own numbers instead, and everything below is derived from them.

     Measured across the seeded world: mean weekly volume per member, mean run
     length, the share of runs that are territory runs, the area a closed loop
     actually encloses, and the share of claimed ground that came off somebody
     who already held it. -------------------------------------------------- */

  const MEMBER_WEEK = 32000;        // metres run, per member, per week
  const MEAN_RUN = 6300;            // metres
  const TERRITORY_SHARE = 0.25;     // of runs, are territory runs
  const MEAN_CLAIM = 294000;        // m² enclosed by one closed loop
  const TAKEN_SHARE = 0.164;        // of claimed ground, was cut out of someone

  const LOOPS_PER_WEEK = (MEMBER_WEEK / MEAN_RUN) * TERRITORY_SHARE;

  /** One member's week, in each mission's own unit. */
  const PER_WEEK = {
    distance: MEMBER_WEEK,
    claimed: LOOPS_PER_WEEK * MEAN_CLAIM,
    taken: LOOPS_PER_WEEK * MEAN_CLAIM * TAKEN_SHARE,
  };

  /* How much of that week the mission asks for. Below 1 on purpose: a weekly
     crew goal should be something a crew running normally clears together,
     not a coin toss. One number, so all three are equally hard by
     construction rather than by coincidence. */
  const ASK = 0.9;

  /**
   * Three missions, and only three. They are the three things this app
   * measures — distance run, ground claimed, ground taken off somebody — so a
   * crew's week is always one of those, and a captain choosing between them is
   * choosing what the crew is for rather than picking a difficulty.
   *
   * The target is `perMember` times the headcount, so a crew of twelve is
   * asked for twelve times what a crew of one is. The XP is the same for all
   * three: equal work, equal reward, or the choice stops being about what the
   * crew wants to do.
   */
  const MISSION_XP = 280;

  const MISSIONS = {
    distance: {
      key: 'distance', name: 'Cover the ground', unit: 'dist',
      note: 'Every kilometre, added up',
      perMember: Math.round(PER_WEEK.distance * ASK), xp: MISSION_XP,
    },
    claimed: {
      key: 'claimed', name: 'Take ground', unit: 'area',
      note: 'New land claimed this week',
      perMember: Math.round(PER_WEEK.claimed * ASK), xp: MISSION_XP,
    },
    taken: {
      key: 'taken', name: 'Take it off somebody', unit: 'area',
      note: 'Ground cut out of other runners',
      perMember: Math.round(PER_WEEK.taken * ASK), xp: MISSION_XP,
    },
  };

  const CREW_COLORS = ['#ff3d8b', '#2fe0ff', '#ffb020', '#2ee6a8', '#a855f7', '#ff8a4c'];

  const NEARBY_SEED = [
    { name: 'Dawn Patrol', tagline: 'Out the door before the city wakes', days: ['Tue', 'Thu'], time: '05:40', spot: 'Riverside gate',
      notice: 'Clocks go back this weekend — 05:40 is still 05:40. Bring a light.' },
    { name: 'Hill Tax', tagline: 'We pay it every Wednesday', days: ['Wed'], time: '19:00', spot: 'North ridge car park',
      notice: 'North ridge is closed for resurfacing. We meet at the south gate until further notice.' },
    { name: 'Long Way Home', tagline: 'Easy miles, loud conversation', days: ['Sun'], time: '08:00', spot: 'Central fountain',
      notice: 'Reminder: Sunday is easy pace. If you can\'t talk, you\'re running it wrong.' },
    { name: 'Track Rats', tagline: 'Intervals until the lights go out', days: ['Mon', 'Wed', 'Fri'], time: '20:00', spot: 'Municipal track',
      notice: 'Track is booked by the school until 20:15 on Mondays. Warm up on the outer loop.' },
    { name: 'Land Grab', tagline: 'Loops only. The map is the point.', days: ['Sat'], time: '07:30', spot: 'Old market square',
      notice: 'We are two plots off overtaking Dawn Patrol. Close your loops this week.' },
  ];

  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  const FIRST = ['Jae', 'Mina', 'Theo', 'Sena', 'Rae', 'Noa', 'Kai', 'Ari', 'Yuna', 'Dev', 'Iris', 'Ollie', 'Nam', 'Sol', 'Beck'];
  const LAST = ['Ito', 'Park', 'Kim', 'Cho', 'Ryu', 'Han', 'Lim', 'Oh', 'Seo', 'Bae', 'Jung', 'Yoon'];

  function initialsOf(name) {
    return name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  }

  function person(rand, role) {
    const name = `${FIRST[Math.floor(rand() * FIRST.length)]} ${LAST[Math.floor(rand() * LAST.length)]}`;
    return {
      id: uid(),
      name,
      initials: initialsOf(name),
      color: CREW_COLORS[Math.floor(rand() * CREW_COLORS.length)],
      role: role || 'member',
      joinedAt: Date.now() - Math.floor(rand() * 300) * 864e5,
      weekly: Math.round((8 + rand() * 55) * 1000),
    };
  }

  const Crew = {
    ROLES,
    CREW_TIERS,
    DAYS,

    /* --- Schedule ---------------------------------------------------------- */

    /** A crew can meet on several days; older crews stored a single one. */
    days(crew) {
      const sched = (crew && crew.schedule) || {};
      if (Array.isArray(sched.days)) return sched.days.filter((d) => DAYS.indexOf(d) >= 0);
      if (!sched.day) return [];
      // "Tue & Thu" and "Mon, Wed" both came out of the old single-day field.
      return String(sched.day).split(/[&,]/).map((d) => d.trim()).filter((d) => DAYS.indexOf(d) >= 0);
    },

    formatDays(crew) {
      const days = this.days(crew).slice().sort((a, b) => DAYS.indexOf(a) - DAYS.indexOf(b));
      if (!days.length) return 'No regular day';
      if (days.length === 7) return 'Every day';
      if (days.length === 2) return days.join(' & ');
      return days.join(', ');
    },

    /** "05:40" → "5:40 AM". Stored as 24-hour; shown the way people say it. */
    formatTime(time) {
      const parts = String(time || '').split(':');
      let hour = Number(parts[0]);
      const minute = parts[1] || '00';
      if (!isFinite(hour)) return '—';
      const meridiem = hour >= 12 ? 'PM' : 'AM';
      hour = hour % 12;
      if (hour === 0) hour = 12;
      return `${hour}:${minute} ${meridiem}`;
    },

    /** Splits a stored time for the pickers. */
    timeParts(time) {
      const parts = String(time || '08:00').split(':');
      let hour = Number(parts[0]);
      if (!isFinite(hour)) hour = 8;
      const meridiem = hour >= 12 ? 'PM' : 'AM';
      let h12 = hour % 12;
      if (h12 === 0) h12 = 12;
      return { hour: h12, minute: parts[1] || '00', meridiem };
    },

    /** Back to 24-hour for storage. */
    toTime(hour, minute, meridiem) {
      let h = Number(hour) % 12;
      if (meridiem === 'PM') h += 12;
      return `${String(h).padStart(2, '0')}:${minute}`;
    },

    /** Two letters for the crew, used when there is no photo yet. */
    monogram(crew) {
      const words = String((crew && crew.name) || '?').split(/\s+/).filter(Boolean);
      if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
      return String((crew && crew.name) || '?').slice(0, 2).toUpperCase();
    },

    /** Whoever in the crew runs the quickest — the pace on the card is theirs. */
    paceLeader(crew) {
      const paced = (crew.members || []).filter((m) => m.pace);
      if (!paced.length) return null;
      return paced.reduce((best, m) => (m.pace < best.pace ? m : best));
    },

    /** Members running quicker than the crew's average — the ones pushing it. */
    pacesetters(crew) {
      const paced = (crew.members || []).filter((m) => m.pace);
      if (paced.length < 2) return [];
      const average = paced.reduce((sum, m) => sum + m.pace, 0) / paced.length;
      return paced.filter((m) => m.pace < average).sort((a, b) => a.pace - b.pace);
    },

    MISSIONS,
    PER_WEEK,

    /* --- Level ------------------------------------------------------------- */

    level(crew) {
      const xp = (crew && crew.xp) || 0;
      let tier = CREW_TIERS[0];
      let next = null;
      CREW_TIERS.forEach((t, i) => {
        if (xp >= t.xp) { tier = t; next = CREW_TIERS[i + 1] || null; }
      });
      const span = next ? next.xp - tier.xp : 1;
      return { xp, tier, next, progress: next ? M.clamp((xp - tier.xp) / span, 0, 1) : 1 };
    },

    /* --- Notices -----------------------------------------------------------
       The captain's board. Members read it; only the captain writes. ------ */

    notices(crew) {
      return ((crew && crew.notices) || []).slice().sort((a, b) => b.at - a.at);
    },

    postNotice(state, crewId, text) {
      const crew = this._led(state, crewId);
      if (!crew) return { error: 'Only the captain can post a notice.' };
      const body = (text || '').trim().slice(0, 280);
      if (!body) return { error: 'A notice needs something in it.' };
      if (!crew.notices) crew.notices = [];
      crew.notices.unshift({ id: uid(), text: body, at: Date.now(), by: state.profile.name });
      crew.notices = crew.notices.slice(0, 20);
      return { crew, notice: crew.notices[0] };
    },

    removeNotice(state, crewId, noticeId) {
      const crew = this._led(state, crewId);
      if (!crew) return { error: 'Only the captain can remove a notice.' };
      crew.notices = (crew.notices || []).filter((n) => n.id !== noticeId);
      return { crew };
    },

    /* --- Weekly mission -----------------------------------------------------
       One per week, chosen by the captain, cleared by everyone. ----------- */

    weekKey(when) {
      return M.startOfWeek(when || Date.now());
    },

    /** The choices on offer this week, with targets scaled to crew size. */
    /** The three missions, with this crew's size already priced in. */
    missionOptions(crew) {
      const heads = Math.max(1, this.memberCount(crew));
      return Object.keys(MISSIONS).map((key) => {
        const def = MISSIONS[key];
        return {
          key,
          def,
          heads,
          target: Math.max(1000, Math.round(def.perMember * heads)),
          xp: def.xp,
        };
      });
    },

    setMission(state, crewId, optionKey) {
      const crew = this._led(state, crewId);
      if (!crew) return { error: 'Only the captain sets the mission.' };
      const option = this.missionOptions(crew).find((o) => o.key === optionKey);
      if (!option) return { error: 'Unknown mission.' };

      const week = this.weekKey();
      if (crew.mission && crew.mission.week === week && crew.mission.completedAt) {
        return { error: 'This week is already cleared. The next one starts Monday.' };
      }
      crew.mission = {
        week,
        key: option.key,
        type: option.def.key,
        heads: option.heads,          // what the crew was when it was set
        target: option.target,
        xp: option.xp,
        setAt: Date.now(),
        completedAt: null,
      };
      return { crew, mission: crew.mission };
    },

    /**
     * How far the crew has got this week. Your own contribution comes from your
     * real activities; the others' from the volume they are known to run.
     */
    missionStatus(state, crew) {
      const mission = crew && crew.mission;
      const week = this.weekKey();
      if (!mission) return { mission: null, stale: false, week };
      if (mission.week !== week) return { mission, stale: true, week };

      const def = MISSIONS[mission.type];
      // A mission set before the three were settled on no longer exists. Treat
      // it as last week's so the captain is asked for a new one rather than
      // shown a bar that measures nothing.
      if (!def) return { mission, stale: true, week };

      const others = crew.members.filter((m) => m.id !== 'me');
      const inCrew = crew.memberIds.indexOf('me') >= 0;

      // Your own contribution is measured from what you actually ran. Your
      // team-mates' is modelled from their weekly volume, the way every other
      // number about them in this app is, until there is a server to ask.
      let have = 0;
      if (mission.type === 'distance') {
        have = others.reduce((sum, m) => sum + (m.weekly || 0), 0)
          + (inCrew ? M.Stats.weekly(state).distance : 0);
      } else if (mission.type === 'claimed') {
        const mine = (state.territories || [])
          .filter((t) => t.claimedAt >= week)
          .reduce((sum, t) => sum + (t.area || 0), 0);
        have = others.reduce((sum, m) => sum + this.modelled(m, 'claimed'), 0) + (inCrew ? mine : 0);
      } else if (mission.type === 'taken') {
        have = others.reduce((sum, m) => sum + this.modelled(m, 'taken'), 0)
          + (inCrew ? this.takenSince(state, crew, week) : 0);
      }

      const complete = have >= mission.target;
      return {
        mission, def, have, stale: false, week,
        need: mission.target,
        progress: M.clamp(have / Math.max(1, mission.target), 0, 1),
        complete,
      };
    },

    /**
     * What a team-mate of this volume would have produced this week, in a
     * mission's unit. Scaled from the same member-week the targets are, so a
     * crew of team-mates is asked for exactly what a crew of real runners
     * would be — the two halves of the sum have to agree or the difficulty
     * depends on how much of your crew is fiction.
     */
    modelled(member, type) {
      const week = member.weekly || 0;
      if (type === 'distance') return week;
      return Math.round((week / MEMBER_WEEK) * PER_WEEK[type]);
    },

    /**
     * Ground this crew has cut out of runners outside it since a moment in
     * time. Measured, not modelled: it replays the same cuts that decide the
     * live map and counts only the ones this crew made, so a plot two members
     * both ran over is counted once and the total can never exceed what those
     * runners actually lost.
     */
    takenSince(state, crew, since) {
      if (!crew) return 0;
      const ids = new Set((crew.members || []).map((m) => m.id));
      const all = (state.territories || []).concat(state.rivalLand || []);
      const origin = state.profile.home;
      const ours = (t) => ids.has(t.owner === 'me' || !t.owner ? 'me' : t.owner);

      let total = 0;
      all.forEach((victim) => {
        if (ours(victim)) return;                    // taking your own is not taking
        M.Land.raiders(victim, all, origin, since).forEach((r) => {
          if (ids.has(r.owner)) total += r.area;
        });
      });
      return total;
    },

    /**
     * Banks the reward once the crew clears the week. Safe to call repeatedly —
     * a mission pays out once.
     */
    settleMission(state, crew) {
      const status = this.missionStatus(state, crew);
      if (!status.mission || status.stale || !status.complete || status.mission.completedAt) return null;
      crew.mission.completedAt = Date.now();
      crew.xp = (crew.xp || 0) + crew.mission.xp;
      crew.missionsDone = (crew.missionsDone || 0) + 1;
      return { crew, xp: crew.mission.xp, level: this.level(crew) };
    },


    /** Everything the app knows about: the crew you are in, plus the locals. */
    all(state) { return state.crews || []; },

    mine(state) {
      return this.all(state).find((c) => c.memberIds && c.memberIds.indexOf('me') >= 0) || null;
    },

    nearby(state) {
      const mine = this.mine(state);
      return this.all(state)
        .filter((c) => !mine || c.id !== mine.id)
        .sort((a, b) => a.distance - b.distance);
    },

    isLeader(crew) { return !!crew && crew.leaderId === 'me'; },

    memberCount(crew) { return crew.members.length; },

    /** Weekly volume of the whole crew — the number crews actually brag about. */
    weeklyVolume(crew) {
      return crew.members.reduce((sum, m) => sum + (m.weekly || 0), 0);
    },

    paceBand(crew) {
      const paces = crew.members.map((m) => m.pace).filter(Boolean);
      if (!paces.length) return null;
      return [Math.min.apply(null, paces), Math.max.apply(null, paces)];
    },

    /* --- Discovery -------------------------------------------------------- */

    /** Generates the local crews once, then leaves them alone. */
    seedNearby(home) {
      const rand = M.rng(70707);
      return NEARBY_SEED.map((s, i) => {
        const bearing = rand() * Math.PI * 2;
        const away = 400 + rand() * 4200;                  // 0.4–4.6 km out
        const base = Geo.offset(home, Math.cos(bearing) * away, Math.sin(bearing) * away);
        const size = 4 + Math.floor(rand() * 9);
        const members = [];
        for (let k = 0; k < size; k++) {
          const m = person(rand, k === 0 ? 'leader' : rand() > 0.75 ? 'pacer' : 'member');
          m.pace = Math.round(clamp(400 - (m.weekly / 1000) * 1.8, 250, 420));
          members.push(m);
        }
        return {
          id: 'crew-' + i,
          name: s.name,
          tagline: s.tagline,
          photo: null,
          color: CREW_COLORS[i % CREW_COLORS.length],
          foundedAt: Date.now() - Math.floor(rand() * 900 + 90) * 864e5,
          home: base,
          distance: away,
          leaderId: members[0].id,
          members,
          memberIds: members.map((m) => m.id),
          requests: [],
          schedule: { days: s.days, time: s.time, spot: s.spot },
            openJoin: rand() > 0.4,        // some crews let you in, some review you
          xp: Math.floor(rand() * 3800),
          missionsDone: Math.floor(rand() * 14),
          notices: [{
            id: 'n-' + i,
            text: s.notice,
            at: Date.now() - Math.floor(rand() * 5 + 1) * 864e5,
            by: members[0].name,
          }],
          mission: null,
        };
      });
    },

    /* --- Territory ----------------------------------------------------------
       A crew's ground is simply its members' ground. Claims are already
       exclusive across the whole map — no two overlap, whoever owns them — so
       the crew total is a sum and needs no geometry of its own. What the crew
       adds is the grouping: adjacent plots drawn in one colour read as one
       holding, which is the thing a crew actually wants to see. ------------- */

    /** Every claim on the map held by a member of this crew. */
    claims(state, crew) {
      if (!crew) return [];
      const ids = new Set((crew.members || []).map((m) => m.id));
      const mine = ids.has('me') ? (state.territories || []) : [];
      return (state.rivalLand || []).filter((t) => ids.has(t.owner)).concat(mine);
    },

    /**
     * What a crew holds, and who put it there. `byMember` is the honest answer
     * to "who is carrying this crew" — it counts ground still held, not ground
     * ever claimed, so a member whose land has been taken back does not keep
     * credit for it.
     */
    territory(state, crew) {
      const claims = this.claims(state, crew);
      const byId = new Map();

      claims.forEach((t) => {
        const id = t.owner === 'me' || !t.owner ? 'me' : t.owner;
        const prev = byId.get(id);
        if (prev) { prev.area += t.area || 0; prev.plots += 1; }
        else byId.set(id, { id, area: t.area || 0, plots: 1 });
      });

      const byMember = (crew.members || []).map((m) => {
        const row = byId.get(m.id) || { area: 0, plots: 0 };
        return { id: m.id, name: m.id === 'me' ? 'You' : m.name, initials: m.initials, me: m.id === 'me', area: row.area, plots: row.plots };
      }).filter((r) => r.plots > 0).sort((a, b) => b.area - a.area);

      return {
        claims,
        plots: claims.length,
        area: claims.reduce((sum, t) => sum + (t.area || 0), 0),
        byMember,
        holders: byMember.length,
      };
    },

    /** Crews ranked by ground held, yours included wherever it lands. */
    landStandings(state) {
      const all = (state.crews || []).slice();
      const mine = this.mine(state);
      if (mine && !all.some((c) => c.id === mine.id)) all.push(mine);
      return all
        .map((crew) => ({
          id: crew.id, name: crew.name, color: crew.color,
          me: !!mine && crew.id === mine.id,
          area: this.territory(state, crew).area,
        }))
        .sort((a, b) => b.area - a.area);
    },

    /* --- Membership ------------------------------------------------------- */

    /** Your own member record, with a pace taken from what you actually run. */
    meAsMember(state, role) {
      const paced = state.activities.filter((a) => a.distance > 800);
      const perMetre = paced.length
        ? paced.reduce((sum, a) => sum + a.duration / a.distance, 0) / paced.length
        : 0;
      return {
        id: 'me',
        name: state.profile.name,
        initials: state.profile.initials,
        color: '#f1ead9',
        role: role || 'member',
        joinedAt: Date.now(),
        weekly: M.Stats.weekly(state).distance,
        pace: perMetre ? Math.round(perMetre * 1000) : null,
      };
    },

    create(state, form) {
      const name = (form.name || '').trim().slice(0, 28);
      if (!name) return { error: 'A crew needs a name.' };
      if (this.mine(state)) return { error: 'Leave your current crew first.' };

      const me = this.meAsMember(state, 'leader');

      const crew = {
        id: uid(),
        name,
        tagline: (form.tagline || '').trim().slice(0, 60) || 'Newly founded.',
        photo: null,
        color: CREW_COLORS[Math.floor(Math.random() * CREW_COLORS.length)],
        foundedAt: Date.now(),
        home: state.profile.home,
        distance: 0,
        leaderId: 'me',
        members: [me],
        memberIds: ['me'],
        // A brand new crew gets people knocking, which is what makes the
        // management screens worth having on day one.
        requests: [],
        schedule: {
          days: (form.days && form.days.length ? form.days : ['Sat']),
          time: form.time || '08:00',
          spot: (form.spot || '').trim() || 'To be decided',
        },
        openJoin: form.openJoin !== false,
        founded: true,
        xp: 0,
        missionsDone: 0,
        notices: [],
        mission: null,
      };

      const rand = M.rng(Date.now() % 100000);
      for (let i = 0; i < 3; i++) crew.requests.push(Object.assign(person(rand), { at: Date.now() - i * 36e5 }));

      state.crews.unshift(crew);
      return { crew };
    },

    join(state, crewId) {
      if (this.mine(state)) return { error: 'You are already in a crew.' };
      const crew = this.all(state).find((c) => c.id === crewId);
      if (!crew) return { error: 'That crew is gone.' };

      const me = this.meAsMember(state, 'member');

      if (!crew.openJoin) {
        crew.pendingMe = true;
        return { crew, pending: true };
      }
      crew.members.push(me);
      crew.memberIds.push('me');
      return { crew };
    },

    leave(state, crewId) {
      const crew = this.all(state).find((c) => c.id === crewId);
      if (!crew) return { error: 'That crew is gone.' };
      if (this.isLeader(crew) && crew.members.length > 1) {
        return { error: 'Hand the crew to someone else before you leave.' };
      }
      if (this.isLeader(crew)) {
        state.crews = state.crews.filter((c) => c.id !== crewId);
        return { disbanded: true };
      }
      crew.members = crew.members.filter((m) => m.id !== 'me');
      crew.memberIds = crew.memberIds.filter((id) => id !== 'me');
      crew.pendingMe = false;
      return { crew };
    },

    /* --- Leader tools ------------------------------------------------------
       Everything below refuses unless you actually lead the crew. --------- */

    approve(state, crewId, personId) {
      const crew = this._led(state, crewId);
      if (!crew) return { error: 'Only the captain can do that.' };
      const at = crew.requests.findIndex((r) => r.id === personId);
      if (at < 0) return { error: 'That request is gone.' };
      const joiner = crew.requests.splice(at, 1)[0];
      joiner.role = 'member';
      joiner.joinedAt = Date.now();
      crew.members.push(joiner);
      crew.memberIds.push(joiner.id);
      return { crew, joiner };
    },

    decline(state, crewId, personId) {
      const crew = this._led(state, crewId);
      if (!crew) return { error: 'Only the captain can do that.' };
      crew.requests = crew.requests.filter((r) => r.id !== personId);
      return { crew };
    },

    setRole(state, crewId, memberId, role) {
      const crew = this._led(state, crewId);
      if (!crew) return { error: 'Only the captain can do that.' };
      if (memberId === 'me') return { error: 'Hand the crew over instead.' };
      const member = crew.members.find((m) => m.id === memberId);
      if (!member || !ROLES[role]) return { error: 'Unknown member.' };
      member.role = role;
      return { crew, member };
    },

    remove(state, crewId, memberId) {
      const crew = this._led(state, crewId);
      if (!crew) return { error: 'Only the captain can do that.' };
      if (memberId === 'me') return { error: 'You cannot remove yourself.' };
      crew.members = crew.members.filter((m) => m.id !== memberId);
      crew.memberIds = crew.memberIds.filter((id) => id !== memberId);
      return { crew };
    },

    handOver(state, crewId, memberId) {
      const crew = this._led(state, crewId);
      if (!crew) return { error: 'Only the captain can do that.' };
      const member = crew.members.find((m) => m.id === memberId);
      if (!member) return { error: 'Unknown member.' };
      const me = crew.members.find((m) => m.id === 'me');
      member.role = 'leader';
      if (me) me.role = 'member';
      crew.leaderId = member.id;
      return { crew, member };
    },

    /** The captain's photo for the crew. Stored as a small data URL. */
    setPhoto(state, crewId, dataUrl) {
      const crew = this._led(state, crewId);
      if (!crew) return { error: 'Only the captain can change the photo.' };
      crew.photo = dataUrl || null;
      return { crew };
    },

    edit(state, crewId, patch) {
      const crew = this._led(state, crewId);
      if (!crew) return { error: 'Only the captain can do that.' };
      if (patch.name !== undefined) {
        const name = patch.name.trim().slice(0, 28);
        if (!name) return { error: 'A crew needs a name.' };
        crew.name = name;
      }
      if (patch.tagline !== undefined) crew.tagline = patch.tagline.trim().slice(0, 60);
      if (patch.schedule) {
        const next = Object.assign({}, crew.schedule, patch.schedule);
        if (patch.schedule.days) { next.days = patch.schedule.days; delete next.day; }
        crew.schedule = next;
      }
      if (patch.openJoin !== undefined) crew.openJoin = !!patch.openJoin;
      return { crew };
    },

    disband(state, crewId) {
      const crew = this._led(state, crewId);
      if (!crew) return { error: 'Only the captain can do that.' };
      state.crews = state.crews.filter((c) => c.id !== crewId);
      return { disbanded: true };
    },

    _led(state, crewId) {
      const crew = this.all(state).find((c) => c.id === crewId);
      return crew && this.isLeader(crew) ? crew : null;
    },
  };

  M.Crew = Crew;
})(window.MILES);
