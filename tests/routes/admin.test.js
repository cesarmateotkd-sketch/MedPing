'use strict';

jest.mock('../../src/queues/reminderQueue', () => ({
  reminderQueue: {
    getWaitingCount:   jest.fn().mockResolvedValue(0),
    getActiveCount:    jest.fn().mockResolvedValue(0),
    getCompletedCount: jest.fn().mockResolvedValue(5),
    getFailedCount:    jest.fn().mockResolvedValue(1),
    getDelayedCount:   jest.fn().mockResolvedValue(0),
    getRepeatableJobs: jest.fn().mockResolvedValue([{ id: 'r1', pattern: '0 8 * * *', tz: 'UTC', next: 123 }]),
    getFailed:         jest.fn().mockResolvedValue([{
      id: 'f1', data: { patientId: 1, medicationId: 10 },
      failedReason: 'SMS error', attemptsMade: 3, finishedOn: Date.now(),
      retry: jest.fn().mockResolvedValue(undefined),
    }]),
  },
}));
delete process.env.API_KEY;

const request = require('supertest');
const express = require('express');
const { reminderQueue } = require('../../src/queues/reminderQueue');

const app = express();
app.use(express.json());
app.use('/admin', require('../../src/routes/admin'));
app.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));

beforeEach(() => {
  reminderQueue.getWaitingCount.mockClear();
  reminderQueue.getActiveCount.mockClear();
  reminderQueue.getCompletedCount.mockClear();
  reminderQueue.getFailedCount.mockClear();
  reminderQueue.getDelayedCount.mockClear();
  reminderQueue.getRepeatableJobs.mockClear();
  reminderQueue.getFailed.mockClear();
});

// ---------------------------------------------------------------------------
// GET /admin/queue
// ---------------------------------------------------------------------------
describe('GET /admin/queue', () => {
  test('200: returns counts object with keys waiting/active/completed/failed/delayed/repeatable', async () => {
    const res = await request(app).get('/admin/queue');
    expect(res.status).toBe(200);
    expect(res.body.counts).toMatchObject({
      waiting:    0,
      active:     0,
      completed:  5,
      failed:     1,
      delayed:    0,
      repeatable: 1,
    });
  });

  test('200: recent_failures array contains entry with id, data, reason, attempts, finished_at', async () => {
    const res = await request(app).get('/admin/queue');
    expect(res.status).toBe(200);
    expect(res.body.recent_failures).toHaveLength(1);
    const failure = res.body.recent_failures[0];
    expect(failure).toMatchObject({
      id:       'f1',
      data:     { patientId: 1, medicationId: 10 },
      reason:   'SMS error',
      attempts: 3,
    });
    expect(typeof failure.finished_at).toBe('string');
  });

  test('200: repeatable_jobs array contains entry with id, pattern, tz, next', async () => {
    const res = await request(app).get('/admin/queue');
    expect(res.status).toBe(200);
    expect(res.body.repeatable_jobs).toHaveLength(1);
    expect(res.body.repeatable_jobs[0]).toMatchObject({
      id:      'r1',
      pattern: '0 8 * * *',
      tz:      'UTC',
      next:    123,
    });
  });
});

// ---------------------------------------------------------------------------
// POST /admin/queue/retry-failed
// ---------------------------------------------------------------------------
describe('POST /admin/queue/retry-failed', () => {
  test('200: returns { retried: 1 } when one failed job exists', async () => {
    const res = await request(app).post('/admin/queue/retry-failed');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ retried: 1 });
  });

  test('200: returns { retried: 0 } when no failed jobs exist', async () => {
    reminderQueue.getFailed.mockResolvedValueOnce([]);
    const res = await request(app).post('/admin/queue/retry-failed');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ retried: 0 });
  });
});
