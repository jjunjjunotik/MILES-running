'use strict';

/* Checks for what the app sends. Each one returns the clean value or throws a
   422 whose message can be shown to the runner as it is. */

const { fail } = require('./http');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function str(value, opts) {
  const o = opts || {};
  if (value === undefined || value === null) {
    if (o.optional) return undefined;
    throw fail.invalid(o.message || `${o.label || 'That'} is missing.`);
  }
  if (typeof value !== 'string') throw fail.invalid(o.message || `${o.label || 'That'} has to be text.`);
  // Control characters have no business in a name or a notice; line breaks
  // are allowed only where a multi-line field asks for them.
  let v = value.replace(o.multiline ? /[\u0000-\u0009\u000b-\u001f\u007f]/g : /[\u0000-\u001f\u007f]/g, '');
  if (o.trim !== false) v = v.trim();
  if (o.min !== undefined && v.length < o.min) {
    throw fail.invalid(o.message || (o.min <= 1 ? `${o.label || 'That'} needs something in it.` : `${o.label || 'That'} needs at least ${o.min} characters.`));
  }
  if (o.max !== undefined && v.length > o.max) {
    if (o.clip) v = v.slice(0, o.max).trim();
    else throw fail.invalid(o.message || `${o.label || 'That'} can be at most ${o.max} characters.`);
  }
  return v;
}

function num(value, opts) {
  const o = opts || {};
  if (value === undefined || value === null) {
    if (o.optional) return o.optional === true ? undefined : o.optional;
    throw fail.invalid(`${o.label || 'A number'} is missing.`);
  }
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n)) throw fail.invalid(`${o.label || 'That'} has to be a number.`);
  if (o.integer && !Number.isInteger(n)) throw fail.invalid(`${o.label || 'That'} has to be a whole number.`);
  if (o.min !== undefined && n < o.min) throw fail.invalid(`${o.label || 'That'} is too small.`);
  if (o.max !== undefined && n > o.max) throw fail.invalid(`${o.label || 'That'} is too large.`);
  return n;
}

function bool(value, opts) {
  const o = opts || {};
  if (value === undefined || value === null) {
    if (o.optional !== undefined) return o.optional;
    throw fail.invalid(`${o.label || 'That'} is missing.`);
  }
  if (typeof value !== 'boolean') throw fail.invalid(`${o.label || 'That'} has to be true or false.`);
  return value;
}

function oneOf(value, list, opts) {
  const o = opts || {};
  if ((value === undefined || value === null) && o.optional) return undefined;
  if (list.indexOf(value) < 0) throw fail.invalid(o.message || `${o.label || 'That'} is not one of the choices.`);
  return value;
}

function uuid(value, label) {
  if (typeof value !== 'string' || !UUID.test(value)) throw fail.notFound(`${label || 'That'} does not exist.`);
  return value.toLowerCase();
}

function isUuid(value) {
  return typeof value === 'string' && UUID.test(value);
}

function latlng(p, label) {
  if (!p || typeof p !== 'object') throw fail.invalid(`${label || 'A point'} is missing.`);
  const lat = Number(p.lat);
  const lng = Number(p.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    throw fail.invalid(`${label || 'A point'} is not a place on Earth.`);
  }
  return { lat, lng };
}

/** A list of points. Only lat and lng are kept, rounded to ~1 cm. */
function points(list, opts) {
  const o = opts || {};
  if (!Array.isArray(list)) throw fail.invalid(`${o.label || 'The route'} has to be a list of points.`);
  if (o.min !== undefined && list.length < o.min) throw fail.invalid(`${o.label || 'The route'} is too short.`);
  if (o.max !== undefined && list.length > o.max) throw fail.invalid(`${o.label || 'The route'} has too many points.`);
  return list.map((p) => {
    const q = latlng(p, 'A point on ' + (o.label || 'the route').toLowerCase());
    return { lat: Math.round(q.lat * 1e7) / 1e7, lng: Math.round(q.lng * 1e7) / 1e7 };
  });
}

function email(value) {
  const v = str(value, { label: 'Email', min: 3, max: 254 });
  // Deliberately loose: one @, something either side, a dot in the domain.
  // The only real test of an address is sending something to it.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw fail.invalid('That does not look like an email address.');
  return v;
}

function emailNorm(value) {
  return String(value || '').trim().toLowerCase();
}

function password(value) {
  if (typeof value !== 'string') throw fail.invalid('Password is missing.');
  if (value.length < 8) throw fail.invalid('Use at least 8 characters for your password.');
  if (value.length > 128) throw fail.invalid('That password is too long.');
  return value;
}

/** "Mina Park" → "MP", the way the app works them out (state.js). */
function initialsOf(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  return words.slice(0, 2).map((w) => Array.from(w)[0]).join('').toUpperCase() || 'ME';
}

module.exports = { str, num, bool, oneOf, uuid, isUuid, latlng, points, email, emailNorm, password, initialsOf };
