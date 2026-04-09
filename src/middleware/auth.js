'use strict';

const logger = require('../helpers/logger');

/**
 * Require the X-API-Key request header to match the API_KEY environment variable.
 *
 * Behaviour by environment:
 *   - API_KEY set      → enforce on all environments
 *   - API_KEY unset + NODE_ENV=production → reject every request (misconfiguration)
 *   - API_KEY unset + development/test    → allow with a one-time warning
 */
function requireApiKey(req, res, next) {
  const configuredKey = process.env.API_KEY;

  if (!configuredKey) {
    if (process.env.NODE_ENV === 'production') {
      logger.error('API_KEY is not set — blocking request in production');
      return res.status(503).json({ error: 'Server misconfiguration: API_KEY not set' });
    }
    // Development only — warn once and allow through.
    logger.warn('API_KEY not configured — auth disabled (development/test only)');
    return next();
  }

  const provided = req.headers['x-api-key'];
  if (!provided || provided !== configuredKey) {
    logger.warn('Unauthorized request', { ip: req.ip, path: req.originalUrl });
    return res.status(401).json({ error: 'Unauthorized — provide a valid X-API-Key header' });
  }

  next();
}

module.exports = requireApiKey;
