'use strict';

/* The request pipeline: CORS, the router, body parsing, authentication, a
   rate-limit ceiling, then the route — and one line of log per request. */

const { HttpError, fail, send, sendError, parseBody, createRouter, KB } = require('./http');
const { authenticate, bearer } = require('./auth');
const { createLimiter } = require('./limits');
const { createMailer } = require('./mailer');

const ROUTES = ['account', 'runs', 'land', 'crews', 'friends', 'races', 'moderation', 'billing', 'admin', 'pages'];

function corsHeaders(req, config) {
  const origin = req.headers.origin;
  const any = config.corsOrigins.indexOf('*') >= 0;
  if (!origin && !any) return {};
  const allowed = any ? '*' : config.corsOrigins.indexOf(origin) >= 0 ? origin : null;
  if (!allowed) return { vary: 'origin' };
  return {
    'access-control-allow-origin': allowed,
    'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-max-age': '600',
    vary: 'origin',
  };
}

function clientIp(req, config) {
  if (config.trustProxy) {
    // The proxy in front of us appends the address it saw; that one is ours to trust.
    const fly = req.headers['fly-client-ip'];
    if (fly) return String(fly);
    const fwd = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (fwd.length) return fwd[fwd.length - 1];
  }
  return req.socket.remoteAddress || 'unknown';
}

function createApp(deps) {
  const config = deps.config;
  const db = deps.db;
  const limiter = createLimiter(config.rateLimitScale);
  const mailer = createMailer(config, deps.mailer);
  const router = createRouter();
  const app = { config, db, limiter, mailer, live: deps.live || null, log: deps.log || console };

  ROUTES.forEach((name) => require('./routes/' + name)(router, app));

  async function handle(req, res) {
    const started = Date.now();
    const cors = corsHeaders(req, config);
    let path = '/';
    let status = 500;
    try {
      const url = new URL(req.url, 'http://localhost');
      path = url.pathname;
      if (req.method === 'OPTIONS') {
        status = 204;
        res.writeHead(204, cors);
        res.end();
        return;
      }
      const found = router.match(req.method, path);
      if (!found.route) {
        if (found.allowed.length) throw new HttpError(405, 'method_not_allowed', `Use ${found.allowed.join(' or ')} here.`);
        throw fail.notFound('No such endpoint.');
      }
      const { route, params } = found;
      const ip = clientIp(req, config);
      // A ceiling on everything, per address. The tighter limits on signing
      // in and resetting passwords live in their own routes.
      if (!limiter.take('ip:' + ip, 600, 60 * 1000)) throw fail.tooMany();

      const ctx = Object.assign({}, app, {
        req, params, ip,
        query: Object.fromEntries(url.searchParams),
        user: null,
      });
      const auth = route.options.auth === undefined ? true : route.options.auth;
      if (auth) {
        const token = bearer(req);
        ctx.user = token ? await authenticate(db, token) : null;
        if (!ctx.user && auth !== 'optional') throw fail.unauthorized(token ? 'Your session has ended. Sign in again.' : 'Sign in first.');
        if (ctx.user && !limiter.take('user:' + ctx.user.id, 300, 60 * 1000)) throw fail.tooMany();
      }
      ctx.body = await parseBody(req, route.options.limit || 32 * KB);

      const result = await route.handler(ctx);
      status = (result && result.status) || 200;
      send(res, result, cors);
    } catch (err) {
      status = err.status || 500;
      if (status === 500) app.log.error(`[api] ${req.method} ${path}:`, err && err.stack ? err.stack : err);
      if (!res.headersSent) sendError(res, err, cors);
      else res.end();
    } finally {
      if (config.logRequests) app.log.log(`${req.method} ${path} ${status} ${Date.now() - started}ms`);
    }
  }

  return {
    handle,
    router,
    app,
    close() { limiter.close(); },
  };
}

module.exports = { createApp };
