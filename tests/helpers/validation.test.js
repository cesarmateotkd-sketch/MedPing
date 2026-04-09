'use strict';
const { parseId, isValidReminderTime, isValidTimezone } = require('../../src/helpers/validation');

describe('parseId', () => {
  test('returns the integer for a valid positive ID string', () => expect(parseId('5')).toBe(5));
  test('returns null for zero',           () => expect(parseId('0')).toBeNull());
  test('returns null for negative',       () => expect(parseId('-1')).toBeNull());
  test('returns null for non-numeric',    () => expect(parseId('abc')).toBeNull());
  test('returns null for empty string',   () => expect(parseId('')).toBeNull());
  test('returns null for float string',   () => expect(parseId('1.5')).toBeNull());
});

describe('isValidReminderTime', () => {
  test('accepts 00:00',  () => expect(isValidReminderTime('00:00')).toBe(true));
  test('accepts 23:59',  () => expect(isValidReminderTime('23:59')).toBe(true));
  test('accepts 08:30',  () => expect(isValidReminderTime('08:30')).toBe(true));
  test('rejects 24:00',  () => expect(isValidReminderTime('24:00')).toBe(false));
  test('rejects 08:60',  () => expect(isValidReminderTime('08:60')).toBe(false));
  test('rejects 8:00',   () => expect(isValidReminderTime('8:00')).toBe(false));
  test('rejects letters',() => expect(isValidReminderTime('ab:cd')).toBe(false));
  test('rejects empty',  () => expect(isValidReminderTime('')).toBe(false));
});

describe('isValidTimezone', () => {
  test('accepts UTC',                  () => expect(isValidTimezone('UTC')).toBe(true));
  test('accepts America/New_York',     () => expect(isValidTimezone('America/New_York')).toBe(true));
  test('accepts Asia/Tokyo',           () => expect(isValidTimezone('Asia/Tokyo')).toBe(true));
  test('rejects garbage string',       () => expect(isValidTimezone('bad/Zone')).toBe(false));
  test('rejects empty string',         () => expect(isValidTimezone('')).toBe(false));
  test('rejects null',                 () => expect(isValidTimezone(null)).toBe(false));
});
