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
  PORT:                 process.env.PORT || 3000,
  NODE_ENV:             process.env.NODE_ENV || 'development',
};
