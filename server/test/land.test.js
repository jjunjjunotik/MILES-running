'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, run, loop, offset, HOME } = require('./helpers');
const { Geo, Land } = require('../src/shared');

const near = (a, b, tolerance, label) => assert.ok(Math.abs(a - b) <= tolerance, `${label || ''} ${a} vs ${b}`);
// Areas agree to within a few square metres per square kilometre: the server
// projects around the claims it is resolving, the test around their middle.
const close = (a, b, label) => near(a, b, Math.max(2, Math.abs(b) * 2e-4), label);
const BBOX = (c, m) => {
  const sw = offset(c, -m, -m);
  const ne = offset(c, m, m);
  return `${sw.lng},${sw.lat},${ne.lng},${ne.lat}`;
};

/** The areas the app itself would work out for these loops, in this order. */
function expected(loops) {
  const claims = loops.map((polygon, i) => ({ id: String(i), claimedAt: i + 1, polygon }));
  const all = [].concat(...loops);
  Land.resolve(claims, Geo.centroid(all));
  return claims.map((c) => c.area);
}

test('runs', async (t) => {
  const s = await boot();
  t.after(() => s.close());

  await t.test('a run is kept as the app sent it, and a retried upload is the same run', async () => {
    const r = await s.runner();
    const body = run({ kind: 'free' });
    const first = await r.api.post('/v1/runs', { run: body });
    assert.equal(first.status, 201, first.text);
    const kept = first.body.run;
    assert.equal(kept.id, body.id);
    assert.match(kept.serverId, /^[0-9a-f-]{36}$/);
    assert.equal(kept.kind, 'free');
    assert.equal(kept.startedAt, body.startedAt);
    near(kept.distance, body.distance, 1e-6);
    assert.equal(kept.route.length, body.route.length);
    assert.deepEqual(kept.splits, body.splits);
    assert.equal(first.body.claim, null);

    const again = await r.api.post('/v1/runs', { run: body });
    assert.equal(again.status, 200);
    assert.equal(again.body.run.serverId, kept.serverId);
    const list = await r.api.get('/v1/runs');
    assert.equal(list.body.runs.length, 1);
  });

  await t.test('runs that cannot be real are refused, each with its reason', async () => {
    const r = await s.runner();
    const cases = [
      [run({ startedAt: Date.now() + 3600e3 }), 'bad_time'],
      [run({ startedAt: Date.now() - 90 * 864e5 }), 'too_old'],
      [run({ extra: { distance: 10000, duration: 1000 } }), 'too_fast'],
      [run({ extra: { source: 'sim' } }), 'simulated'],
      [run({ kind: 'territory', extra: { territoryPolygon: loop(HOME, 300).slice(0, 12) } }), 'open_loop'],
      [run({ extra: { kind: 'swim' } }), 'invalid'],
      [run({ extra: { route: [{ lat: 95, lng: 0 }] } }), 'invalid'],
    ];
    for (const [body, code] of cases) {
      const res = await r.api.post('/v1/runs', { run: body });
      assert.equal(res.status, 422, `${code}: ${res.text}`);
      assert.equal(res.body.error.code, code);
    }
    assert.equal((await r.api.get('/v1/runs')).body.runs.length, 0);
  });

  await t.test('your runs come back newest first, a page at a time', async () => {
    const r = await s.runner();
    for (let i = 0; i < 5; i++) {
      await r.api.post('/v1/runs', { run: run({ startedAt: Date.now() - (i + 1) * 3600e3 }) });
    }
    const page1 = await r.api.get('/v1/runs?limit=2');
    assert.equal(page1.body.runs.length, 2);
    assert.ok(page1.body.runs[0].startedAt > page1.body.runs[1].startedAt);
    const page2 = await r.api.get(`/v1/runs?limit=2&before=${page1.body.next}`);
    const page3 = await r.api.get(`/v1/runs?limit=2&before=${page2.body.next}`);
    assert.equal(page3.body.runs.length, 1);
    assert.equal(page3.body.next, null);
    const ids = new Set([...page1.body.runs, ...page2.body.runs, ...page3.body.runs].map((x) => x.serverId));
    assert.equal(ids.size, 5);
  });

  await t.test('nobody else can delete your run', async () => {
    const a = await s.runner();
    const b = await s.runner();
    const up = await a.api.post('/v1/runs', { run: run() });
    assert.equal((await b.api.delete('/v1/runs/' + up.body.run.serverId)).status, 404);
    assert.equal((await a.api.delete('/v1/runs/' + up.body.run.serverId)).status, 204);
    assert.equal((await a.api.get('/v1/runs')).body.runs.length, 0);
  });
});

test('territory', async (t) => {
  const s = await boot();
  t.after(() => s.close());

  // Three neighbourhoods far enough apart not to touch each other.
  const SPOT1 = offset(HOME, 0, 0);
  const SPOT2 = offset(HOME, 5000, 0);
  const SPOT3 = offset(HOME, 0, 5000);

  await t.test('a closed loop claims what it encloses', async () => {
    const r = await s.runner();
    const polygon = loop(SPOT1, 300);
    const res = await r.api.post('/v1/runs', { run: run({ kind: 'territory', route: polygon }) });
    assert.equal(res.status, 201, res.text);
    const claim = res.body.claim;
    assert.ok(claim, 'a claim was made');
    close(claim.area, Geo.polygonArea(polygon), 'area');
    near(res.body.run.claimedArea, claim.area, 1e-6);
    assert.equal(claim.mine, true);
    assert.equal(claim.pieces.length, 1);
    assert.equal(claim.ownerName, r.user.name);
  });

  await t.test('a loop too small to matter is a run, not a claim', async () => {
    const r = await s.runner();
    const res = await r.api.post('/v1/runs', { run: run({ kind: 'territory', route: loop(SPOT1, 15), distance: 500 }) });
    assert.equal(res.status, 201);
    assert.equal(res.body.claim, null);
    assert.equal(res.body.run.claimedArea, 0);
  });

  await t.test('a later loop takes the ground it covers, exactly as the app works it out', async () => {
    const a = await s.runner({ name: 'Alex Ryu' });
    const b = await s.runner({ name: 'Mina Park' });
    const loopA = loop(SPOT2, 400);
    const loopB = loop(offset(SPOT2, 450, 0), 350);
    const [wantA, wantB] = expected([loopA, loopB]);

    const ra = await a.api.post('/v1/runs', { run: run({ kind: 'territory', route: loopA, startedAt: Date.now() - 3 * 3600e3 }) });
    const rb = await b.api.post('/v1/runs', { run: run({ kind: 'territory', route: loopB, startedAt: Date.now() - 2 * 3600e3 }) });
    assert.equal(rb.status, 201, rb.text);

    const view = await a.api.get('/v1/land?bbox=' + BBOX(SPOT2, 1500));
    assert.equal(view.status, 200, view.text);
    const mine = view.body.claims.find((c) => c.id === ra.body.claim.id);
    const theirs = view.body.claims.find((c) => c.id === rb.body.claim.id);
    close(mine.area, wantA, 'A keeps what B did not take');
    close(theirs.area, wantB, 'B holds the whole loop');
    assert.ok(mine.area < Geo.polygonArea(loopA) - 1000);
    assert.equal(theirs.ownerName, 'Mina Park');
    assert.equal(theirs.mine, false);

    // Who took it is Pro; how much is free.
    const free = await a.api.get('/v1/land/raiders');
    close(free.body.lost, Geo.polygonArea(loopA) - wantA, 'lost');
    assert.equal(free.body.raiders, null);
    await a.api.post('/v1/me/trial');
    const pro = await a.api.get('/v1/land/raiders');
    assert.equal(pro.body.raiders.length, 1);
    assert.equal(pro.body.raiders[0].name, 'Mina Park');
    assert.equal(pro.body.raiders[0].plots, 1);
    near(pro.body.raiders[0].area, pro.body.lost, 1e-6);

    const takes = await s.db.many('select * from takes where victim_user_id = $1', [a.id]);
    assert.equal(takes.length, 1);
    assert.equal(takes[0].taker_user_id, b.id);
    const plot = (await a.api.get('/v1/land/mine')).body.claims[0];
    close(plot.lost, Geo.polygonArea(loopA) - wantA, 'each of your plots says what it lost');
    assert.equal(theirs.lost, undefined, 'nobody else\'s plot carries that figure');
  });

  await t.test('a run uploaded late is placed at the time it was run, not the time it arrived', async () => {
    const a = await s.runner();
    const b = await s.runner();
    const c = await s.runner();
    const centre = offset(SPOT3, 0, 0);
    const loopA = loop(centre, 400);
    const loopB = loop(offset(centre, 350, 0), 350);
    const loopC = loop(offset(centre, 150, 250), 300);
    // A at 5h ago, B at 1h ago; C ran 3h ago but only uploads now.
    await a.api.post('/v1/runs', { run: run({ kind: 'territory', route: loopA, startedAt: Date.now() - 5 * 3600e3 }) });
    await b.api.post('/v1/runs', { run: run({ kind: 'territory', route: loopB, startedAt: Date.now() - 1 * 3600e3 }) });
    await c.api.post('/v1/runs', { run: run({ kind: 'territory', route: loopC, startedAt: Date.now() - 3 * 3600e3 }) });
    const [wantA, wantC, wantB] = expected([loopA, loopC, loopB]);

    const view = (await a.api.get('/v1/land?bbox=' + BBOX(centre, 1500))).body.claims;
    const area = (who) => view.filter((x) => x.owner === who.id).reduce((sum, x) => sum + x.area, 0);
    close(area(a), wantA, 'A');
    close(area(c), wantC, 'C is cut by B, who came after');
    close(area(b), wantB, 'B');
  });

  await t.test('two loops closing at the same moment still leave no ground counted twice', async () => {
    const a = await s.runner();
    const b = await s.runner();
    const centre = offset(HOME, -6000, 0);
    const loopA = loop(centre, 350);
    const loopB = loop(offset(centre, 300, 0), 350);
    const now = Date.now();
    const [ra, rb] = await Promise.all([
      a.api.post('/v1/runs', { run: run({ kind: 'territory', route: loopA, startedAt: now - 2 * 3600e3 }) }),
      b.api.post('/v1/runs', { run: run({ kind: 'territory', route: loopB, startedAt: now - 2 * 3600e3 }) }),
    ]);
    assert.equal(ra.status, 201);
    assert.equal(rb.status, 201);
    const claims = (await a.api.get('/v1/land?bbox=' + BBOX(centre, 1500))).body.claims;
    const total = claims.reduce((sum, c) => sum + c.area, 0);
    const union = expected([loopA, loopB]).reduce((x, y) => x + y, 0);
    close(total, union, 'held land adds up to the union of the two loops');
    const times = await s.db.many('select claimed_at from claims where user_id = any($1)', [[a.id, b.id]]);
    assert.notEqual(new Date(times[0].claimed_at).getTime(), new Date(times[1].claimed_at).getTime(), 'no two claims share a moment');
  });

  await t.test('ground taken in full leaves the live map, and only Pro can replay it', async () => {
    const a = await s.runner();
    const b = await s.runner();
    const centre = offset(HOME, -12000, 0);
    const small = await a.api.post('/v1/runs', { run: run({ kind: 'territory', route: loop(centre, 150), startedAt: Date.now() - 4 * 3600e3 }) });
    await b.api.post('/v1/runs', { run: run({ kind: 'territory', route: loop(centre, 400), startedAt: Date.now() - 3600e3 }) });
    const live = (await a.api.get('/v1/land?bbox=' + BBOX(centre, 1000))).body.claims;
    assert.equal(live.some((c) => c.id === small.body.claim.id), false);
    const locked = await a.api.get('/v1/land?history=1&bbox=' + BBOX(centre, 1000));
    assert.equal(locked.status, 402);
    assert.equal(locked.body.error.code, 'pro_required');
    assert.equal(locked.body.error.feature, 'timeMachine');
    await a.api.post('/v1/me/trial');
    const past = (await a.api.get('/v1/land?history=1&bbox=' + BBOX(centre, 1000))).body.claims;
    const gone = past.find((c) => c.id === small.body.claim.id);
    assert.ok(gone, 'the time machine still has it');
    assert.equal(gone.area, 0);
    assert.deepEqual(gone.pieces, []);
    // Your own list keeps it too.
    assert.ok((await a.api.get('/v1/land/mine')).body.claims.some((c) => c.id === small.body.claim.id));
  });

  await t.test('deleting the run that took land gives it back', async () => {
    const a = await s.runner();
    const b = await s.runner();
    const centre = offset(HOME, 0, -6000);
    const loopA = loop(centre, 400);
    const ra = await a.api.post('/v1/runs', { run: run({ kind: 'territory', route: loopA, startedAt: Date.now() - 4 * 3600e3 }) });
    const rb = await b.api.post('/v1/runs', { run: run({ kind: 'territory', route: loop(offset(centre, 300, 0), 300), startedAt: Date.now() - 3600e3 }) });
    const before = (await a.api.get('/v1/land/mine')).body.claims[0].area;
    assert.ok(before < Geo.polygonArea(loopA) - 1000);
    assert.equal((await b.api.delete('/v1/runs/' + rb.body.run.serverId)).status, 204);
    const after = (await a.api.get('/v1/land/mine')).body.claims[0];
    close(after.area, Geo.polygonArea(loopA), 'whole again');
    assert.equal(after.id, ra.body.claim.id);
    assert.equal((await a.api.get('/v1/land/raiders')).body.lost, 0);
  });

  await t.test('deleting an account gives back everything it had taken', async () => {
    const a = await s.runner();
    const b = await s.runner();
    const centre = offset(HOME, 0, -12000);
    const loopA = loop(centre, 400);
    await a.api.post('/v1/runs', { run: run({ kind: 'territory', route: loopA, startedAt: Date.now() - 4 * 3600e3 }) });
    await b.api.post('/v1/runs', { run: run({ kind: 'territory', route: loop(offset(centre, 300, 0), 300), startedAt: Date.now() - 3600e3 }) });
    assert.equal((await b.api.delete('/v1/me', { password: b.password })).status, 204);
    close((await a.api.get('/v1/land/mine')).body.claims[0].area, Geo.polygonArea(loopA));
  });

  await t.test('a runner you blocked is on the map without their name', async () => {
    const a = await s.runner();
    const b = await s.runner({ name: 'Theo Kim' });
    const centre = offset(HOME, 12000, 0);
    await b.api.post('/v1/runs', { run: run({ kind: 'territory', route: loop(centre, 300) }) });
    await s.db.query('insert into blocks (user_id, blocked_id) values ($1, $2)', [a.id, b.id]);
    const seen = (await a.api.get('/v1/land?bbox=' + BBOX(centre, 1000))).body.claims[0];
    assert.equal(seen.ownerName, 'Hidden runner');
    assert.equal(seen.initials, '··');
    const other = await s.runner();
    assert.equal((await other.api.get('/v1/land?bbox=' + BBOX(centre, 1000))).body.claims[0].ownerName, 'Theo Kim');
  });

  await t.test('the map refuses a view it cannot draw', async () => {
    const r = await s.runner();
    assert.equal((await r.api.get('/v1/land?bbox=1,2,3')).status, 422);
    assert.equal((await r.api.get('/v1/land?bbox=126,37,128,39')).body.error.code, 'too_wide');
    assert.equal((await r.api.get('/v1/land?bbox=127,38,126,37')).status, 422);
  });

  await t.test('naming a plot is Supporter, and the name is checked', async () => {
    const r = await s.runner();
    const up = await r.api.post('/v1/runs', { run: run({ kind: 'territory', route: loop(offset(HOME, 18000, 0), 300) }) });
    const id = up.body.claim.id;
    const locked = await r.api.patch('/v1/claims/' + id, { name: 'Riverside', color: '#26dafe' });
    assert.equal(locked.status, 402);
    await r.api.post('/v1/me/trial');
    const ok = await r.api.patch('/v1/claims/' + id, { name: 'Riverside', color: '#26DAFE' });
    assert.equal(ok.status, 200, ok.text);
    assert.equal(ok.body.claim.name, 'Riverside');
    assert.equal(ok.body.claim.color, '#26dafe');
    assert.equal((await r.api.patch('/v1/claims/' + id, { name: 'bitch hill' })).status, 422);
    assert.equal((await r.api.patch('/v1/claims/' + id, { color: 'red' })).status, 422);
    const other = await s.runner();
    await other.api.post('/v1/me/trial');
    assert.equal((await other.api.patch('/v1/claims/' + id, { name: 'Mine now' })).status, 404);
  });
});
