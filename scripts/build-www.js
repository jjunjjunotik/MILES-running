// Copies the app into www/, the folder Capacitor packs into the Android and
// iOS builds. The app has no build step of its own; this is only a copy, so
// what ships is exactly what `index.html` runs in a browser — plus the
// server's address, from MILES_API_URL, and RevenueCat's public keys for the
// two stores, from REVENUECAT_IOS_KEY and REVENUECAT_ANDROID_KEY. (The map's
// key is the server's to give: ARCGIS_MAP_KEY, in server/README.md.)
//   MILES_API_URL=https://api.example.com REVENUECAT_IOS_KEY=appl_… \
//   REVENUECAT_ANDROID_KEY=goog_… node scripts/build-www.js
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const out = path.join(root, 'www');

// The server the phone builds talk to. Without MILES_API_URL the build is
// the self-contained demo; with it, a real account on the shared map.
const api = (process.env.MILES_API_URL || '').trim().replace(/\/+$/, '');
if (api && !/^https:\/\//.test(api) && !process.env.MILES_ALLOW_HTTP) {
  // Android refuses plain HTTP and so does App Review. MILES_ALLOW_HTTP=1 is
  // for an emulator talking to a laptop, and only that.
  console.error(`MILES_API_URL has to be https:// (got ${api}). Set MILES_ALLOW_HTTP=1 for local testing only.`);
  process.exit(1);
}

// The keys the app may carry are RevenueCat's public ones. The secret key
// (sk_…) belongs on the server only; a phone build with it is refused.
const keys = { 'miles-rc-ios': ['REVENUECAT_IOS_KEY', 'appl_'], 'miles-rc-android': ['REVENUECAT_ANDROID_KEY', 'goog_'] };
const rc = {};
Object.entries(keys).forEach(([name, [env, prefix]]) => {
  const key = (process.env[env] || '').trim();
  if (key && !key.startsWith(prefix) && !key.startsWith('test_')) {
    console.error(`${env} has to be RevenueCat's public ${prefix}… key for that store (got ${key.slice(0, 5)}…). The secret sk_ key goes on the server.`);
    process.exit(1);
  }
  rc[name] = key;
});
if (rc['miles-rc-ios'] || rc['miles-rc-android']) {
  if (!api) { console.error('RevenueCat keys need MILES_API_URL: purchases belong to a MILES account.'); process.exit(1); }
}

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out);
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const values = Object.assign({ 'miles-api': api }, rc);
let page = html;
Object.entries(values).forEach(([name, value]) => {
  const meta = new RegExp(`<meta name="${name}" content="[^"]*"`);
  if (!meta.test(page)) { console.error(`index.html has no ${name} meta tag`); process.exit(1); }
  page = page.replace(meta, `<meta name="${name}" content="${value.replace(/"/g, '&quot;')}"`);
});
fs.writeFileSync(path.join(out, 'index.html'), page);
fs.cpSync(path.join(root, 'src'), path.join(out, 'src'), { recursive: true });

let files = 0;
(function count(dir) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? count(path.join(dir, e.name)) : files++));
})(out);
const stores = ['ios', 'android'].filter((p) => rc[`miles-rc-${p}`]);
console.log(`www/ ready: ${files} files, ${api ? 'talking to ' + api : 'the demo (no MILES_API_URL)'}` +
  (api ? `, ${stores.length ? 'selling on ' + stores.join(' and ') : 'no store keys (nothing can be bought)'}` : ''));
