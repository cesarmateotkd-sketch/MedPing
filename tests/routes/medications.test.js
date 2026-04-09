'use strict';

jest.mock('../../src/db', () => ({ query: jest.fn() }));
jest.mock('../../src/queues/reminderQueue', () => ({
  scheduleReminder: jest.fn().mockResolvedValue(undefined),
  cancelReminder:   jest.fn().mockResolvedValue(undefined),
  reminderQueue:    { add: jest.fn() },
}));
// API_KEY not set in test → auth middleware allows through with a warning.
delete process.env.API_KEY;

const request  = require('supertest');
const express  = require('express');
const pool     = require('../../src/db');

const app = express();
app.use(express.json());
app.use('/medications', require('../../src/routes/medications'));
app.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));

beforeEach(() => {
  pool.query.mockReset();
  const { scheduleReminder, cancelReminder } = require('../../src/queues/reminderQueue');
  scheduleReminder.mockClear();
  cancelReminder.mockClear();
});

// ---------------------------------------------------------------------------
// DELETE /medications/:id
// ---------------------------------------------------------------------------
describe('DELETE /medications/:id', () => {
  test('200: soft-deletes and calls cancelReminder', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 10, patient_id: 1 }] });

    const res = await request(app).delete('/medications/10');

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/deactivated/i);
    expect(res.body.medication).toMatchObject({ id: 10, patient_id: 1 });

    const { cancelReminder } = require('../../src/queues/reminderQueue');
    expect(cancelReminder).toHaveBeenCalledWith(1, 10);
  });

  test('400: non-numeric ID', async () => {
    const res = await request(app).delete('/medications/abc');
    expect(res.status).toBe(400);
  });

  test('404: not found (query returns empty rows)', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app).delete('/medications/999');
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// PUT /medications/:id
// ---------------------------------------------------------------------------
describe('PUT /medications/:id', () => {
  test('200: updates name only', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 10, patient_id: 1, name: 'NewName', dose: '10mg', reminder_time: '08:00' }],
    });

    const res = await request(app).put('/medications/10').send({ name: 'NewName' });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('NewName');

    const { scheduleReminder } = require('../../src/queues/reminderQueue');
    expect(scheduleReminder).not.toHaveBeenCalled();
  });

  test('200: updates reminder_time and reschedules', async () => {
    pool.query
      .mockResolvedValueOnce({
        rows: [{ id: 10, patient_id: 1, name: 'Lisinopril', dose: '10mg', reminder_time: '09:00' }],
      })
      .mockResolvedValueOnce({
        rows: [{ id: 1, timezone: 'America/New_York', reminders_active: true }],
      });

    const res = await request(app).put('/medications/10').send({ reminder_time: '09:00' });

    expect(res.status).toBe(200);

    const { scheduleReminder } = require('../../src/queues/reminderQueue');
    expect(scheduleReminder).toHaveBeenCalledWith(1, 10, '09:00', 'America/New_York');
  });

  test('400: no fields provided', async () => {
    const res = await request(app).put('/medications/10').send({});
    expect(res.status).toBe(400);
  });

  test('400: invalid reminder_time (25:00)', async () => {
    const res = await request(app).put('/medications/10').send({ reminder_time: '25:00' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/reminder_time/i);
  });

  test('400: non-numeric ID', async () => {
    const res = await request(app).put('/medications/abc').send({ name: 'X' });
    expect(res.status).toBe(400);
  });

  test('404: not found (query returns empty rows)', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app).put('/medications/999').send({ name: 'Ghost' });
    expect(res.status).toBe(404);
  });
});
