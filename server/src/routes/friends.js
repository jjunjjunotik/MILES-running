'use strict';

/* Friends, the feed of their runs, and kudos.

   A friend is added with their six-character code, and a friendship goes
   both ways at once. Knowing someone's code is the consent: there is no
   searching for runners by name, so nobody can be found who did not hand
   their code out. */

const v = require('../validate');
const { fail, reply } = require('../http');
const { memberStats } = require('../services/crews');
const { runView, trimRoute } = require('../services/runs');

const DAY = 864e5;
const FEED_DAYS = 30;

function since(query) {
  const now = Date.now();
  const week = Number(query.week);
  return Number.isFinite(week) && week > now - 8 * DAY && week <= now ? week : now - 7 * DAY;
}

const blockedEitherWay = `exists (select 1 from blocks b
  where (b.user_id = $1 and b.blocked_id = x.id) or (b.user_id = x.id and b.blocked_id = $1))`;

module.exports = function friendRoutes(router, app) {
  const { limiter } = app;

  router.get('/v1/friends', async (ctx) => {
    const { db, user, query } = ctx;
    const rows = await db.many(
      `select u.id, u.name, u.initials, f.created_at from friendships f join users u on u.id = f.friend_id
        where f.user_id = $1 and u.banned_at is null order by f.created_at`, [user.id]);
    const stats = await memberStats(db, rows.map((r) => r.id), since(query));
    return {
      code: user.friend_code,
      friends: rows.map((r) => Object.assign({
        id: r.id, name: r.name, initials: r.initials, since: new Date(r.created_at).getTime(),
        online: !!(ctx.live && ctx.live.isOnline(r.id)),
      }, stats.get(r.id))),
    };
  });

  router.post('/v1/friends', async (ctx) => {
    const { db, user, body, query } = ctx;
    if (!limiter.take('friend-code:' + user.id, 30, 60 * 60 * 1000)) throw fail.tooMany('Too many codes tried. Try again later.');
    const code = String(body.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const nobody = fail.notFound('No runner has that code. Check it with them.');
    if (code.length !== 6) throw nobody;
    if (code === user.friend_code) throw fail.invalid('That is your own code.', 'own_code');
    const x = await db.one(
      `select x.id, x.name, x.initials, ${blockedEitherWay} as blocked
         from users x where x.friend_code = $2 and x.banned_at is null`, [user.id, code]);
    // Blocked either way reads exactly like a wrong code.
    if (!x || x.blocked) throw nobody;
    await db.query(
      `insert into friendships (user_id, friend_id) values ($1, $2), ($2, $1) on conflict do nothing`, [user.id, x.id]);
    const stats = await memberStats(db, [x.id], since(query));
    return reply.json({
      friend: Object.assign({ id: x.id, name: x.name, initials: x.initials, online: !!(ctx.live && ctx.live.isOnline(x.id)) }, stats.get(x.id)),
    }, 201);
  });

  router.delete('/v1/friends/:id', async (ctx) => {
    const id = v.uuid(ctx.params.id, 'That friend');
    await ctx.db.query(
      'delete from friendships where (user_id = $1 and friend_id = $2) or (user_id = $2 and friend_id = $1)', [ctx.user.id, id]);
    return reply.empty();
  });

  /* Your friends' runs from the last month, newest first. Each route has its
     ends cut off, so the feed never shows anybody's front door. */
  router.get('/v1/feed', async (ctx) => {
    const { db, user, query } = ctx;
    const limit = v.num(query.limit, { optional: 30, integer: true, min: 1, max: 100, label: 'limit' });
    const before = v.num(query.before, { optional: Date.now() + DAY, label: 'before' });
    const rows = await db.many(
      `select r.*, u.name, u.initials,
              (select count(*) from kudos k where k.run_id = r.id) as kudos_count,
              exists (select 1 from kudos k where k.run_id = r.id and k.user_id = $1) as kudos_mine
         from runs r
         join friendships f on f.friend_id = r.user_id and f.user_id = $1
         join users u on u.id = r.user_id
        where u.banned_at is null
          and r.started_at < $2 and r.started_at > now() - make_interval(days => $4)
          and not exists (select 1 from blocks b where (b.user_id = $1 and b.blocked_id = r.user_id)
                                                  or (b.user_id = r.user_id and b.blocked_id = $1))
        order by r.started_at desc limit $3`,
      [user.id, new Date(before), limit, FEED_DAYS]);
    return {
      items: rows.map((r) => {
        const activity = runView(r);
        activity.route = trimRoute(activity.route);
        delete activity.results;
        delete activity.source;
        return {
          who: { id: r.user_id, name: r.name, initials: r.initials },
          activity,
          kudos: r.kudos_count,
          kudosMine: r.kudos_mine,
        };
      }),
    };
  });

  /* Kudos, for a friend's run. */
  async function friendRun(ctx) {
    const id = v.uuid(ctx.params.id, 'That run');
    const run = await ctx.db.one(
      `select r.id from runs r join friendships f on f.friend_id = r.user_id and f.user_id = $2 where r.id = $1`, [id, ctx.user.id]);
    if (!run) throw fail.notFound('That run is not one you can see.');
    return id;
  }
  const count = async (db, id) => (await db.one('select count(*) as n from kudos where run_id = $1', [id])).n;

  router.post('/v1/runs/:id/kudos', async (ctx) => {
    const id = await friendRun(ctx);
    await ctx.db.query('insert into kudos (run_id, user_id) values ($1, $2) on conflict do nothing', [id, ctx.user.id]);
    return { kudos: await count(ctx.db, id), kudosMine: true };
  });

  router.delete('/v1/runs/:id/kudos', async (ctx) => {
    const id = await friendRun(ctx);
    await ctx.db.query('delete from kudos where run_id = $1 and user_id = $2', [id, ctx.user.id]);
    return { kudos: await count(ctx.db, id), kudosMine: false };
  });
};
