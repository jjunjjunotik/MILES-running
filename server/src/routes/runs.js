'use strict';

/* Uploading, listing and deleting your runs. A closed territory loop claims
   its ground as part of the upload, in the same transaction. */

const v = require('../validate');
const { fail, reply, KB } = require('../http');
const { cleanRun, runView } = require('../services/runs');
const land = require('../services/land');
const crews = require('../services/crews');

module.exports = function runs(router, app) {
  const { config, limiter } = app;

  async function claimFor(q, runRow, userId) {
    const row = await q.one(
      `select c.*, u.name, u.initials, m.crew_id, false as hidden
         from claims c join users u on u.id = c.user_id
         left join crew_members m on m.user_id = c.user_id
        where c.run_id = $1`, [runRow.id]);
    return row ? land.claimView(row, userId) : null;
  }

  /* The same run uploaded twice — a retry after a dropped connection — is
     the same run: the second upload answers with the first. */
  router.post('/v1/runs', { limit: 1024 * KB }, async (ctx) => {
    const { body, db, user } = ctx;
    if (!limiter.take('runs:' + user.id, 120, 60 * 60 * 1000)) throw fail.tooMany('That is a lot of runs. Try again later.');
    const { run, polygon, claimedAt } = cleanRun(body.run || body, config);

    const result = await db.tx(async (q) => {
      const existing = await q.one('select * from runs where user_id = $1 and client_id = $2', [user.id, run.clientId]);
      if (existing) return { status: 200, row: existing, crew: null };

      let raceId = run.raceId;
      if (raceId) {
        const entered = await q.one(
          `select 1 from races r where r.id = $1 and (r.host_id = $2 or exists
             (select 1 from race_entrants e where e.race_id = r.id and e.user_id = $2))`, [raceId, user.id]);
        if (!entered) raceId = null;
      }

      let row = await q.one(
        `insert into runs (user_id, client_id, kind, title, started_at, distance, duration, elevation, route, splits,
                           loop_closed, source, race_id, target, place, field_size, finished, results)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18) returning *`,
        [user.id, run.clientId, run.kind, run.title, new Date(run.startedAt), run.distance, run.duration, run.elevation,
          JSON.stringify(run.route), JSON.stringify(run.splits), run.loopClosed, run.source, raceId, run.target,
          run.placing, run.fieldSize, run.finished, run.results ? JSON.stringify(run.results) : null]);

      if (polygon && land.claimable(polygon).ok) {
        const claim = await land.insertClaim(q, { userId: user.id, runId: row.id, polygon, claimedAt });
        row = await q.one('update runs set claimed_area = $2 where id = $1 returning *', [row.id, claim.area]);
      }
      const crew = await crews.afterRun(q, user.id);
      return { status: 201, row, crew };
    });

    return reply.json({
      run: runView(result.row),
      claim: await claimFor(db, result.row, user.id),
      crew: result.crew,
    }, result.status);
  });

  router.get('/v1/runs', async (ctx) => {
    const { db, user, query } = ctx;
    const limit = v.num(query.limit, { optional: 100, integer: true, min: 1, max: 500, label: 'limit' });
    const before = v.num(query.before, { optional: Date.now() + 864e5, label: 'before' });
    const rows = await db.many(
      `select r.*, (select count(*) from kudos k where k.run_id = r.id) as kudos_count
         from runs r where r.user_id = $1 and r.started_at < $2 order by r.started_at desc limit $3`,
      [user.id, new Date(before), limit + 1]);
    const page = rows.slice(0, limit);
    return {
      runs: page.map(runView),
      next: rows.length > limit ? new Date(page[page.length - 1].started_at).getTime() : null,
    };
  });

  /* Deleting a run deletes its claim too, and gives back whatever that claim
     had taken from other runners. */
  router.delete('/v1/runs/:id', async (ctx) => {
    const { db, user, params } = ctx;
    const id = v.uuid(params.id, 'That run');
    const done = await db.tx(async (q) => {
      await q.query('select pg_advisory_xact_lock($1)', [land.LAND_LOCK]);
      const run = await q.one('select id from runs where id = $1 and user_id = $2', [id, user.id]);
      if (!run) return false;
      const claims = await q.many('select id, min_lat, min_lng, max_lat, max_lng from claims where run_id = $1', [id]);
      await land.removeClaims(q, claims);
      await q.query('delete from runs where id = $1', [id]);
      return true;
    });
    if (!done) throw fail.notFound('That run does not exist.');
    return reply.empty();
  });
};
