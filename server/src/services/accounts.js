'use strict';

/* A runner's account as the app sees it, the settings it keeps for them,
   and the two things the stores require any account to offer: everything we
   hold about you (export), and all of it gone (delete). */

const { proView, entitlementOf } = require('./entitlements');
const land = require('./land');

const ms = (d) => (d ? new Date(d).getTime() : null);

/* The app's settings that follow a runner from phone to phone. Anything
   else in the object is dropped; the app owns what these mean. */
const PREF_KEYS = {
  units: (v) => (v === 'km' || v === 'mi' ? v : undefined),
  mapStyle: (v) => (typeof v === 'string' && /^[a-z]{1,16}$/.test(v) ? v : undefined),
  heroBg: (v) => (Number.isInteger(v) && v >= 0 && v < 50 ? v : undefined),
  rangeMode: (v) => (v === 'week' || v === 'month' ? v : undefined),
  rankSeen: (v) => (typeof v === 'string' && /^[a-z]{1,16}$/.test(v) ? v : undefined),
  cardDesign: (v) => (v && ['map', 'poster', 'sticker'].indexOf(v.template) >= 0 ? { template: v.template } : undefined),
  questClaims: (v) => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
    const out = {};
    Object.keys(v).slice(0, 64).forEach((k) => {
      if (/^[a-z0-9-]{1,32}$/.test(k) && Number.isInteger(v[k]) && v[k] >= 0 && v[k] <= 1000) out[k] = v[k];
    });
    return out;
  },
};

function cleanPrefs(input, base) {
  const out = Object.assign({}, base || {});
  if (!input || typeof input !== 'object') return out;
  Object.keys(PREF_KEYS).forEach((key) => {
    if (!(key in input)) return;
    const value = PREF_KEYS[key](input[key]);
    if (value !== undefined) out[key] = value;
  });
  return out;
}

function handleOf(name) {
  const h = String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  return h ? '@' + h : '@runner';
}

async function meView(q, user) {
  const ent = await entitlementOf(q, user.id);
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    initials: user.initials,
    handle: handleOf(user.name),
    friendCode: user.friend_code,
    prefs: user.prefs || {},
    pro: proView(user, ent),
    createdAt: ms(user.created_at),
  };
}

/**
 * Deletes a runner and everything that is theirs. A crew they captain
 * carries on under its longest-standing pacer or member; a crew of one goes
 * with them. Their land is removed and the ground it had cut out of other
 * runners' claims is given back.
 */
async function deleteAccount(db, userId) {
  await db.tx(async (q) => {
    await q.query('select pg_advisory_xact_lock($1)', [land.LAND_LOCK]);
    const led = await q.one(`select crew_id from crew_members where user_id = $1 and role = 'leader'`, [userId]);
    if (led) {
      const next = await q.one(
        `select user_id from crew_members where crew_id = $1 and user_id <> $2
          order by (role = 'pacer') desc, joined_at asc limit 1`, [led.crew_id, userId]);
      await q.query('delete from crew_members where user_id = $1', [userId]);
      if (next) await q.query(`update crew_members set role = 'leader' where crew_id = $1 and user_id = $2`, [led.crew_id, next.user_id]);
      else await q.query('delete from crews where id = $1', [led.crew_id]);
    }
    const claims = await q.many('select id, min_lat, min_lng, max_lat, max_lng from claims where user_id = $1', [userId]);
    await q.query('delete from users where id = $1', [userId]);
    // The claims went with the user; what they had cut from others comes back.
    for (const b of land.mergeBoxes(claims.map(land.boundsOfRow))) await land.recompute(q, b);
  });
}

/** Everything held about a runner, as one JSON document. */
async function exportData(q, user) {
  const id = user.id;
  const [runs, claims, membership, requests, notices, friends, blocks, reports, ent, kudos] = await Promise.all([
    q.many('select * from runs where user_id = $1 order by started_at', [id]),
    q.many('select id, run_id, claimed_at, polygon, pieces, area, original_area, label, color from claims where user_id = $1 order by claimed_at', [id]),
    q.many('select m.role, m.joined_at, c.id as crew_id, c.name as crew_name from crew_members m join crews c on c.id = m.crew_id where m.user_id = $1', [id]),
    q.many('select r.at, c.id as crew_id, c.name as crew_name from crew_requests r join crews c on c.id = r.crew_id where r.user_id = $1', [id]),
    q.many('select n.id, n.crew_id, n.text, n.created_at from crew_notices n where n.author_id = $1 order by n.created_at', [id]),
    q.many('select u.id, u.name, f.created_at from friendships f join users u on u.id = f.friend_id where f.user_id = $1', [id]),
    q.many('select b.blocked_id, b.created_at from blocks b where b.user_id = $1', [id]),
    q.many('select target_type, target_id, reason, note, status, created_at from reports where reporter_id = $1', [id]),
    entitlementOf(q, id),
    q.many('select run_id, created_at from kudos where user_id = $1', [id]),
  ]);
  return {
    exportedAt: new Date().toISOString(),
    account: {
      id, email: user.email, name: user.name, initials: user.initials, friendCode: user.friend_code,
      prefs: user.prefs, createdAt: user.created_at, termsAcceptedAt: user.terms_accepted_at,
      trialEndsAt: user.trial_ends_at,
    },
    entitlement: ent ? { plan: ent.plan, tier: ent.tier, expiresAt: ent.expires_at, store: ent.store } : null,
    runs, claims, crew: membership, crewRequests: requests, notices, friends, blocks, reports, kudos,
  };
}

module.exports = { cleanPrefs, handleOf, meView, deleteAccount, exportData };
