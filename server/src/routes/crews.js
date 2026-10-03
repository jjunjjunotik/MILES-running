'use strict';

/* Crews: finding them, founding one (Pro), joining, and everything a captain
   does. Every change answers with the crew as it now stands, so the app can
   replace what it drew with the truth. */

const v = require('../validate');
const { fail, reply, KB } = require('../http');
const filter = require('../filter');
const { Crew } = require('../shared');
const crews = require('../services/crews');
const { requireFeature } = require('../services/entitlements');

const DAY = 864e5;
const NEARBY_KM = 50;

function since(query) {
  // The app sends the start of its own week (its Monday, in its own time
  // zone), so "this week" means the same thing on the screen and here.
  const now = Date.now();
  const week = Number(query.week);
  return Number.isFinite(week) && week > now - 8 * DAY && week <= now ? week : now - 7 * DAY;
}

function origin(query) {
  const lat = Number(query.lat);
  const lng = Number(query.lng);
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}

function cleanSchedule(input, base) {
  // Only what was actually sent replaces the default: a form that leaves the
  // time out gets 08:00, not a crew that meets at "undefined".
  const given = Object.fromEntries(Object.entries(input || {}).filter(([, value]) => value !== undefined && value !== null));
  const s = Object.assign({ days: ['Sat'], time: '08:00', spot: 'To be decided' }, base || {}, given);
  if (!Array.isArray(s.days)) throw fail.invalid('Pick the days the crew runs.');
  const days = Crew.DAYS.filter((d) => s.days.indexOf(d) >= 0);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(s.time))) throw fail.invalid('That is not a time of day.');
  const spot = filter.assertClean(v.str(s.spot, { label: 'Where you meet', max: 60 }), 'meeting spot') || 'To be decided';
  return { days: days.length ? days : ['Sat'], time: s.time, spot };
}

const PHOTO = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/;

module.exports = function crewRoutes(router) {
  const view = (ctx, crew) => crews.crewView(ctx.db, crew, ctx.user.id, { since: since(ctx.query), origin: origin(ctx.query) });

  async function viewById(ctx, id) {
    const crew = await ctx.db.one('select * from crews where id = $1', [id]);
    if (!crew) throw fail.notFound('That crew is gone.');
    return view(ctx, crew);
  }

  /* Yours, and the ones near where you are. */
  router.get('/v1/crews', async (ctx) => {
    const { db, user, query } = ctx;
    const mine = await crews.crewOf(db, user.id);
    if (mine) await db.tx((q) => crews.settle(q, mine.id));
    const here = origin(query);
    let nearby = [];
    if (here) {
      // Close enough on a city's scale: degrees of longitude shrink by cos(lat).
      const k = Math.cos(here.lat * Math.PI / 180);
      const span = NEARBY_KM / 111;
      nearby = await db.many(
        `select * from crews
          where id is distinct from $3::uuid
            and home_lat between $1::float8 - $4::float8 and $1::float8 + $4::float8
            and home_lng between $2::float8 - $4::float8 / $5::float8 and $2::float8 + $4::float8 / $5::float8
          order by power(home_lat - $1::float8, 2) + power((home_lng - $2::float8) * $5::float8, 2)
          limit 20`, [here.lat, here.lng, mine ? mine.id : null, span, k]);
    }
    const fresh = mine ? await db.one('select * from crews where id = $1', [mine.id]) : null;
    return {
      mine: fresh ? await view(ctx, fresh) : null,
      nearby: await Promise.all(nearby.map((c) => view(ctx, c))),
    };
  });

  router.get('/v1/crews/:id', async (ctx) => viewById(ctx, v.uuid(ctx.params.id, 'That crew')));

  /* Founding a crew is Pro; joining one never is. */
  router.post('/v1/crews', async (ctx) => {
    const { db, user, body } = ctx;
    await requireFeature(db, user, 'crewCreate', 'Founding a crew is part of Pro. Joining one is free.');
    const name = filter.assertClean(v.str(body.name, { label: 'A crew name', min: 1, max: 28 }), 'crew name');
    const tagline = filter.assertClean(v.str(body.tagline || '', { label: 'The tagline', max: 60 }), 'tagline') || 'Newly founded.';
    const schedule = cleanSchedule({ days: body.days, time: body.time, spot: body.spot });
    const home = v.latlng(body.home, 'Where the crew runs');
    const color = Crew.COLORS[Math.floor(Math.random() * Crew.COLORS.length)];

    const crew = await db.tx(async (q) => {
      if (await crews.crewOf(q, user.id)) throw fail.conflict('Leave your current crew first.', 'in_a_crew');
      const row = await q.one(
        `insert into crews (name, tagline, color, home_lat, home_lng, schedule, open_join)
         values ($1, $2, $3, $4, $5, $6, $7) returning *`,
        [name, tagline, color, home.lat, home.lng, JSON.stringify(schedule), body.openJoin !== false]);
      await q.query(`insert into crew_members (crew_id, user_id, role) values ($1, $2, 'leader')`, [row.id, user.id]);
      await q.query('delete from crew_requests where user_id = $1', [user.id]);
      return row;
    });
    return reply.json({ crew: await view(ctx, crew) }, 201);
  });

  /* An open crew lets you straight in; a closed one gets a request. */
  router.post('/v1/crews/:id/join', async (ctx) => {
    const { db, user } = ctx;
    const id = v.uuid(ctx.params.id, 'That crew');
    const pending = await db.tx(async (q) => {
      const crew = await q.one('select * from crews where id = $1 for update', [id]);
      if (!crew) throw fail.notFound('That crew is gone.');
      if (await crews.crewOf(q, user.id)) throw fail.conflict('You are already in a crew.', 'in_a_crew');
      if (!crew.open_join) {
        await q.query('insert into crew_requests (crew_id, user_id) values ($1, $2) on conflict do nothing', [id, user.id]);
        return true;
      }
      await q.query(`insert into crew_members (crew_id, user_id, role) values ($1, $2, 'member')`, [id, user.id]);
      await q.query('delete from crew_requests where user_id = $1', [user.id]);
      return false;
    });
    return { crew: await viewById(ctx, id), pending };
  });

  router.delete('/v1/crews/:id/request', async (ctx) => {
    const id = v.uuid(ctx.params.id, 'That crew');
    await ctx.db.query('delete from crew_requests where crew_id = $1 and user_id = $2', [id, ctx.user.id]);
    return { crew: await viewById(ctx, id) };
  });

  /* A captain with a crew behind them hands it over first; a captain alone
     takes the crew with them. */
  router.post('/v1/crews/:id/leave', async (ctx) => {
    const { db, user } = ctx;
    const id = v.uuid(ctx.params.id, 'That crew');
    const disbanded = await db.tx(async (q) => {
      const crew = await q.one('select * from crews where id = $1 for update', [id]);
      if (!crew) throw fail.notFound('That crew is gone.');
      const role = await crews.roleIn(q, id, user.id);
      if (!role) throw fail.conflict('You are not in that crew.', 'not_member');
      const count = (await q.one('select count(*) as n from crew_members where crew_id = $1', [id])).n;
      if (role === 'leader' && count > 1) throw fail.conflict('Hand the crew to someone else before you leave.', 'hand_over_first');
      if (role === 'leader') { await q.query('delete from crews where id = $1', [id]); return true; }
      await q.query('delete from crew_members where crew_id = $1 and user_id = $2', [id, user.id]);
      return false;
    });
    return disbanded ? { disbanded: true } : { crew: await viewById(ctx, id) };
  });

  /* --- The captain's tools ------------------------------------------------- */

  router.post('/v1/crews/:id/requests/:userId/approve', async (ctx) => {
    const { db, user, params } = ctx;
    const id = v.uuid(params.id, 'That crew');
    const who = v.uuid(params.userId, 'That runner');
    await db.tx(async (q) => {
      await crews.ledBy(q, id, user.id);
      const request = await q.one('select 1 from crew_requests where crew_id = $1 and user_id = $2', [id, who]);
      if (!request) throw fail.notFound('That request is gone.');
      if (await crews.crewOf(q, who)) {
        await q.query('delete from crew_requests where crew_id = $1 and user_id = $2', [id, who]);
        throw fail.conflict('They joined another crew in the meantime.', 'in_a_crew');
      }
      await q.query(`insert into crew_members (crew_id, user_id, role) values ($1, $2, 'member')`, [id, who]);
      await q.query('delete from crew_requests where user_id = $1', [who]);
    });
    return { crew: await viewById(ctx, id) };
  });

  router.post('/v1/crews/:id/requests/:userId/decline', async (ctx) => {
    const { db, user, params } = ctx;
    const id = v.uuid(params.id, 'That crew');
    const who = v.uuid(params.userId, 'That runner');
    await db.tx(async (q) => {
      await crews.ledBy(q, id, user.id);
      await q.query('delete from crew_requests where crew_id = $1 and user_id = $2', [id, who]);
    });
    return { crew: await viewById(ctx, id) };
  });

  router.patch('/v1/crews/:id/members/:userId', async (ctx) => {
    const { db, user, params, body } = ctx;
    const id = v.uuid(params.id, 'That crew');
    const who = v.uuid(params.userId, 'That runner');
    const role = v.oneOf(body.role, ['pacer', 'member'], { label: 'The role' });
    await db.tx(async (q) => {
      await crews.ledBy(q, id, user.id);
      if (who === user.id) throw fail.conflict('Hand the crew over instead.', 'self');
      const row = await q.one(`update crew_members set role = $3 where crew_id = $1 and user_id = $2 returning 1`, [id, who, role]);
      if (!row) throw fail.notFound('They are not in the crew.');
    });
    return { crew: await viewById(ctx, id) };
  });

  router.delete('/v1/crews/:id/members/:userId', async (ctx) => {
    const { db, user, params } = ctx;
    const id = v.uuid(params.id, 'That crew');
    const who = v.uuid(params.userId, 'That runner');
    await db.tx(async (q) => {
      await crews.ledBy(q, id, user.id);
      if (who === user.id) throw fail.conflict('You cannot remove yourself.', 'self');
      await q.query('delete from crew_members where crew_id = $1 and user_id = $2', [id, who]);
    });
    return { crew: await viewById(ctx, id) };
  });

  router.post('/v1/crews/:id/handover', async (ctx) => {
    const { db, user, params, body } = ctx;
    const id = v.uuid(params.id, 'That crew');
    const who = v.uuid(body.userId, 'That runner');
    await db.tx(async (q) => {
      await crews.ledBy(q, id, user.id);
      if (who === user.id) throw fail.conflict('You are already the captain.', 'self');
      if (!(await crews.roleIn(q, id, who))) throw fail.notFound('They are not in the crew.');
      // One captain at a time: step down before they step up.
      await q.query(`update crew_members set role = 'member' where crew_id = $1 and user_id = $2`, [id, user.id]);
      await q.query(`update crew_members set role = 'leader' where crew_id = $1 and user_id = $2`, [id, who]);
    });
    return { crew: await viewById(ctx, id) };
  });

  router.patch('/v1/crews/:id', { limit: 400 * KB }, async (ctx) => {
    const { db, user, params, body } = ctx;
    const id = v.uuid(params.id, 'That crew');
    await db.tx(async (q) => {
      const crew = await crews.ledBy(q, id, user.id);
      const next = {
        name: body.name === undefined ? crew.name
          : filter.assertClean(v.str(body.name, { label: 'A crew name', min: 1, max: 28 }), 'crew name'),
        tagline: body.tagline === undefined ? crew.tagline
          : filter.assertClean(v.str(body.tagline, { label: 'The tagline', max: 60 }), 'tagline'),
        schedule: body.schedule === undefined ? crew.schedule : cleanSchedule(body.schedule, crew.schedule),
        openJoin: body.openJoin === undefined ? crew.open_join : v.bool(body.openJoin, { label: 'Who can join' }),
        photo: crew.photo,
      };
      if (body.photo !== undefined) {
        if (body.photo === null) next.photo = null;
        else if (typeof body.photo === 'string' && PHOTO.test(body.photo) && body.photo.length <= 300 * KB) next.photo = body.photo;
        else throw fail.invalid('That photo cannot be used. Pick a JPEG or PNG.');
      }
      await q.query(
        `update crews set name = $2, tagline = $3, schedule = $4, open_join = $5, photo = $6 where id = $1`,
        [id, next.name, next.tagline, JSON.stringify(next.schedule), next.openJoin, next.photo]);
    });
    return { crew: await viewById(ctx, id) };
  });

  router.delete('/v1/crews/:id', async (ctx) => {
    const { db, user, params } = ctx;
    const id = v.uuid(params.id, 'That crew');
    await db.tx(async (q) => {
      await crews.ledBy(q, id, user.id);
      const count = (await q.one('select count(*) as n from crew_members where crew_id = $1', [id])).n;
      if (count > 1) throw fail.conflict('Hand the crew to someone else first — it has other runners in it.', 'hand_over_first');
      await q.query('delete from crews where id = $1', [id]);
    });
    return { disbanded: true };
  });

  /* The notice board: the captain writes, the crew reads. */
  router.post('/v1/crews/:id/notices', async (ctx) => {
    const { db, user, params, body } = ctx;
    const id = v.uuid(params.id, 'That crew');
    const text = filter.assertClean(v.str(body.text, { label: 'A notice', min: 1, max: 280, multiline: true }), 'notice');
    await db.tx(async (q) => {
      await crews.ledBy(q, id, user.id, 'Only the captain can post a notice.');
      await q.query('insert into crew_notices (crew_id, author_id, text) values ($1, $2, $3)', [id, user.id, text]);
      // The board keeps the latest twenty.
      await q.query(
        `delete from crew_notices where crew_id = $1 and id not in
           (select id from crew_notices where crew_id = $1 order by created_at desc limit 20)`, [id]);
    });
    return reply.json({ crew: await viewById(ctx, id) }, 201);
  });

  router.delete('/v1/crews/:id/notices/:noticeId', async (ctx) => {
    const { db, user, params } = ctx;
    const id = v.uuid(params.id, 'That crew');
    const noticeId = v.uuid(params.noticeId, 'That notice');
    await db.tx(async (q) => {
      await crews.ledBy(q, id, user.id, 'Only the captain can remove a notice.');
      await q.query('delete from crew_notices where id = $1 and crew_id = $2', [noticeId, id]);
    });
    return { crew: await viewById(ctx, id) };
  });

  /* This week's mission. `week` is the start of the captain's week, the same
     number crew.js keys missions by. */
  router.put('/v1/crews/:id/mission', async (ctx) => {
    const { db, user, params, body } = ctx;
    const id = v.uuid(params.id, 'That crew');
    const now = Date.now();
    const week = v.num(body.week, { label: 'The week' });
    if (week > now + DAY || week < now - 8 * DAY) throw fail.invalid('That is not this week.');
    await db.tx(async (q) => {
      const crew = await crews.ledBy(q, id, user.id, 'Only the captain sets the mission.');
      const option = (await crews.missionOptions(q, id)).find((o) => o.key === body.key);
      if (!option) throw fail.invalid('Unknown mission.');
      if (crew.mission && crew.mission.week === week && crew.mission.completedAt) {
        throw fail.conflict('This week is already cleared. The next one starts Monday.', 'cleared');
      }
      const mission = {
        week, key: option.key, type: option.def.key, heads: option.heads,
        target: option.target, xp: option.xp, setAt: now, completedAt: null,
      };
      await q.query('update crews set mission = $2 where id = $1', [id, JSON.stringify(mission)]);
      // Set late in a strong week, it may already be cleared.
      await crews.settle(q, id);
    });
    return { crew: await viewById(ctx, id) };
  });
};
