'use strict';

/* Postgres. One pool for the process; `tx` runs a function inside a
   transaction and hands it the same small interface the pool has, so every
   service function takes a `q` and works either way. */

const fs = require('fs');
const path = require('path');
const { Pool, types } = require('pg');

// count(*) and other int8s arrive as strings by default; every one this
// server reads fits comfortably in a double.
types.setTypeParser(20, (v) => Number(v));

const MIGRATIONS = path.resolve(__dirname, '../migrations');
// Any constant will do; it only has to be the same in every process.
const MIGRATION_LOCK = 4407001;

function wrap(client) {
  return {
    query: (text, params) => client.query(text, params),
    one: async (text, params) => (await client.query(text, params)).rows[0] || null,
    many: async (text, params) => (await client.query(text, params)).rows,
  };
}

function createDb(url, options) {
  const pool = new Pool({ connectionString: url, max: (options && options.max) || 10 });
  pool.on('error', (err) => console.error('[db] idle client error:', err.message));

  const db = Object.assign(wrap(pool), {
    pool,

    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const result = await fn(wrap(client));
        await client.query('commit');
        return result;
      } catch (err) {
        try { await client.query('rollback'); } catch (e) { /* the original error matters more */ }
        throw err;
      } finally {
        client.release();
      }
    },

    /** Applies every migration not yet applied, in file-name order. */
    async migrate() {
      const client = await pool.connect();
      try {
        // Two servers starting at once must not both run the same migration.
        await client.query('select pg_advisory_lock($1)', [MIGRATION_LOCK]);
        await client.query(`create table if not exists schema_migrations (
          name text primary key, applied_at timestamptz not null default now())`);
        const done = new Set((await client.query('select name from schema_migrations')).rows.map((r) => r.name));
        const files = fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
        const applied = [];
        for (const file of files) {
          if (done.has(file)) continue;
          const sql = fs.readFileSync(path.join(MIGRATIONS, file), 'utf8');
          await client.query('begin');
          try {
            await client.query(sql);
            await client.query('insert into schema_migrations (name) values ($1)', [file]);
            await client.query('commit');
            applied.push(file);
          } catch (err) {
            await client.query('rollback');
            throw new Error(`migration ${file} failed: ${err.message}`);
          }
        }
        return applied;
      } finally {
        try { await client.query('select pg_advisory_unlock($1)', [MIGRATION_LOCK]); } catch (e) { /* closing anyway */ }
        client.release();
      }
    },

    close: () => pool.end(),
  });

  return db;
}

module.exports = { createDb };
