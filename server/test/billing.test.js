'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { boot, client } = require('./helpers');
const { planFor } = require('../src/routes/billing');

const DAY = 864e5;

function event(type, userId, extra) {
  return {
    api_version: '1.0',
    event: Object.assign({
      id: crypto.randomUUID(),
      type,
      app_user_id: userId,
      product_id: 'pro_yearly',
      entitlement_ids: ['pro'],
      store: 'APP_STORE',
      environment: 'SANDBOX',
      purchased_at_ms: Date.now(),
      expiration_at_ms: Date.now() + 365 * DAY,
    }, extra || {}),
  };
}

test('product ids map to the plans the app sells', () => {
  assert.equal(planFor({ product_id: 'pro_yearly' }).id, 'pro_yearly');
  assert.equal(planFor({ product_id: 'supporter_monthly:monthly-base' }).id, 'supporter_monthly');
  assert.equal(planFor({ product_id: 'com.miles.whatever', entitlement_ids: ['pro'] }).id, 'pro_monthly');
  assert.equal(planFor({ product_id: 'com.miles.whatever', entitlement_ids: ['supporter'] }).id, 'supporter_monthly');
  assert.equal(planFor({ product_id: 'nothing', entitlement_ids: [] }), null);
});

test('the RevenueCat webhook', async (t) => {
  const s = await boot();
  t.after(() => s.close());
  const hook = (body, secret) => client(s.url).post('/v1/billing/revenuecat', body, { authorization: secret === undefined ? 'test-rc-secret' : secret });
  const me = async (r) => (await r.api.get('/v1/me')).body.pro;

  await t.test('only RevenueCat may call it', async () => {
    const r = await s.runner();
    assert.equal((await hook(event('INITIAL_PURCHASE', r.id), '')).status, 401);
    assert.equal((await hook(event('INITIAL_PURCHASE', r.id), 'Bearer wrong')).status, 401);
    assert.equal((await me(r)).tier, 'free');
    assert.equal((await hook(event('INITIAL_PURCHASE', r.id), 'Bearer test-rc-secret')).status, 200, 'with or without "Bearer"');
  });

  await t.test('a purchase, a duplicate delivery, a cancellation, an expiry', async () => {
    const r = await s.runner();
    const expires = Date.now() + 30 * DAY;
    const purchase = event('INITIAL_PURCHASE', r.id, { product_id: 'pro_monthly', expiration_at_ms: expires });
    const res = await hook(purchase);
    assert.equal(res.body.outcome, 'granted');
    let pro = await me(r);
    assert.equal(pro.tier, 'pro');
    assert.equal(pro.plan, 'pro_monthly');
    assert.equal(pro.renewsAt, expires);
    assert.equal(pro.willRenew, true);
    assert.equal(pro.trialAvailable, false);

    assert.equal((await hook(purchase)).body.outcome, 'duplicate');

    await hook(event('CANCELLATION', r.id, { expiration_at_ms: expires }));
    pro = await me(r);
    assert.equal(pro.tier, 'pro', 'paid-up time is kept');
    assert.equal(pro.willRenew, false);

    await hook(event('EXPIRATION', r.id, { expiration_at_ms: Date.now() - 1000 }));
    pro = await me(r);
    assert.equal(pro.tier, 'free');
    assert.equal(pro.plan, null);
  });

  await t.test('a Google product id, and an upgrade', async () => {
    const r = await s.runner();
    await hook(event('INITIAL_PURCHASE', r.id, { product_id: 'supporter_monthly:base', entitlement_ids: ['supporter'], store: 'PLAY_STORE' }));
    assert.equal((await me(r)).tier, 'supporter');
    await hook(event('PRODUCT_CHANGE', r.id, { product_id: 'pro_yearly:base' }));
    const pro = await me(r);
    assert.equal(pro.tier, 'pro');
    assert.equal(pro.plan, 'pro_yearly');
    // Supporter cannot found a crew; Pro can.
    const crew = await r.api.post('/v1/crews', { name: 'Paid Crew', home: { lat: 37.5, lng: 127 } });
    assert.equal(crew.status, 201, crew.text);
  });

  await t.test('a purchase moved to another account', async () => {
    const a = await s.runner();
    const b = await s.runner();
    await hook(event('INITIAL_PURCHASE', a.id));
    const moved = await hook(event('TRANSFER', null, { transferred_from: [a.id], transferred_to: [b.id], app_user_id: undefined }));
    assert.equal(moved.body.outcome, 'transferred');
    assert.equal((await me(a)).tier, 'free');
    assert.equal((await me(b)).tier, 'pro');
  });

  await t.test('an event for nobody is kept and acknowledged', async () => {
    const res = await hook(event('INITIAL_PURCHASE', '$RCAnonymousID:abc'));
    assert.equal(res.status, 200);
    assert.equal(res.body.outcome, 'no such runner');
    const stored = await s.db.one('select count(*) as n from billing_events where type = $1', ['INITIAL_PURCHASE']);
    assert.ok(stored.n >= 1);
  });
});

test('without a webhook secret the endpoint does not exist', async (t) => {
  const s = await boot({ REVENUECAT_WEBHOOK_SECRET: '' });
  t.after(() => s.close());
  assert.equal((await client(s.url).post('/v1/billing/revenuecat', {}, { authorization: '' })).status, 404);
});
