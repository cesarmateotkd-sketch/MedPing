'use strict';

// Mock all external I/O and phone helper (route tests focus on logic, not validation lib).
jest.mock('../../src/db', () => ({ query: jest.fn() }));
jest.mock('../../src/queues/reminderQueue', () => ({
  scheduleReminder: jest.fn().mockResolvedValue(undefined),
  cancelReminder:   jest.fn().mockResolvedValue(undefined),
  reminderQueue:    { add: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock('../../src/helpers/phone', () => ({
  // Treat anything starting with '+' as already normalized; reject everything else.
  normalizePhone: jest.fn((phone) => {
    const s = String(phone);
    return s.startsWith('+') ? s : null;
  }),
}));

const request = require('supertest');
const express = require('express');
const pool    = require('../../src/db');

// Build a minimal app that mounts only the patients router.
const app = express();
app.use(express.json());
app.use('/patients', require('../../src/routes/patients'));
app.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));

beforeEach(() => pool.query.mockReset());

// ---------------------------------------------------------------------------
// POST /patients
// ---------------------------------------------------------------------------
describe('POST /patients', () => {
  test('creates a patient and returns 201', async () => {
    const row = { id: 1, name: 'Alice', phone: '+12128675309', timezone: 'UTC', reminders_active: true };
    pool.query.mockResolvedValueOnce({ rows: [row] });

    const res = await request(app)
      .post('/patients')
      .send({ name: 'Alice', phone: '+12128675309' });

    expect(res.status).toBe(201);
    expect(res.body.phone).toBe('+12128675309');
  });

  test('passes normalized phone to DB', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 2, phone: '+19175550001' }] });

    const res = await request(app)
      .post('/patients')
      .send({ name: 'Bob', phone: '+19175550001' });

    expect(res.status).toBe(201);
    expect(pool.query.mock.calls[0][1][1]).toBe('+19175550001');
  });

  test('returns 400 when name is missing', async () => {
    const res = await request(app).post('/patients').send({ phone: '+12128675309' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/name/);
  });

  test('returns 400 for an invalid phone number', async () => {
    // Mock returns null for non-E.164
    const res = await request(app).post('/patients').send({ name: 'Alice', phone: 'bad-phone' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/phone/i);
  });
});

// ---------------------------------------------------------------------------
// POST /patients/:id/medications
// ---------------------------------------------------------------------------
describe('POST /patients/:id/medications', () => {
  test('creates a medication and schedules a reminder', async () => {
    const patient = { id: 1, reminders_active: true, timezone: 'America/New_York' };
    const med     = { id: 10, patient_id: 1, name: 'Lisinopril', dose: '10mg', reminder_time: '08:00:00' };

    pool.query
      .mockResolvedValueOnce({ rows: [patient] })
      .mockResolvedValueOnce({ rows: [med] });

    const res = await request(app)
      .post('/patients/1/medications')
      .send({ name: 'Lisinopril', dose: '10mg', reminder_time: '08:00' });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Lisinopril');

    const { scheduleReminder } = require('../../src/queues/reminderQueue');
    expect(scheduleReminder).toHaveBeenCalledWith(1, 10, '08:00', 'America/New_York');
  });

  test('returns 400 for a non-numeric patient ID', async () => {
    const res = await request(app)
      .post('/patients/abc/medications')
      .send({ name: 'X', dose: '1mg', reminder_time: '08:00' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid patient ID/);
  });

  test('returns 400 for out-of-range hour in reminder_time', async () => {
    const res = await request(app)
      .post('/patients/1/medications')
      .send({ name: 'X', dose: '1mg', reminder_time: '25:00' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/reminder_time/);
  });

  test('returns 400 for out-of-range minute in reminder_time', async () => {
    const res = await request(app)
      .post('/patients/1/medications')
      .send({ name: 'X', dose: '1mg', reminder_time: '08:60' });
    expect(res.status).toBe(400);
  });

  test('returns 400 for bad reminder_time format (single digit hour)', async () => {
    const res = await request(app)
      .post('/patients/1/medications')
      .send({ name: 'X', dose: '1mg', reminder_time: '8:00' });
    expect(res.status).toBe(400);
  });

  test('returns 404 when patient does not exist', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app)
      .post('/patients/999/medications')
      .send({ name: 'X', dose: '1mg', reminder_time: '08:00' });
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// POST /patients/:id/caregivers
// ---------------------------------------------------------------------------
describe('POST /patients/:id/caregivers', () => {
  test('creates a caregiver and returns 201', async () => {
    const caregiver = { id: 1, patient_id: 1, name: 'Bob', phone: '+19175550001', threshold: 3 };
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 1 }] })  // patient check
      .mockResolvedValueOnce({ rows: [caregiver] });  // insert

    const res = await request(app)
      .post('/patients/1/caregivers')
      .send({ name: 'Bob', phone: '+19175550001', threshold: 3 });

    expect(res.status).toBe(201);
    expect(res.body.phone).toBe('+19175550001');
  });

  test('defaults threshold to 3 when omitted', async () => {
    const caregiver = { id: 2, patient_id: 1, name: 'Carol', phone: '+19175550002', threshold: 3 };
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 1 }] })
      .mockResolvedValueOnce({ rows: [caregiver] });

    const res = await request(app)
      .post('/patients/1/caregivers')
      .send({ name: 'Carol', phone: '+19175550002' });

    expect(res.status).toBe(201);
    // threshold should be 3 in the DB call
    expect(pool.query.mock.calls[1][1][4]).toBe(3);
  });

  test('returns 400 for invalid threshold (zero)', async () => {
    const res = await request(app)
      .post('/patients/1/caregivers')
      .send({ name: 'Bob', phone: '+19175550001', threshold: 0 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/threshold/);
  });

  test('returns 400 for invalid phone', async () => {
    const res = await request(app)
      .post('/patients/1/caregivers')
      .send({ name: 'Bob', phone: 'bad-phone' });
    expect(res.status).toBe(400);
  });

  test('returns 404 when patient does not exist', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app)
      .post('/patients/999/caregivers')
      .send({ name: 'Bob', phone: '+19175550001' });
    expect(res.status).toBe(404);
  });

  test('returns 400 for non-numeric patient ID', async () => {
    const res = await request(app)
      .post('/patients/bad/caregivers')
      .send({ name: 'Bob', phone: '+19175550001' });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// GET /patients/:id/dashboard
// ---------------------------------------------------------------------------
describe('GET /patients/:id/dashboard', () => {
  test('returns dashboard with schedule and adherence', async () => {
    const patient   = { id: 1, name: 'Alice', phone: '+12128675309', timezone: 'UTC', reminders_active: true };
    const meds      = [{ id: 10, name: 'Lisinopril', dose: '10mg', reminder_time: '08:00', food_note: null, today_status: 'confirmed' }];
    const adherence = [{ week_start: '2026-04-06', pct: '100.00' }];

    pool.query
      .mockResolvedValueOnce({ rows: [patient] })
      .mockResolvedValueOnce({ rows: meds })
      .mockResolvedValueOnce({ rows: adherence });

    const res = await request(app).get('/patients/1/dashboard');

    expect(res.status).toBe(200);
    expect(res.body.patient.name).toBe('Alice');
    expect(res.body.today_schedule).toHaveLength(1);
    expect(res.body.weekly_adherence[0].pct).toBe('100.00');
  });

  test('returns 400 for non-numeric ID', async () => {
    const res = await request(app).get('/patients/abc/dashboard');
    expect(res.status).toBe(400);
  });

  test('returns 404 when patient not found', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/patients/999/dashboard');
    expect(res.status).toBe(404);
  });
});
