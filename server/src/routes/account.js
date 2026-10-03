'use strict';

/* Signing up and in, the password, the profile, and the account itself. */

const v = require('../validate');
const { HttpError, fail, reply } = require('../http');
const filter = require('../filter');
const auth = require('../auth');
const { meView, cleanPrefs, deleteAccount, exportData } = require('../services/accounts');
const { startTrial } = require('../services/entitlements');

const RESET_MINUTES = 15;
const RESET_TRIES = 5;

module.exports = function account(router, app) {
  const { config, limiter } = app;

  async function newUser(db, { email, password, name, prefs }) {
    const hash = await auth.hashPassword(password, config.scryptN);
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        return await db.one(
          `insert into users (email, email_norm, password_hash, name, initials, friend_code, prefs, terms_accepted_at)
           values ($1, $2, $3, $4, $5, $6, $7, now()) returning *`,
          [email, v.emailNorm(email), hash, name, v.initialsOf(name), auth.friendCode(), JSON.stringify(cleanPrefs(prefs))]);
      } catch (err) {
        if (err.code === '23505' && /email_norm/.test(err.constraint || '')) {
          throw fail.conflict('There is already an account with that email. Sign in instead.', 'email_taken');
        }
        if (err.code === '23505' && /friend_code/.test(err.constraint || '')) continue;
        throw err;
      }
    }
    throw new Error('could not find a free friend code');
  }

  router.post('/v1/auth/signup', { auth: false }, async (ctx) => {
    const { body, db, ip } = ctx;
    if (!limiter.take('signup:' + ip, 20, 60 * 60 * 1000)) throw fail.tooMany('Too many new accounts from here. Try again later.');
    const email = v.email(body.email);
    const password = v.password(body.password);
    const name = filter.assertClean(v.str(body.name, { label: 'Your name', min: 1, max: 24 }), 'name');
    if (body.acceptTerms !== true) throw fail.invalid('Agree to the terms and the privacy policy to make an account.', 'terms_required');
    if (body.ageConfirmed !== true) throw fail.invalid('MILES is for runners aged 14 and over.', 'age_required');

    const user = await newUser(db, { email, password, name, prefs: body.prefs });
    const token = await auth.createSession(db, user.id, ctx.req.headers['user-agent']);
    return reply.json({ token, user: await meView(db, user) }, 201);
  });

  router.post('/v1/auth/login', { auth: false }, async (ctx) => {
    const { body, db, ip } = ctx;
    const norm = v.emailNorm(body.email);
    if (!limiter.take('login-ip:' + ip, 30, 60 * 1000) || !limiter.take('login:' + norm, 10, 15 * 60 * 1000)) {
      throw fail.tooMany('Too many tries. Wait a few minutes and try again.');
    }
    const user = norm ? await db.one('select * from users where email_norm = $1', [norm]) : null;
    // Hash something either way, so a wrong email takes as long as a wrong password.
    const ok = user
      ? await auth.verifyPassword(String(body.password || ''), user.password_hash)
      : (await auth.hashPassword('not a user', config.scryptN), false);
    if (!ok) throw new HttpError(401, 'bad_credentials', 'That email and password do not match.');
    if (user.banned_at) throw new HttpError(403, 'banned', 'This account has been suspended. Contact support if you think that is a mistake.');

    if (auth.needsRehash(user.password_hash, config.scryptN)) {
      await db.query('update users set password_hash = $2 where id = $1', [user.id, await auth.hashPassword(String(body.password), config.scryptN)]);
    }
    const token = await auth.createSession(db, user.id, ctx.req.headers['user-agent']);
    return { token, user: await meView(db, user) };
  });

  router.post('/v1/auth/logout', async (ctx) => {
    await ctx.db.query('delete from sessions where id = $1', [ctx.user.session_id]);
    return reply.empty();
  });

  /* --- Forgotten password: a six-digit code by email ------------------------ */

  router.post('/v1/auth/password/forgot', { auth: false }, async (ctx) => {
    const { body, db, ip } = ctx;
    const norm = v.emailNorm(body.email);
    if (!limiter.take('forgot-ip:' + ip, 10, 60 * 60 * 1000) || !limiter.take('forgot:' + norm, 3, 60 * 60 * 1000)) {
      throw fail.tooMany('Too many codes asked for. Try again in an hour.');
    }
    const user = norm ? await db.one('select * from users where email_norm = $1', [norm]) : null;
    if (user && !user.banned_at) {
      const code = auth.resetCode();
      await db.tx(async (q) => {
        await q.query('update password_resets set used_at = now() where user_id = $1 and used_at is null', [user.id]);
        await q.query(
          `insert into password_resets (user_id, code_hash, expires_at)
           values ($1, $2, now() + make_interval(mins => $3))`,
          [user.id, auth.sha256(user.id + ':' + code), RESET_MINUTES]);
      });
      // Not awaited: whether an email went out must not show in how long this takes.
      app.mailer.send({
        to: user.email,
        subject: `${config.appName} password reset code: ${code}`,
        text: `Your ${config.appName} code is ${code}.\n\nEnter it in the app within ${RESET_MINUTES} minutes to choose a new password. `
          + 'If you did not ask for it, ignore this email — your password has not changed.',
      }).catch((err) => app.log.error('[mail] reset code not sent:', err.message));
    }
    // The same answer whether or not there is such an account.
    return reply.json({ ok: true }, 202);
  });

  router.post('/v1/auth/password/reset', { auth: false }, async (ctx) => {
    const { body, db } = ctx;
    const norm = v.emailNorm(body.email);
    const code = String(body.code || '').replace(/\s+/g, '');
    const password = v.password(body.password);
    if (!limiter.take('reset:' + norm, 10, 60 * 60 * 1000)) throw fail.tooMany();
    const wrong = () => fail.invalid('That code is wrong or has expired. Ask for a new one.', 'bad_code');

    const user = norm ? await db.one('select * from users where email_norm = $1', [norm]) : null;
    if (!user || user.banned_at || !/^\d{6}$/.test(code)) throw wrong();
    const reset = await db.one(
      `select * from password_resets where user_id = $1 and used_at is null and expires_at > now()
        order by created_at desc limit 1`, [user.id]);
    if (!reset || reset.attempts >= RESET_TRIES) throw wrong();
    if (!auth.sha256(user.id + ':' + code).equals(reset.code_hash)) {
      await db.query('update password_resets set attempts = attempts + 1 where id = $1', [reset.id]);
      throw wrong();
    }

    const hash = await auth.hashPassword(password, config.scryptN);
    const token = await db.tx(async (q) => {
      await q.query('update users set password_hash = $2, updated_at = now() where id = $1', [user.id, hash]);
      await q.query('update password_resets set used_at = now() where id = $1', [reset.id]);
      // Whoever was signed in with the old password is not any more.
      await q.query('delete from sessions where user_id = $1', [user.id]);
      return auth.createSession(q, user.id, ctx.req.headers['user-agent']);
    });
    return { token, user: await meView(db, user) };
  });

  /* --- You ------------------------------------------------------------------ */

  router.get('/v1/me', async (ctx) => meView(ctx.db, ctx.user));

  router.patch('/v1/me', async (ctx) => {
    const { body, db, user } = ctx;
    const sets = [];
    const params = [user.id];
    if (body.name !== undefined) {
      const name = filter.assertClean(v.str(body.name, { label: 'Your name', min: 1, max: 24 }), 'name');
      params.push(name, v.initialsOf(name));
      sets.push(`name = $${params.length - 1}`, `initials = $${params.length}`);
    }
    if (body.prefs !== undefined) {
      params.push(JSON.stringify(cleanPrefs(body.prefs, user.prefs)));
      sets.push(`prefs = $${params.length}`);
    }
    if (!sets.length) return meView(db, user);
    const updated = await db.one(`update users set ${sets.join(', ')}, updated_at = now() where id = $1 returning *`, params);
    return meView(db, updated);
  });

  router.post('/v1/me/password', async (ctx) => {
    const { body, db, user } = ctx;
    if (!limiter.take('password:' + user.id, 10, 60 * 60 * 1000)) throw fail.tooMany();
    if (!(await auth.verifyPassword(String(body.current || ''), user.password_hash))) {
      throw new HttpError(401, 'bad_credentials', 'Your current password is not right.');
    }
    const next = v.password(body.password);
    await db.tx(async (q) => {
      await q.query('update users set password_hash = $2, updated_at = now() where id = $1', [user.id, await auth.hashPassword(next, config.scryptN)]);
      // Every other phone signs in again; this one stays.
      await q.query('delete from sessions where user_id = $1 and id <> $2', [user.id, user.session_id]);
    });
    return reply.empty();
  });

  router.post('/v1/me/trial', async (ctx) => {
    const updated = await startTrial(ctx.db, ctx.user);
    return meView(ctx.db, updated);
  });

  router.get('/v1/me/export', async (ctx) => {
    const data = await exportData(ctx.db, ctx.user);
    return reply.json(data, 200, { 'content-disposition': 'attachment; filename="miles-export.json"' });
  });

  /* Deleting the account asks for the password again: it cannot be undone,
     and a phone left unlocked should not be enough. */
  router.delete('/v1/me', async (ctx) => {
    const { body, db, user } = ctx;
    if (!limiter.take('delete:' + user.id, 10, 60 * 60 * 1000)) throw fail.tooMany();
    if (!(await auth.verifyPassword(String(body.password || ''), user.password_hash))) {
      throw new HttpError(401, 'bad_credentials', 'That password is not right.');
    }
    await deleteAccount(db, user.id);
    return reply.empty();
  });
};
