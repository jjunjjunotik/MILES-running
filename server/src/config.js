'use strict';

/* Every setting the server reads, in one place. All of it comes from the
   environment, so the same image runs on a laptop and in production; see
   .env.example for what each one is for. */

function bool(value, fallback) {
  if (value === undefined || value === '') return fallback;
  return /^(1|true|yes|on)$/i.test(String(value));
}

function int(value, fallback) {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function load(env) {
  const e = env || process.env;
  return {
    port: int(e.PORT, 8080),
    databaseUrl: e.DATABASE_URL || 'postgres://miles:miles@127.0.0.1:5432/miles',
    // Where the server can be reached from outside: used in emails and on the
    // privacy, terms and account-deletion pages.
    publicUrl: (e.PUBLIC_URL || 'http://localhost:8080').replace(/\/+$/, ''),
    appName: e.APP_NAME || 'MILES',
    companyName: e.COMPANY_NAME || '',
    contactEmail: e.CONTACT_EMAIL || '',
    // Bearer token for /admin. Empty means /admin is switched off.
    adminToken: e.ADMIN_TOKEN || '',
    // Shared secret RevenueCat sends in its webhook's Authorization header.
    revenuecatSecret: e.REVENUECAT_WEBHOOK_SECRET || '',
    // Optional. RevenueCat's V1 secret key (sk_…), so the server can ask what
    // a runner has right after they buy instead of waiting for the webhook.
    // Newer RevenueCat projects only make V2 keys, which this cannot use.
    revenuecatApiKey: e.REVENUECAT_API_KEY || '',
    revenuecatApiUrl: (e.REVENUECAT_API_URL || 'https://api.revenuecat.com').replace(/\/+$/, ''),
    resendApiKey: e.RESEND_API_KEY || '',
    mailFrom: e.MAIL_FROM || '',
    // The app's simulator makes up runs when there is no GPS. Off in
    // production: a made-up run must never claim real ground.
    allowSimulatedRuns: bool(e.ALLOW_SIMULATED_RUNS, false),
    // Behind a load balancer the client's address is in X-Forwarded-For.
    trustProxy: bool(e.TRUST_PROXY, false),
    corsOrigins: (e.CORS_ORIGINS || '*').split(',').map((s) => s.trim()).filter(Boolean),
    logRequests: bool(e.LOG_REQUESTS, true),
    // scrypt's cost. 2^15 takes ~100 ms and 32 MB per hash; tests turn it down.
    scryptN: int(e.SCRYPT_N, 32768),
    // Multiplies every rate limit. Tests raise it; nothing else should.
    rateLimitScale: int(e.RATE_LIMIT_SCALE, 1),
  };
}

module.exports = { load };
