'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, run, loop, offset, HOME } = require('./helpers');
const { Geo } = require('../src/shared');

test('friends, the feed and kudos', async (t) => {
  const s = await boot();
  t.after(() => s.close());

  await t.test('a friend is added with their code, both ways at once', async () => {
    const a = await s.runner({ name: 'Alex Ryu' });
    const b = await s.runner({ name: 'Mina Park' });
    const res = await a.api.post('/v1/friends', { code: b.user.friendCode.toLowerCase().split('').join(' ') });
    assert.equal(res.status, 201, res.text);
    assert.equal(res.body.friend.id, b.id);
    const mine = (await a.api.get('/v1/friends')).body;
    const theirs = (await b.api.get('/v1/friends')).body;
    assert.equal(mine.code, a.user.friendCode);
    assert.deepEqual(mine.friends.map((f) => f.name), ['Mina Park']);
    assert.deepEqual(theirs.friends.map((f) => f.name), ['Alex Ryu']);
    assert.equal((await a.api.post('/v1/friends', { code: b.user.friendCode })).status, 201, 'adding twice is harmless');
    assert.equal((await a.api.get('/v1/friends')).body.friends.length, 1);
  });

  await t.test('a wrong code, your own code', async () => {
    const a = await s.runner();
    const wrong = await a.api.post('/v1/friends', { code: 'ZZZZZZ' });
    assert.equal(wrong.status, 404);
    assert.match(wrong.body.error.message, /No runner has that code/);
    assert.equal((await a.api.post('/v1/friends', { code: a.user.friendCode })).body.error.code, 'own_code');
  });

  await t.test('a friend\'s week and pace are their real ones', async () => {
    const a = await s.runner();
    const b = await s.runner();
    await a.api.post('/v1/friends', { code: b.user.friendCode });
    await b.api.post('/v1/runs', { run: run({ distance: 6000, extra: { duration: 1800 } }) });
    const f = (await a.api.get('/v1/friends')).body.friends[0];
    assert.equal(f.weekly, 6000);
    assert.equal(f.pace, 300);
    assert.equal(f.online, false);
  });

  await t.test('the feed is friends\' runs, with the ends of every route cut off', async () => {
    const a = await s.runner();
    const b = await s.runner({ name: 'Theo Kim' });
    const stranger = await s.runner();
    await a.api.post('/v1/friends', { code: b.user.friendCode });
    const route = loop(offset(HOME, 0, 0), 600, 120);
    await b.api.post('/v1/runs', { run: run({ route, distance: 2 * Math.PI * 600 }) });
    await stranger.api.post('/v1/runs', { run: run() });
    const items = (await a.api.get('/v1/feed')).body.items;
    assert.equal(items.length, 1);
    assert.equal(items[0].who.name, 'Theo Kim');
    const shown = items[0].activity.route;
    assert.ok(shown.length > 0 && shown.length < route.length);
    assert.ok(Geo.distance(shown[0], route[0]) > 150, 'the start is not shown');
    assert.ok(Geo.distance(shown[shown.length - 1], route[route.length - 1]) > 150, 'nor the finish');
    assert.equal(items[0].activity.results, undefined);
  });

  await t.test('kudos: for a friend\'s run, counted once, and seen on your own list', async () => {
    const a = await s.runner();
    const b = await s.runner();
    const c = await s.runner();
    await a.api.post('/v1/friends', { code: b.user.friendCode });
    const up = await b.api.post('/v1/runs', { run: run() });
    const id = up.body.run.serverId;
    assert.deepEqual((await a.api.post(`/v1/runs/${id}/kudos`)).body, { kudos: 1, kudosMine: true });
    assert.deepEqual((await a.api.post(`/v1/runs/${id}/kudos`)).body, { kudos: 1, kudosMine: true });
    assert.equal((await c.api.post(`/v1/runs/${id}/kudos`)).status, 404, 'not a friend');
    assert.equal((await b.api.get('/v1/runs')).body.runs[0].kudos, 1);
    const feed = (await a.api.get('/v1/feed')).body.items[0];
    assert.equal(feed.kudos, 1);
    assert.equal(feed.kudosMine, true);
    assert.deepEqual((await a.api.delete(`/v1/runs/${id}/kudos`)).body, { kudos: 0, kudosMine: false });
  });

  await t.test('removing a friend removes them both ways', async () => {
    const a = await s.runner();
    const b = await s.runner();
    await a.api.post('/v1/friends', { code: b.user.friendCode });
    assert.equal((await b.api.delete('/v1/friends/' + a.id)).status, 204);
    assert.equal((await a.api.get('/v1/friends')).body.friends.length, 0);
  });
});

test('blocking and reporting', async (t) => {
  const s = await boot();
  t.after(() => s.close());

  await t.test('a block ends the friendship, hides their runs, and their code stops working', async () => {
    const a = await s.runner();
    const b = await s.runner();
    await a.api.post('/v1/friends', { code: b.user.friendCode });
    await b.api.post('/v1/runs', { run: run() });
    assert.equal((await a.api.post('/v1/blocks', { userId: b.id })).status, 201);
    assert.equal((await a.api.get('/v1/friends')).body.friends.length, 0);
    assert.equal((await a.api.get('/v1/feed')).body.items.length, 0);
    assert.equal((await a.api.post('/v1/friends', { code: b.user.friendCode })).status, 404);
    assert.equal((await b.api.post('/v1/friends', { code: a.user.friendCode })).status, 404, 'nor yours for them');
    const list = (await a.api.get('/v1/blocks')).body.blocked;
    assert.deepEqual(list.map((x) => x.id), [b.id]);
    assert.equal((await a.api.delete('/v1/blocks/' + b.id)).status, 204);
    assert.equal((await a.api.post('/v1/friends', { code: b.user.friendCode })).status, 201);
  });

  await t.test('a report is filed, mailed to the contact address, and refused for nonsense', async () => {
    const a = await s.runner();
    const b = await s.runner();
    const res = await a.api.post('/v1/reports', { type: 'user', id: b.id, reason: 'abuse', note: 'Rude name' });
    assert.equal(res.status, 201, res.text);
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.ok(s.mail.some((m) => m.to === 'help@miles.test' && /report/.test(m.subject)));
    assert.equal((await a.api.post('/v1/reports', { type: 'planet', id: b.id, reason: 'abuse' })).status, 422);
    assert.equal((await a.api.post('/v1/reports', { type: 'user', id: b.id, reason: 'vibes' })).status, 422);
    assert.equal((await a.api.post('/v1/reports', { type: 'user', id: a.id, reason: 'abuse' })).status, 422);
  });

  await t.test('the admin desk needs its token', async () => {
    assert.equal((await s.anon.get('/admin/reports')).status, 401);
    assert.equal((await s.client('wrong').get('/admin/reports')).status, 401);
    const a = await s.runner();
    assert.equal((await a.api.get('/admin/reports')).status, 401, 'a runner\'s token is not an admin token');
    assert.equal((await s.admin.get('/admin/reports')).status, 200);
  });

  await t.test('banning a runner signs them out, keeps them out, and takes their land off the map', async () => {
    const a = await s.runner();
    const bad = await s.runner({ name: 'Bad Actor' });
    const centre = offset(HOME, 9000, 9000);
    const loopA = loop(centre, 400);
    await a.api.post('/v1/runs', { run: run({ kind: 'territory', route: loopA, startedAt: Date.now() - 4 * 3600e3 }) });
    await bad.api.post('/v1/runs', { run: run({ kind: 'territory', route: loop(offset(centre, 300, 0), 300), startedAt: Date.now() - 3600e3 }) });
    await a.api.post('/v1/reports', { type: 'user', id: bad.id, reason: 'cheating' });
    await a.api.post('/v1/reports', { type: 'user', id: bad.id, reason: 'abuse' });

    const queue = (await s.admin.get('/admin/reports')).body.reports.filter((r) => r.target === bad.id);
    assert.equal(queue.length, 2);
    assert.deepEqual(queue[0].actions, ['dismiss', 'rename', 'ban']);
    assert.equal((await s.admin.post(`/admin/reports/${queue[0].id}/resolve`, { action: 'hide' })).status, 422);
    assert.equal((await s.admin.post(`/admin/reports/${queue[0].id}/resolve`, { action: 'ban' })).status, 200);

    assert.equal((await bad.api.get('/v1/me')).status, 401);
    const login = await s.anon.post('/v1/auth/login', { email: bad.email, password: bad.password });
    assert.equal(login.status, 403);
    assert.equal(login.body.error.code, 'banned');
    const mine = (await a.api.get('/v1/land/mine')).body.claims[0];
    assert.ok(Math.abs(mine.area - Geo.polygonArea(loopA)) < Geo.polygonArea(loopA) * 2e-4, 'A has all of it back');
    const open = (await s.admin.get('/admin/reports')).body.reports.filter((r) => r.target === bad.id);
    assert.equal(open.length, 0, 'both reports about them were settled by the one decision');

    assert.equal((await s.admin.post(`/admin/users/${bad.id}/unban`)).status, 200);
    assert.equal((await s.anon.post('/admin/users/' + bad.id + '/unban')).status, 401);
    assert.equal((await s.anon.post('/v1/auth/login', { email: bad.email, password: bad.password })).status, 200);
  });

  await t.test('a crew can be reset, a notice hidden', async () => {
    const cap = await s.runner();
    await cap.api.post('/v1/me/trial');
    const crew = (await cap.api.post('/v1/crews', { name: 'Edgy Crew', tagline: 'Fine', home: HOME })).body.crew;
    const posted = (await cap.api.post(`/v1/crews/${crew.id}/notices`, { text: 'Something awful but not on the list' })).body.crew;
    const reporter = await s.runner();
    const r1 = (await reporter.api.post('/v1/reports', { type: 'crew', id: crew.id, reason: 'hate' })).body.id;
    const r2 = (await reporter.api.post('/v1/reports', { type: 'notice', id: posted.notices[0].id, reason: 'hate' })).body.id;
    assert.equal((await s.admin.post(`/admin/reports/${r1}/resolve`, { action: 'reset' })).status, 200);
    assert.equal((await s.admin.post(`/admin/reports/${r2}/resolve`, { action: 'hide' })).status, 200);
    const after = (await cap.api.get(`/v1/crews/${crew.id}`)).body;
    assert.equal(after.name, 'Unnamed crew');
    assert.equal(after.notices.length, 0);
  });

  await t.test('a plan granted by hand, for the App Review account', async () => {
    const r = await s.runner();
    const res = await s.admin.post('/admin/entitlements', { email: r.email.toUpperCase(), plan: 'pro_yearly', days: 90 });
    assert.equal(res.status, 201, res.text);
    const pro = (await r.api.get('/v1/me')).body.pro;
    assert.equal(pro.tier, 'pro');
    assert.equal(pro.plan, 'pro_yearly');
    assert.equal(pro.trial, false);
    assert.equal(pro.trialAvailable, false);
    assert.ok(pro.renewsAt > Date.now() + 89 * 864e5);
    const stats = (await s.admin.get('/admin/stats')).body;
    assert.ok(stats.runners >= 1);
  });
});
