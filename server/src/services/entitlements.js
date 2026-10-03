'use strict';

/* Who has paid for what. Every Pro gate on the server asks `tierFor` or
   `requireFeature`; the app asks the same question through /v1/me, whose
   `pro` block is shaped so its own Pro.verify() reads it unchanged. */

const { Pro } = require('../shared');
const { fail } = require('../http');

const TRIAL_DAYS = Pro.TRIAL_DAYS;
const ms = (d) => (d ? new Date(d).getTime() : null);

async function entitlementOf(q, userId) {
  return q.one('select * from entitlements where user_id = $1', [userId]);
}

/**
 * The tier a runner is on right now. A paid plan that has lapsed counts for
 * nothing; a trial is always of Pro, and never lowers a paid tier.
 */
function tierFor(user, ent, now) {
  const t = now || Date.now();
  let tier = 'free';
  let plan = null;
  let until = null;
  let trial = false;
  if (ent && (!ent.expires_at || ms(ent.expires_at) > t)) {
    tier = ent.tier;
    plan = Pro.PLANS[ent.plan] ? ent.plan : null;
    until = ms(ent.expires_at);
  }
  if (user.trial_ends_at && ms(user.trial_ends_at) > t && Pro.TIERS.pro > Pro.TIERS[tier]) {
    tier = 'pro';
    trial = true;
    until = ms(user.trial_ends_at);
  }
  return { tier, plan, trial, until };
}

/** The `pro` block of /v1/me. */
function proView(user, ent, now) {
  const v = tierFor(user, ent, now);
  const paid = !!v.plan && !v.trial;
  return {
    tier: v.tier,
    plan: paid ? v.plan : null,
    trial: v.trial,
    until: v.until,
    // What the app's Pro.verify() reads from its state.
    trialEndsAt: ms(user.trial_ends_at),
    renewsAt: paid ? v.until : null,
    willRenew: paid ? ent.will_renew : null,
    trialAvailable: !user.trial_ends_at && v.tier === 'free',
    trialDays: TRIAL_DAYS,
  };
}

async function tierOf(q, user) {
  return tierFor(user, await entitlementOf(q, user.id)).tier;
}

async function can(q, user, feature) {
  const need = Pro.FEATURES[feature];
  if (!need) return true;
  return Pro.TIERS[await tierOf(q, user)] >= Pro.TIERS[need];
}

async function requireFeature(q, user, feature, message) {
  if (!(await can(q, user, feature))) {
    throw fail.paymentRequired(message || 'That needs Pro.', feature);
  }
}

async function startTrial(q, user) {
  const ent = await entitlementOf(q, user.id);
  const view = proView(user, ent);
  if (!view.trialAvailable) throw fail.conflict('The free trial has already been used on this account.', 'trial_used');
  return q.one(
    `update users set trial_ends_at = now() + make_interval(days => $2), updated_at = now()
      where id = $1 returning *`, [user.id, TRIAL_DAYS]);
}

module.exports = { entitlementOf, tierFor, proView, tierOf, can, requireFeature, startTrial, TRIAL_DAYS };
