'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, run } = require('./helpers');

/** A live-channel client with a mailbox: `next(pred)` waits for a message. */
function connect(base, token) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(base.replace(/^http/, 'ws') + '/v1/live');
    const inbox = [];
    const waiting = [];
    let closeEvent = null;
    const closed = new Promise((done) => { ws.onclose = (e) => { closeEvent = e; done(e); }; });
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      const i = waiting.findIndex((w) => w.pred(msg));
      if (i >= 0) waiting.splice(i, 1)[0].resolve(msg);
      else inbox.push(msg);
    };
    ws.onerror = () => { if (ws.readyState !== WebSocket.OPEN) reject(new Error('could not connect')); };
    ws.onopen = () => {
      const c = {
        ws, closed,
        get closeEvent() { return closeEvent; },
        send: (m) => ws.send(JSON.stringify(m)),
        next(pred, timeout) {
          const p = typeof pred === 'string' ? (m) => m.type === pred : pred;
          const at = inbox.findIndex(p);
          if (at >= 0) return Promise.resolve(inbox.splice(at, 1)[0]);
          return new Promise((done, fail) => {
            const w = { pred: p, resolve: (m) => { clearTimeout(timer); done(m); } };
            const timer = setTimeout(() => { waiting.splice(waiting.indexOf(w), 1); fail(new Error('timed out waiting')); }, timeout || 2000);
            waiting.push(w);
          });
        },
        /** Nothing matching arrives within `ms`. */
        async quiet(pred, ms) {
          try { await this.next(pred, ms || 300); return false; } catch (err) { return true; }
        },
        close: () => ws.close(),
      };
      if (token) {
        c.send({ type: 'auth', token });
        c.next('ready').then(() => resolve(c), reject);
      } else resolve(c);
    };
  });
}

async function friends(s, a, b) {
  await a.api.post('/v1/friends', { code: b.user.friendCode });
}

test('races and the live channel', async (t) => {
  const s = await boot();
  t.after(() => s.close());

  await t.test('a race is with friends, four of them unless the host has Pro, at a standard distance unless Pro', async () => {
    const host = await s.runner();
    const pals = [];
    for (let i = 0; i < 5; i++) { const p = await s.runner(); await friends(s, host, p); pals.push(p); }
    const stranger = await s.runner();

    assert.equal((await host.api.post('/v1/races', { target: 5000, rivals: [] })).status, 422);
    const notFriend = await host.api.post('/v1/races', { target: 5000, rivals: [stranger.id] });
    assert.equal(notFriend.body.error.code, 'not_friends');
    const five = await host.api.post('/v1/races', { target: 5000, rivals: pals.map((p) => p.id) });
    assert.equal(five.status, 402);
    assert.equal(five.body.error.feature, 'bigRaces');
    const odd = await host.api.post('/v1/races', { target: 4200, rivals: [pals[0].id] });
    assert.equal(odd.body.error.feature, 'customDistance');

    const ok = await host.api.post('/v1/races', { target: 5000, rivals: pals.slice(0, 4).map((p) => p.id) });
    assert.equal(ok.status, 201, ok.text);
    assert.equal(ok.body.race.target, 5000);
    assert.equal(ok.body.race.host.id, host.id);
    assert.equal(ok.body.race.entrants.length, 4);

    await host.api.post('/v1/me/trial');
    assert.equal((await host.api.post('/v1/races', { target: 4200, rivals: pals.map((p) => p.id) })).status, 201);
  });

  await t.test('the socket wants a token first, and a real one', async () => {
    const anon = await connect(s.url);
    anon.send({ type: 'join', race: 'x' });
    const e = await anon.closed;
    assert.equal(e.code, 4001);
    const fake = await connect(s.url);
    fake.send({ type: 'auth', token: 'nope' });
    assert.equal((await fake.next('error')).code, 'unauthorized');
    assert.equal((await fake.closed).code, 4001);
  });

  await t.test('an invite arrives the moment the race exists, and stays listed until they have run it', async () => {
    const host = await s.runner({ name: 'Host Runner' });
    const guest = await s.runner();
    await friends(s, host, guest);
    const live = await connect(s.url, guest.token);
    assert.equal((await host.api.get('/v1/friends')).body.friends[0].online, true, 'shown as online while connected');

    const made = await host.api.post('/v1/races', { target: 3000, rivals: [guest.id] });
    const invite = await live.next('invite');
    assert.equal(invite.race.id, made.body.race.id);
    assert.equal(invite.race.host.name, 'Host Runner');
    assert.deepEqual((await guest.api.get('/v1/races/invites')).body.races.map((r) => r.id), [made.body.race.id]);

    const result = await guest.api.post('/v1/runs', { run: run({ kind: 'race', extra: { raceId: made.body.race.id, placing: 1, fieldSize: 2 } }) });
    assert.equal(result.body.run.raceId, made.body.race.id);
    assert.deepEqual((await guest.api.get('/v1/races/invites')).body.races, []);
    live.close();
    await live.closed;
    await new Promise((r) => setTimeout(r, 50));
    assert.equal((await host.api.get('/v1/friends')).body.friends[0].online, false);
  });

  await t.test('telemetry goes to the others in the race, under the sender\'s real name, and nowhere else', async () => {
    const a = await s.runner({ name: 'Alex Ryu' });
    const b = await s.runner({ name: 'Mina Park' });
    const c = await s.runner();
    await friends(s, a, b);
    await friends(s, a, c);
    const race = (await a.api.post('/v1/races', { target: 1000, rivals: [b.id] })).body.race;
    const la = await connect(s.url, a.token);
    const lb = await connect(s.url, b.token);
    const lc = await connect(s.url, c.token);
    la.send({ type: 'join', race: race.id });
    lb.send({ type: 'join', race: race.id });
    lc.send({ type: 'join', race: race.id });
    await la.next('joined');
    await lb.next('joined');
    assert.equal((await lc.next('error')).code, 'not_in_race');

    lb.send({ type: 'hello', race: race.id });
    const hello = await la.next('hello');
    assert.equal(hello.from, b.id);

    la.send({ type: 'telemetry', race: race.id, telemetry: { name: 'Somebody Else', distance: 412.5, duration: 120, currentPace: 290, position: { lat: 37.5, lng: 127 }, evil: '<script>' } });
    const got = await lb.next('telemetry');
    assert.equal(got.from, a.id);
    assert.equal(got.telemetry.name, 'Alex Ryu', 'the name is the account\'s, not whatever was sent');
    assert.equal(got.telemetry.standsFor, a.id, 'which is what replaces their pace bot');
    assert.equal(got.telemetry.distance, 412.5);
    assert.deepEqual(got.telemetry.position, { lat: 37.5, lng: 127 });
    assert.equal('evil' in got.telemetry, false);
    assert.ok(await la.quiet('telemetry'), 'not echoed back to the sender');
    assert.ok(await lc.quiet('telemetry'), 'nor to anyone outside the race');

    lb.close();
    const left = await la.next('left');
    assert.equal(left.from, b.id);
    la.close();
    lc.close();
  });

  await t.test('a run that names a race it was not in is kept, without the race', async () => {
    const a = await s.runner();
    const b = await s.runner();
    const outsider = await s.runner();
    await friends(s, a, b);
    const race = (await a.api.post('/v1/races', { target: 1000, rivals: [b.id] })).body.race;
    const res = await outsider.api.post('/v1/runs', { run: run({ kind: 'race', extra: { raceId: race.id } }) });
    assert.equal(res.status, 201);
    assert.equal(res.body.run.raceId, null);
  });
});
