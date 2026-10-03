'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, run, loop, offset, HOME } = require('./helpers');
const { Crew } = require('../src/shared');

const FORM = { name: 'Han River Pacers', tagline: 'Early loops, long talks.', days: ['Tue', 'Thu', 'Sat', 'Funday'], time: '06:30', spot: 'Yeouido gate 2', openJoin: true, home: HOME };
const at = (p) => `lat=${p.lat}&lng=${p.lng}`;

async function captain(s, form) {
  const r = await s.runner();
  await r.api.post('/v1/me/trial');
  const res = await r.api.post('/v1/crews', Object.assign({}, FORM, form || {}));
  assert.equal(res.status, 201, res.text);
  return { r, crew: res.body.crew };
}

test('crews', async (t) => {
  const s = await boot();
  t.after(() => s.close());

  await t.test('founding a crew is Pro; the founder is its captain', async () => {
    const r = await s.runner();
    const locked = await r.api.post('/v1/crews', FORM);
    assert.equal(locked.status, 402);
    assert.equal(locked.body.error.feature, 'crewCreate');
    await r.api.post('/v1/me/trial');
    const res = await r.api.post('/v1/crews', FORM);
    assert.equal(res.status, 201, res.text);
    const c = res.body.crew;
    assert.equal(c.name, 'Han River Pacers');
    assert.equal(c.leaderId, r.id);
    assert.deepEqual(c.memberIds, [r.id]);
    assert.equal(c.members[0].role, 'leader');
    assert.deepEqual(c.schedule, { days: ['Tue', 'Thu', 'Sat'], time: '06:30', spot: 'Yeouido gate 2' });
    assert.ok(Crew.COLORS.indexOf(c.color) >= 0);
    assert.equal(c.xp, 0);
    assert.deepEqual(c.requests, []);
    assert.equal((await r.api.post('/v1/crews', FORM)).status, 409, 'one crew at a time');
  });

  await t.test('what a crew may be called is checked', async () => {
    const r = await s.runner();
    await r.api.post('/v1/me/trial');
    for (const patch of [{ name: '' }, { name: 'x'.repeat(29) }, { name: 'Shit Kickers' }, { time: '25:00' }, { tagline: '씨발 러닝' }, { home: { lat: 200, lng: 0 } }]) {
      assert.equal((await r.api.post('/v1/crews', Object.assign({}, FORM, patch))).status, 422, JSON.stringify(patch));
    }
  });

  await t.test('crews near you, nearest first, with yours on its own', async () => {
    const base = offset(HOME, 30000, 30000);
    const near = await captain(s, { name: 'Near Crew', home: offset(base, 500, 0) });
    await captain(s, { name: 'Middle Crew', home: offset(base, 3000, 0) });
    await captain(s, { name: 'Far Away Crew', home: offset(base, 80000, 0) });
    const res = await near.r.api.get('/v1/crews?' + at(base));
    assert.equal(res.body.mine.name, 'Near Crew');
    const names = res.body.nearby.map((c) => c.name);
    assert.equal(names[0], 'Middle Crew');
    assert.equal(names.indexOf('Far Away Crew'), -1);
    assert.equal(names.indexOf('Near Crew'), -1, 'yours is not listed twice');
    assert.ok(Math.abs(res.body.nearby[0].distance - 3000) < 30, String(res.body.nearby[0].distance));
  });

  await t.test('an open crew lets you in; a closed one asks its captain', async () => {
    const open = await captain(s, { name: 'Open Door', openJoin: true });
    const closed = await captain(s, { name: 'Gatekeepers', openJoin: false });
    const a = await s.runner();
    const joined = await a.api.post(`/v1/crews/${open.crew.id}/join`);
    assert.equal(joined.status, 200, joined.text);
    assert.equal(joined.body.pending, false);
    assert.ok(joined.body.crew.memberIds.indexOf(a.id) >= 0);
    assert.equal((await a.api.post(`/v1/crews/${closed.crew.id}/join`)).status, 409, 'already in a crew');

    const b = await s.runner();
    const asked = await b.api.post(`/v1/crews/${closed.crew.id}/join`);
    assert.equal(asked.body.pending, true);
    assert.equal(asked.body.crew.pendingMe, true);
    assert.equal(asked.body.crew.memberIds.indexOf(b.id), -1);
    assert.deepEqual(asked.body.crew.requests, [], 'requests are the captain\'s to see');

    const desk = (await closed.r.api.get(`/v1/crews/${closed.crew.id}`)).body;
    assert.equal(desk.requests.length, 1);
    assert.equal(desk.requests[0].id, b.id);
    assert.equal(typeof desk.requests[0].weekly, 'number');

    assert.equal((await b.api.post(`/v1/crews/${closed.crew.id}/requests/${b.id}/approve`)).status, 403, 'only the captain approves');
    const ok = await closed.r.api.post(`/v1/crews/${closed.crew.id}/requests/${b.id}/approve`);
    assert.equal(ok.status, 200, ok.text);
    assert.ok(ok.body.crew.memberIds.indexOf(b.id) >= 0);
    assert.deepEqual(ok.body.crew.requests, []);
  });

  await t.test('a request is void once its runner joins somewhere else', async () => {
    const closed = await captain(s, { name: 'Slow Gate', openJoin: false });
    const open = await captain(s, { name: 'Quick Gate', openJoin: true });
    const r = await s.runner();
    await r.api.post(`/v1/crews/${closed.crew.id}/join`);
    await r.api.post(`/v1/crews/${open.crew.id}/join`);
    // Joining an open crew withdrew the other request.
    assert.equal((await closed.r.api.get(`/v1/crews/${closed.crew.id}`)).body.requests.length, 0);
    const declined = await closed.r.api.post(`/v1/crews/${closed.crew.id}/requests/${r.id}/approve`);
    assert.equal(declined.status, 404);
  });

  await t.test('captains hand over before they leave; the last runner out takes the crew', async () => {
    const { r: cap, crew } = await captain(s, { name: 'Changing Hands' });
    const m = await s.runner();
    await m.api.post(`/v1/crews/${crew.id}/join`);
    const stuck = await cap.api.post(`/v1/crews/${crew.id}/leave`);
    assert.equal(stuck.status, 409);
    assert.equal(stuck.body.error.code, 'hand_over_first');
    assert.equal((await cap.api.delete(`/v1/crews/${crew.id}`)).status, 409);

    const handed = await cap.api.post(`/v1/crews/${crew.id}/handover`, { userId: m.id });
    assert.equal(handed.status, 200, handed.text);
    assert.equal(handed.body.crew.leaderId, m.id);
    assert.equal(handed.body.crew.members.find((x) => x.id === cap.id).role, 'member');
    assert.equal((await cap.api.post(`/v1/crews/${crew.id}/handover`, { userId: cap.id })).status, 403, 'no longer captain');

    const left = await cap.api.post(`/v1/crews/${crew.id}/leave`);
    assert.equal(left.status, 200);
    assert.deepEqual(left.body.crew.memberIds, [m.id]);
    const gone = await m.api.post(`/v1/crews/${crew.id}/leave`);
    assert.deepEqual(gone.body, { disbanded: true });
    assert.equal((await m.api.get(`/v1/crews/${crew.id}`)).status, 404);
  });

  await t.test('pacers, removals and the edit form', async () => {
    const { r: cap, crew } = await captain(s, { name: 'Tidy Crew' });
    const m = await s.runner();
    await m.api.post(`/v1/crews/${crew.id}/join`);
    const pacer = await cap.api.patch(`/v1/crews/${crew.id}/members/${m.id}`, { role: 'pacer' });
    assert.equal(pacer.body.crew.members.find((x) => x.id === m.id).role, 'pacer');
    assert.equal((await cap.api.patch(`/v1/crews/${crew.id}/members/${m.id}`, { role: 'leader' })).status, 422);
    assert.equal((await m.api.patch(`/v1/crews/${crew.id}`, { name: 'Taken Over' })).status, 403);

    const photo = 'data:image/jpeg;base64,' + Buffer.from('not really a jpeg').toString('base64');
    const edited = await cap.api.patch(`/v1/crews/${crew.id}`, {
      name: 'Tidier Crew', tagline: 'Neat.', openJoin: false, photo, schedule: { days: ['Sun'], time: '07:15', spot: 'The bridge' },
    });
    assert.equal(edited.status, 200, edited.text);
    const e = edited.body.crew;
    assert.equal(e.name, 'Tidier Crew');
    assert.equal(e.openJoin, false);
    assert.equal(e.photo, photo);
    assert.deepEqual(e.schedule, { days: ['Sun'], time: '07:15', spot: 'The bridge' });
    assert.equal((await cap.api.patch(`/v1/crews/${crew.id}`, { photo: 'javascript:alert(1)' })).status, 422);
    assert.equal((await cap.api.patch(`/v1/crews/${crew.id}`, { name: 'Bitch Squad' })).status, 422);

    const removed = await cap.api.delete(`/v1/crews/${crew.id}/members/${m.id}`);
    assert.deepEqual(removed.body.crew.memberIds, [cap.id]);
  });

  await t.test('the notice board: the captain writes, everyone reads, twenty are kept', async () => {
    const { r: cap, crew } = await captain(s, { name: 'Board Crew' });
    const m = await s.runner();
    await m.api.post(`/v1/crews/${crew.id}/join`);
    assert.equal((await m.api.post(`/v1/crews/${crew.id}/notices`, { text: 'Hello' })).status, 403);
    assert.equal((await cap.api.post(`/v1/crews/${crew.id}/notices`, { text: '   ' })).status, 422);
    assert.equal((await cap.api.post(`/v1/crews/${crew.id}/notices`, { text: 'Fuck Mondays' })).status, 422);
    for (let i = 1; i <= 22; i++) {
      const posted = await cap.api.post(`/v1/crews/${crew.id}/notices`, { text: `Notice ${i}\nsecond line` });
      assert.equal(posted.status, 201, posted.text);
    }
    const seen = (await m.api.get(`/v1/crews/${crew.id}`)).body.notices;
    assert.equal(seen.length, 20);
    assert.equal(seen[0].text, 'Notice 22\nsecond line');
    assert.equal(seen[0].by, cap.user.name);
    const removed = await cap.api.delete(`/v1/crews/${crew.id}/notices/${seen[0].id}`);
    assert.equal(removed.body.crew.notices[0].text, 'Notice 21\nsecond line');
    // A member who blocked the captain no longer reads their notices.
    await m.api.post('/v1/blocks', { userId: cap.id });
    assert.equal((await m.api.get(`/v1/crews/${crew.id}`)).body.notices.length, 0);
  });

  await t.test('a captain who deletes their account leaves the crew to its longest-standing pacer', async () => {
    const { r: cap, crew } = await captain(s, { name: 'Succession' });
    const first = await s.runner();
    const second = await s.runner();
    await first.api.post(`/v1/crews/${crew.id}/join`);
    await second.api.post(`/v1/crews/${crew.id}/join`);
    await cap.api.patch(`/v1/crews/${crew.id}/members/${second.id}`, { role: 'pacer' });
    assert.equal((await cap.api.delete('/v1/me', { password: cap.password })).status, 204);
    const after = (await first.api.get(`/v1/crews/${crew.id}`)).body;
    assert.equal(after.leaderId, second.id);
    assert.deepEqual(after.memberIds.sort(), [first.id, second.id].sort());
  });
});

test('crew missions are measured from what the crew ran', async (t) => {
  const s = await boot();
  t.after(() => s.close());
  const week = Date.now() - 6 * 3600e3;          // the captain's week started six hours ago
  const long = (distance, startedAt) => run({ distance, startedAt, extra: { duration: distance / 4.5 } });

  await t.test('distance: every member\'s runs this week, paid out once', async () => {
    const { r: cap, crew } = await captain(s, { name: 'Distance Crew' });
    const m = await s.runner();
    await m.api.post(`/v1/crews/${crew.id}/join`);
    assert.equal((await m.api.put(`/v1/crews/${crew.id}/mission`, { key: 'distance', week })).status, 403);
    assert.equal((await cap.api.put(`/v1/crews/${crew.id}/mission`, { key: 'swim', week })).status, 422);
    const set = await cap.api.put(`/v1/crews/${crew.id}/mission`, { key: 'distance', week });
    assert.equal(set.status, 200, set.text);
    const mission = set.body.crew.mission;
    assert.equal(mission.type, 'distance');
    assert.equal(mission.heads, 2);
    assert.equal(mission.target, Math.round(Crew.MISSIONS.distance.perMember * 2));
    assert.equal(set.body.crew.missionHave, 0);

    // A run from before the week does not count.
    await cap.api.post('/v1/runs', { run: long(30000, week - 3 * 3600e3) });
    const first = await cap.api.post('/v1/runs', { run: long(30000, week + 600e3) });
    assert.equal(first.status, 201, first.text);
    assert.equal(first.body.crew.missionCleared, null);
    assert.equal((await m.api.get(`/v1/crews/${crew.id}`)).body.missionHave, 30000);

    const second = await m.api.post('/v1/runs', { run: long(30000, week + 1200e3) });
    assert.ok(second.body.crew.missionCleared, 'the run that crossed the line cleared the week');
    assert.equal(second.body.crew.missionCleared.xp, Crew.MISSIONS.distance.xp);
    const after = (await cap.api.get(`/v1/crews/${crew.id}`)).body;
    assert.equal(after.xp, Crew.MISSIONS.distance.xp);
    assert.equal(after.missionsDone, 1);
    assert.ok(after.mission.completedAt);

    // More running pays nothing more, and the week cannot be set again.
    await m.api.post('/v1/runs', { run: long(20000, week + 1800e3) });
    assert.equal((await cap.api.get(`/v1/crews/${crew.id}`)).body.xp, Crew.MISSIONS.distance.xp);
    const reset = await cap.api.put(`/v1/crews/${crew.id}/mission`, { key: 'claimed', week });
    assert.equal(reset.status, 409);
    assert.equal(reset.body.error.code, 'cleared');
  });

  await t.test('land taken counts ground taken from outside the crew, not from each other', async () => {
    const { r: cap, crew } = await captain(s, { name: 'Raiders' });
    const mate = await s.runner();
    const rival = await s.runner();
    await mate.api.post(`/v1/crews/${crew.id}/join`);
    const centre = offset(HOME, 20000, -20000);
    // Before the week: the rival and the crewmate each hold a plot.
    await rival.api.post('/v1/runs', { run: run({ kind: 'territory', route: loop(centre, 400), startedAt: week - 5 * 3600e3 }) });
    await mate.api.post('/v1/runs', { run: run({ kind: 'territory', route: loop(offset(centre, 1500, 0), 400), startedAt: week - 5 * 3600e3 }) });
    await cap.api.put(`/v1/crews/${crew.id}/mission`, { key: 'taken', week });

    // The captain cuts into both.
    await cap.api.post('/v1/runs', { run: run({ kind: 'territory', route: loop(offset(centre, 450, 0), 300), startedAt: week + 600e3 }) });
    await cap.api.post('/v1/runs', { run: run({ kind: 'territory', route: loop(offset(centre, 1950, 0), 300), startedAt: week + 900e3 }) });

    const takes = await s.db.many('select victim_user_id, area from takes where taker_user_id = $1', [cap.id]);
    const fromRival = takes.filter((x) => x.victim_user_id === rival.id).reduce((a, x) => a + x.area, 0);
    const fromMate = takes.filter((x) => x.victim_user_id === mate.id).reduce((a, x) => a + x.area, 0);
    assert.ok(fromRival > 1000 && fromMate > 1000, JSON.stringify(takes));
    const have = (await cap.api.get(`/v1/crews/${crew.id}`)).body.missionHave;
    assert.ok(Math.abs(have - fromRival) < 1e-6, `${have} should be ${fromRival}, not including ${fromMate}`);
  });

  await t.test('land claimed counts what the crew still holds of this week\'s claims', async () => {
    const { r: cap, crew } = await captain(s, { name: 'Claimers' });
    await cap.api.put(`/v1/crews/${crew.id}/mission`, { key: 'claimed', week });
    const centre = offset(HOME, -20000, -20000);
    const up = await cap.api.post('/v1/runs', { run: run({ kind: 'territory', route: loop(centre, 400), startedAt: week + 600e3 }) });
    const held = up.body.claim.area;
    assert.ok(Math.abs((await cap.api.get(`/v1/crews/${crew.id}`)).body.missionHave - held) < 1e-6);
    // Someone takes a bite: the crew's week shrinks with it.
    const rival = await s.runner();
    await rival.api.post('/v1/runs', { run: run({ kind: 'territory', route: loop(offset(centre, 400, 0), 300), startedAt: week + 1200e3 }) });
    assert.ok((await cap.api.get(`/v1/crews/${crew.id}`)).body.missionHave < held - 1000);
  });

  await t.test('a member\'s week and pace are measured, not modelled', async () => {
    const { r: cap, crew } = await captain(s, { name: 'Measured' });
    await cap.api.post('/v1/runs', { run: run({ distance: 5000, startedAt: week + 600e3, extra: { duration: 1500 } }) });
    await cap.api.post('/v1/runs', { run: run({ distance: 10000, startedAt: week - 864e5, extra: { duration: 3300 } }) });
    const me = (await cap.api.get(`/v1/crews/${crew.id}?week=${week}`)).body.members[0];
    assert.equal(me.weekly, 5000, 'only this week');
    assert.equal(me.pace, Math.round(((1500 / 5000) + (3300 / 10000)) / 2 * 1000), 'seconds per km over recent runs');
  });
});
