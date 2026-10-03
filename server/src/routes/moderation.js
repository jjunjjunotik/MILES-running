'use strict';

/* What the App Store asks of any app where people post things others see
   (guideline 1.2): a way to report it, a way to block whoever posted it, and
   someone who acts on reports. Reports land in the /admin queue and, if
   CONTACT_EMAIL is set, in that inbox too. */

const v = require('../validate');
const { fail, reply } = require('../http');

const TYPES = ['user', 'crew', 'notice', 'run', 'claim'];
const REASONS = ['spam', 'abuse', 'hate', 'sexual', 'violence', 'impersonation', 'cheating', 'other'];

module.exports = function moderationRoutes(router, app) {
  const { limiter, config } = app;

  router.post('/v1/reports', async (ctx) => {
    const { db, user, body } = ctx;
    if (!limiter.take('report:' + user.id, 20, 60 * 60 * 1000)) throw fail.tooMany('That is a lot of reports. Try again later.');
    const type = v.oneOf(body.type, TYPES, { label: 'What is being reported' });
    const id = v.str(body.id, { label: 'What is being reported', min: 1, max: 64 });
    const reason = v.oneOf(body.reason, REASONS, { label: 'The reason' });
    const note = v.str(body.note, { optional: true, label: 'The note', max: 500, multiline: true }) || null;
    if (type === 'user' && id === user.id) throw fail.invalid('You cannot report yourself.');

    const row = await db.one(
      `insert into reports (reporter_id, target_type, target_id, reason, note) values ($1, $2, $3, $4, $5) returning id`,
      [user.id, type, id, reason, note]);
    if (config.contactEmail) {
      app.mailer.send({
        to: config.contactEmail,
        subject: `${config.appName} report: ${reason} (${type})`,
        text: `A ${type} was reported for ${reason}.\n\nTarget: ${type} ${id}\nNote: ${note || '—'}\n\n`
          + `Review it at ${config.publicUrl}/admin/reports — the App Store expects action within 24 hours.`,
      }).catch((err) => app.log.error('[mail] report notice not sent:', err.message));
    }
    return reply.json({ ok: true, id: row.id }, 201);
  });

  router.get('/v1/blocks', async (ctx) => {
    const rows = await ctx.db.many(
      `select u.id, u.name, u.initials, b.created_at from blocks b join users u on u.id = b.blocked_id
        where b.user_id = $1 order by b.created_at desc`, [ctx.user.id]);
    return { blocked: rows.map((r) => ({ id: r.id, name: r.name, initials: r.initials, at: new Date(r.created_at).getTime() })) };
  });

  /* Blocking ends a friendship too; neither of you can add the other back. */
  router.post('/v1/blocks', async (ctx) => {
    const { db, user, body } = ctx;
    const id = v.uuid(body.userId, 'That runner');
    if (id === user.id) throw fail.invalid('You cannot block yourself.');
    if (!(await db.one('select 1 from users where id = $1', [id]))) throw fail.notFound('That runner does not exist.');
    await db.tx(async (q) => {
      await q.query('insert into blocks (user_id, blocked_id) values ($1, $2) on conflict do nothing', [user.id, id]);
      await q.query('delete from friendships where (user_id = $1 and friend_id = $2) or (user_id = $2 and friend_id = $1)', [user.id, id]);
    });
    return reply.json({ ok: true }, 201);
  });

  router.delete('/v1/blocks/:id', async (ctx) => {
    const id = v.uuid(ctx.params.id, 'That runner');
    await ctx.db.query('delete from blocks where user_id = $1 and blocked_id = $2', [ctx.user.id, id]);
    return reply.empty();
  });
};
