'use strict';

/* Crews, as the app draws them, and the weekly mission measured from what
   the members actually ran — the server is the first place that can, since
   every member's runs are here. Mission targets, rewards and tiers come from
   the app's own crew.js. */

const { Crew } = require('../shared');
const { fail } = require('../http');

const DAY = 864e5;
const WEEK = 7 * DAY;
const ms = (d) => (d ? new Date(d).getTime() : null);

/** Weekly distance and typical pace for each runner, by id. */
async function memberStats(q, ids, since) {
  const out = new Map(ids.map((id) => [id, { weekly: 0, pace: null }]));
  if (!ids.length) return out;
  const weekly = await q.many(
    `select user_id, sum(distance) as weekly from runs
      where user_id = any($1::uuid[]) and started_at >= $2 group by user_id`, [ids, new Date(since)]);
  weekly.forEach((r) => { out.get(r.user_id).weekly = r.weekly; });
  // Seconds per kilometre over their last twenty runs of any length worth timing.
  const paces = await q.many(
    `select user_id, avg(duration / distance) * 1000 as pace from (
        select user_id, duration, distance,
               row_number() over (partition by user_id order by started_at desc) as n
          from runs where user_id = any($1::uuid[]) and distance > 800 and duration > 0
     ) recent where n <= 20 group by user_id`, [ids]);
  paces.forEach((r) => { out.get(r.user_id).pace = Math.round(r.pace); });
  return out;
}

/** How far the crew has got with this mission, in the mission's own unit. */
async function missionHave(q, crewId, mission) {
  if (!mission || !Crew.MISSIONS[mission.type]) return null;
  const from = new Date(mission.week);
  const to = new Date(mission.week + WEEK);
  const members = `(select user_id from crew_members where crew_id = $1)`;
  let row;
  if (mission.type === 'distance') {
    row = await q.one(
      `select coalesce(sum(distance), 0) as have from runs
        where user_id in ${members} and started_at >= $2 and started_at < $3`, [crewId, from, to]);
  } else if (mission.type === 'claimed') {
    // Ground claimed this week that the crew still holds.
    row = await q.one(
      `select coalesce(sum(area), 0) as have from claims
        where user_id in ${members} and claimed_at >= $2 and claimed_at < $3`, [crewId, from, to]);
  } else {
    // Taken from runners outside the crew; taking a crewmate's is not taking.
    row = await q.one(
      `select coalesce(sum(area), 0) as have from takes
        where taker_user_id in ${members} and victim_user_id not in ${members}
          and at >= $2 and at < $3`, [crewId, from, to]);
  }
  return row.have;
}

function activeMission(mission, now) {
  return !!mission && Crew.MISSIONS[mission.type] && (now || Date.now()) < mission.week + WEEK;
}

/**
 * Pays out the week once the crew has cleared it. Safe to call as often as
 * anything likes: the row is locked, and a cleared mission pays once.
 */
async function settle(q, crewId) {
  const crew = await q.one('select * from crews where id = $1 for update', [crewId]);
  if (!crew || !activeMission(crew.mission) || crew.mission.completedAt) return null;
  const have = await missionHave(q, crewId, crew.mission);
  if (have < crew.mission.target) return null;
  const mission = Object.assign({}, crew.mission, { completedAt: Date.now() });
  const updated = await q.one(
    `update crews set mission = $2, xp = xp + $3, missions_done = missions_done + 1 where id = $1 returning *`,
    [crewId, JSON.stringify(mission), mission.xp]);
  const level = Crew.level({ xp: updated.xp });
  return { crewId, name: updated.name, xp: mission.xp, tier: level.tier.index, tierName: level.tier.name };
}

/** After a member's run: did that clear the crew's week? */
async function afterRun(q, userId) {
  const m = await q.one('select crew_id from crew_members where user_id = $1', [userId]);
  if (!m) return null;
  const cleared = await settle(q, m.crew_id);
  return cleared ? { id: m.crew_id, missionCleared: cleared } : { id: m.crew_id, missionCleared: null };
}

function distanceBetween(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * A crew in the shape the app's crew.js works with: members with their
 * weekly distance and pace, the notices, the mission and how far along it
 * is. Join requests are the captain's to see.
 */
async function crewView(q, crew, viewerId, options) {
  const o = options || {};
  const since = o.since || Date.now() - WEEK;
  const members = await q.many(
    `select m.user_id, m.role, m.joined_at, u.name, u.initials
       from crew_members m join users u on u.id = m.user_id
      where m.crew_id = $1 order by m.joined_at`, [crew.id]);
  const leader = members.find((m) => m.role === 'leader');
  const isLeader = !!leader && leader.user_id === viewerId;
  const requests = isLeader ? await q.many(
    `select r.user_id, r.at, u.name, u.initials
       from crew_requests r join users u on u.id = r.user_id
      where r.crew_id = $1 order by r.at`, [crew.id]) : [];
  const stats = await memberStats(q, members.map((m) => m.user_id).concat(requests.map((r) => r.user_id)), since);
  const notices = await q.many(
    `select n.id, n.text, n.created_at, u.name from crew_notices n join users u on u.id = n.author_id
      where n.crew_id = $1 and n.hidden_at is null
        and not exists (select 1 from blocks b where b.user_id = $2 and b.blocked_id = n.author_id)
      order by n.created_at desc limit 20`, [crew.id, viewerId]);
  const pending = await q.one('select 1 from crew_requests where crew_id = $1 and user_id = $2', [crew.id, viewerId]);
  const mission = crew.mission && Crew.MISSIONS[crew.mission.type] ? crew.mission : null;
  const home = { lat: crew.home_lat, lng: crew.home_lng };

  return {
    id: crew.id,
    name: crew.name,
    tagline: crew.tagline,
    photo: crew.photo || null,
    color: crew.color,
    foundedAt: ms(crew.founded_at),
    home,
    distance: o.origin ? Math.round(distanceBetween(o.origin, home)) : null,
    leaderId: leader ? leader.user_id : null,
    members: members.map((m) => Object.assign({
      id: m.user_id, name: m.name, initials: m.initials, role: m.role, joinedAt: ms(m.joined_at),
    }, stats.get(m.user_id))),
    memberIds: members.map((m) => m.user_id),
    requests: requests.map((r) => ({
      id: r.user_id, name: r.name, initials: r.initials, at: ms(r.at), weekly: stats.get(r.user_id).weekly,
    })),
    schedule: crew.schedule,
    openJoin: crew.open_join,
    xp: crew.xp,
    missionsDone: crew.missions_done,
    notices: notices.map((n) => ({ id: n.id, text: n.text, at: ms(n.created_at), by: n.name })),
    mission,
    missionHave: activeMission(mission) ? await missionHave(q, crew.id, mission) : null,
    pendingMe: !!pending,
  };
}

async function crewOf(q, userId) {
  return q.one('select c.* from crews c join crew_members m on m.crew_id = c.id where m.user_id = $1', [userId]);
}

async function roleIn(q, crewId, userId) {
  const row = await q.one('select role from crew_members where crew_id = $1 and user_id = $2', [crewId, userId]);
  return row ? row.role : null;
}

/** The crew, if the runner leads it; otherwise the error the app shows. */
async function ledBy(q, crewId, userId, message) {
  const crew = await q.one('select * from crews where id = $1 for update', [crewId]);
  if (!crew) throw fail.notFound('That crew is gone.');
  if ((await roleIn(q, crewId, userId)) !== 'leader') throw fail.forbidden(message || 'Only the captain can do that.');
  return crew;
}

/** The three missions with this crew's size priced in, from crew.js. */
async function missionOptions(q, crewId) {
  const heads = (await q.one('select count(*) as n from crew_members where crew_id = $1', [crewId])).n;
  return Crew.missionOptions({ members: new Array(Math.max(1, heads)).fill(0) });
}

module.exports = {
  WEEK, memberStats, missionHave, settle, afterRun, crewView, crewOf, roleIn, ledBy, missionOptions, distanceBetween,
};
