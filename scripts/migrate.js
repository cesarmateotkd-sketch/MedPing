'use strict';
require('dotenv').config();

const { readFileSync } = require('fs');
const path = require('path');
const pool = require('../src/db');

async function migrate() {
  const schema = readFileSync(
    path.join(__dirname, '../src/db/schema.sql'),
    'utf8'
  );

  console.log('[migrate] Applying schema...');
  await pool.query(schema);
  console.log('[migrate] Done.');
  await pool.end();
}

migrate().catch((err) => {
  console.error('[migrate] Failed:', err.message);
  process.exit(1);
});
