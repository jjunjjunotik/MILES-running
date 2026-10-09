'use strict';

/* Payments arrive through RevenueCat, which sits between the app and both
   stores (Apple's in-app purchase and Google Play Billing). The app buys
   with RevenueCat's SDK after logging in with the runner's MILES id;
   RevenueCat then tells us here what that runner now has.

   Each event is stored once by its id, so a delivery RevenueCat retries is
   not applied twice. Product ids are the plan ids from pro.js
   ("pro_yearly"); Google's "pro_yearly:base-plan" form is understood too. */

const crypto = require('crypto');
const { HttpError, fail, reply } = require('../http');
const { meView } = require('../services/accounts');
const { Pro } = require('../shared');
const { isUuid } = require('../validate');
const { safeEqual } = require('../auth');

const GRANTS = ['INITIAL_PURCHASE', 'RENEWAL', 'PRODUCT_CHANGE', 'UNCANCELLATION', 'NON_RENEWING_PURCHASE',
  'SUBSCRIPTION_EXTENDED', 'TEMPORARY_ENTITLEMENT_GRANT'];

/** The plan an event is about, or null if it names nothing we sell. */
function planFor(event) {
  const base = String(event.product_id || '').split(':')[0];
  if (Pro.PLANS[base]) return Pro.PLANS[base];
  const ids = event.entitlement_ids || (event.entitlement_id ? [event.entitlement_id] : []);
  const tier = ids.indexOf('pro') >= 0 ? 'pro' : ids.indexOf('supporter') >= 0 ? 'supporter' : null;
  return tier ? Pro.PLANS[`${tier}_monthly`] : null;
}

const when = (msValue) => (Number.isFinite(Number(msValue)) && msValue ? new Date(Number(msValue)) : null);

async function apply(q, userId, event) {
  const type = event.type;
  if (GRANTS.indexOf(type) >= 0) {
    const plan = planFor(event);
    if (!plan) return 'unknown product';
    await q.query(
      `insert into entitlements (user_id, plan, tier, expires_at, will_renew, source, store, product_id, updated_at)
       values ($1, $2, $3, $4, true, 'revenuecat', $5, $6, now())
       on conflict (user_id) do update set plan = $2, tier = $3, expires_at = $4, will_renew = true,
         source = 'revenuecat', store = $5, product_id = $6, updated_at = now()`,
      [userId, plan.id, plan.tier, when(event.expiration_at_ms), event.store || null, event.product_id || null]);
    return 'granted';
  }
  if (type === 'CANCELLATION' || type === 'SUBSCRIPTION_PAUSED') {
    // Paid-up time is kept; it simply will not renew.
    await q.query('update entitlements set will_renew = false, updated_at = now() where user_id = $1', [userId]);
    return 'will not renew';
  }
  if (type === 'EXPIRATION') {
    await q.query(
      'update entitlements set expires_at = least(coalesce(expires_at, now()), coalesce($2, now())), will_renew = false, updated_at = now() where user_id = $1',
      [userId, when(event.expiration_at_ms)]);
    return 'expired';
  }
  return 'ignored';
}

/**
 * Sets a runner's entitlement from RevenueCat's own record of them (its
 * "subscriber"): the best tier with an entitlement still running, or none.
 * Plans granted by hand are never taken away here.
 */
async function applySubscriber(q, userId, subscriber) {
  const now = Date.now();
  let best = null;
  Object.entries((subscriber && subscriber.entitlements) || {}).forEach(([name, e]) => {
    const tier = name === 'pro' || name === 'supporter' ? name : null;
    const expires = e.expires_date ? Date.parse(e.expires_date) : null;
    if (!tier || (expires !== null && expires <= now)) return;
    if (!best || Pro.TIERS[tier] > Pro.TIERS[best.tier]) best = { tier, expires, product: e.product_identifier || '' };
  });
  if (!best) {
    await q.query(
      `update entitlements set expires_at = now(), will_renew = false, updated_at = now()
        where user_id = $1 and source = 'revenuecat' and (expires_at is null or expires_at > now())`, [userId]);
    return 'none';
  }
  const plan = planFor({ product_id: best.product, entitlement_ids: [best.tier] });
  // Google products can be named with or without their base plan
  // ("pro_yearly:yearly"), and not always the same way in both places.
  const subs = subscriber.subscriptions || {};
  const base = (id) => String(id).split(':')[0];
  const key = best.product in subs ? best.product : Object.keys(subs).find((k) => base(k) === base(best.product));
  const sub = (key && subs[key]) || {};
  const willRenew = !sub.unsubscribe_detected_at && !sub.billing_issues_detected_at;
  await q.query(
    `insert into entitlements (user_id, plan, tier, expires_at, will_renew, source, store, product_id, updated_at)
     values ($1, $2, $3, $4, $5, 'revenuecat', $6, $7, now())
     on conflict (user_id) do update set plan = $2, tier = $3, expires_at = $4, will_renew = $5,
       source = 'revenuecat', store = $6, product_id = $7, updated_at = now()
     where entitlements.source <> 'admin' or entitlements.expires_at < $4 or $4 is null`,
    [userId, plan.id, plan.tier, best.expires === null ? null : new Date(best.expires), willRenew, sub.store || null, best.product]);
  return 'granted';
}

module.exports = function billingRoutes(router, app) {
  const { config, limiter } = app;

  /* Right after a purchase the app asks here, and the server asks RevenueCat
     — the purchase counts at once rather than when the webhook lands, a few
     seconds later. Optional: it needs a V1 secret key, which RevenueCat's
     newer projects no longer make, and without one the webhook does it all. */
  router.post('/v1/billing/sync', async (ctx) => {
    const { db, user } = ctx;
    if (!config.revenuecatApiKey) throw fail.notFound('No such endpoint.');
    if (!limiter.take('billing-sync:' + user.id, 30, 60 * 60 * 1000)) throw fail.tooMany();
    const unreachable = () => new HttpError(502, 'store_unreachable', 'The store could not be reached. Your purchase is safe — try again in a moment.');
    let res;
    try {
      res = await fetch(`${config.revenuecatApiUrl}/v1/subscribers/${encodeURIComponent(user.id)}`, {
        headers: { authorization: `Bearer ${config.revenuecatApiKey}`, accept: 'application/json' },
      });
    } catch (err) {
      throw unreachable();
    }
    if (!res.ok) {
      app.log.error(res.status === 403
        ? '[billing] RevenueCat refused REVENUECAT_API_KEY: this needs a V1 secret key. With only V2 keys, leave it empty; the webhook does the work.'
        : `[billing] RevenueCat answered ${res.status} for ${user.id}`);
      throw unreachable();
    }
    const body = await res.json();
    await db.tx((q) => applySubscriber(q, user.id, body.subscriber));
    const fresh = await db.one('select * from users where id = $1', [user.id]);
    return meView(db, fresh);
  });

  router.post('/v1/billing/revenuecat', { auth: false, limit: 64 * 1024 }, async (ctx) => {
    if (!config.revenuecatSecret) throw fail.notFound('No such endpoint.');
    const header = String(ctx.req.headers.authorization || '');
    if (!safeEqual(header, config.revenuecatSecret) && !safeEqual(header, 'Bearer ' + config.revenuecatSecret)) {
      throw fail.unauthorized('Wrong webhook secret.');
    }
    const event = ctx.body && ctx.body.event;
    if (!event || typeof event !== 'object' || !event.type) throw fail.badRequest('No event in that delivery.');
    const id = String(event.id || crypto.createHash('sha256').update(JSON.stringify(event)).digest('hex'));

    const outcome = await ctx.db.tx(async (q) => {
      const fresh = await q.one(
        `insert into billing_events (id, user_id, type, payload) values ($1, $2, $3, $4)
         on conflict (id) do nothing returning id`,
        [id, isUuid(event.app_user_id) ? event.app_user_id : null, String(event.type), JSON.stringify(event)]);
      if (!fresh) return 'duplicate';

      if (event.type === 'TRANSFER') {
        // The purchase moved between accounts: whatever the old one had, the new one has.
        const from = (event.transferred_from || []).filter(isUuid);
        const to = (event.transferred_to || []).filter(isUuid);
        const source = from.length ? await q.one('select * from entitlements where user_id = any($1::uuid[]) order by expires_at desc nulls first limit 1', [from]) : null;
        if (source && to.length) {
          for (const userId of to) {
            if (!(await q.one('select 1 from users where id = $1', [userId]))) continue;
            await q.query(
              `insert into entitlements (user_id, plan, tier, expires_at, will_renew, source, store, product_id, updated_at)
               values ($1, $2, $3, $4, $5, 'revenuecat', $6, $7, now())
               on conflict (user_id) do update set plan = $2, tier = $3, expires_at = $4, will_renew = $5,
                 source = 'revenuecat', store = $6, product_id = $7, updated_at = now()`,
              [userId, source.plan, source.tier, source.expires_at, source.will_renew, source.store, source.product_id]);
          }
          await q.query('delete from entitlements where user_id = any($1::uuid[])', [from]);
        }
        return 'transferred';
      }

      const userId = event.app_user_id;
      if (!isUuid(userId) || !(await q.one('select 1 from users where id = $1', [userId]))) {
        // Kept, and acknowledged: retrying will not make the account exist.
        return 'no such runner';
      }
      return apply(q, userId, event);
    });
    return reply.json({ ok: true, outcome }, 200);
  });
};

module.exports.planFor = planFor;
module.exports.applySubscriber = applySubscriber;
