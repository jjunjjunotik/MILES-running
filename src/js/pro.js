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

  const TRIAL_DAYS = 14;
  const DAY = 864e5;

  const PLANS = {
    pro_monthly: { id: 'pro_monthly', tier: 'pro', name: 'Pro', price: 4900, period: 'month', label: '₩4,900 / mo' },
    pro_yearly:  { id: 'pro_yearly',  tier: 'pro', name: 'Pro', price: 39000, period: 'year', label: '₩39,000 / yr', note: 'Two months free, paid once' },
  };

  /* What the tier buys, in the order it is worth buying it for. */
  const BENEFITS = [
    { icon: '⏳', name: 'Time machine', note: 'Replay the map week by week and watch the borders move' },
    { icon: '⚔', name: 'Who took your land', note: 'Every claim measured back to the runner who made it' },
    { icon: '🎨', name: 'Name and colour your plots', note: 'Your ground, marked your way' },
  ];

  const Pro = {
    PLANS,
    BENEFITS,
    TRIAL_DAYS,

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
      if (p.trialEndsAt && Date.now() < p.trialEndsAt) {
        return { tier: 'pro', plan: null, trial: true, until: p.trialEndsAt };
      }
      if (p.plan && PLANS[p.plan]) {
        return { tier: 'pro', plan: PLANS[p.plan], trial: false, until: p.renewsAt || null };
      }
      return { tier: 'free', plan: null, trial: false, until: null };
    },

    active(state) { return this.verify(state).tier === 'pro'; },

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

    /** Total ground lost to other runners, all claims counted. */
    lostTotal(state) {
      return this.raiders(state).reduce((sum, r) => sum + r.area, 0);
    },
  };

  M.Pro = Pro;
})(window.MILES);
