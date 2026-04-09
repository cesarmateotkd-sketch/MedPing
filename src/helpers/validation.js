'use strict';

/**
 * Parse a route :id parameter to a positive integer.
 * Returns null for non-numeric, zero, or negative values.
 *
 * @param {string} str
 * @returns {number|null}
 */
function parseId(str) {
  if (!/^\d+$/.test(str)) return null;
  const n = parseInt(str, 10);
  return n > 0 ? n : null;
}

/**
 * Validate that a time string is "HH:MM" with a valid 24-hour hour and minute.
 *
 * @param {string} t
 * @returns {boolean}
 */
function isValidReminderTime(t) {
  if (!/^\d{2}:\d{2}$/.test(t)) return false;
  const [h, m] = t.split(':').map(Number);
  return h >= 0 && h <= 23 && m >= 0 && m <= 59;
}

/**
 * Validate an IANA timezone string using the platform's Intl support.
 * Rejects anything that Intl.DateTimeFormat cannot resolve.
 *
 * @param {string} tz
 * @returns {boolean}
 */
function isValidTimezone(tz) {
  if (!tz || typeof tz !== 'string') return false;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

module.exports = { parseId, isValidReminderTime, isValidTimezone };
