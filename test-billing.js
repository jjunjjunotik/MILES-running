// Paying for Supporter and Pro in the phone app, end to end: the real server
// (server/) on a database of its own, a stand-in for RevenueCat's REST API
// behind it, and a stand-in for the store on the phone — the
// @revenuecat/purchases-capacitor plugin as the app's WebView sees it. The
// app is served the way scripts/build-www.js ships it, with the server's
// address and the store keys written into its meta tags.
//
// Checked: the store learns who is buying; prices are the store's, in won;
// the renewal terms, Restore purchases, the terms and the privacy policy sit
// beside the offer; a cancelled purchase changes nothing; a purchase counts
// at once, and the profile shows it — and when it ends, once cancelled; an upgrade on Google Play replaces the old plan rather than
// running beside it; the same plan is not sold twice; managing opens the
// store's own page; a purchase made while the store's records lag still
// switches on; so does one in a RevenueCat project with only V2 secret keys,
// where it arrives by webhook alone; restoring with nothing to restore says
// so at once; restoring on an iPhone; signing out and in moves the store to
// the new account; and a web build with no store says so.
//   node test-billing.js
// Needs what test-online.js needs: Playwright, the server's dependencies and
// a Postgres where the role may create databases (TEST_DATABASE_URL).
const { chromium } = require('playwright');
const fs = require('fs');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { Client } = require('./server/node_modules/pg');
const { start } = require('./server/src/index.js');
const { load } = require('./server/src/config.js');
const { AUDIT } = require('./audit.js');

const ADMIN_URL = process.env.TEST_DATABASE_URL || 'postgres://miles:miles@127.0.0.1:5432/postgres';
const PASSWORD = 'long enough pass';
const DAY = 864e5;
const PRICES = { supporter_monthly: '₩3,000', supporter_yearly: '₩30,000', pro_monthly: '₩6,500', pro_yearly: '₩65,000' };
const TIERS = { supporter_monthly: 'supporter', supporter_yearly: 'supporter', pro_monthly: 'pro', pro_yearly: 'pro' };

async function admin(sql) {
  const c = new Client({ connectionString: ADMIN_URL });
  await c.connect();
  try { await c.query(sql); } finally { await c.end(); }
}

const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)));

// The store on the phone. Google names its products "plan:base-plan"; Apple
// by the plan alone. A purchase is reported to the RevenueCat stand-in through
// window.rcBought, the way the real store reports it to RevenueCat.
const STORE = (platform, prices) => `(() => {
  const platform = ${JSON.stringify(platform)};
  const prices = ${JSON.stringify(prices)};
  const store = window.__store = { calls: [], active: [], cancelNext: false, opened: [], user: null };
  const idOf = (plan) => (platform === 'android' ? plan + ':base' : plan);
  const info = () => ({ customerInfo: {
    activeSubscriptions: store.active.slice(),
    managementURL: platform === 'android' ? 'https://play.google.com/store/account/subscriptions?package=app.miles.running' : 'https://apps.apple.com/account/subscriptions',
  } });
  const Purchases = {
    async configure(o) { store.calls.push(['configure', o.apiKey, o.appUserID]); store.user = o.appUserID; },
    async logIn(o) { store.calls.push(['logIn', o.appUserID]); store.user = o.appUserID; return Object.assign(info(), { created: false }); },
    async logOut() { store.calls.push(['logOut']); store.user = null; return info(); },
    async getProducts(o) {
      store.calls.push(['getProducts', o.type]);
      return { products: o.productIdentifiers.map((id) => ({ identifier: idOf(id), priceString: prices[id], title: id })) };
    },
    async getCustomerInfo() { return info(); },
    async purchaseStoreProduct(o) {
      store.calls.push(['purchase', o.product.identifier, o.storeProductChangeInfo || null]);
      if (store.cancelNext) {
        store.cancelNext = false;
        const err = new Error('Purchase was cancelled.');
        err.code = '1';
        err.userCancelled = true;
        throw err;
      }
      store.active = [o.product.identifier];
      await window.rcBought(store.user, o.product.identifier, platform);
      return Object.assign(info(), { productIdentifier: o.product.identifier });
    },
    async restorePurchases() { store.calls.push(['restore']); return info(); },
  };
  // Every other plugin: present, and refusing.
  const other = new Proxy({}, { get: (_, key) => (key === 'then' ? undefined : () => Promise.reject(new Error('not in this test'))) });
  window.Capacitor = {
    isNativePlatform: () => true,
    getPlatform: () => platform,
    registerPlugin: (name) => (name === 'Purchases' ? Purchases : other),
  };
  window.open = (url) => { store.opened.push(url); return null; };
})()`;

(async () => {
  // --- RevenueCat, as far as the server asks it anything --------------------
  const records = new Map();       // user id → subscriber record
  const down = new Set();          // users whose record is not there yet
  // Users of a project with only V2 secret keys, which the v1 API refuses.
  // For them the purchase reaches the server the way it would in such a
  // project: by RevenueCat's webhook, a moment after the store took the money.
  const v2 = new Set();
  let rcAsked = 0;
  const rc = http.createServer((req, res) => {
    rcAsked++;
    const id = decodeURIComponent(req.url.split('/').pop());
    if (v2.has(id)) {
      res.writeHead(403, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ code: 7723, message: "You're trying to use a secret API key incompatible with RevenueCat API V1." }));
      return;
    }
    const ok = !down.has(id) && req.headers.authorization === 'Bearer sk_test';
    res.writeHead(ok ? 200 : 503, { 'content-type': 'application/json' });
    res.end(JSON.stringify(ok ? (records.get(id) || { subscriber: { entitlements: {}, subscriptions: {} } }) : { message: 'unavailable' }));
  });
  const RC = await listen(rc);
  const bought = (userId, product, platform) => {
    const plan = product.split(':')[0];
    const expires = new Date(Date.now() + 30 * DAY).toISOString();
    // RevenueCat names Google products with the base plan in one place and
    // without it in the other; the server has to find them either way.
    records.set(userId, { subscriber: {
      entitlements: { [TIERS[plan]]: { expires_date: expires, product_identifier: product } },
      subscriptions: { [plan]: { expires_date: expires, store: platform === 'ios' ? 'app_store' : 'play_store', unsubscribe_detected_at: null } },
    } });
    if (v2.has(userId)) {
      setTimeout(() => call('POST', '/v1/billing/revenuecat', { event: {
        id: crypto.randomUUID(), type: 'INITIAL_PURCHASE', app_user_id: userId, product_id: product,
        entitlement_ids: [TIERS[plan]], store: platform === 'ios' ? 'APP_STORE' : 'PLAY_STORE', expiration_at_ms: Date.parse(expires),
      } }, { authorization: 'Bearer rc-hook' }), 2500);
    }
  };

  // --- The server -----------------------------------------------------------
  const dbName = 'miles_billing_' + crypto.randomBytes(4).toString('hex');
  await admin(`create database ${dbName}`);
  const dbUrl = new URL(ADMIN_URL);
  dbUrl.pathname = '/' + dbName;
  const logged = [];
  const quiet = { log() {}, warn() {}, error: (...a) => logged.push(a.join(' ')) };
  const server = await start({
    config: load({
      DATABASE_URL: dbUrl.toString(), SCRYPT_N: '1024', RATE_LIMIT_SCALE: '1000', LOG_REQUESTS: 'false',
      REVENUECAT_API_KEY: 'sk_test', REVENUECAT_API_URL: RC, REVENUECAT_WEBHOOK_SECRET: 'rc-hook',
    }),
    port: 0, log: quiet, poolSize: 4, mailer: { async send() {} },
  });
  const API = server.url;
  const db = server.db;
  const call = async (method, p, body, headers) => {
    const res = await fetch(API + p, { method, headers: Object.assign({ 'content-type': 'application/json' }, headers || {}), body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  const runner = async (name) => {
    const email = `${name.toLowerCase()}.${crypto.randomBytes(3).toString('hex')}@example.test`;
    const res = await call('POST', '/v1/auth/signup', { email, password: PASSWORD, name, acceptTerms: true, ageConfirmed: true });
    if (res.status !== 201) throw new Error('signup failed: ' + JSON.stringify(res.body));
    return { id: res.body.user.id, token: res.body.token, user: res.body.user, email };
  };

  // --- The app, as build-www.js ships it ----------------------------------------
  const root = __dirname;
  const keys = { 'miles-api': API, 'miles-rc-ios': 'appl_test', 'miles-rc-android': 'goog_test' };
  const shipped = (withKeys) => Object.entries(withKeys ? keys : { 'miles-api': API }).reduce(
    (html, [name, value]) => html.replace(new RegExp(`<meta name="${name}" content="[^"]*"`), `<meta name="${name}" content="${value}"`),
    fs.readFileSync(path.join(root, 'index.html'), 'utf8'));
  const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json' };
  const files = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/' || url.pathname === '/index.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(shipped(url.searchParams.get('keys') !== 'none'));
      return;
    }
    const file = path.join(root, path.normalize(decodeURIComponent(url.pathname)));
    if (!file.startsWith(path.join(root, 'src')) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  const APP = await listen(files);

  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const errors = [];
  let bad = 0;
  const ok = (label, cond, extra) => {
    console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${!cond && extra !== undefined ? '  → ' + extra : ''}`);
    if (!cond) bad++;
  };

  /** A phone signed in as `who`, on `platform` (or a web build with none). */
  const phone = async (who, platform, options) => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/not in this test|Failed to load resource/.test(m.text())) errors.push('CONSOLE: ' + m.text()); });
    await page.exposeFunction('rcBought', bought);
    if (platform) await page.addInitScript(STORE(platform, PRICES));
    await page.addInitScript(([base, token, user]) => {
      localStorage.setItem('miles.session', JSON.stringify({ base, token, user }));
    }, [API, who.token, who.user]);
    await page.goto(APP + '/index.html' + (options && options.noKeys ? '?keys=none' : ''));
    await page.waitForFunction(() => MILES.State.data.connected && MILES.State.data.account && !MILES.Sync.pulling, null, { timeout: 8000 });
    return page;
  };
  const until = (page, fn, arg, timeout) => page.waitForFunction(fn, arg, { timeout: timeout || 8000 });
  const lastToast = (page) => page.evaluate(() => { const t = [...document.querySelectorAll('#toasts .toast')].pop(); return t ? t.textContent : ''; });
  const calls = (page, kind) => page.evaluate((k) => window.__store.calls.filter((c) => !k || c[0] === k), kind);
  const offer = (page, tier, period) => page.evaluate(([t, p]) => {
    MILES.UI.proTier = t;
    MILES.UI.proPeriod = p;
    MILES.UI.openPro();
    MILES.UI.proTier = t;
    MILES.UI.renderProOffer();
  }, [tier, period]);
  const sheet = (page) => page.evaluate(() => ({
    plans: [...document.querySelectorAll('#proPlans button')].map((b) => b.textContent),
    primary: document.querySelector('#proPrimary').textContent,
    fine: document.querySelector('#proFinePrint').textContent,
    links: [...document.querySelectorAll('#proLinks a, #proLinks button')].map((a) => [a.textContent, a.getAttribute('href')]),
    linksShown: !document.querySelector('#proLinks').hidden,
  }));
  const tier = (page) => page.evaluate(() => MILES.Pro.verify(MILES.State.data).tier);

  try {
    // --- 1. Signing in tells the store who is buying ---------------------------------
    const mina = await runner('Mina');
    let page = await phone(mina, 'android');
    await until(page, () => window.__store.calls.some((c) => c[0] === 'getProducts'));
    const configured = await calls(page, 'configure');
    ok('signed in, the store is set up with the public Google key and this account',
      configured.length === 1 && configured[0][1] === 'goog_test' && configured[0][2] === mina.id, JSON.stringify(configured));
    ok('and asked for subscriptions', (await calls(page, 'getProducts'))[0][1] === 'SUBSCRIPTION');

    // --- 2. The offer, at the store's prices ----------------------------------------------
    await offer(page, 'supporter', 'monthly');
    let s = await sheet(page);
    ok('plans are priced by the store, in won, not the demo\'s dollars',
      s.plans.join('|') === '₩3,000 / mo|₩30,000 / yr' && s.primary === 'Subscribe · ₩3,000 / mo', JSON.stringify(s));
    ok('the renewal terms name the price, the period and Google Play',
      /Supporter, ₩3,000 \/ mo/.test(s.fine) && /renews every month/.test(s.fine) && /Google Play/.test(s.fine) && !/\$/.test(s.fine), s.fine);
    ok('Restore purchases, the terms and the privacy policy sit beside the offer',
      s.linksShown && s.links.map((l) => l[0]).join('|') === 'Restore purchases|Terms of Use|Privacy policy'
      && s.links[1][1] === API + '/terms' && s.links[2][1] === API + '/privacy', JSON.stringify(s.links));
    const a = await page.evaluate(AUDIT('#proSheet'));
    ok('the offer: type, contrast and reach', a.seen > 0 && !a.type.length && !a.contrast.length && !a.touch.length,
      JSON.stringify({ type: a.type, contrast: a.contrast, touch: a.touch }));
    await offer(page, 'pro', 'yearly');
    s = await sheet(page);
    ok('Pro still leads with the free trial, which needs no store', s.primary === 'Start 14-day trial' && /No card needed/.test(s.fine), JSON.stringify(s));

    // --- 3. Cancelled at the store: nothing happens ------------------------------------------
    await offer(page, 'supporter', 'monthly');
    const askedBefore = rcAsked;
    await page.evaluate(() => { window.__store.cancelNext = true; });
    await page.click('#proPrimary');
    await page.waitForTimeout(400);
    ok('a purchase cancelled at the store changes nothing and says nothing',
      (await tier(page)) === 'free' && rcAsked === askedBefore && !/cancel/i.test(await lastToast(page)), await lastToast(page));

    // --- 4. Buying Supporter -----------------------------------------------------------------
    await offer(page, 'supporter', 'monthly');
    await page.click('#proPrimary');
    await until(page, () => MILES.Pro.verify(MILES.State.data).tier === 'supporter');
    const bought1 = (await calls(page, 'purchase')).pop();
    ok('the store sells the Google product for the plan, with nothing to replace', bought1[1] === 'supporter_monthly:base' && bought1[2] === null, JSON.stringify(bought1));
    const ent = await db.one('select plan, tier, source, will_renew from entitlements where user_id = $1', [mina.id]);
    ok('it counts at once: the server asked RevenueCat, without waiting for the webhook',
      ent && ent.plan === 'supporter_monthly' && ent.source === 'revenuecat' && ent.will_renew === true, JSON.stringify(ent));
    ok('and the app says so', /Supporter is on/.test(await lastToast(page)), await lastToast(page));
    await page.evaluate(() => MILES.UI.go('profile'));
    ok('the profile shows the plan', /Supporter · renews in/.test(await page.textContent('#proStatus')), await page.textContent('#proStatus'));
    ok('as what it is, not at the demo\'s dollar price', (await page.textContent('#proCardNote')) === 'Supporter · monthly', await page.textContent('#proCardNote'));
    records.get(mina.id).subscriber.subscriptions.supporter_monthly.unsubscribe_detected_at = new Date().toISOString();
    await page.evaluate(() => MILES.Billing.confirm());
    await until(page, () => /ends in/.test(document.querySelector('#proStatus').textContent)).catch(() => {});
    ok('cancelled in the store, it says when it ends rather than renews', /Supporter · ends in/.test(await page.textContent('#proStatus')), await page.textContent('#proStatus'));

    // --- 5. Upgrading on Google Play replaces the plan ------------------------------------------
    await offer(page, 'pro', 'yearly');
    s = await sheet(page);
    ok('with Supporter, Pro is offered at its price, not as a trial', s.primary === 'Subscribe · ₩65,000 / yr', s.primary);
    await page.click('#proPrimary');
    await until(page, () => MILES.Pro.verify(MILES.State.data).tier === 'pro');
    const bought2 = (await calls(page, 'purchase')).pop();
    ok('Google Play is told the new plan replaces Supporter, so both are not charged',
      bought2[1] === 'pro_yearly:base' && bought2[2] && bought2[2].oldProductIdentifier === 'supporter_monthly', JSON.stringify(bought2));
    ok('and the account is Pro', (await db.one('select plan from entitlements where user_id = $1', [mina.id])).plan === 'pro_yearly');

    // --- 6. The same plan twice ------------------------------------------------------------------
    const purchasesBefore = (await calls(page, 'purchase')).length;
    await offer(page, 'pro', 'yearly');
    await page.click('#proPrimary');
    await page.waitForTimeout(400);
    ok('a plan the store account already has is not sold again',
      (await calls(page, 'purchase')).length === purchasesBefore && /already has that plan/.test(await lastToast(page)), await lastToast(page));

    // --- 7. Managing it is the store's job ---------------------------------------------------------
    await page.evaluate(() => { MILES.UI.closeSheet('#proSheet'); MILES.UI.go('profile'); });
    await page.click('#proBtn');
    const opened = await page.evaluate(() => window.__store.opened.slice());
    ok('Manage opens the store\'s own page for this subscription', opened.length === 1 && /play\.google\.com\/store\/account\/subscriptions/.test(opened[0]), JSON.stringify(opened));

    // --- 8. Signing out and in as someone else -------------------------------------------------------
    const jun = await runner('Jun');
    await page.evaluate(() => MILES.Api.signOut());
    await until(page, () => window.__store.calls.some((c) => c[0] === 'logOut'));
    await page.evaluate(([email, pw]) => MILES.Api.signIn(email, pw), [jun.email, PASSWORD]);
    await until(page, () => window.__store.calls.some((c) => c[0] === 'logIn'));
    const login = (await calls(page, 'logIn')).pop();
    ok('signing out leaves the store, and the next account is the one that buys', login[1] === jun.id, JSON.stringify(login));
    await until(page, () => MILES.State.data.account && !MILES.Sync.pulling);
    ok('and that account has none of the last one\'s plan', (await tier(page)) === 'free');

    // --- 9. RevenueCat a step behind ----------------------------------------------------------------
    down.add(jun.id);
    await page.evaluate(() => { window.__store.active = []; });
    await offer(page, 'supporter', 'yearly');
    await page.click('#proPrimary');
    await until(page, () => /Payment received/.test([...document.querySelectorAll('#toasts .toast')].map((t) => t.textContent).join(' ')));
    ok('if the store\'s records lag, the app says the payment arrived, not that it failed', (await tier(page)) === 'free');
    down.delete(jun.id);
    const hook = await call('POST', '/v1/billing/revenuecat', { event: {
      id: crypto.randomUUID(), type: 'INITIAL_PURCHASE', app_user_id: jun.id, product_id: 'supporter_yearly:base',
      entitlement_ids: ['supporter'], store: 'PLAY_STORE', expiration_at_ms: Date.now() + 365 * DAY,
    } }, { authorization: 'Bearer rc-hook' });
    ok('then the webhook lands', hook.status === 200 && hook.body.outcome === 'granted', JSON.stringify(hook));
    await until(page, () => MILES.Pro.verify(MILES.State.data).tier === 'supporter', null, 9000).catch(() => {});
    ok('and the app looks again by itself, and switches it on', (await tier(page)) === 'supporter');
    await until(page, () => /Supporter<\/b> is on|Supporter is on/.test([...document.querySelectorAll('#toasts .toast')].map((t) => t.textContent).join(' ')), null, 3000).catch(() => {});
    ok('and says so when it does', /Supporter is on/.test(await lastToast(page)), await lastToast(page));
    await page.close();

    // --- 9b. A RevenueCat project with only V2 secret keys ------------------------------------------
    // The server's quick check is refused, so a purchase arrives only by the
    // webhook — the set-up a new RevenueCat project has.
    const hana = await runner('Hana');
    v2.add(hana.id);
    page = await phone(hana, 'android');
    await until(page, () => window.__store.calls.some((c) => c[0] === 'getProducts'));
    await page.evaluate(() => MILES.Account.restore());
    ok('Restore with nothing on the store account says so, without making anyone wait',
      /No subscription found/.test(await lastToast(page)), await lastToast(page));
    await db.query("update users set trial_ends_at = now() - interval '1 day' where id = $1", [hana.id]);
    await page.evaluate(() => MILES.Sync.pullMe());
    await offer(page, 'pro', 'monthly');
    const clicked = Date.now();
    await page.click('#proPrimary');
    await until(page, () => /Payment received/.test([...document.querySelectorAll('#toasts .toast')].map((t) => t.textContent).join(' ')));
    ok('the server cannot ask RevenueCat, so the app says the payment arrived', (await tier(page)) === 'free');
    await until(page, () => MILES.Pro.verify(MILES.State.data).tier === 'pro', null, 15000).catch(() => {});
    ok('the webhook lands, and the app, looking again, switches Pro on', (await tier(page)) === 'pro', await tier(page));
    await until(page, () => /Pro is on/.test([...document.querySelectorAll('#toasts .toast')].map((t) => t.textContent).join(' ')), null, 3000).catch(() => {});
    ok('within seconds, and says so', /Pro is on/.test(await lastToast(page)) && Date.now() - clicked < 12000, `${await lastToast(page)} after ${Date.now() - clicked} ms`);
    ok('the server log says why its quick check failed, and what to do', logged.some((l) => /needs a V1 secret key/.test(l) && /leave it empty/.test(l)), JSON.stringify(logged.slice(-3)));
    await page.close();

    // --- 10. An iPhone: Apple's terms, and Restore purchases ----------------------------------------
    const yuna = await runner('Yuna');
    bought(yuna.id, 'pro_monthly', 'ios');           // bought on her last iPhone
    page = await phone(yuna, 'ios');
    await until(page, () => window.__store.calls.some((c) => c[0] === 'getProducts'));
    ok('on an iPhone the store is set up with the Apple key', (await calls(page, 'configure'))[0][1] === 'appl_test');
    // The trial is not the headline once it is spent; use it up on the server.
    await db.query("update users set trial_ends_at = now() - interval '1 day' where id = $1", [yuna.id]);
    await page.evaluate(() => MILES.Sync.pullMe());
    await offer(page, 'pro', 'monthly');
    s = await sheet(page);
    ok('Apple\'s renewal terms: the Apple Account, and 24 hours before the period ends',
      /Pro, ₩6,500 \/ mo/.test(s.fine) && /Apple Account/.test(s.fine) && /24 hours/.test(s.fine) && /App Store/.test(s.fine), s.fine);
    await page.click('#proRestore');
    await until(page, () => MILES.Pro.verify(MILES.State.data).tier === 'pro');
    ok('Restore purchases finds the plan bought on another phone', (await calls(page, 'restore')).length === 1 && /restored/.test(await lastToast(page)), await lastToast(page));
    await page.evaluate(() => { window.__store.active = ['pro_monthly']; });
    await offer(page, 'supporter', 'monthly');
    await page.click('#proPrimary');
    await until(page, () => window.__store.calls.filter((c) => c[0] === 'purchase').length === 1);
    const crossgrade = (await calls(page, 'purchase'))[0];
    ok('on the App Store the plans share a group, so Apple swaps them itself', crossgrade[1] === 'supporter_monthly' && crossgrade[2] === null, JSON.stringify(crossgrade));
    await page.close();

    // --- 11. A build that cannot sell ---------------------------------------------------------------
    const web = await runner('Web');
    page = await phone(web, null, { noKeys: true });
    await db.query("update users set trial_ends_at = now() - interval '1 day' where id = $1", [web.id]);
    await page.evaluate(() => MILES.Sync.pullMe());
    await offer(page, 'pro', 'yearly');
    s = await sheet(page);
    ok('in a browser there is no store: no Restore, the demo\'s prices, the terms still linked',
      s.links.map((l) => l[0]).join('|') === 'Terms of Use|Privacy policy' && s.plans[1] === '$49.99 / yr', JSON.stringify(s));
    await page.click('#proPrimary');
    await page.waitForTimeout(300);
    ok('and buying says where it can be done, rather than pretending', /in the MILES app from the App Store or Google Play/.test(await lastToast(page)), await lastToast(page));
    ok('nothing was granted', (await tier(page)) === 'free');
    await page.close();
  } finally {
    await browser.close();
    await server.close();
    files.close();
    rc.close();
    await admin(`drop database if exists ${dbName} with (force)`);
  }

  errors.forEach((e) => console.log(e));
  const failed = bad + errors.length;
  console.log(failed === 0 ? 'PAYING WORKS, AND SAYS WHAT IT COSTS' : `${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((err) => { console.error(err); process.exit(1); });
