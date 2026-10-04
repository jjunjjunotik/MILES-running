// The app with a server. Every other check runs the self-contained demo; this
// one starts the real API (server/) on a database of its own and drives the
// app against it the way a runner would: signing up, running, losing ground
// to another runner, a friend's feed, a crew, a race invite over the live
// socket, reporting and blocking, a dead connection, signing out and back in,
// an ended session, and deleting the account. Other runners are played from
// here, over the same API and socket a phone uses.
//   node test-online.js
// Needs Playwright (as the other checks do), the server's own dependencies
// (`cd server && npm install`), and a Postgres where the role may create
// databases: TEST_DATABASE_URL, default postgres://miles:miles@127.0.0.1:5432/postgres.
const { chromium } = require('playwright');
const path = require('path');
const crypto = require('crypto');
const { Client } = require('./server/node_modules/pg');
const { start } = require('./server/src/index.js');
const { load } = require('./server/src/config.js');
const { AUDIT } = require('./audit.js');

const ADMIN_URL = process.env.TEST_DATABASE_URL || 'postgres://miles:miles@127.0.0.1:5432/postgres';
const PASSWORD = 'long enough pass';

async function admin(sql) {
  const c = new Client({ connectionString: ADMIN_URL });
  await c.connect();
  try { await c.query(sql); } finally { await c.end(); }
}

/* --- Geometry, as core.js does it ---------------------------------------- */
const R = 6371000;
const offset = (p, east, north) => {
  const k = Math.cos(p.lat * Math.PI / 180);
  return { lat: p.lat + (north / R) * (180 / Math.PI), lng: p.lng + (east / (R * k)) * (180 / Math.PI) };
};
const loop = (c, radius) => {
  const ring = [];
  for (let i = 0; i < 24; i++) {
    const t = (i / 24) * Math.PI * 2;
    ring.push(offset(c, Math.cos(t) * radius, Math.sin(t) * radius));
  }
  ring.push(ring[0]);
  return ring;
};
const centroid = (ring) => ({
  lat: ring.reduce((a, p) => a + p.lat, 0) / ring.length,
  lng: ring.reduce((a, p) => a + p.lng, 0) / ring.length,
});

(async () => {
  const dbName = 'miles_online_' + crypto.randomBytes(4).toString('hex');
  await admin(`create database ${dbName}`);
  const dbUrl = new URL(ADMIN_URL);
  dbUrl.pathname = '/' + dbName;
  const quiet = { log() {}, warn() {}, error: (...a) => console.error(...a) };
  const server = await start({
    config: load({
      DATABASE_URL: dbUrl.toString(), SCRYPT_N: '1024', RATE_LIMIT_SCALE: '1000', LOG_REQUESTS: 'false',
      ALLOW_SIMULATED_RUNS: 'true', ADMIN_TOKEN: 'online-admin',
    }),
    port: 0, log: quiet, poolSize: 4, mailer: { async send() {} },
  });
  const API = server.url;
  const db = server.db;

  const call = async (method, p, body, token) => {
    const res = await fetch(API + p, {
      method,
      headers: Object.assign({ 'content-type': 'application/json' }, token ? { authorization: 'Bearer ' + token } : {}),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  const runner = async (name) => {
    const email = `${name.split(' ')[0].toLowerCase().replace(/[^a-z]/g, '') || 'r'}.${crypto.randomBytes(3).toString('hex')}@example.test`;
    const res = await call('POST', '/v1/auth/signup', { email, password: PASSWORD, name, acceptTerms: true, ageConfirmed: true });
    if (res.status !== 201) throw new Error('signup failed: ' + JSON.stringify(res.body));
    return { id: res.body.user.id, token: res.body.token, code: res.body.user.friendCode, name, email };
  };
  // A loop run just now: it ends after anything already on the map, so it
  // is the later claim and takes what it covers.
  const territoryRun = (route) => ({
    id: 'node-' + crypto.randomBytes(4).toString('hex'),
    startedAt: Date.now() - 5 * 60000,
    kind: 'territory', title: 'Morning Territory Loop',
    distance: 2400, duration: 400, elevation: 10, route, splits: [],
    loopClosed: true, territoryPolygon: route, source: 'gps',
  });

  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  const appUrl = 'file://' + path.resolve(__dirname, 'index.html') + '?api=' + encodeURIComponent(API) + '&sim=1';

  let bad = 0;
  const ok = (label, cond, extra) => {
    console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${!cond && extra !== undefined ? '  → ' + extra : ''}`);
    if (!cond) bad++;
  };
  const until = (fn, arg, timeout) => page.waitForFunction(fn, arg, { timeout: timeout || 8000 });
  const settle = () => until(() => !MILES.State.data.outbox.length && !MILES.Sync.flushing && !MILES.Sync.pulling);
  const lastToast = () => page.evaluate(() => { const t = [...document.querySelectorAll('#toasts .toast')].pop(); return t ? t.textContent : ''; });
  const askTitle = () => page.evaluate(() => (document.querySelector('#askSheet:not([hidden]) .ask-title') || {}).textContent || null);
  const clickAsk = (text) => page.evaluate((t) => {
    const b = [...document.querySelectorAll('#askSheet button')].find((x) => x.textContent.trim() === t);
    if (!b) throw new Error('no button ' + t);
    b.click();
  }, text);
  /** A run in the simulator: 40× for free and races, until the loop closes for territory. */
  async function simRun(kind, ms) {
    await page.evaluate((k) => { MILES.Tracker.demoSpeed = 40; MILES.UI.beginRun({ kind: k }); }, kind);
    if (kind === 'territory') await until(() => !MILES.Tracker.active, null, 60000);
    else { await page.waitForTimeout(ms || 1600); await page.evaluate(() => MILES.UI.finishRun()); }
  }

  try {
    // --- 1. A real account starts empty, behind the sign-in screen ----------
    await page.goto(appUrl);
    await page.waitForTimeout(600);
    const first = await page.evaluate(() => ({
      auth: !document.querySelector('#authScreen').hidden,
      connected: MILES.State.data.connected,
      made: MILES.State.data.activities.length + MILES.State.data.rivalLand.length + MILES.State.data.crews.length + MILES.State.data.friends.length,
    }));
    ok('with a server the app opens on the sign-in screen', first.auth && first.connected, JSON.stringify(first));
    ok('and nothing is made up: no seeded runs, rivals, crews or friends', first.made === 0, first.made);
    const audits = [];
    const audit = async (label, selector) => {
      const a = await page.evaluate(AUDIT(selector));
      audits.push(label);
      ok(`${label}: type, contrast and reach`, a.seen > 0 && !a.type.length && !a.contrast.length && !a.touch.length,
        JSON.stringify({ type: a.type, contrast: a.contrast, touch: a.touch, seen: a.seen }));
    };
    for (const mode of ['signin', 'reset1', 'reset2', 'signup']) {
      await page.evaluate((m) => MILES.Account.setMode(m, m === 'reset2' ? { note: 'If there is an account with that email, the code is on its way.' } : { error: 'That email and password do not match.' }), mode);
      await audit(`the sign-in screen (${mode})`, '#authScreen');
    }
    await page.evaluate(() => MILES.Account.setMode('signup'));

    // --- 2. Signing up ----------------------------------------------------------
    const myEmail = `mina.${crypto.randomBytes(3).toString('hex')}@example.test`;
    await page.fill('#authName', 'Mina Park');
    await page.fill('#authEmail', myEmail);
    await page.fill('#authPassword', PASSWORD);
    await page.click('#authSubmit');
    await page.waitForTimeout(150);
    const refused = await page.textContent('#authError');
    ok('sign-up asks for the age and the terms before it goes anywhere', /14 and over/.test(refused), refused);
    await page.check('#authAge');
    await page.check('#authTerms');
    await page.click('#authSubmit');
    await until(() => document.querySelector('#authScreen').hidden && MILES.State.data.account && MILES.State.data.account.friendCode);
    const me = await page.evaluate(() => ({ name: MILES.State.data.profile.name, code: MILES.State.data.account.friendCode, id: MILES.Api.user.id }));
    const row = await db.one('select name, friend_code from users where email_norm = $1', [myEmail]);
    ok('signed up: the account on the phone is the one on the server', row && row.name === 'Mina Park' && row.friend_code === me.code, JSON.stringify([me, row]));
    await page.evaluate(() => MILES.UI.go('profile'));
    await audit('the account card', '#dataCard');
    await page.evaluate(() => MILES.Account.changePassword());
    await audit('the change-password form', '#askSheet');
    await page.evaluate(() => MILES.UI.closeSheet('#askSheet'));
    await page.evaluate(() => MILES.Account.deleteAccount());
    await audit('the delete-account form', '#askSheet');
    await page.evaluate(() => MILES.UI.closeSheet('#askSheet'));
    await page.evaluate(() => MILES.UI.go('home'));

    // Settings and the runner name follow the account, not the phone.
    await page.click('#screen-home [data-unit="mi"]');
    await page.waitForTimeout(1700);                       // settings are sent a moment after the last change
    const prefs = (await db.one('select prefs from users where id = $1', [me.id])).prefs;
    ok('a setting changed on the phone is kept on the account', prefs.units === 'mi', JSON.stringify(prefs));
    await page.click('#screen-home [data-unit="km"]');
    await page.evaluate(() => MILES.UI.go('profile'));
    await page.click('#nameBtn');
    await page.fill('#askSheet input', 'Mina P');
    await clickAsk('Save');
    await until(() => MILES.Api.user && MILES.Api.user.name === 'Mina P');
    ok('a new runner name is the account\'s name', (await db.one('select name from users where id = $1', [me.id])).name === 'Mina P');
    await page.click('#nameBtn');
    await page.fill('#askSheet input', 'Shit Runner');
    await clickAsk('Save');
    await until(() => MILES.State.data.profile.name === 'Mina P');
    const refusedName = await lastToast();
    ok('a name the server refuses is put back, and the reason given',
      /not allowed/.test(refusedName) && (await db.one('select name from users where id = $1', [me.id])).name === 'Mina P', refusedName);
    await page.evaluate(() => MILES.UI.go('home'));

    // --- 3. Runs reach the server; a loop claims ground there --------------------
    await simRun('free');
    await settle();
    await simRun('territory');
    await settle();
    const runs = await db.many('select kind, claimed_area from runs where user_id = $1 order by started_at', [me.id]);
    const mine = await page.evaluate(() => MILES.State.data.territories.map((t) => ({ serverId: t.serverId, area: t.area, polygon: t.polygon })));
    ok('both runs are on the server, and the outbox is empty', runs.length === 2 && runs[1].kind === 'territory', JSON.stringify(runs));
    ok('the loop\'s plot is the server\'s, with the area it holds there',
      mine.length === 1 && !!mine[0].serverId && Math.abs(mine[0].area - runs[1].claimed_area) < 1, JSON.stringify(mine.map((m) => [m.serverId, m.area])));

    // --- 4. Another runner takes a bite ------------------------------------------
    const theo = await runner('Theo Kim');
    await call('POST', '/v1/friends', { code: me.code }, theo.token);
    const mid = centroid(mine[0].polygon);
    const radius = Math.sqrt(mine[0].area / Math.PI);
    const bite = await call('POST', '/v1/runs', { run: territoryRun(loop(offset(mid, radius, 0), radius * 0.8)) }, theo.token);
    ok('the other runner\'s loop is a claim on the server', bite.status === 201 && bite.body.claim, JSON.stringify(bite.body));
    await page.evaluate(() => MILES.Sync.refresh());
    const after = await page.evaluate(() => ({
      area: MILES.State.data.territories[0].area,
      lost: MILES.State.data.territories[0].lost,
      rival: MILES.State.data.rivalLand.map((t) => t.ownerName),
      total: MILES.Pro.lostTotal(MILES.State.data),
      who: MILES.Pro.raiders(MILES.State.data).length,
    }));
    ok('your plot shrinks by what they took, and says so', after.area < mine[0].area - 1000 && after.lost > 1000, JSON.stringify(after));
    ok('their plot is on your map under their name', after.rival.indexOf('Theo Kim') >= 0, JSON.stringify(after.rival));
    ok('how much you lost is free to know; who took it is Pro', after.total > 1000 && after.who === 0, JSON.stringify(after));

    // --- 5. Friends and the feed -------------------------------------------------
    await page.evaluate(() => MILES.UI.go('feed'));
    await until(() => (MILES.State.data.feed || []).length > 0);
    const feed = await page.evaluate(() => ({
      friends: MILES.State.data.friends.map((f) => f.name),
      cards: [...document.querySelectorAll('#feedList .feed-who')].map((n) => n.textContent),
    }));
    ok('adding your code made them a friend, and their run is in your feed',
      feed.friends.indexOf('Theo Kim') >= 0 && feed.cards.indexOf('Theo Kim') >= 0, JSON.stringify(feed));
    await audit('the feed, with kudos and a menu on every card', '#feedList');
    await page.click('#feedList [aria-label="Give kudos to Theo Kim"]');
    await until(() => MILES.State.data.feed[0].kudosMine);
    const kudos = (await call('GET', '/v1/runs', undefined, theo.token)).body.runs[0].kudos;
    ok('kudos reach the runner', kudos === 1, kudos);

    // --- 6. A crew -----------------------------------------------------------------
    await page.evaluate(() => MILES.Sync.startTrial());
    await page.evaluate(() => MILES.UI.go('crew'));
    await page.evaluate(() => MILES.UI.openCreateCrew());
    await page.fill('#newCrewName', 'Han River Pacers');
    await page.fill('#newCrewTagline', 'Early loops, long talks.');
    await page.evaluate(() => [...document.querySelectorAll('#crewSheet button')].find((b) => b.textContent === 'Found it').click());
    await until(() => { const c = MILES.Crew.mine(MILES.State.data); return c && /^[0-9a-f-]{36}$/.test(c.id); });
    const crew = await db.one(`select c.id, c.name, m.role from crews c join crew_members m on m.crew_id = c.id where m.user_id = $1`, [me.id]);
    ok('a crew founded in the app is founded on the server, with you as captain', crew && crew.name === 'Han River Pacers' && crew.role === 'leader', JSON.stringify(crew));
    const fakes = await page.evaluate(() => MILES.Crew.mine(MILES.State.data).requests.length);
    ok('and nobody made up is knocking on its door', fakes === 0, fakes);
    await page.evaluate(() => MILES.UI.composeNotice(MILES.Crew.mine(MILES.State.data).id));
    await page.fill('#askSheet textarea', 'Saturday long run moves to 7:00.');
    await clickAsk('Post');
    await until(() => MILES.Crew.mine(MILES.State.data).notices.length === 1);
    const notice = await db.one('select text from crew_notices where crew_id = $1', [crew.id]);
    ok('the notice is on the server', notice && notice.text === 'Saturday long run moves to 7:00.', JSON.stringify(notice));
    await call('POST', `/v1/crews/${crew.id}/join`, {}, theo.token);
    await page.evaluate(() => MILES.Sync.refresh());
    const roster = await page.evaluate(() => MILES.Crew.mine(MILES.State.data).members.map((m) => m.id === 'me' ? 'me' : m.name));
    ok('a runner who joins on their phone appears in your crew', roster.length === 2 && roster.indexOf('Theo Kim') >= 0, JSON.stringify(roster));
    await page.evaluate(() => MILES.UI.openCrewSheet(MILES.Crew.mine(MILES.State.data).id));
    await audit('the captain\'s crew sheet', '#crewSheet');
    await page.evaluate(() => MILES.UI.closeSheet('#crewSheet'));
    // The same crew seen by its member: report and block where the content is.
    const member = await page.evaluate(() => MILES.Crew.mine(MILES.State.data).members.find((m) => m.id !== 'me').id);
    await page.evaluate((id) => MILES.UI.manageMember(MILES.Crew.mine(MILES.State.data).id, id), member);
    const manage = await page.evaluate(() => [...document.querySelectorAll('#crewSheetBody button')].map((b) => b.textContent.trim()));
    ok('a captain can report or block a member, as well as manage them', manage.indexOf('Report or block') >= 0, JSON.stringify(manage));
    await page.evaluate(() => MILES.UI.closeSheet('#crewSheet'));
    await page.evaluate(() => MILES.UI.openMissionPicker(MILES.Crew.mine(MILES.State.data).id));
    await page.click('#crewSheet .mission-option');
    await until(() => !!MILES.Crew.mine(MILES.State.data).mission);
    await page.waitForTimeout(300);
    const mission = await db.one('select mission from crews where id = $1', [crew.id]);
    ok('this week\'s mission is set on the server, priced for two', mission.mission && mission.mission.heads === 2, JSON.stringify(mission.mission));

    // --- 7. Report and block ----------------------------------------------------------
    await page.evaluate(() => MILES.UI.closeSheet('#crewSheet'));
    await page.evaluate(() => MILES.UI.go('feed'));
    await page.click('#feedList .feed-more');
    ok('a feed card opens a menu to report or block its runner', await askTitle() === 'Theo Kim');
    await audit('the report-or-block menu', '#askSheet');
    await clickAsk('Report Theo Kim');
    await audit('the report form', '#askSheet');
    await page.click('#askSheet .report-reason[data-reason="cheating"]');
    await clickAsk('Send report');
    await page.waitForTimeout(300);
    const report = await db.one(`select target_type, target_id, reason from reports where reporter_id = $1`, [me.id]);
    ok('a report reaches the moderation queue', report && report.target_id === theo.id && report.reason === 'cheating', JSON.stringify(report));
    await page.click('#feedList .feed-more');
    await clickAsk('Block Theo Kim');
    await page.waitForTimeout(100);
    await clickAsk('Block');
    await until(() => !MILES.State.data.friends.length);
    const blocked = await db.one('select 1 as yes from blocks where user_id = $1 and blocked_id = $2', [me.id, theo.id]);
    const left = await page.evaluate(() => [...document.querySelectorAll('#feedList .feed-who')].map((n) => n.textContent));
    ok('blocking takes them out of your friends and your feed', !!blocked && left.indexOf('Theo Kim') < 0, JSON.stringify(left));

    // --- 8. A race invite, over the live socket ---------------------------------------
    // A name that is also markup: it must arrive as text, everywhere.
    const sneaky = await runner('S <svg onload=__x=1>');
    await call('POST', '/v1/friends', { code: me.code }, sneaky.token);
    const socket = new WebSocket(API.replace(/^http/, 'ws') + '/v1/live');
    const inbox = [];
    socket.onmessage = (e) => inbox.push(JSON.parse(e.data));
    await new Promise((resolve) => { socket.onopen = resolve; });
    socket.send(JSON.stringify({ type: 'auth', token: sneaky.token }));
    await new Promise((resolve) => setTimeout(resolve, 200));
    await until(() => MILES.Api.live.ready);
    const race = (await call('POST', '/v1/races', { target: 3000, rivals: [me.id] }, sneaky.token)).body.race;
    await until(() => !!document.querySelector('#askSheet:not([hidden])'));
    ok('a friend\'s race arrives as an invite the moment it is made', /wants to race/.test(await askTitle() || ''), await askTitle());
    await clickAsk('Race now');
    await until(() => MILES.Tracker.active && MILES.Tracker.kind === 'race');
    socket.send(JSON.stringify({ type: 'join', race: race.id }));
    await new Promise((resolve) => setTimeout(resolve, 200));
    socket.send(JSON.stringify({ type: 'telemetry', race: race.id, telemetry: { distance: 820, duration: 240 } }));
    await until(() => MILES.Live.list().some((p) => !p.isBot && p.distance === 820));
    const field = await page.evaluate(() => MILES.Live.list().filter((p) => !p.isBot).map((p) => p.name));
    ok('their live distance arrives on your race board, in place of their pace bot', field.length === 1 && field[0] === 'S <svg onload=__x=1>', JSON.stringify(field));
    await page.waitForTimeout(1500);
    const theirs = inbox.filter((m) => m.type === 'telemetry' && m.race === race.id);
    ok('and yours goes to them', theirs.length > 0 && theirs.every((m) => m.from === me.id && m.telemetry.name === 'Mina P'), theirs.length);
    await page.evaluate(() => MILES.UI.finishRun());
    await settle();
    const raceRun = await db.one('select race_id from runs where user_id = $1 and kind = $2', [me.id, 'race']);
    ok('the race is filed under the race it was', raceRun && raceRun.race_id === race.id, JSON.stringify(raceRun));
    const markup = await page.evaluate(() => ({
      xss: window.__x,
      text: [...document.querySelectorAll('#toasts .toast')].map((t) => t.textContent).join(' | '),
      injected: document.querySelectorAll('#toasts svg, #askBody svg, #raceRows svg').length,
    }));
    ok('a name made of markup is shown as text and never runs', markup.xss === undefined && markup.injected === 0 && /<svg onload/.test(markup.text), JSON.stringify(markup));
    socket.close();

    // --- 9. No connection: the run waits, then arrives --------------------------------
    await page.route(API + '/v1/runs', (route) => route.abort());
    await simRun('free');
    await page.waitForTimeout(500);
    const waiting = await page.evaluate(() => ({ outbox: MILES.State.data.outbox.length, pending: MILES.State.data.activities[0].pending }));
    ok('a run finished with no connection waits in the outbox', waiting.outbox === 1 && waiting.pending === true, JSON.stringify(waiting));
    await page.unroute(API + '/v1/runs');
    await page.evaluate(() => MILES.Sync.flush());
    await settle();
    const count = (await db.one('select count(*) as n from runs where user_id = $1', [me.id])).n;
    ok('and is uploaded as soon as the server can be reached', count === 4, count);

    // --- 10. A run the server refuses leaves the phone too ----------------------------
    await page.route(API + '/v1/runs', (route) => route.fulfill({
      status: 422, contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'too_fast', message: 'That run is faster than anyone can run.' } }),
    }));
    const before = await page.evaluate(() => MILES.State.data.activities.length);
    await simRun('free');
    await until(() => !MILES.State.data.outbox.length);
    const refusedRun = await page.evaluate(() => MILES.State.data.activities.length);
    const said = await lastToast();
    ok('a refused run is taken off the phone, and the reason is given', refusedRun === before && /faster than anyone/.test(said), JSON.stringify([before, refusedRun, said]));
    await page.unroute(API + '/v1/runs');

    // --- 11. Signing out and back in ----------------------------------------------------
    await page.evaluate(() => MILES.UI.go('profile'));
    await page.click('#signOutBtn');
    await clickAsk('Sign out');
    await until(() => !document.querySelector('#authScreen').hidden);
    const out = await page.evaluate(() => ({
      runs: MILES.State.data.activities.length,
      stored: localStorage.getItem('miles.account.v1'),
      session: localStorage.getItem('miles.session'),
    }));
    ok('signing out leaves nothing of the account on the phone', out.runs === 0 && out.stored === null && out.session === null, JSON.stringify(out));
    await page.evaluate(() => MILES.Account.setMode('signin'));
    await page.fill('#authEmail', myEmail);
    await page.fill('#authPassword', PASSWORD);
    await page.click('#authSubmit');
    await until(() => document.querySelector('#authScreen').hidden && !MILES.Sync.pulling && MILES.State.data.activities.length === 4, null, 10000);
    const back = await page.evaluate(() => ({ runs: MILES.State.data.activities.length, plots: MILES.State.data.territories.length, crew: (MILES.Crew.mine(MILES.State.data) || {}).name }));
    ok('signing back in brings everything back from the server', back.runs === 4 && back.plots === 1 && back.crew === 'Han River Pacers', JSON.stringify(back));

    // --- 12. A session that ends elsewhere ----------------------------------------------
    // One request from the old session is held back, to come home late.
    const oldToken = await page.evaluate(() => MILES.Api.token);
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    await page.route(API + '/v1/feed', async (route) => {
      if (route.request().headers().authorization !== 'Bearer ' + oldToken) return route.continue();
      await held;
      return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: { code: 'unauthorized', message: 'Your session has ended. Sign in again.' } }) });
    });
    await db.query('delete from sessions where user_id = $1', [me.id]);
    await page.evaluate(() => { MILES.Sync.refresh(); });
    await until(() => !document.querySelector('#authScreen').hidden);
    ok('a session ended on the server sends you back to sign in, and says why', /session ended/i.test(await page.textContent('#authError')));
    await page.evaluate(() => MILES.Account.setMode('signin'));
    await page.fill('#authEmail', myEmail);
    await page.fill('#authPassword', PASSWORD);
    await page.click('#authSubmit');
    await until(() => document.querySelector('#authScreen').hidden && !MILES.Sync.pulling);
    release();
    await page.waitForTimeout(600);
    const still = await page.evaluate(() => ({ auth: !document.querySelector('#authScreen').hidden, signedIn: MILES.Api.signedIn(), runs: MILES.State.data.activities.length }));
    ok('a slow answer from the ended session does not sign the new one out, nor touch its data',
      !still.auth && still.signedIn && still.runs === 4, JSON.stringify(still));
    await page.unroute(API + '/v1/feed');

    // --- 13. Deleting the account ---------------------------------------------------------
    await page.evaluate(() => MILES.UI.go('profile'));
    await page.click('#deleteAccountBtn');
    await page.fill('#deletePassword', 'not the password');
    await clickAsk('Delete everything');
    await page.waitForTimeout(300);
    const wrong = await page.evaluate(() => (document.querySelector('#askSheet [role="alert"]') || {}).textContent);
    ok('deleting the account needs the right password', /not right/.test(wrong || ''), wrong);
    await page.fill('#deletePassword', PASSWORD);
    await clickAsk('Delete everything');
    await until(() => !document.querySelector('#authScreen').hidden);
    const gone = (await db.one('select count(*) as n from users where id = $1', [me.id])).n;
    ok('and then it is gone from the server', gone === 0, gone);

    // --- 14. The demo is still the demo ----------------------------------------------------
    const demo = await browser.newPage({ viewport: { width: 390, height: 844 } });
    demo.on('pageerror', (e) => errors.push('PAGEERROR (demo): ' + e.message));
    await demo.goto('file://' + path.resolve(__dirname, 'index.html') + '?api=off');
    await demo.waitForTimeout(600);
    const d = await demo.evaluate(() => ({
      auth: !document.querySelector('#authScreen').hidden,
      connected: !!MILES.State.data.connected,
      runs: MILES.State.data.activities.length,
      crews: MILES.State.data.crews.length,
    }));
    ok('with no server it is the demo it always was', !d.auth && !d.connected && d.runs > 0 && d.crews > 0, JSON.stringify(d));
  } finally {
    await browser.close();
    await server.close();
    await admin(`drop database if exists ${dbName} with (force)`);
  }

  errors.forEach((e) => console.log(e));
  const failed = bad + errors.length;
  console.log(failed === 0 ? 'THE APP WORKS AGAINST A REAL SERVER' : `${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((err) => { console.error(err); process.exit(1); });
