'use strict';

/* The HTTP plumbing, small enough to read in one go: a router with `:param`
   paths, a body reader with a size limit, typed replies and one error shape.
   Every error the API returns looks like { error: { code, message } }. */

class HttpError extends Error {
  constructor(status, code, message, extra) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra || null;
  }
}

const fail = {
  badRequest: (message, code) => new HttpError(400, code || 'bad_request', message),
  unauthorized: (message) => new HttpError(401, 'unauthorized', message || 'Sign in first.'),
  paymentRequired: (message, feature) => new HttpError(402, 'pro_required', message || 'That needs Pro.', feature ? { feature } : null),
  forbidden: (message) => new HttpError(403, 'forbidden', message || 'Not yours to do.'),
  notFound: (message) => new HttpError(404, 'not_found', message || 'Not found.'),
  conflict: (message, code) => new HttpError(409, code || 'conflict', message),
  gone: (message) => new HttpError(410, 'gone', message),
  invalid: (message, code) => new HttpError(422, code || 'invalid', message),
  tooMany: (message) => new HttpError(429, 'rate_limited', message || 'Too many tries. Wait a minute and try again.'),
};

/* --- Replies ------------------------------------------------------------- */

const REPLY = Symbol('reply');
const reply = {
  json: (body, status, headers) => ({ [REPLY]: 'json', status: status || 200, body, headers }),
  html: (body, status, headers) => ({ [REPLY]: 'html', status: status || 200, body, headers }),
  text: (body, status) => ({ [REPLY]: 'text', status: status || 200, body }),
  empty: (status) => ({ [REPLY]: 'empty', status: status || 204 }),
  redirect: (location, status) => ({ [REPLY]: 'redirect', status: status || 303, location }),
};

function send(res, result, extraHeaders) {
  const r = result && result[REPLY] ? result : reply.json(result === undefined ? {} : result);
  const headers = Object.assign({}, extraHeaders, r.headers);
  if (r[REPLY] === 'json') {
    const body = JSON.stringify(r.body);
    res.writeHead(r.status, Object.assign({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }, headers));
    res.end(body);
  } else if (r[REPLY] === 'html') {
    res.writeHead(r.status, Object.assign({
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      // The pages are plain documents: no scripts at all, and nothing framed.
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
    }, headers));
    res.end(r.body);
  } else if (r[REPLY] === 'text') {
    res.writeHead(r.status, Object.assign({ 'content-type': 'text/plain; charset=utf-8' }, headers));
    res.end(r.body);
  } else if (r[REPLY] === 'redirect') {
    res.writeHead(r.status, Object.assign({ location: r.location }, headers));
    res.end();
  } else {
    res.writeHead(r.status, headers);
    res.end();
  }
}

function sendError(res, err, extraHeaders) {
  const status = err.status || 500;
  const body = { error: { code: err.code || 'server_error', message: status === 500 ? 'Something went wrong on our side.' : err.message } };
  if (err.extra) Object.assign(body.error, err.extra);
  send(res, reply.json(body, status), extraHeaders);
}

/* --- Bodies -------------------------------------------------------------- */

const KB = 1024;

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length'] || 0);
    if (declared > limit) { reject(new HttpError(413, 'too_large', 'That is too big to send.')); req.resume(); return; }
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new HttpError(413, 'too_large', 'That is too big to send.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function parseBody(req, limit) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return {};
  const raw = await readBody(req, limit);
  if (!raw.length) return {};
  const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (type === 'application/x-www-form-urlencoded') {
    return Object.fromEntries(new URLSearchParams(raw.toString('utf8')));
  }
  try {
    const value = JSON.parse(raw.toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('not an object');
    return value;
  } catch (err) {
    throw new HttpError(400, 'bad_json', 'The request body is not a JSON object.');
  }
}

/* --- Router -------------------------------------------------------------- */

function createRouter() {
  const routes = [];

  function add(method, pattern, options, handler) {
    if (typeof options === 'function') { handler = options; options = {}; }
    const keys = [];
    const source = pattern
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\/:([a-zA-Z]+)/g, (_, key) => { keys.push(key); return '/([^/]+)'; });
    routes.push({ method, re: new RegExp('^' + source + '/?$'), keys, handler, options: options || {} });
  }

  return {
    get: (p, o, h) => add('GET', p, o, h),
    post: (p, o, h) => add('POST', p, o, h),
    put: (p, o, h) => add('PUT', p, o, h),
    patch: (p, o, h) => add('PATCH', p, o, h),
    delete: (p, o, h) => add('DELETE', p, o, h),

    /** The route for a request, or which methods the path does allow. */
    match(method, path) {
      const allowed = [];
      for (const route of routes) {
        const m = route.re.exec(path);
        if (!m) continue;
        if (route.method !== method && !(method === 'HEAD' && route.method === 'GET')) {
          allowed.push(route.method);
          continue;
        }
        const params = {};
        route.keys.forEach((key, i) => {
          try { params[key] = decodeURIComponent(m[i + 1]); } catch (err) { params[key] = m[i + 1]; }
        });
        return { route, params };
      }
      return { route: null, allowed };
    },
  };
}

module.exports = { HttpError, fail, reply, send, sendError, parseBody, createRouter, KB };
