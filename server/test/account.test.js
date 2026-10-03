'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, client } = require('./helpers');

test('accounts', async (t) => {
  const s = await boot();
  t.after(() => s.close());

  await t.test('signing up returns a session and the account', async () => {
    const res = await s.anon.post('/v1/auth/signup', {
      email: '  Mina.Park@Example.test ', password: 'long enough', name: 'Mina Park',
      acceptTerms: true, ageConfirmed: true, prefs: { units: 'mi', nonsense: 'dropped' },
    });
    assert.equal(res.status, 201, res.text);
    assert.ok(res.body.token.length > 30);
    const u = res.body.user;
    assert.equal(u.email, 'Mina.Park@Example.test');
    assert.equal(u.name, 'Mina Park');
    assert.equal(u.initials, 'MP');
    assert.equal(u.handle, '@minapark');
    assert.match(u.friendCode, /^[A-HJ-NP-Z2-9]{6}$/);
    assert.deepEqual(u.prefs, { units: 'mi' });
    assert.equal(u.pro.tier, 'free');
    assert.equal(u.pro.trialAvailable, true);
    assert.equal('password_hash' in u, false);
  });

  await t.test('one account per email, whatever its case', async () => {
    const res = await s.anon.post('/v1/auth/signup', {
      email: 'mina.park@example.TEST', password: 'long enough', name: 'Mina Again', acceptTerms: true, ageConfirmed: true,
    });
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'email_taken');
  });

  await t.test('sign-up refuses what it should, and says why', async () => {
    const base = { email: 'new@example.test', password: 'long enough', name: 'New Runner', acceptTerms: true, ageConfirmed: true };
    const cases = [
      [{ acceptTerms: false }, 'terms_required'],
      [{ ageConfirmed: undefined }, 'age_required'],
      [{ password: 'short' }, 'invalid'],
      [{ email: 'not an email' }, 'invalid'],
      [{ name: '   ' }, 'invalid'],
      [{ name: 'x'.repeat(25) }, 'invalid'],
      [{ name: 'Fuuuck Runners' }, 'blocked_words'],
    ];
    for (const [patch, code] of cases) {
      const res = await s.anon.post('/v1/auth/signup', Object.assign({}, base, patch));
      assert.equal(res.status, 422, JSON.stringify(patch));
      assert.equal(res.body.error.code, code, JSON.stringify(patch));
      assert.ok(res.body.error.message.length > 5);
    }
  });

  await t.test('signing in, and the same answer for a wrong password or a wrong email', async () => {
    const ok = await s.anon.post('/v1/auth/login', { email: 'MINA.PARK@example.test', password: 'long enough' });
    assert.equal(ok.status, 200, ok.text);
    assert.equal(ok.body.user.name, 'Mina Park');
    const wrongPass = await s.anon.post('/v1/auth/login', { email: 'mina.park@example.test', password: 'not it at all' });
    const wrongMail = await s.anon.post('/v1/auth/login', { email: 'nobody@example.test', password: 'not it at all' });
    assert.equal(wrongPass.status, 401);
    assert.equal(wrongMail.status, 401);
    assert.deepEqual(wrongPass.body, wrongMail.body);
  });

  await t.test('a session reads the account; no session, a bad one or a signed-out one does not', async () => {
    const r = await s.runner();
    assert.equal((await r.api.get('/v1/me')).status, 200);
    assert.equal((await s.anon.get('/v1/me')).status, 401);
    assert.equal((await s.client('not-a-real-token').get('/v1/me')).status, 401);
    assert.equal((await r.api.post('/v1/auth/logout')).status, 204);
    const after = await r.api.get('/v1/me');
    assert.equal(after.status, 401);
    assert.match(after.body.error.message, /sign in/i);
  });

  await t.test('renaming updates the initials; settings keep only what the app uses', async () => {
    const r = await s.runner();
    const res = await r.api.patch('/v1/me', {
      name: 'Theo Kim',
      prefs: { units: 'mi', mapStyle: 'topo', cardDesign: { template: 'poster', extra: 1 }, questClaims: { 'first-steps': 1, 'BAD KEY': 1 }, password: 'x' },
    });
    assert.equal(res.status, 200, res.text);
    assert.equal(res.body.initials, 'TK');
    assert.deepEqual(res.body.prefs, { units: 'mi', mapStyle: 'topo', cardDesign: { template: 'poster' }, questClaims: { 'first-steps': 1 } });
    const merged = await r.api.patch('/v1/me', { prefs: { heroBg: 3 } });
    assert.equal(merged.body.prefs.units, 'mi', 'settings are merged, not replaced');
    assert.equal(merged.body.prefs.heroBg, 3);
    assert.equal((await r.api.patch('/v1/me', { name: 'shit runner' })).status, 422);
  });

  await t.test('a forgotten password: a code by email, wrong codes counted, every old session ended', async () => {
    const r = await s.runner();
    const other = await s.client().post('/v1/auth/login', { email: r.email, password: r.password });
    const second = s.client(other.body.token);

    const unknown = await s.anon.post('/v1/auth/password/forgot', { email: 'ghost@example.test' });
    assert.equal(unknown.status, 202);
    const asked = await s.anon.post('/v1/auth/password/forgot', { email: r.email.toUpperCase() });
    assert.equal(asked.status, 202);
    assert.deepEqual(unknown.body, asked.body, 'no way to tell whether the account exists');

    await new Promise((resolve) => setTimeout(resolve, 50));
    const letter = s.mail.find((m) => m.to === r.email);
    assert.ok(letter, 'an email went to the runner');
    assert.equal(s.mail.filter((m) => m.to === 'ghost@example.test').length, 0);
    const code = /(\d{6})/.exec(letter.text)[1];

    const wrong = await s.anon.post('/v1/auth/password/reset', { email: r.email, code: code === '000000' ? '111111' : '000000', password: 'brand new pass' });
    assert.equal(wrong.status, 422);
    assert.equal(wrong.body.error.code, 'bad_code');

    const reset = await s.anon.post('/v1/auth/password/reset', { email: r.email, code, password: 'brand new pass' });
    assert.equal(reset.status, 200, reset.text);
    assert.ok(reset.body.token);
    assert.equal((await r.api.get('/v1/me')).status, 401, 'the old session ended');
    assert.equal((await second.get('/v1/me')).status, 401, 'and so did the other phone');
    assert.equal((await s.client(reset.body.token).get('/v1/me')).status, 200);

    const reuse = await s.anon.post('/v1/auth/password/reset', { email: r.email, code, password: 'another new one' });
    assert.equal(reuse.status, 422, 'a code works once');
    assert.equal((await s.anon.post('/v1/auth/login', { email: r.email, password: 'brand new pass' })).status, 200);
  });

  await t.test('a reset code stops working after five wrong guesses', async () => {
    const r = await s.runner();
    await s.anon.post('/v1/auth/password/forgot', { email: r.email });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const code = /(\d{6})/.exec(s.mail.filter((m) => m.to === r.email).pop().text)[1];
    const bad = code === '123456' ? '654321' : '123456';
    for (let i = 0; i < 5; i++) {
      assert.equal((await s.anon.post('/v1/auth/password/reset', { email: r.email, code: bad, password: 'whatever pass' })).status, 422);
    }
    const late = await s.anon.post('/v1/auth/password/reset', { email: r.email, code, password: 'whatever pass' });
    assert.equal(late.status, 422, 'even the right code, once it has been guessed at five times');
  });

  await t.test('changing the password keeps this phone and signs the others out', async () => {
    const r = await s.runner();
    const other = await s.anon.post('/v1/auth/login', { email: r.email, password: r.password });
    const bad = await r.api.post('/v1/me/password', { current: 'wrong one', password: 'new password' });
    assert.equal(bad.status, 401);
    assert.equal((await r.api.post('/v1/me/password', { current: r.password, password: 'new password' })).status, 204);
    assert.equal((await r.api.get('/v1/me')).status, 200);
    assert.equal((await s.client(other.body.token).get('/v1/me')).status, 401);
  });

  await t.test('the Pro trial: once per account', async () => {
    const r = await s.runner();
    const res = await r.api.post('/v1/me/trial');
    assert.equal(res.status, 200, res.text);
    assert.equal(res.body.pro.tier, 'pro');
    assert.equal(res.body.pro.trial, true);
    assert.equal(res.body.pro.trialAvailable, false);
    const days = (res.body.pro.trialEndsAt - Date.now()) / 864e5;
    assert.ok(days > 13.9 && days <= 14, String(days));
    const again = await r.api.post('/v1/me/trial');
    assert.equal(again.status, 409);
    assert.equal(again.body.error.code, 'trial_used');
  });

  await t.test('the export holds the account and nothing secret', async () => {
    const r = await s.runner();
    const res = await r.api.get('/v1/me/export');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-disposition'), /attachment/);
    assert.equal(res.body.account.email, r.email);
    assert.ok(Array.isArray(res.body.runs));
    assert.equal(/password|token|hash/i.test(JSON.stringify(res.body)), false);
  });

  await t.test('deleting the account needs the password, and then it is gone', async () => {
    const r = await s.runner();
    assert.equal((await r.api.delete('/v1/me', { password: 'wrong' })).status, 401);
    assert.equal((await r.api.delete('/v1/me', { password: r.password })).status, 204);
    assert.equal((await r.api.get('/v1/me')).status, 401);
    assert.equal((await s.anon.post('/v1/auth/login', { email: r.email, password: r.password })).status, 401);
    const row = await s.db.one('select count(*) as n from users where email_norm = $1', [r.email.toLowerCase()]);
    assert.equal(row.n, 0);
    // The address can be used again.
    assert.equal((await s.anon.post('/v1/auth/signup', { email: r.email, password: 'another pass', name: 'Back Again', acceptTerms: true, ageConfirmed: true })).status, 201);
  });

  await t.test('the plumbing: CORS, unknown paths, wrong methods, bad and oversized bodies', async () => {
    const pre = await fetch(s.url + '/v1/me', { method: 'OPTIONS', headers: { origin: 'capacitor://localhost', 'access-control-request-method': 'GET' } });
    assert.equal(pre.status, 204);
    assert.equal(pre.headers.get('access-control-allow-origin'), '*');
    assert.match(pre.headers.get('access-control-allow-headers'), /authorization/);

    const missing = await s.anon.get('/v1/nothing-here');
    assert.equal(missing.status, 404);
    assert.equal(missing.body.error.code, 'not_found');
    const method = await s.anon.raw('PUT', '/v1/auth/login', {});
    assert.equal(method.status, 405);
    const badJson = await s.anon.post('/v1/auth/login', '{"email": ');
    assert.equal(badJson.status, 400);
    assert.equal(badJson.body.error.code, 'bad_json');
    const huge = await s.anon.post('/v1/auth/login', { email: 'a@b.c', password: 'x'.repeat(40 * 1024) });
    assert.equal(huge.status, 413);
  });
});

test('signing in is rate limited per email', async (t) => {
  const s = await boot({ RATE_LIMIT_SCALE: '1' });
  t.after(() => s.close());
  const r = await s.runner();
  const results = [];
  for (let i = 0; i < 11; i++) {
    results.push((await s.anon.post('/v1/auth/login', { email: r.email, password: 'wrong password' })).status);
  }
  assert.deepEqual(results.slice(0, 10), new Array(10).fill(401));
  assert.equal(results[10], 429);
  // The right password does not get through the lock either.
  assert.equal((await s.anon.post('/v1/auth/login', { email: r.email, password: r.password })).status, 429);
  assert.equal((await client(s.url).post('/v1/auth/login', { email: 'someone.else@example.test', password: 'x' })).status, 401,
    'another email is not locked out');
});
