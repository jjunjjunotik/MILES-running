// Copies the app into www/, the folder Capacitor packs into the Android and
// iOS builds. The app has no build step of its own; this is only a copy, so
// what ships is exactly what `index.html` runs in a browser.
//   node scripts/build-www.js
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const out = path.join(root, 'www');

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out);
fs.copyFileSync(path.join(root, 'index.html'), path.join(out, 'index.html'));
fs.cpSync(path.join(root, 'src'), path.join(out, 'src'), { recursive: true });

let files = 0;
(function count(dir) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? count(path.join(dir, e.name)) : files++));
})(out);
console.log(`www/ ready: ${files} files`);
