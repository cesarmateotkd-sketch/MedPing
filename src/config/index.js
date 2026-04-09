'use strict';
require('dotenv').config();

function requireEnv(name) {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required environment variable: ${name}`);
  return val;
}

module.exports = {
  TWILIO_ACCOUNT_SID:   requireEnv('TWILIO_ACCOUNT_SID'),
  TWILIO_AUTH_TOKEN:    requireEnv('TWILIO_AUTH_TOKEN'),
  TWILIO_PHONE_NUMBER:  requireEnv('TWILIO_PHONE_NUMBER'),
  DATABASE_URL:         requireEnv('DATABASE_URL'),
  REDIS_URL:            requireEnv('REDIS_URL'),

  // Optional — API key for protecting REST endpoints.
  // Must be set in production; in development access is allowed without it (with a warning).
  API_KEY:   process.env.API_KEY   || null,

  PORT:      process.env.PORT      || 3000,
  NODE_ENV:  process.env.NODE_ENV  || 'development',
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
};
