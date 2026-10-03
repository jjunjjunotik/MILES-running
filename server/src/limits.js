'use strict';

/* Rate limits, counted in fixed windows in memory. One server process is the
   whole deployment for now; with several, this moves to Postgres or Redis.

   The limits are on what an attacker would hammer — signing in, signing up,
   reset codes — plus a generous ceiling on everything else. */

function createLimiter(scale) {
  const factor = scale || 1;
  const windows = new Map();

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [key, w] of windows) if (w.reset <= now) windows.delete(key);
  }, 60 * 1000);
  sweep.unref();

  return {
    /** Counts one hit against `key`; false once it is over `limit` in `windowMs`. */
    take(key, limit, windowMs) {
      const now = Date.now();
      let w = windows.get(key);
      if (!w || w.reset <= now) {
        w = { count: 0, reset: now + windowMs };
        windows.set(key, w);
      }
      w.count += 1;
      return w.count <= limit * factor;
    },
    close() { clearInterval(sweep); windows.clear(); },
  };
}

module.exports = { createLimiter };
