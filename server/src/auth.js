'use strict';

/* Passwords, session tokens and reset codes.

   Passwords are hashed with scrypt; the cost is stored with each hash, so it
   can be raised later and old hashes still verify. A session is 32 random
   bytes the app keeps; the database holds only its SHA-256. */

const crypto = require('crypto');
const { promisify } = require('util');

const scrypt = promisify(crypto.scrypt);

const SESSION_DAYS = 180;
// Touching last_used_at on every request would be a write per request.
const TOUCH_EVERY_MS = 60 * 60 * 1000;

async function hashPassword(password, N) {
  const cost = N || 32768;
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password.normalize('NFKC'), salt, 32, { N: cost, r: 8, p: 1, maxmem: 256 * cost * 8 });
  return ['scrypt', cost, 8, 1, salt.toString('base64'), key.toString('base64')].join('$');
}

async function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, saltB64, keyB64] = parts;
  const expected = Buffer.from(keyB64, 'base64');
  try {
    const key = await scrypt(String(password).normalize('NFKC'), Buffer.from(saltB64, 'base64'), expected.length, {
      N: Number(N), r: Number(r), p: Number(p), maxmem: 256 * Number(N) * Number(r),
    });
    return key.length === expected.length && crypto.timingSafeEqual(key, expected);
  } catch (err) {
    return false;
  }
}

/** Whether a stored hash was made with less work than we now ask for. */
function needsRehash(stored, N) {
  const parts = String(stored || '').split('$');
  return parts[0] !== 'scrypt' || Number(parts[1]) < (N || 32768);
}

const newToken = () => crypto.randomBytes(32).toString('base64url');
const sha256 = (value) => crypto.createHash('sha256').update(String(value)).digest();

async function createSession(q, userId, userAgent) {
  const token = newToken();
  await q.query(
    `insert into sessions (user_id, token_hash, user_agent, expires_at)
     values ($1, $2, $3, now() + make_interval(days => $4))`,
    [userId, sha256(token), userAgent ? String(userAgent).slice(0, 200) : null, SESSION_DAYS]);
  return token;
}

/** The runner a token belongs to, or null. Banned runners have no sessions. */
async function authenticate(q, token) {
  if (!token || typeof token !== 'string' || token.length > 100) return null;
  const row = await q.one(
    `select s.id as session_id, s.last_used_at, u.*
       from sessions s join users u on u.id = s.user_id
      where s.token_hash = $1 and s.expires_at > now()`,
    [sha256(token)]);
  if (!row || row.banned_at) return null;
  if (Date.now() - new Date(row.last_used_at).getTime() > TOUCH_EVERY_MS) {
    // Sliding expiry: a runner who opens the app stays signed in.
    await q.query(
      `update sessions set last_used_at = now(), expires_at = now() + make_interval(days => $2) where id = $1`,
      [row.session_id, SESSION_DAYS]);
  }
  return row;
}

function bearer(req) {
  const header = String(req.headers.authorization || '');
  const m = /^Bearer\s+(\S+)$/i.exec(header);
  return m ? m[1] : null;
}

/** Six digits, for the password reset email. */
function resetCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

/** Constant-time comparison of two strings of any length. */
function safeEqual(a, b) {
  const x = sha256(a);
  const y = sha256(b);
  return crypto.timingSafeEqual(x, y);
}

/* Friend codes: six characters from an alphabet with nothing to misread —
   no 0/O, no 1/I/L. 31^6 is just under 900 million. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function friendCode() {
  let out = '';
  for (let i = 0; i < 6; i++) out += CODE_ALPHABET[crypto.randomInt(0, CODE_ALPHABET.length)];
  return out;
}

module.exports = {
  hashPassword, verifyPassword, needsRehash, newToken, sha256, createSession, authenticate,
  bearer, resetCode, safeEqual, friendCode, SESSION_DAYS,
};
