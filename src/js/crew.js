/* ==========================================================================
   MILES · crews
   A crew is a running club with a home turf. You can start one, find the ones
   near you, and — if you lead one — decide who runs under its name.
   ========================================================================== */

(function (M) {
  'use strict';

  const { Geo, uid, clamp } = M;

  const ROLES = { leader: 'Captain', pacer: 'Pacer', member: 'Member' };

  const CREW_COLORS = ['#ff3d8b', '#2fe0ff', '#ffb020', '#2ee6a8', '#a855f7', '#ff8a4c'];

  const NEARBY_SEED = [
    { name: 'Dawn Patrol', tagline: 'Out the door before the city wakes', emoji: '🌅', day: 'Tue & Thu', time: '05:40', spot: 'Riverside gate' },
    { name: 'Hill Tax', tagline: 'We pay it every Wednesday', emoji: '⛰️', day: 'Wed', time: '19:00', spot: 'North ridge car park' },
    { name: 'Long Way Home', tagline: 'Easy miles, loud conversation', emoji: '🌙', day: 'Sun', time: '08:00', spot: 'Central fountain' },
    { name: 'Track Rats', tagline: 'Intervals until the lights go out', emoji: '⚡', day: 'Mon & Fri', time: '20:00', spot: 'Municipal track' },
    { name: 'Land Grab', tagline: 'Loops only. The map is the point.', emoji: '🏴', day: 'Sat', time: '07:30', spot: 'Old market square' },
  ];

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
          emoji: s.emoji,
          color: CREW_COLORS[i % CREW_COLORS.length],
          foundedAt: Date.now() - Math.floor(rand() * 900 + 90) * 864e5,
          home: base,
          distance: away,
          leaderId: members[0].id,
          members,
          memberIds: members.map((m) => m.id),
          requests: [],
          schedule: { day: s.day, time: s.time, spot: s.spot },
          openJoin: rand() > 0.4,        // some crews let you in, some review you
        };
      });
    },

    /* --- Membership ------------------------------------------------------- */

    create(state, form) {
      const name = (form.name || '').trim().slice(0, 28);
      if (!name) return { error: 'A crew needs a name.' };
      if (this.mine(state)) return { error: 'Leave your current crew first.' };

      const me = {
        id: 'me',
        name: state.profile.name,
        initials: state.profile.initials,
        color: '#c8ff2e',
        role: 'leader',
        joinedAt: Date.now(),
        weekly: M.Stats.weekly(state).distance,
      };

      const crew = {
        id: uid(),
        name,
        tagline: (form.tagline || '').trim().slice(0, 60) || 'Newly founded.',
        emoji: form.emoji || '🏃',
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
          day: form.day || 'Sat',
          time: form.time || '08:00',
          spot: (form.spot || '').trim() || 'To be decided',
        },
        openJoin: form.openJoin !== false,
        founded: true,
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

      const me = {
        id: 'me',
        name: state.profile.name,
        initials: state.profile.initials,
        color: '#c8ff2e',
        role: 'member',
        joinedAt: Date.now(),
        weekly: M.Stats.weekly(state).distance,
      };

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

    edit(state, crewId, patch) {
      const crew = this._led(state, crewId);
      if (!crew) return { error: 'Only the captain can do that.' };
      if (patch.name !== undefined) {
        const name = patch.name.trim().slice(0, 28);
        if (!name) return { error: 'A crew needs a name.' };
        crew.name = name;
      }
      if (patch.tagline !== undefined) crew.tagline = patch.tagline.trim().slice(0, 60);
      if (patch.schedule) crew.schedule = Object.assign({}, crew.schedule, patch.schedule);
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
