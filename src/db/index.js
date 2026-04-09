'use strict';
// Load .env before reading process.env.  Idempotent — safe to call multiple times.
require('dotenv').config();

const { Pool } = require('pg');
const logger   = require('../helpers/logger');

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL environment variable is required');

// Enable SSL for managed cloud databases.
// Triggered by: DB_SSL=true  OR  "sslmode=require" / "ssl=true" in the connection string.
const useSSL =
  process.env.DB_SSL === 'true' ||
  url.includes('sslmode=require') ||
  url.includes('ssl=true');

const pool = new Pool({
  connectionString: url,
  ...(useSSL ? { ssl: { rejectUnauthorized: false } } : {}),
});

pool.on('error', (err) => {
  logger.error('Unexpected PostgreSQL client error', { message: err.message, code: err.code });
});

module.exports = pool;
