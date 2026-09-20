/* ==========================================================================
   MILES · pro
   The paid tier: what it is, who has it, and the two things it actually does.

   ── On enforcement ───────────────────────────────────────────────────────
   This file does NOT enforce payment, and cannot. The app is a static front
   end whose state lives in localStorage, so `pro.plan = 'pro'` is one devtools
   edit away for anybody who wants it. What is built here is the *product
   surface*: the features, the boundary between free and paid, and the places
   the offer appears. Enforcement needs a server, and when that server exists
   `verify()` below is the only function that has to change — it asks the
   backend whether this account has paid, caches the answer with an expiry,
   and everything above it keeps working untouched.

   ── On what is paid ──────────────────────────────────────────────────────
   Nothing here affects fairness. Pro cannot claim more land, hold it longer,
   or level faster; territory is a contest and a contest you can buy is not
   one. Pro knows more about a map everybody plays on equally.
   ========================================================================== */

(function (M) {
  'use strict';

  const { Geo, Land } = M;

  /** Distance from a point to a line segment, in projected metres. */
  function segDistance(p, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = dx * dx + dy * dy;
    let t = len ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / len : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
  }

  const TRIAL_DAYS = 14;
  const DAY = 864e5;

  /* Two paid tiers. Supporter is the cosmetic half on its own, for people who
     want to back the app and mark their ground without the analysis. */
  const TIERS = { free: 0, supporter: 1, pro: 2 };

  const PLANS = {
    supporter_monthly: { id: 'supporter_monthly', tier: 'supporter', name: 'Supporter', price: 2900, period: 'month', label: '₩2,900 / mo' },
    supporter_yearly:  { id: 'supporter_yearly',  tier: 'supporter', name: 'Supporter', price: 24000, period: 'year', label: '₩24,000 / yr', note: 'Two months free, paid once' },
    pro_monthly:       { id: 'pro_monthly',       tier: 'pro',       name: 'Pro',       price: 4900, period: 'month', label: '₩4,900 / mo' },
    pro_yearly:        { id: 'pro_yearly',        tier: 'pro',       name: 'Pro',       price: 39000, period: 'year', label: '₩39,000 / yr', note: 'Two months free, paid once' },
  };

  /**
   * Every gate in the app names a capability here rather than testing a tier,
   * so moving a feature between tiers is one line in this table and nothing
   * else in the codebase moves.
   *
   * Note what is absent: nothing that claims ground, holds it, or earns XP.
   * A contest you can buy is not one, so the paid line is drawn at knowing and
   * at expression, never at outcome.
   */
  const FEATURES = {
    // Supporter — expression. Changes how your running looks, never how it scores.
    plotStyle:      'supporter',   // name and colour your own plots
    cardThemes:     'supporter',   // record card colourways
    // Pro — information and organising.
    timeMachine:    'pro',
    raiders:        'pro',
    scout:          'pro',         // where the unclaimed ground is
    bigRaces:       'pro',         // a wider field; everyone you invite runs free
    customDistance: 'pro',
    crewCreate:     'pro',         // founding a crew; joining one is always free
    crewTerritory:  'pro',         // the map read by crew rather than by runner
    mapStyles:      'pro',
  };

  /* Icons name a sprite in index.html rather than an emoji: emoji render as
     somebody else's artwork at somebody else's weight, which is exactly wrong
     next to a hand-drawn interface. Each one draws its own mechanism — the
     scout icon is the dashed ring the feature actually puts on the map. */
  const BENEFITS = {
    supporter: [
      { icon: 'i-tag', name: 'Name and colour your plots', note: 'Marked and named your way' },
      { icon: 'i-swatch', name: 'Record card themes', note: 'Four colourways for your card' },
    ],
    pro: [
      { icon: 'i-rewind', name: 'Time machine', note: 'Replay the map week by week' },
      { icon: 'i-bite', name: 'Who took your land', note: 'Measured back to whoever took it' },
      { icon: 'i-scout', name: 'Scout', note: 'The biggest open ground in view' },
      { icon: 'i-lanes', name: 'Races up to 16', note: 'Everyone you invite runs free' },
      { icon: 'i-found', name: 'Found a crew', note: 'Joining a crew is free, always' },
      { icon: 'i-blocks', name: 'Crew territory', note: 'Whose ground is whose, block by block' },
      { icon: 'i-layers', name: 'Every map style', note: 'Street and light, as well as dark' },
    ],
  };

  const Pro = {
    PLANS,
    BENEFITS,
    FEATURES,
    TIERS,
    TRIAL_DAYS,
    MAX_RIVALS_FREE: 4,
    MAX_RIVALS_PRO: 16,

    /* --- Entitlement -------------------------------------------------------- */

    /**
     * THE SEAM. Everything else in the app asks `Pro.active()`; only this
     * function knows where the answer comes from. Today: local state, which is
     * a promise the user can break. Tomorrow: a signed entitlement from the
     * server, cached here with an expiry. Nothing above this line changes.
     */
    verify(state) {
      const p = (state || M.State.data || {}).pro;
      if (!p) return { tier: 'free', plan: null, trial: false, until: null };
      // A trial is always of the top tier — there is no point trialling less.
      if (p.trialEndsAt && Date.now() < p.trialEndsAt) {
        return { tier: 'pro', plan: null, trial: true, until: p.trialEndsAt };
      }
      if (p.plan && PLANS[p.plan]) {
        return { tier: PLANS[p.plan].tier, plan: PLANS[p.plan], trial: false, until: p.renewsAt || null };
      }
      return { tier: 'free', plan: null, trial: false, until: null };
    },

    tier(state) { return this.verify(state).tier; },

    /** Whether this account may use a named capability. */
    can(feature, state) {
      const need = FEATURES[feature];
      if (!need) return true;                      // unlisted is free
      return TIERS[this.tier(state)] >= TIERS[need];
    },

    /** The tier a capability needs, for the offer to lead with the right one. */
    tierFor(feature) { return FEATURES[feature] || 'free'; },

    active(state) { return TIERS[this.tier(state)] >= TIERS.pro; },

    /** A race field is the host's to widen; guests never pay to line up. */
    maxRivals(state) {
      return this.can('bigRaces', state) ? this.MAX_RIVALS_PRO : this.MAX_RIVALS_FREE;
    },

    /** Whether the trial is still on the table — it is offered once. */
    trialAvailable(state) {
      const p = (state || M.State.data).pro;
      return !p || (!p.trialEndsAt && !p.plan);
    },

    startTrial(state) {
      const s = state || M.State.data;
      if (!this.trialAvailable(s)) return null;
      s.pro = Object.assign({}, s.pro, { trialEndsAt: Date.now() + TRIAL_DAYS * DAY, startedAt: Date.now() });
      return this.verify(s);
    },

    /**
     * Records a purchase. With a backend this is the callback after the
     * payment provider confirms, and the entitlement comes from the server
     * rather than being written here.
     */
    subscribe(state, planId) {
      const s = state || M.State.data;
      if (!PLANS[planId]) return null;
      const period = PLANS[planId].period === 'year' ? 365 : 30;
      s.pro = Object.assign({}, s.pro, {
        plan: planId, since: Date.now(), renewsAt: Date.now() + period * DAY,
      });
      return this.verify(s);
    },

    cancel(state) {
      const s = state || M.State.data;
      s.pro = Object.assign({}, s.pro, { plan: null, renewsAt: null, trialEndsAt: null });
      return this.verify(s);
    },

    /* --- Time machine ------------------------------------------------------
       The map as it stood at a moment in the past. Claims carry the time they
       were made, and exclusivity is decided by that order alone, so the past
       is not stored — it is recomputed by resolving only what had happened
       yet. Copies go in, so the live map is never touched. -------------------- */

    /** The first moment there was anything on the map. */
    firstClaimAt(state) {
      const all = (state.territories || []).concat(state.rivalLand || []);
      return all.reduce((min, c) => Math.min(min, c.claimedAt || Infinity), Infinity);
    },

    mapAt(state, when) {
      const claims = (state.territories || []).concat(state.rivalLand || [])
        .filter((c) => (c.claimedAt || 0) <= when)
        .map((c) => ({
          id: c.id, owner: c.owner, ownerName: c.ownerName, initials: c.initials,
          color: c.color, polygon: c.polygon, claimedAt: c.claimedAt,
        }));
      Land.resolve(claims, state.profile.home);
      return claims;
    },

    /** Area you held at a moment, for the figure beside the scrubber. */
    heldAt(state, when) {
      return this.mapAt(state, when)
        .filter((c) => c.owner === 'me' || !c.owner)
        .reduce((sum, c) => sum + (c.area || 0), 0);
    },

    /* --- Who took your land ------------------------------------------------- */

    /**
     * Every runner who has cut into your claims, with how much each of them
     * took. Attribution is exact: the same cuts that decide the live map are
     * replayed one at a time, so no square metre is counted twice.
     */
    raiders(state) {
      const later = (state.territories || []).concat(state.rivalLand || []);
      const byOwner = new Map();

      (state.territories || []).forEach((mine) => {
        Land.raiders(mine, later, state.profile.home).forEach((r) => {
          if (r.owner === 'me') return;                 // your own later loops
          const prev = byOwner.get(r.owner);
          if (prev) {
            prev.area += r.area;
            prev.at = Math.max(prev.at, r.at);
            prev.plots += 1;
          } else {
            byOwner.set(r.owner, { owner: r.owner, name: r.name, color: r.color, area: r.area, at: r.at, plots: 1 });
          }
        });
      });

      return [...byOwner.values()].sort((a, b) => b.area - a.area);
    },

    /* --- Scout --------------------------------------------------------------
       "Where should I run next" has an answer on a map of claims: the largest
       circle you can draw that touches nobody's land. ------------------------ */

    /**
     * The biggest open ground inside the given bounds, as a centre and a
     * radius in metres, or null if the view is full. Found by sampling: for a
     * grid of candidate centres, measure the distance to the nearest claimed
     * edge and keep the best, then refine around the winner. Sampling is
     * honest here in a way it would not be for area — a circle that clears
     * every sampled edge is checked against the claims themselves before it
     * is offered, so what comes back is always genuinely empty.
     */
    scout(state, bounds, claims) {
      const origin = state.profile.home;
      const all = (claims || (state.territories || []).concat(state.rivalLand || []))
        .map((c) => ((c.pieces && c.pieces.length ? c.pieces[0].ring : c.polygon) || []))
        .filter((ring) => ring.length >= 3)
        .map((ring) => ring.map((p) => Geo.project(p, origin)));
      if (!bounds) return null;

      const nw = Geo.project({ lat: bounds.north, lng: bounds.west }, origin);
      const se = Geo.project({ lat: bounds.south, lng: bounds.east }, origin);
      const x0 = Math.min(nw.x, se.x), x1 = Math.max(nw.x, se.x);
      const y0 = Math.min(nw.y, se.y), y1 = Math.max(nw.y, se.y);
      // Keep the circle fully inside the view, so it is somewhere you can see.
      const edge = (p) => Math.min(p.x - x0, x1 - p.x, p.y - y0, y1 - p.y);

      const clearance = (p) => {
        let best = edge(p);
        for (let i = 0; i < all.length && best > 0; i++) {
          const ring = all[i];
          if (M.Clip.pointInRing(p, ring)) return 0;         // standing on someone's land
          for (let j = 0; j < ring.length; j++) {
            const d = segDistance(p, ring[j], ring[(j + 1) % ring.length]);
            if (d < best) best = d;
          }
        }
        return best;
      };

      let best = null;
      const scan = (ax0, ay0, ax1, ay1, steps) => {
        for (let i = 0; i <= steps; i++) {
          for (let j = 0; j <= steps; j++) {
            const p = { x: ax0 + ((ax1 - ax0) * i) / steps, y: ay0 + ((ay1 - ay0) * j) / steps };
            const r = clearance(p);
            if (!best || r > best.r) best = { x: p.x, y: p.y, r };
          }
        }
      };

      scan(x0, y0, x1, y1, 16);
      if (!best) return null;
      // Refine around the winner, which is where the true maximum sits.
      const span = Math.max(x1 - x0, y1 - y0) / 16;
      scan(best.x - span, best.y - span, best.x + span, best.y + span, 8);

      // Below this it is a gap between plots, not somewhere to run a loop.
      if (!best || best.r < 120) return null;
      return { centre: Geo.unproject({ x: best.x, y: best.y }, origin), radius: best.r };
    },

    /** Total ground lost to other runners, all claims counted. */
    lostTotal(state) {
      return this.raiders(state).reduce((sum, r) => sum + r.area, 0);
    },
  };

  M.Pro = Pro;
})(window.MILES);
