'use strict';

/* The map: whatever is claimed inside a view, your own claims, who has taken
   your ground, and naming a plot of your own. */

const v = require('../validate');
const { fail } = require('../http');
const filter = require('../filter');
const land = require('../services/land');
const { can, requireFeature } = require('../services/entitlements');

// The widest view the map asks for in one go: about 65 km across.
const MAX_SPAN = 0.6;

function parseBbox(text) {
  const parts = String(text || '').split(',').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    throw fail.invalid('bbox has to be west,south,east,north.');
  }
  const [w, s, e, n] = parts;
  if (s < -90 || n > 90 || w < -180 || e > 180 || s >= n || w >= e) throw fail.invalid('That bbox is not a box on the map.');
  if (n - s > MAX_SPAN || e - w > MAX_SPAN) throw fail.invalid('That view is too wide. Zoom in.', 'too_wide');
  return { minLng: w, minLat: s, maxLng: e, maxLat: n };
}

module.exports = function landRoutes(router) {
  router.get('/v1/land', async (ctx) => {
    const { db, user, query } = ctx;
    const box = parseBbox(query.bbox);
    const history = query.history === '1' || query.history === 'true';
    // Land that has already been taken in full is the time machine's to show.
    if (history) await requireFeature(db, user, 'timeMachine', 'The time machine is part of Pro.');
    return { claims: await land.landIn(db, box, user.id, { history }) };
  });

  router.get('/v1/land/mine', async (ctx) => ({ claims: await land.claimsOf(ctx.db, ctx.user.id) }));

  /* How much of your ground has been taken is free to know; who took it is Pro. */
  router.get('/v1/land/raiders', async (ctx) => {
    const { db, user } = ctx;
    const found = await land.raidersOf(db, user.id);
    return { lost: found.lost, raiders: (await can(db, user, 'raiders')) ? found.raiders : null };
  });

  /* Naming and colouring your own plot — what Supporter buys. */
  router.patch('/v1/claims/:id', async (ctx) => {
    const { db, user, params, body } = ctx;
    const id = v.uuid(params.id, 'That plot');
    await requireFeature(db, user, 'plotStyle', 'Naming your ground is part of Supporter.');
    const name = body.name === undefined ? undefined
      : body.name === null ? null
        : filter.assertClean(v.str(body.name, { label: 'The name', max: 28 }), 'name') || null;
    const color = body.color === undefined ? undefined
      : body.color === null ? null
        : /^#[0-9a-f]{6}$/i.test(body.color) ? body.color.toLowerCase() : (() => { throw fail.invalid('That colour is not a colour.'); })();
    const row = await db.one(
      `update claims set label = case when $3 then $4 else label end, color = case when $5 then $6 else color end
        where id = $1 and user_id = $2 returning id`,
      [id, user.id, name !== undefined, name, color !== undefined, color]);
    if (!row) throw fail.notFound('That plot does not exist.');
    const mine = await land.claimsOf(db, user.id);
    return { claim: mine.find((c) => c.id === id) };
  });
};
