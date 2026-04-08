'use strict';
const { parsePhoneNumber } = require('libphonenumber-js');

/**
 * Normalize a phone number string to E.164 format.
 * @param {string} phone           - Raw phone number string.
 * @param {string} [defaultCountry='US'] - ISO 3166-1 alpha-2 country code for numbers without a country prefix.
 * @returns {string|null} E.164 formatted number, or null if invalid.
 */
function normalizePhone(phone, defaultCountry = 'US') {
  try {
    const parsed = parsePhoneNumber(String(phone), defaultCountry);
    if (parsed && parsed.isValid()) {
      return parsed.format('E.164');
    }
    return null;
  } catch {
    return null;
  }
}

module.exports = { normalizePhone };
