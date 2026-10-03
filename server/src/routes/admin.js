'use strict';

/* The moderation desk and a few levers, behind ADMIN_TOKEN. With no token
   configured, none of this exists.

   Every report can be resolved with an action that fits what was reported:
   a runner can be renamed or banned, a crew reset or deleted, a notice
   hidden, a run or a plot removed — or the report dismissed. */

const v = require('../validate');
const { fail, reply } = require('../http');
const { safeEqual, bearer } = require('../auth');
const { Pro } = require('../shared');
const land = require('../services/land');

const ACTIONS = {
  user: ['dismiss', 'rename', 'ban'],
  crew: ['dismiss', 'reset', 'delete'],
  notice: ['dismiss', 'hide'],
  run: ['dismiss', 'delete'],
  claim: ['dismiss', 'reset', 'delete'],
};

/** Bans a runner: no sign-in, no sessions, and their land leaves the map. */
async function ban(q, userId, reason) {
  const user = await q.one('update users set banned_at = now(), ban_reason = $2 where id = $1 returning id', [userId, reason || null]);
  if (!user) throw fail.notFound('No such runner.');
  await q.query('delete from sessions where user_id = $1', [userId]);
  await q.query('delete from friendships where user_id = $1 or friend_id = $1', [userId]);
  await land.removeClaims(q, await q.many('select id, min_lat, min_lng, max_lat, max_lng from claims where user_id = $1', [userId]));
}

async function act(q, report, action) {
  const id = report.target_id;
  const uuid = v.isUuid(id);
  if (action === 'dismiss') return;
  if (!uuid) throw fail.invalid('That report does not point at anything that can be acted on.');
  switch (`${report.target_type}:${action}`) {
    case 'user:rename':
      await q.query(`update users set name = 'Runner', initials = 'R' where id = $1`, [id]);
      return;
    case 'user:ban':
      await ban(q, id, `report ${report.id}: ${report.reason}`);
      return;
    case 'crew:reset':
      await q.query(
        `update crews set name = 'Unnamed crew', tagline = '', photo = null,
                schedule = jsonb_set(schedule, '{spot}', '"To be decided"') where id = $1`, [id]);
      return;
    case 'crew:delete':
      await q.query('delete from crews where id = $1', [id]);
      return;
    case 'notice:hide':
      await q.query('update crew_notices set hidden_at = now() where id = $1', [id]);
      return;
    case 'run:delete': {
      await q.query('select pg_advisory_xact_lock($1)', [land.LAND_LOCK]);
      await land.removeClaims(q, await q.many('select id, min_lat, min_lng, max_lat, max_lng from claims where run_id = $1', [id]));
      await q.query('delete from runs where id = $1', [id]);
      return;
    }
    case 'claim:reset':
      await q.query('update claims set label = null, color = null where id = $1', [id]);
      return;
    case 'claim:delete':
      await land.removeClaims(q, await q.many('select id, min_lat, min_lng, max_lat, max_lng from claims where id = $1', [id]));
      return;
    default:
      throw fail.invalid('That action does not fit that report.');
  }
}

module.exports = function adminRoutes(router, app) {
  const { config } = app;

  function guard(ctx) {
    if (!config.adminToken) throw fail.notFound('No such endpoint.');
    const token = bearer(ctx.req);
    if (!token || !safeEqual(token, config.adminToken)) throw fail.unauthorized('Admin token required.');
  }
  const admin = (handler) => async (ctx) => { guard(ctx); return handler(ctx); };

  router.get('/admin/reports', { auth: false }, admin(async (ctx) => {
    const status = ctx.query.status === 'resolved' ? 'resolved' : 'open';
    const rows = await ctx.db.many(
      `select r.*, u.name as reporter_name from reports r left join users u on u.id = r.reporter_id
        where r.status = $1 order by r.created_at asc limit 200`, [status]);
    return {
      reports: rows.map((r) => ({
        id: r.id, type: r.target_type, target: r.target_id, reason: r.reason, note: r.note,
        reporter: r.reporter_id ? { id: r.reporter_id, name: r.reporter_name } : null,
        createdAt: new Date(r.created_at).getTime(), status: r.status, resolution: r.resolution,
        actions: ACTIONS[r.target_type],
      })),
    };
  }));

  router.post('/admin/reports/:id/resolve', { auth: false }, admin(async (ctx) => {
    const id = v.uuid(ctx.params.id, 'That report');
    const action = String(ctx.body.action || '');
    await ctx.db.tx(async (q) => {
      const report = await q.one('select * from reports where id = $1 for update', [id]);
      if (!report) throw fail.notFound('No such report.');
      if (ACTIONS[report.target_type].indexOf(action) < 0) throw fail.invalid(`Pick one of: ${ACTIONS[report.target_type].join(', ')}.`);
      await act(q, report, action);
      // Every open report about the same thing is settled by the same decision.
      await q.query(
        `update reports set status = 'resolved', resolution = $3, resolved_at = now()
          where (id = $1 or (target_type = $2 and target_id = $4)) and status = 'open'`,
        [id, report.target_type, action + (ctx.body.note ? `: ${String(ctx.body.note).slice(0, 300)}` : ''), report.target_id]);
    });
    return { ok: true };
  }));

  router.post('/admin/users/:id/ban', { auth: false }, admin(async (ctx) => {
    const id = v.uuid(ctx.params.id, 'That runner');
    await ctx.db.tx((q) => ban(q, id, ctx.body.reason ? String(ctx.body.reason).slice(0, 300) : null));
    return { ok: true };
  }));

  router.post('/admin/users/:id/unban', { auth: false }, admin(async (ctx) => {
    const id = v.uuid(ctx.params.id, 'That runner');
    const row = await ctx.db.one('update users set banned_at = null, ban_reason = null where id = $1 returning id', [id]);
    if (!row) throw fail.notFound('No such runner.');
    return { ok: true };
  }));

  /* A plan granted by hand: the account App Review signs in with, a
     competition prize, a refund made good. */
  router.post('/admin/entitlements', { auth: false }, admin(async (ctx) => {
    const { body, db } = ctx;
    const plan = Pro.PLANS[body.plan];
    if (!plan) throw fail.invalid(`plan has to be one of: ${Object.keys(Pro.PLANS).join(', ')}.`);
    const days = v.num(body.days, { label: 'days', min: 1, max: 3650, integer: true });
    const user = body.userId
      ? await db.one('select id from users where id = $1', [v.uuid(body.userId, 'That runner')])
      : await db.one('select id from users where email_norm = $1', [v.emailNorm(body.email)]);
    if (!user) throw fail.notFound('No such runner.');
    await db.query(
      `insert into entitlements (user_id, plan, tier, expires_at, will_renew, source, updated_at)
       values ($1, $2, $3, now() + make_interval(days => $4), false, 'admin', now())
       on conflict (user_id) do update set plan = $2, tier = $3, expires_at = now() + make_interval(days => $4),
         will_renew = false, source = 'admin', updated_at = now()`,
      [user.id, plan.id, plan.tier, days]);
    return reply.json({ ok: true, userId: user.id }, 201);
  }));

  router.get('/admin/stats', { auth: false }, admin(async (ctx) => {
    const row = await ctx.db.one(
      `select (select count(*) from users) as runners,
              (select count(*) from users where created_at > now() - interval '7 days') as new_this_week,
              (select count(*) from runs) as runs,
              (select count(*) from claims where area > 0) as plots,
              (select count(*) from crews) as crews,
              (select count(*) from reports where status = 'open') as open_reports,
              (select min(created_at) from reports where status = 'open') as oldest_open_report`);
    return row;
  }));
};
