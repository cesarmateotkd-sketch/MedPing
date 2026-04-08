'use strict';
require('dotenv').config();

const express = require('express');
const config  = require('./config');

const app = express();

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

// URL-encoded parser must come BEFORE routes so Twilio webhook bodies are
// available in req.body when the signature-validation middleware runs.
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

app.use('/patients',    require('./routes/patients'));
app.use('/medications', require('./routes/medications'));
app.use('/sms',         require('./routes/sms'));

// Health check
app.get('/health', (_req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

// ---------------------------------------------------------------------------
// Global error handler
// ---------------------------------------------------------------------------
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  console.error('[app] Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
const PORT = Number(config.PORT);
app.listen(PORT, () => {
  console.log(`[app] MedPing listening on port ${PORT} (${config.NODE_ENV})`);
});

module.exports = app;
