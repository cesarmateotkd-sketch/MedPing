'use strict';
/**
 * Versioned migration runner.
 *
 * - Only requires DATABASE_URL (and optionally DB_SSL) — no Twilio credentials needed.
 * - Reads .sql files from src/db/migrations/ in alphabetical order.
 * - Tracks applied migrations in the schema_migrations table.
 * - Each migration runs in its own transaction; a failure rolls back and aborts.
 */
require('dotenv').config();

const { readFileSync, readdirSync } = require('fs');
const path  = require('path');
const { Pool } = require('pg');

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('[migrate] DATABASE_URL is required');
  process.exit(1);
}

const useSSL =
  process.env.DB_SSL === 'true' ||
  url.includes('sslmode=require') ||
  url.includes('ssl=true');

const pool = new Pool({
  connectionString: url,
  ...(useSSL ? { ssl: { rejectUnauthorized: false } } : {}),
});

const MIGRATIONS_DIR = path.join(__dirname, '../src/db/migrations');

async function migrate() {
  const client = await pool.connect();
  try {
    // Bootstrap the migration tracking table.
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version    TEXT        PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const applied = new Set(
      (await client.query('SELECT version FROM schema_migrations ORDER BY version')).rows.map(
        (r) => r.version
      )
    );

    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort(); // lexicographic → 001_, 002_, ...

    let count = 0;
    for (const file of files) {
      if (applied.has(file)) {
        console.log(`[migrate] skip  ${file}`);
        continue;
      }

      const sql = readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      console.log(`[migrate] apply ${file}`);

      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
      await client.query('COMMIT');
      count++;
    }

    console.log(
      count === 0
        ? '[migrate] Already up to date.'
        : `[migrate] Applied ${count} migration(s).`
    );
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch((err) => {
  console.error('[migrate] Failed:', err.message);
  process.exit(1);
});
