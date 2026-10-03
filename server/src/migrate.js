'use strict';

/* `npm run migrate`: brings the database up to date and exits. The server
   also does this when it starts, so this is only for running it on its own. */

const { load } = require('./config');
const { createDb } = require('./db');

(async () => {
  const config = load();
  const db = createDb(config.databaseUrl, { max: 1 });
  try {
    const applied = await db.migrate();
    console.log(applied.length ? `applied: ${applied.join(', ')}` : 'already up to date');
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  } finally {
    await db.close();
  }
})();
