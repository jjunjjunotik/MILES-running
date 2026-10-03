'use strict';

/* Races with friends. The host picks a distance and who to race; the server
   keeps the field and sends each invitee the invite over the live channel the
   moment it exists. The race itself runs over that channel (live.js); each
   runner's result arrives with their run. */

const v = require('../validate');
const { fail, reply } = require('../http');
const { Pro } = require('../shared');
const { can } = require('../services/entitlements');

const INVITE_MINUTES = 30;
// The distances the app offers to everyone; anything else is Pro's custom distance.
const STANDARD = [1000, 3000, 5000, 10000];

async function raceView(q, race, live) {
  const people = await q.many(
    `select u.id, u.name, u.initials, (u.id = r.host_id) as host
       from races r
       join users u on u.id = r.host_id or u.id in (select user_id from race_entrants where race_id = r.id)
      where r.id = $1`, [race.id]);
  const host = people.find((p) => p.host);
  return {
    id: race.id,
    target: race.target,
    createdAt: new Date(race.created_at).getTime(),
    host: host ? { id: host.id, name: host.name, initials: host.initials } : null,
    entrants: people.filter((p) => !p.host).map((p) => ({
      id: p.id, name: p.name, initials: p.initials, online: !!(live && live.isOnline(p.id)),
    })),
  };
}

module.exports = function raceRoutes(router) {
  router.post('/v1/races', async (ctx) => {
    const { db, user, body } = ctx;
    const target = v.num(body.target, { label: 'The race distance', min: 100, max: 100000 });
    if (STANDARD.indexOf(target) < 0 && !(await can(db, user, 'customDistance'))) {
      throw fail.paymentRequired('A distance of your own is part of Pro.', 'customDistance');
    }
    if (!Array.isArray(body.rivals) || !body.rivals.length) throw fail.invalid('Pick at least one runner to race.');
    const rivals = Array.from(new Set(body.rivals.map((id) => v.uuid(id, 'That runner'))));
    const most = (await can(db, user, 'bigRaces')) ? Pro.MAX_RIVALS_PRO : Pro.MAX_RIVALS_FREE;
    if (rivals.length > most) {
      throw most === Pro.MAX_RIVALS_PRO
        ? fail.invalid(`A race holds you and ${most} others.`)
        : fail.paymentRequired(`A race of more than ${most} rivals is part of Pro.`, 'bigRaces');
    }
    const friends = await db.many(
      `select friend_id from friendships where user_id = $1 and friend_id = any($2::uuid[])
          and not exists (select 1 from blocks b where (b.user_id = $1 and b.blocked_id = friend_id)
                                                  or (b.user_id = friend_id and b.blocked_id = $1))`,
      [user.id, rivals]);
    if (friends.length !== rivals.length) throw fail.invalid('You can only race your friends.', 'not_friends');

    const race = await db.tx(async (q) => {
      const row = await q.one('insert into races (host_id, target) values ($1, $2) returning *', [user.id, target]);
      await q.query(
        'insert into race_entrants (race_id, user_id) select $1, unnest($2::uuid[])', [row.id, rivals]);
      return row;
    });
    const view = await raceView(db, race, ctx.live);
    if (ctx.live) ctx.live.notify(rivals, { type: 'invite', race: view });
    return reply.json({ race: view }, 201);
  });

  /* Races you have been invited to in the last half hour. */
  router.get('/v1/races/invites', async (ctx) => {
    const { db, user } = ctx;
    const rows = await db.many(
      `select r.* from races r join race_entrants e on e.race_id = r.id
        where e.user_id = $1 and r.created_at > now() - make_interval(mins => $2)
          and not exists (select 1 from runs x where x.user_id = $1 and x.race_id = r.id)
        order by r.created_at desc`, [user.id, INVITE_MINUTES]);
    return { races: await Promise.all(rows.map((r) => raceView(db, r, ctx.live))) };
  });

  router.get('/v1/races/:id', async (ctx) => {
    const { db, user, params } = ctx;
    const id = v.uuid(params.id, 'That race');
    const race = await db.one(
      `select r.* from races r where r.id = $1 and (r.host_id = $2 or exists
         (select 1 from race_entrants e where e.race_id = r.id and e.user_id = $2))`, [id, user.id]);
    if (!race) throw fail.notFound('That race does not exist.');
    return { race: await raceView(db, race, ctx.live) };
  });
};
