'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, run } = require('./helpers');

test('the public pages', async (t) => {
  const s = await boot();
  t.after(() => s.close());

  await t.test('privacy, terms and support are served, filled in from the configuration', async () => {
    for (const path of ['/', '/privacy', '/terms', '/support', '/delete-account']) {
      const res = await fetch(s.url + path);
      assert.equal(res.status, 200, path);
      assert.match(res.headers.get('content-type'), /text\/html/);
      assert.match(res.headers.get('content-security-policy'), /default-src 'none'/);
      const html = await res.text();
      assert.doesNotMatch(html, /<script/i, path + ' runs no scripts');
      assert.doesNotMatch(html, /undefined|\$\{/, path + ' has nothing left unfilled');
    }
    const privacy = await (await fetch(s.url + '/privacy')).text();
    assert.match(privacy, /MILES Test Co\./);
    assert.match(privacy, /help@miles\.test/);
    assert.match(privacy, /200 metres/, 'it describes what the feed actually does');
    const terms = await (await fetch(s.url + '/terms')).text();
    assert.match(terms, /24 hours/, 'the moderation promise the App Store asks for');
    assert.match(terms, /objectionable content/);
  });

  await t.test('an account can be deleted from a browser', async () => {
    const r = await s.runner();
    await r.api.post('/v1/runs', { run: run() });
    const post = (fields) => fetch(s.url + '/delete-account', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(fields).toString(),
    });
    const unconfirmed = await post({ email: r.email, password: r.password });
    assert.equal(unconfirmed.status, 400);
    assert.match(await unconfirmed.text(), /Tick the box/);
    const wrong = await post({ email: r.email, password: 'nope', confirm: 'yes' });
    assert.equal(wrong.status, 401);
    assert.equal((await r.api.get('/v1/me')).status, 200, 'still there');
    const done = await post({ email: r.email.toUpperCase(), password: r.password, confirm: 'yes' });
    assert.equal(done.status, 200);
    assert.match(await done.text(), /Your account is deleted/);
    assert.equal((await r.api.get('/v1/me')).status, 401);
    assert.equal((await s.db.one('select count(*) as n from runs where user_id = $1', [r.id])).n, 0);
  });

  await t.test('the health check', async () => {
    const res = await s.anon.get('/healthz');
    assert.deepEqual(res.body, { ok: true });
  });
});
