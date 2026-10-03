'use strict';

/* Territory, kept by the server.

   A claim's loop never changes. What it still holds — its `pieces` and
   `area` — depends on every later claim that overlaps it, and is worked out
   by the app's own Land.resolve. When a claim arrives or goes, only the
   claims whose extent touches it can change, so only those are recomputed,
   from scratch, against every claim that could cut them. The same pass
   records each bite one claim took out of another (`takes`), which is what
   "land taken" means everywhere: the crew mission, and who took your land.

   All writes take one advisory lock. Two loops closing at the same moment
   would otherwise each be resolved against a map without the other. */

const { Geo, Land } = require('../shared');

const LAND_LOCK = 4407002;
const MIN_AREA = 1000;          // m²: the app ignores noise-sized loops too (state.js)
const MAX_AREA = 50e6;          // m²: far beyond any loop one run closes
const ROUND = 1e7;              // ~1 cm

const ms = (d) => new Date(d).getTime();
const round = (p) => ({ lat: Math.round(p.lat * ROUND) / ROUND, lng: Math.round(p.lng * ROUND) / ROUND });

function boundsOf(ring) {
  let minLat = Infinity; let minLng = Infinity; let maxLat = -Infinity; let maxLng = -Infinity;
  ring.forEach((p) => {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  });
  return { minLat, minLng, maxLat, maxLng };
}

const boundsOfRow = (r) => ({ minLat: r.min_lat, minLng: r.min_lng, maxLat: r.max_lat, maxLng: r.max_lng });

function union(boxes) {
  return boxes.reduce((u, b) => ({
    minLat: Math.min(u.minLat, b.minLat), minLng: Math.min(u.minLng, b.minLng),
    maxLat: Math.max(u.maxLat, b.maxLat), maxLng: Math.max(u.maxLng, b.maxLng),
  }));
}

const BOX_SQL = 'bounds && box(point($1, $2), point($3, $4))';
const boxParams = (b) => [b.minLng, b.minLat, b.maxLng, b.maxLat];

async function lock(q) {
  await q.query('select pg_advisory_xact_lock($1)', [LAND_LOCK]);
}

function overlapping(q, box) {
  return q.many(
    `select id, user_id, claimed_at, polygon, min_lat, min_lng, max_lat, max_lng
       from claims where ${BOX_SQL} order by claimed_at, id`, boxParams(box));
}

/**
 * Re-resolves every claim whose extent touches `box`, and replays who took
 * what from each of them. Must run inside a transaction.
 */
async function recompute(q, box) {
  await lock(q);
  const affected = await overlapping(q, box);
  if (!affected.length) return 0;

  // Everything that could cut an affected claim overlaps its extent, and so
  // overlaps the union of them all.
  const wide = union(affected.map(boundsOfRow));
  const context = await overlapping(q, wide);
  const claims = context.map((r) => ({ id: r.id, owner: r.user_id, claimedAt: ms(r.claimed_at), polygon: r.polygon }));
  const byId = new Map(claims.map((c) => [c.id, c]));
  const origin = { lat: (wide.minLat + wide.maxLat) / 2, lng: (wide.minLng + wide.maxLng) / 2 };

  Land.resolve(claims, origin);

  const ids = affected.map((r) => r.id);
  await q.query('delete from takes where victim_claim_id = any($1::uuid[])', [ids]);

  const takes = [];
  for (const row of affected) {
    const c = byId.get(row.id);
    const pieces = (c.pieces || []).map((p) => ({ ring: p.ring.map(round), holes: p.holes.map((h) => h.map(round)) }));
    await q.query('update claims set pieces = $2, area = $3 where id = $1', [row.id, JSON.stringify(pieces), c.area || 0]);
    // Your own later loops cover your ground; they do not take it.
    Land.cuts(c, claims, origin).forEach((cut) => {
      if (cut.owner === c.owner) return;
      takes.push([row.id, cut.claim.id, c.owner, cut.owner, cut.area, new Date(cut.at)]);
    });
  }
  if (takes.length) {
    await q.query(
      `insert into takes (victim_claim_id, taker_claim_id, victim_user_id, taker_user_id, area, at)
       select * from unnest($1::uuid[], $2::uuid[], $3::uuid[], $4::uuid[], $5::float8[], $6::timestamptz[])`,
      [0, 1, 2, 3, 4, 5].map((k) => takes.map((t) => t[k])));
  }
  return affected.length;
}

/** Whether a closed loop is one the map accepts as a claim. */
function claimable(polygon) {
  if (!polygon || polygon.length < 4) return { ok: false, reason: 'The loop is too short to enclose anything.' };
  const area = Geo.polygonArea(polygon);
  if (area < MIN_AREA) return { ok: false, reason: 'The loop encloses too little ground to claim.', area };
  if (area > MAX_AREA) return { ok: false, reason: 'That loop is far larger than one run can close.', area };
  return { ok: true, area };
}

/**
 * Adds a claim and settles the map around it. `claimedAt` orders it against
 * every other claim; no two claims share a millisecond, so the order is total.
 * Must run inside a transaction.
 */
async function insertClaim(q, { userId, runId, polygon, claimedAt }) {
  await lock(q);
  let at = Math.floor(claimedAt);
  while (await q.one('select 1 from claims where claimed_at = $1', [new Date(at)])) at += 1;
  const ring = polygon.map(round);
  const b = boundsOf(ring);
  const row = await q.one(
    `insert into claims (user_id, run_id, claimed_at, polygon, original_area, min_lat, min_lng, max_lat, max_lng)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
    [userId, runId || null, new Date(at), JSON.stringify(ring), Geo.polygonArea(ring), b.minLat, b.minLng, b.maxLat, b.maxLng]);
  await recompute(q, b);
  return q.one('select * from claims where id = $1', [row.id]);
}

/** Removes claims (rows from `claims`) and gives their ground back. */
async function removeClaims(q, rows) {
  if (!rows.length) return;
  await lock(q);
  await q.query('delete from claims where id = any($1::uuid[])', [rows.map((r) => r.id)]);
  // Overlapping extents are recomputed once, as one box.
  for (const b of mergeBoxes(rows.map(boundsOfRow))) await recompute(q, b);
}

/** Unions boxes that overlap, so neighbouring claims are recomputed once. */
function mergeBoxes(boxes) {
  const out = [];
  boxes.forEach((b) => {
    let merged = b;
    for (let i = out.length - 1; i >= 0; i--) {
      const o = out[i];
      const apart = o.maxLat < merged.minLat || merged.maxLat < o.minLat || o.maxLng < merged.minLng || merged.maxLng < o.minLng;
      if (!apart) { merged = union([o, merged]); out.splice(i, 1); }
    }
    out.push(merged);
  });
  return out;
}

/**
 * The map in a box, as the app draws it. Land that has been taken entirely
 * is left out unless `history` asks for it (the time machine replays it).
 * Owners the viewer has blocked are shown without their name.
 */
async function landIn(q, box, viewerId, options) {
  const o = options || {};
  const rows = await q.many(
    `select c.id, c.user_id, c.run_id, c.claimed_at, c.polygon, c.pieces, c.area, c.label, c.color,
            u.name, u.initials, m.crew_id,
            exists (select 1 from blocks b where b.user_id = $5 and b.blocked_id = c.user_id) as hidden
       from claims c
       join users u on u.id = c.user_id
       left join crew_members m on m.user_id = c.user_id
      where c.${BOX_SQL} ${o.history ? '' : 'and c.area > 0'}
      order by c.claimed_at
      limit $6`,
    boxParams(box).concat([viewerId, o.limit || 3000]));
  return rows.map((r) => claimView(r, viewerId));
}

function claimView(r, viewerId) {
  const hidden = !!r.hidden;
  return {
    id: r.id,
    owner: r.user_id,
    mine: r.user_id === viewerId,
    ownerName: hidden ? 'Hidden runner' : r.name,
    initials: hidden ? '··' : r.initials,
    crewId: r.crew_id || null,
    runId: r.run_id || null,
    claimedAt: ms(r.claimed_at),
    polygon: r.polygon,
    pieces: r.pieces || [],
    area: r.area,
    name: r.label || null,
    color: r.color || null,
  };
}

/** Every claim a runner has made, held or not. */
async function claimsOf(q, userId) {
  const rows = await q.many(
    `select c.*, u.name, u.initials, m.crew_id, false as hidden
       from claims c join users u on u.id = c.user_id
       left join crew_members m on m.user_id = c.user_id
      where c.user_id = $1 order by c.claimed_at desc`, [userId]);
  return rows.map((r) => claimView(r, userId));
}

/** Who has taken a runner's ground, biggest first, and the total lost. */
async function raidersOf(q, userId) {
  const rows = await q.many(
    `select t.taker_user_id as owner, u.name, u.initials,
            sum(t.area) as area, max(t.at) as at, count(distinct t.victim_claim_id) as plots,
            exists (select 1 from blocks b where b.user_id = $1 and b.blocked_id = t.taker_user_id) as hidden
       from takes t join users u on u.id = t.taker_user_id
      where t.victim_user_id = $1
      group by t.taker_user_id, u.name, u.initials
      order by area desc`, [userId]);
  return {
    lost: rows.reduce((s, r) => s + r.area, 0),
    raiders: rows.map((r) => ({
      owner: r.owner,
      name: r.hidden ? 'Hidden runner' : r.name,
      initials: r.hidden ? '··' : r.initials,
      area: r.area, at: ms(r.at), plots: r.plots,
    })),
  };
}

module.exports = {
  LAND_LOCK, MIN_AREA, MAX_AREA, boundsOf, boundsOfRow, mergeBoxes, recompute, claimable, insertClaim,
  removeClaims, landIn, claimView, claimsOf, raidersOf,
};
