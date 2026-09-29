// The Android and iOS app. Checked here, with a stand-in for the native side:
// a run's GPS comes from the background-location plugin, with the notification
// text Android shows while it records; the notification permission is asked
// once, when a run starts, and only on Android; "centre on me" asks for one
// position without starting that notification; stopping a run stops the GPS;
// in a browser nothing changes; and nothing sits under the notch or the home
// bar.
//   node test-native.js
// Needs Playwright, which the app itself does not: `npm i playwright`, or run
// with NODE_PATH pointing at an install that has it.
const { chromium } = require('playwright');
const path = require('path');

// A stand-in for window.Capacitor as the app's WebView sees it. Records every
// call; `window.__fix(lat, lng, alt)` delivers a position to every watcher.
const FAKE = (platform) => `(() => {
  const calls = [];
  const watchers = {};
  let next = 1;
  const plugins = {
    BackgroundGeolocation: {
      addWatcher(options, cb) {
        const id = String(next++);
        watchers[id] = cb;
        calls.push({ call: 'addWatcher', id, options });
        return Promise.resolve(id);
      },
      removeWatcher({ id }) { delete watchers[id]; calls.push({ call: 'removeWatcher', id }); return Promise.resolve(); },
      openSettings() { calls.push({ call: 'openSettings' }); return Promise.resolve(); },
    },
    RunNotice: {
      request() { calls.push({ call: 'RunNotice.request' }); return Promise.resolve({ granted: true }); },
    },
  };
  window.__calls = calls;
  window.__watchers = () => Object.keys(watchers);
  window.__fix = (lat, lng, alt) => Object.values(watchers).forEach((cb) => cb({ latitude: lat, longitude: lng, altitude: alt, accuracy: 5, time: Date.now() }));
  window.Capacitor = {
    isNativePlatform: () => true,
    getPlatform: () => '${platform}',
    registerPlugin: (name) => plugins[name],
  };
})()`;

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const errors = [];
  let bad = 0;
  const ok = (label, cond, extra) => {
    console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${!cond && extra !== undefined ? '  → ' + extra : ''}`);
    if (!cond) bad++;
  };
  const open = async (platform) => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
    if (platform) await page.addInitScript(FAKE(platform));
    await page.goto('file://' + path.resolve(__dirname, 'index.html'));
    await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
    await page.reload();
    await page.waitForTimeout(800);
    return page;
  };

  // --- 1. A run in the Android app --------------------------------------------
  let page = await open('android');
  const run = await page.evaluate(async () => {
    const T = MILES.Tracker;
    const home = MILES.State.data.profile.home;
    const out = { app: MILES.Native.isApp, platform: document.documentElement.dataset.platform };
    T.start({ kind: 'free' });
    T.pause();                                          // hold the simulator still
    await new Promise((r) => setTimeout(r, 50));
    out.watchers = window.__watchers().length;
    for (let i = 0; i < 30; i++) {
      const p = MILES.Geo.offset(home, i * 10, 0);
      window.__fix(p.lat, p.lng, 20 + i);
    }
    out.source = T.state.source;
    out.route = T.state.route.length;
    T.stop();
    out.after = window.__watchers().length;
    // A second run: the notification permission is not asked again.
    T.start({ kind: 'free' });
    await new Promise((r) => setTimeout(r, 50));
    T.stop();
    out.calls = window.__calls;
    return out;
  });
  const adds = run.calls.filter((c) => c.call === 'addWatcher');
  ok('the app knows it is the Android app', run.app === true && run.platform === 'android', JSON.stringify([run.app, run.platform]));
  ok('a run records from the background-location plugin', run.watchers === 1 && run.source === 'gps' && run.route >= 20,
    JSON.stringify({ watchers: run.watchers, source: run.source, route: run.route }));
  ok('with the notification that keeps it recording with the screen off',
    adds.every((c) => c.options.backgroundTitle === 'Run in progress' && /recording your route/.test(c.options.backgroundMessage) && c.options.requestPermissions === true),
    JSON.stringify(adds.map((c) => c.options)));
  ok('stopping the run stops the GPS', run.after === 0, run.after);
  const asked = run.calls.filter((c) => c.call === 'RunNotice.request').length;
  const firstAsk = run.calls.findIndex((c) => c.call === 'RunNotice.request');
  const firstWatch = run.calls.findIndex((c) => c.call === 'addWatcher');
  ok('the notification permission is asked once, before the first run records', asked === 1 && firstAsk < firstWatch,
    JSON.stringify(run.calls.map((c) => c.call)));

  // --- 2. "Centre on me" -------------------------------------------------------
  const locate = await page.evaluate(async () => {
    window.__calls.length = 0;
    MILES.UI.locate();
    await new Promise((r) => setTimeout(r, 50));
    window.__fix(37.5283, 126.9326, 12);
    await new Promise((r) => setTimeout(r, 50));
    return {
      calls: window.__calls,
      home: MILES.State.data.profile.home,
      left: window.__watchers().length,
    };
  });
  const locWatch = locate.calls.find((c) => c.call === 'addWatcher');
  ok('"centre on me" takes one position and moves the map there',
    Math.abs(locate.home.lat - 37.5283) < 1e-6 && Math.abs(locate.home.lng - 126.9326) < 1e-6 && locate.left === 0,
    JSON.stringify(locate));
  ok('without starting the run notification', locWatch && !('backgroundMessage' in locWatch.options), JSON.stringify(locWatch));
  await page.close();

  // --- 3. iOS: no Android permission to ask --------------------------------------
  page = await open('ios');
  const ios = await page.evaluate(async () => {
    MILES.Tracker.start({ kind: 'free' });
    await new Promise((r) => setTimeout(r, 50));
    MILES.Tracker.stop();
    return window.__calls.map((c) => c.call);
  });
  ok('on iPhone a run records the same way, with nothing Android-only asked', ios.includes('addWatcher') && !ios.includes('RunNotice.request'),
    JSON.stringify(ios));
  await page.close();

  // --- 4. A browser is unchanged -------------------------------------------------
  page = await open(null);
  const web = await page.evaluate(() => ({ app: MILES.Native.isApp, platform: MILES.Native.platform, mark: document.documentElement.dataset.platform || null }));
  ok('in a browser it is still the web app, on the browser\'s own GPS', web.app === false && web.platform === 'web' && web.mark === null,
    JSON.stringify(web));

  // --- 5. The notch and the home bar --------------------------------------------
  const insets = await page.evaluate(() => {
    const root = document.documentElement.style;
    root.setProperty('--safe-area-inset-top', '47px');
    root.setProperty('--safe-area-inset-bottom', '34px');
    const phone = document.querySelector('.phone').getBoundingClientRect();
    const bar = document.querySelector('#tabbar').getBoundingClientRect();
    const first = document.querySelector('.screen[data-active="true"]').getBoundingClientRect();
    MILES.UI.toast('x');
    const out = { top: Math.round(first.top - phone.top), bottom: Math.round(phone.bottom - bar.bottom) };
    root.removeProperty('--safe-area-inset-top');
    root.removeProperty('--safe-area-inset-bottom');
    const bar0 = document.querySelector('#tabbar').getBoundingClientRect();
    const first0 = document.querySelector('.screen[data-active="true"]').getBoundingClientRect();
    out.top0 = Math.round(first0.top - phone.top);
    out.bottom0 = Math.round(phone.bottom - bar0.bottom);
    return out;
  });
  ok('the screens start below the status bar and the tabs end above the home bar',
    insets.top === 47 && insets.bottom === 34, JSON.stringify(insets));
  ok('and a screen with neither gives up no space', insets.top0 === 0 && insets.bottom0 === 0, JSON.stringify(insets));
  await page.close();

  await browser.close();
  errors.forEach((e) => console.log(e));
  const failed = bad + errors.length;
  console.log(failed === 0 ? 'THE APP RECORDS A RUN LIKE THE WEB DOES' : `${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
})();
