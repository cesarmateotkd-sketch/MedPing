'use strict';
const { normalizePhone } = require('../../src/helpers/phone');

// Use real NANP numbers (non-555 exchanges) so libphonenumber-js considers them valid.
// 212-867-5309 is the classic example with a valid 867 exchange.
const VALID_E164    = '+12128675309';
const VALID_DASHES  = '212-867-5309';
const VALID_10DIGIT = '2128675309';
const VALID_PARENS  = '(212) 867-5309';
const VALID_WITH_1  = '12128675309';

describe('normalizePhone', () => {
  test('returns E.164 for a valid US number with dashes', () => {
    expect(normalizePhone(VALID_DASHES)).toBe(VALID_E164);
  });

  test('returns E.164 for a number already in E.164 format', () => {
    expect(normalizePhone(VALID_E164)).toBe(VALID_E164);
  });

  test('returns E.164 for a 10-digit US number without formatting', () => {
    expect(normalizePhone(VALID_10DIGIT)).toBe(VALID_E164);
  });

  test('returns E.164 for a US number with country code prefix (no +)', () => {
    expect(normalizePhone(VALID_WITH_1)).toBe(VALID_E164);
  });

  test('returns E.164 for a number with parentheses and spaces', () => {
    expect(normalizePhone(VALID_PARENS)).toBe(VALID_E164);
  });

  test('returns null for a clearly invalid number', () => {
    expect(normalizePhone('not-a-phone')).toBeNull();
  });

  test('returns null for an empty string', () => {
    expect(normalizePhone('')).toBeNull();
  });

  test('returns null for a number that is too short', () => {
    expect(normalizePhone('123')).toBeNull();
  });

  test('returns E.164 for a valid UK number with country code', () => {
    // +44 7911 123456 is a valid UK mobile
    expect(normalizePhone('+447911123456')).toBe('+447911123456');
  });
});
