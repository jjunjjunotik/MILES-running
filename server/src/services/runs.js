'use strict';

/* A run as the app records it, checked before it is kept.

   The checks are the cheap ones that stop the obvious: a run in the future,
   one faster than anyone runs, one the app's simulator made up. They are not
   an anti-cheat system; they keep the map honest enough to play on. */

const v = require('../validate');
const { fail } = require('../http');
const { Geo } = require('../shared');
const filter = require('../filter');

const DAY = 864e5;
const MAX_AGE_DAYS = 60;              // a phone offline for two months can still catch up
const CLOSE_SLACK = 60;               // metres: the app closes at 30, plus simplification

/* Average speed limits, metres per second. The 1500 m world record is about
   7.3 m/s; nobody holds more than 7.5 for a kilometre or longer. */
function tooFast(distance, duration) {
  if (distance < 200) return false;
  if (duration <= 0) return true;
  const speed = distance / duration;
  return distance >= 1000 ? speed > 7.5 : speed > 10.5;
}

const ms = (d) => (d ? new Date(d).getTime() : null);

function cleanSplits(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, 400).map((sp) => ({
    km: v.num(sp && sp.km, { integer: true, min: 1, max: 400, label: 'A split' }),
    seconds: v.num(sp && sp.seconds, { min: 0, max: 86400, label: 'A split' }),
  }));
}

function cleanResults(list) {
  if (!Array.isArray(list)) return null;
  return list.slice(0, 20).map((r) => ({
    place: v.num(r.place, { integer: true, min: 1, max: 64, label: 'A place' }),
    name: v.str(r.name, { label: 'A name', min: 1, max: 24, clip: true }),
    me: r.me === true,
    initials: v.str(r.initials || '?', { max: 3, clip: true }),
    color: typeof r.color === 'string' && /^#[0-9a-f]{6}$/i.test(r.color) ? r.color : null,
    distance: v.num(r.distance, { min: 0, max: 300000, label: 'A distance' }),
    finishedAt: r.finishedAt === null || r.finishedAt === undefined ? null : v.num(r.finishedAt, { min: 0, max: 172800 }),
  }));
}

/**
 * Checks and normalises an uploaded run. Returns the run and, for a closed
 * territory loop worth claiming, the polygon to claim.
 */
function cleanRun(body, config, now) {
  const r = body || {};
  const t = now || Date.now();
  const kind = v.oneOf(r.kind, ['free', 'territory', 'race'], { label: 'The kind of run' });
  const startedAt = v.num(r.startedAt, { label: 'The start time' });
  if (startedAt > t + 5 * 60 * 1000) throw fail.invalid('That run starts in the future.', 'bad_time');
  if (startedAt < t - MAX_AGE_DAYS * DAY) throw fail.invalid('That run is too old to upload.', 'too_old');
  const distance = v.num(r.distance, { label: 'The distance', min: 0, max: 300000 });
  const duration = v.num(r.duration, { label: 'The time', min: 0, max: 48 * 3600 });
  if (startedAt + duration * 1000 > t + 10 * 60 * 1000) throw fail.invalid('That run ends in the future.', 'bad_time');
  if (tooFast(distance, duration)) throw fail.invalid('That run is faster than anyone can run.', 'too_fast');

  const source = v.oneOf(r.source || 'gps', ['gps', 'sim'], { label: 'The source' });
  if (source === 'sim' && !config.allowSimulatedRuns) {
    throw fail.invalid('A simulated run is not saved to your account. Run with GPS on.', 'simulated');
  }

  const run = {
    clientId: v.str(r.id, { label: 'The run id', min: 1, max: 64 }),
    kind,
    title: filter.assertClean(v.str(r.title || 'Run', { label: 'The title', min: 1, max: 60, clip: true }), 'title'),
    startedAt,
    distance,
    duration,
    elevation: r.elevation === null || r.elevation === undefined ? null : v.num(r.elevation, { label: 'The climb', min: 0, max: 20000 }),
    route: v.points(r.route || [], { label: 'The route', max: 20000 }),
    splits: cleanSplits(r.splits),
    loopClosed: kind === 'territory' && r.loopClosed === true,
    source,
    raceId: v.isUuid(r.raceId) ? r.raceId.toLowerCase() : null,
    target: kind === 'race' && r.target !== null && r.target !== undefined ? v.num(r.target, { min: 100, max: 100000, label: 'The race distance' }) : null,
    placing: kind === 'race' && r.placing ? v.num(r.placing, { integer: true, min: 1, max: 64, label: 'The place' }) : null,
    fieldSize: kind === 'race' && r.fieldSize ? v.num(r.fieldSize, { integer: true, min: 1, max: 64, label: 'The field' }) : null,
    finished: typeof r.finished === 'boolean' ? r.finished : null,
    results: kind === 'race' ? cleanResults(r.results) : null,
  };

  let polygon = null;
  if (run.loopClosed) {
    const ring = v.points(r.territoryPolygon || r.route, { label: 'The loop', min: 4, max: 20000 });
    // A stored ring repeats its first point at the end or not; either way
    // the two ends have to meet for it to be a loop.
    if (Geo.distance(ring[0], ring[ring.length - 1]) > CLOSE_SLACK) {
      throw fail.invalid('That loop does not come back to where it started.', 'open_loop');
    }
    polygon = ring;
  }

  return { run, polygon, claimedAt: Math.min(t, startedAt + duration * 1000) };
}

function runView(r) {
  return {
    id: r.client_id,
    serverId: r.id,
    startedAt: ms(r.started_at),
    kind: r.kind,
    title: r.title,
    distance: r.distance,
    duration: r.duration,
    elevation: r.elevation,
    route: r.route,
    splits: r.splits || [],
    loopClosed: r.loop_closed,
    claimedArea: r.claimed_area,
    source: r.source,
    raceId: r.race_id || null,
    target: r.target,
    placing: r.place,
    fieldSize: r.field_size,
    finished: r.finished,
    results: r.results || null,
    kudos: r.kudos_count === undefined ? 0 : r.kudos_count,
  };
}

/**
 * A route as other runners see it. The first and last 200 m are cut off,
 * because that is where a run starts and ends — usually somebody's front door.
 */
function trimRoute(route, metres) {
  const cut = metres === undefined ? 200 : metres;
  if (!Array.isArray(route) || route.length < 3) return [];
  const from = (list) => {
    let gone = 0;
    for (let i = 1; i < list.length; i++) {
      gone += Geo.distance(list[i - 1], list[i]);
      if (gone >= cut) return i;
    }
    return list.length;
  };
  const head = from(route);
  const tail = route.length - from(route.slice().reverse());
  return head < tail ? route.slice(head, tail) : [];
}

module.exports = { cleanRun, runView, trimRoute, tooFast };
