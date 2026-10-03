'use strict';

/* Starts the MILES API: migrates the database, then serves HTTP and the
   live-race WebSocket on one port. `start()` is also what the tests call. */

const http = require('http');
const { load } = require('./config');
const { createDb } = require('./db');
const { createApp } = require('./app');
const { createLive } = require('./live');

async function start(options) {
  const o = options || {};
  const config = o.config || load();
  const db = o.db || createDb(config.databaseUrl, { max: o.poolSize || 10 });
  await db.migrate();

  const live = createLive({ db, log: o.log || console });
  const api = createApp({ config, db, live, mailer: o.mailer, log: o.log });
  const server = http.createServer(api.handle);
  // Requests and idle keep-alive sockets get a deadline; a stuck client must
  // not hold a connection open for ever.
  server.requestTimeout = 30 * 1000;
  server.headersTimeout = 15 * 1000;
  server.keepAliveTimeout = 65 * 1000;
  live.attach(server);

  await new Promise((resolve) => server.listen(o.port !== undefined ? o.port : config.port, resolve));
  const address = server.address();
  const url = `http://127.0.0.1:${address.port}`;

  let closing = null;
  async function close() {
    if (!closing) {
      closing = (async () => {
        live.close();
        await new Promise((resolve) => {
          server.close(() => resolve());
          // Keep-alive sockets would otherwise hold close() open until they idle out.
          server.closeAllConnections();
        });
        api.close();
        if (!o.db) await db.close();
      })();
    }
    return closing;
  }

  return { server, url, config, db, live, api, close };
}

module.exports = { start };

if (require.main === module) {
  start().then((s) => {
    console.log(`MILES API listening on port ${s.server.address().port} (public address: ${s.config.publicUrl})`);
    const stop = (signal) => {
      console.log(`${signal}: closing`);
      s.close().then(() => process.exit(0), () => process.exit(1));
      setTimeout(() => process.exit(1), 10 * 1000).unref();
    };
    process.on('SIGTERM', () => stop('SIGTERM'));
    process.on('SIGINT', () => stop('SIGINT'));
  }).catch((err) => {
    console.error('failed to start:', err.message);
    process.exit(1);
  });
}
