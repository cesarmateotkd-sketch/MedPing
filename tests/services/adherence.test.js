'use strict';

// Mock the pg pool so this test file has no DB dependency.
jest.mock('../../src/db', () => ({ query: jest.fn() }));

const { getWeekStart, updateWeeklyAdherence } = require('../../src/services/adherence');
const pool = require('../../src/db');

describe('getWeekStart', () => {
  test('returns the Monday of the current week in UTC by default', () => {
    // 2026-04-08 is a Wednesday in UTC
    const result = getWeekStart('UTC', new Date('2026-04-08T12:00:00Z'));
    expect(result).toBe('2026-04-06'); // Monday
  });

  test('returns the Monday for a Sunday (edge case)', () => {
    // 2026-04-05 is a Sunday
    const result = getWeekStart('UTC', new Date('2026-04-05T12:00:00Z'));
    expect(result).toBe('2026-03-30'); // previous Monday
  });

  test('returns the Monday for a Monday itself', () => {
    const result = getWeekStart('UTC', new Date('2026-04-06T12:00:00Z'));
    expect(result).toBe('2026-04-06');
  });

  test('accounts for patient timezone — UTC midnight is still Sunday in New York', () => {
    // 2026-04-06 00:30 UTC = 2026-04-05 20:30 EDT (Sunday in New York)
    const result = getWeekStart('America/New_York', new Date('2026-04-06T00:30:00Z'));
    expect(result).toBe('2026-03-30'); // previous Monday, not 2026-04-06
  });

  test('accounts for positive UTC offset — Tokyo is ahead', () => {
    // 2026-04-05 23:00 UTC = 2026-04-06 08:00 JST (Monday in Tokyo)
    const result = getWeekStart('Asia/Tokyo', new Date('2026-04-05T23:00:00Z'));
    expect(result).toBe('2026-04-06');
  });

  test('returns a YYYY-MM-DD string', () => {
    const result = getWeekStart('UTC', new Date('2026-04-08T00:00:00Z'));
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('updateWeeklyAdherence', () => {
  beforeEach(() => {
    pool.query.mockReset();
  });

  test('calculates 100% when all are confirmed', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ confirmed: '3', total: '3' }] }) // SELECT
      .mockResolvedValueOnce({ rows: [] }); // UPSERT

    const pct = await updateWeeklyAdherence(1, '2026-04-06');
    expect(pct).toBeCloseTo(100);
  });

  test('calculates 0% when total is 0 (no resolved logs)', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ confirmed: '0', total: '0' }] })
      .mockResolvedValueOnce({ rows: [] });

    const pct = await updateWeeklyAdherence(1, '2026-04-06');
    expect(pct).toBe(0);
  });

  test('calculates correct percentage for mixed results', async () => {
    // 2 confirmed, 1 skipped = 2/3 = 66.67%
    pool.query
      .mockResolvedValueOnce({ rows: [{ confirmed: '2', total: '3' }] })
      .mockResolvedValueOnce({ rows: [] });

    const pct = await updateWeeklyAdherence(1, '2026-04-06');
    expect(pct).toBeCloseTo(66.67, 1);
  });

  test('upserts with formatted percentage string', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ confirmed: '1', total: '2' }] })
      .mockResolvedValueOnce({ rows: [] });

    await updateWeeklyAdherence(1, '2026-04-06');

    const upsertCall = pool.query.mock.calls[1];
    expect(upsertCall[1][2]).toBe('50.00'); // pct as string with 2 decimals
  });
});
