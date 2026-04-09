'use strict';

/**
 * Minimal structured JSON logger.
 * Writes to stdout (info/debug) or stderr (warn/error).
 * Redacts known-sensitive keys before serializing.
 *
 * Set LOG_LEVEL=debug|info|warn|error in the environment (default: info).
 */

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const maxLevel = LEVELS[process.env.LOG_LEVEL] ?? LEVELS.info;

// Any key whose lowercased name contains one of these strings is redacted.
const SENSITIVE = ['password', 'token', 'secret', 'authorization', 'database_url', 'redis_url', 'api_key'];

function redact(value, depth = 0) {
  if (depth > 5 || value === null || typeof value !== 'object') return value;
  if (value instanceof Error) {
    // Expose only safe fields — never the full stack which may contain DSNs.
    return { name: value.name, message: value.message, code: value.code };
  }
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    const lk = k.toLowerCase();
    out[k] = SENSITIVE.some((s) => lk.includes(s)) ? '[REDACTED]' : redact(v, depth + 1);
  }
  return out;
}

function write(level, msg, meta) {
  if ((LEVELS[level] ?? 99) > maxLevel) return;
  const entry = {
    ts:    new Date().toISOString(),
    level,
    msg,
    ...(meta !== undefined ? redact(meta) : {}),
  };
  const line = JSON.stringify(entry) + '\n';
  if (level === 'error' || level === 'warn') process.stderr.write(line);
  else process.stdout.write(line);
}

const logger = {
  error: (msg, meta) => write('error', msg, meta),
  warn:  (msg, meta) => write('warn',  msg, meta),
  info:  (msg, meta) => write('info',  msg, meta),
  debug: (msg, meta) => write('debug', msg, meta),
};

module.exports = logger;
