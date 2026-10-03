// Copies the app into www/, the folder Capacitor packs into the Android and
// iOS builds. The app has no build step of its own; this is only a copy, so
// what ships is exactly what `index.html` runs in a browser — plus the
// server's address, from MILES_API_URL.
//   MILES_API_URL=https://api.example.com node scripts/build-www.js
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

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out);
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const meta = /<meta name="miles-api" content="[^"]*"/;
if (!meta.test(html)) { console.error('index.html has no miles-api meta tag'); process.exit(1); }
fs.writeFileSync(path.join(out, 'index.html'), html.replace(meta, `<meta name="miles-api" content="${api.replace(/"/g, '&quot;')}"`));
fs.cpSync(path.join(root, 'src'), path.join(out, 'src'), { recursive: true });

let files = 0;
(function count(dir) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? count(path.join(dir, e.name)) : files++));
})(out);
console.log(`www/ ready: ${files} files, ${api ? 'talking to ' + api : 'the demo (no MILES_API_URL)'}`);
