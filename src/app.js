'use strict';
// config loads dotenv — must come before any other src/ module.
const config = require('./config');
const express    = require('express');
const rateLimit  = require('express-rate-limit');
const pool       = require('./db');
const logger     = require('./helpers/logger');
const asyncHandler = require('./helpers/asyncHandler');
const { connection: redisConnection } = require('./queues/reminderQueue');

const app = express();

// ---------------------------------------------------------------------------
// Body parsers
// URL-encoded must be registered BEFORE the SMS route so req.body is
// populated when Twilio signature validation middleware runs.
// ---------------------------------------------------------------------------
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// ---------------------------------------------------------------------------
// Rate limiting for REST API endpoints
// (SMS endpoint has its own per-phone limiter in routes/sms.js)
// ---------------------------------------------------------------------------
const restLimiter = rateLimit({
  windowMs:        60 * 1000,  // 1 minute
  max:             120,         // 120 req/min per IP
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: 'Too many requests — slow down and try again' },
});

app.use('/patients',    restLimiter);
app.use('/medications', restLimiter);
app.use('/caregivers',  restLimiter);
app.use('/admin',       restLimiter);

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
app.use('/patients',    require('./routes/patients'));
app.use('/medications', require('./routes/medications'));
app.use('/caregivers',  require('./routes/caregivers'));
app.use('/sms',         require('./routes/sms'));
app.use('/admin',       require('./routes/admin'));

// ---------------------------------------------------------------------------
// Health check — validates live connectivity to PostgreSQL and Redis.
// Returns 200 when both are reachable, 503 otherwise.
// Intentionally unauthenticated so load balancers can poll it freely.
// ---------------------------------------------------------------------------
app.get('/health', asyncHandler(async (_req, res) => {
  const [pgResult, redisResult] = await Promise.allSettled([
    pool.query('SELECT 1'),
    redisConnection.ping(),
  ]);

  const checks = {
    postgres: pgResult.status   === 'fulfilled' ? 'ok' : 'error',
    redis:    redisResult.status === 'fulfilled' ? 'ok' : 'error',
  };

  const healthy = Object.values(checks).every((v) => v === 'ok');
  res
    .status(healthy ? 200 : 503)
    .json({ status: healthy ? 'ok' : 'degraded', checks, ts: new Date().toISOString() });
}));

// ---------------------------------------------------------------------------
// Global error handler
// Logs a sanitized version (no stack traces, no DSNs) and returns a generic
// message to the client so internal details are never exposed.
// ---------------------------------------------------------------------------
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  logger.error('Unhandled request error', {
    method:  req.method,
    path:    req.path,
    name:    err.name,
    message: err.message,
    code:    err.code,
  });
  res.status(500).json({ error: 'Internal server error' });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
const PORT = Number(config.PORT);
app.listen(PORT, () => {
  logger.info('MedPing server started', { port: PORT, env: config.NODE_ENV });
});

module.exports = app;
