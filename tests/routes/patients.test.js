'use strict';

jest.mock('../../src/db', () => ({ query: jest.fn() }));
jest.mock('../../src/queues/reminderQueue', () => ({
  scheduleReminder: jest.fn().mockResolvedValue(undefined),
  cancelReminder:   jest.fn().mockResolvedValue(undefined),
  reminderQueue:    { add: jest.fn().mockResolvedValue(undefined) },
}));
// Mock normalizePhone to accept anything starting with '+', reject otherwise.
jest.mock('../../src/helpers/phone', () => ({
  normalizePhone: jest.fn((p) => String(p).startsWith('+') ? String(p) : null),
}));
// API_KEY not set in test → auth middleware allows through with a warning.
delete process.env.API_KEY;

const request = require('supertest');
const express = require('express');
const pool    = require('../../src/db');

const app = express();
app.use(express.json());
app.use('/patients', require('../../src/routes/patients'));
app.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));

beforeEach(() => pool.query.mockReset());

// ---------------------------------------------------------------------------
// GET /patients
// ---------------------------------------------------------------------------
describe('GET /patients', () => {
  test('returns paginated list', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 1, name: 'Alice' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ count: '1' }] });

    const res = await request(app).get('/patients');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.meta.total).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// POST /patients
// ---------------------------------------------------------------------------
describe('POST /patients', () => {
  test('creates patient and returns 201', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 1, phone: '+12128675309' }] });
    const res = await request(app).post('/patients').send({ name: 'Alice', phone: '+12128675309' });
    expect(res.status).toBe(201);
  });

  test('returns 400 for missing name', async () => {
    const res = await request(app).post('/patients').send({ phone: '+12128675309' });
    expect(res.status).toBe(400);
  });

  test('returns 400 for invalid phone', async () => {
    const res = await request(app).post('/patients').send({ name: 'Alice', phone: 'bad' });
    expect(res.status).toBe(400);
  });

  test('returns 400 for invalid timezone', async () => {
    const res = await request(app).post('/patients').send({ name: 'Alice', phone: '+12128675309', timezone: 'bad/Zone' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/timezone/i);
  });

  test('returns 409 on duplicate phone (pg error 23505)', async () => {
    pool.query.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: '23505' }));
    const res = await request(app).post('/patients').send({ name: 'Alice', phone: '+12128675309' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already exists/);
  });
});

// ---------------------------------------------------------------------------
// PUT /patients/:id
// ---------------------------------------------------------------------------
describe('PUT /patients/:id', () => {
  test('updates timezone and returns patient', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 1, timezone: 'Asia/Tokyo' }] });
    const res = await request(app).put('/patients/1').send({ timezone: 'Asia/Tokyo' });
    expect(res.status).toBe(200);
  });

  test('returns 400 for invalid timezone', async () => {
    const res = await request(app).put('/patients/1').send({ timezone: 'not/real' });
    expect(res.status).toBe(400);
  });

  test('returns 400 when no fields provided', async () => {
    const res = await request(app).put('/patients/1').send({});
    expect(res.status).toBe(400);
  });

  test('returns 400 for non-numeric ID', async () => {
    const res = await request(app).put('/patients/abc').send({ name: 'X' });
    expect(res.status).toBe(400);
  });

  test('returns 404 when patient not found', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).put('/patients/999').send({ name: 'Ghost' });
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// POST /patients/:id/medications
// ---------------------------------------------------------------------------
describe('POST /patients/:id/medications', () => {
  test('creates medication and schedules reminder', async () => {
    const patient = { id: 1, reminders_active: true, timezone: 'America/New_York' };
    const med     = { id: 10, name: 'Lisinopril', dose: '10mg' };
    pool.query.mockResolvedValueOnce({ rows: [patient] }).mockResolvedValueOnce({ rows: [med] });

    const res = await request(app)
      .post('/patients/1/medications')
      .send({ name: 'Lisinopril', dose: '10mg', reminder_time: '08:00' });

    expect(res.status).toBe(201);
    const { scheduleReminder } = require('../../src/queues/reminderQueue');
    expect(scheduleReminder).toHaveBeenCalled();
  });

  test('returns 400 for invalid reminder_time (bad hour)', async () => {
    const res = await request(app)
      .post('/patients/1/medications')
      .send({ name: 'X', dose: '1mg', reminder_time: '25:00' });
    expect(res.status).toBe(400);
  });

  test('returns 400 for non-numeric patient ID', async () => {
    const res = await request(app).post('/patients/abc/medications').send({ name: 'X', dose: '1mg', reminder_time: '08:00' });
    expect(res.status).toBe(400);
  });

  test('returns 404 when patient not found', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).post('/patients/999/medications').send({ name: 'X', dose: '1mg', reminder_time: '08:00' });
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// POST /patients/:id/caregivers
// ---------------------------------------------------------------------------
describe('POST /patients/:id/caregivers', () => {
  test('creates caregiver and returns 201', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 1 }] })
      .mockResolvedValueOnce({ rows: [{ id: 5, phone: '+19175550001' }] });

    const res = await request(app)
      .post('/patients/1/caregivers')
      .send({ name: 'Bob', phone: '+19175550001' });
    expect(res.status).toBe(201);
  });

  test('returns 400 for threshold = 0', async () => {
    const res = await request(app)
      .post('/patients/1/caregivers')
      .send({ name: 'Bob', phone: '+19175550001', threshold: 0 });
    expect(res.status).toBe(400);
  });

  test('returns 404 when patient not found', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app)
      .post('/patients/999/caregivers')
      .send({ name: 'Bob', phone: '+19175550001' });
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// GET /patients/:id/caregivers
// ---------------------------------------------------------------------------
describe('GET /patients/:id/caregivers', () => {
  test('returns caregiver list', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 1 }] })
      .mockResolvedValueOnce({ rows: [{ id: 5, name: 'Bob' }] });

    const res = await request(app).get('/patients/1/caregivers');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  test('returns 404 when patient not found', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/patients/999/caregivers');
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// GET /patients/:id/dashboard
// ---------------------------------------------------------------------------
describe('GET /patients/:id/dashboard', () => {
  test('returns dashboard data', async () => {
    const patient = { id: 1, name: 'Alice', phone: '+12128675309', timezone: 'UTC', reminders_active: true };
    pool.query
      .mockResolvedValueOnce({ rows: [patient] })
      .mockResolvedValueOnce({ rows: [{ name: 'Lisinopril', today_status: 'pending' }] })
      .mockResolvedValueOnce({ rows: [{ week_start: '2026-04-06', pct: '80.00' }] });

    const res = await request(app).get('/patients/1/dashboard');
    expect(res.status).toBe(200);
    expect(res.body.today_schedule).toHaveLength(1);
    expect(res.body.weekly_adherence[0].pct).toBe('80.00');
  });

  test('returns 400 for non-numeric ID', async () => {
    const res = await request(app).get('/patients/abc/dashboard');
    expect(res.status).toBe(400);
  });

  test('returns 404 when not found', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/patients/999/dashboard');
    expect(res.status).toBe(404);
  });
});
