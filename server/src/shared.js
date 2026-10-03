'use strict';

/* The app's own geometry and rules, loaded from its source.

   Land is decided by polygon clipping in src/js/clip.js and land.js; crew
   missions and the paid tiers are defined in crew.js and pro.js. The server
   runs exactly those files rather than a copy, so the map a phone draws
   before upload and the one the server stores after it are made by the same
   code. They are browser scripts that hang everything off `window.MILES`, so
   each is compiled as a function and handed a `window` of its own. */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DIR = process.env.MILES_SHARED_DIR || path.resolve(__dirname, '../../src/js');
const FILES = ['core.js', 'clip.js', 'land.js', 'crew.js', 'pro.js'];

function load() {
  const window = {};
  FILES.forEach((file) => {
    const code = fs.readFileSync(path.join(DIR, file), 'utf8');
    // compileFunction runs in this realm, so arrays and objects made inside
    // are ordinary ones here.
    const fn = vm.compileFunction(code, ['window', 'module'], { filename: path.join(DIR, file) });
    fn(window, undefined);
  });
  return window.MILES;
}

const M = load();

module.exports = {
  Geo: M.Geo,
  Clip: M.Clip,
  Land: M.Land,
  Crew: M.Crew,
  Pro: M.Pro,
};
