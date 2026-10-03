'use strict';

/* Every test file boots the real server against a database of its own,
   created for it and dropped afterwards, and talks to it over HTTP the way
   the app does. TEST_DATABASE_URL points at any database on a Postgres
   where the role may create databases. */

const crypto = require('crypto');
const { Client } = require('pg');
const { start } = require('../src/index');
const { load } = require('../src/config');

const ADMIN_URL = process.env.TEST_DATABASE_URL || 'postgres://miles:miles@127.0.0.1:5432/postgres';

async function admin(sql) {
  const c = new Client({ connectionString: ADMIN_URL });
  await c.connect();
  try { await c.query(sql); } finally { await c.end(); }
}

const quiet = { log() {}, warn() {}, error: (...args) => console.error(...args) };

function client(base, token) {
  async function call(method, path, body, headers) {
    const res = await fetch(base + path, {
      method,
      headers: Object.assign(
        { 'content-type': 'application/json' },
        token ? { authorization: 'Bearer ' + token } : {},
        headers || {}),
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (err) { /* not JSON */ }
    return { status: res.status, body: json, text, headers: res.headers };
  }
  return {
    get: (p, h) => call('GET', p, undefined, h),
    post: (p, b, h) => call('POST', p, b === undefined ? {} : b, h),
    put: (p, b, h) => call('PUT', p, b === undefined ? {} : b, h),
    patch: (p, b, h) => call('PATCH', p, b === undefined ? {} : b, h),
    delete: (p, b, h) => call('DELETE', p, b, h),
    raw: call,
  };
}

let counter = 0;

async function boot(env) {
  const name = 'miles_test_' + crypto.randomBytes(5).toString('hex');
  await admin(`create database ${name}`);
  const url = new URL(ADMIN_URL);
  url.pathname = '/' + name;

  const mail = [];
  const config = load(Object.assign({
    DATABASE_URL: url.toString(),
    SCRYPT_N: '1024',
    RATE_LIMIT_SCALE: '1000',
    LOG_REQUESTS: 'false',
    ALLOW_SIMULATED_RUNS: 'false',
    ADMIN_TOKEN: 'test-admin-token',
    REVENUECAT_WEBHOOK_SECRET: 'test-rc-secret',
    PUBLIC_URL: 'https://api.miles.test',
    CONTACT_EMAIL: 'help@miles.test',
    COMPANY_NAME: 'MILES Test Co.',
  }, env || {}));
  const server = await start({
    config, port: 0, log: quiet, poolSize: 4,
    mailer: { kind: 'memory', async send(message) { mail.push(message); } },
  });

  const t = {
    url: server.url,
    server,
    db: server.db,
    config,
    mail,
    anon: client(server.url),
    client: (token) => client(server.url, token),
    admin: client(server.url, 'test-admin-token'),

    /** A new runner, signed up and signed in. */
    async runner(overrides) {
      counter += 1;
      const body = Object.assign({
        email: `runner${counter}.${crypto.randomBytes(3).toString('hex')}@example.test`,
        password: 'correct horse battery',
        name: `Runner ${String.fromCharCode(64 + ((counter % 26) || 26))}${counter}`,
        acceptTerms: true,
        ageConfirmed: true,
      }, overrides || {});
      const res = await client(server.url).post('/v1/auth/signup', body);
      if (res.status !== 201) throw new Error(`signup failed: ${res.status} ${res.text}`);
      return {
        id: res.body.user.id,
        token: res.body.token,
        user: res.body.user,
        email: body.email,
        password: body.password,
        api: client(server.url, res.body.token),
      };
    },

    async close() {
      await server.close();
      await admin(`drop database if exists ${name} with (force)`);
    },
  };
  return t;
}

/* --- Geometry for tests ---------------------------------------------------- */

const R_EARTH = 6371000;
function offset(p, east, north) {
  const k = Math.cos(p.lat * Math.PI / 180);
  return { lat: p.lat + (north / R_EARTH) * (180 / Math.PI), lng: p.lng + (east / (R_EARTH * k)) * (180 / Math.PI) };
}

/** A closed loop of `n` points around `centre`, `radius` metres out. */
function loop(centre, radius, n) {
  const count = n || 24;
  const ring = [];
  for (let i = 0; i < count; i++) {
    const t = (i / count) * Math.PI * 2;
    ring.push(offset(centre, Math.cos(t) * radius, Math.sin(t) * radius));
  }
  ring.push(ring[0]);
  return ring;
}

const HOME = { lat: 37.5512, lng: 126.9882 };

let runCounter = 0;
/** A run as the app uploads it. */
function run(overrides) {
  runCounter += 1;
  const o = overrides || {};
  const kind = o.kind || 'free';
  const centre = o.centre || HOME;
  const radius = o.radius || 300;
  const route = o.route || loop(centre, radius);
  const distance = o.distance !== undefined ? o.distance : 2 * Math.PI * radius;
  const startedAt = o.startedAt !== undefined ? o.startedAt : Date.now() - 60 * 60 * 1000;
  return Object.assign({
    id: 'run-' + runCounter + '-' + crypto.randomBytes(3).toString('hex'),
    startedAt,
    kind,
    title: kind === 'territory' ? 'Morning Territory Loop' : kind === 'race' ? 'Morning Race' : 'Morning Run',
    distance,
    duration: distance / 3,
    elevation: 12,
    route,
    splits: [{ km: 1, seconds: 330 }],
    loopClosed: kind === 'territory',
    territoryPolygon: kind === 'territory' ? route : null,
    claimedArea: 0,
    source: 'gps',
    target: kind === 'race' ? 5000 : null,
    finished: kind === 'race' ? true : null,
  }, o.extra || {});
}

module.exports = { boot, client, offset, loop, run, HOME };
