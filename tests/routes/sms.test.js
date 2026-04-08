'use strict';

// Mock all external I/O before requiring the router.
jest.mock('../../src/db', () => ({ query: jest.fn() }));
jest.mock('../../src/queues/reminderQueue', () => ({
  reminderQueue: { add: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock('../../src/services/adherence', () => ({
  getWeekStart:           jest.fn().mockReturnValue('2026-04-06'),
  updateWeeklyAdherence:  jest.fn().mockResolvedValue(75),
}));
jest.mock('../../src/services/caregiver', () => ({
  checkAndAlertCaregivers: jest.fn().mockResolvedValue(undefined),
}));
// Skip Twilio signature validation in tests.
process.env.SKIP_TWILIO_VALIDATION = 'true';
// Satisfy config requireEnv() calls.
process.env.TWILIO_ACCOUNT_SID    = 'ACtest';
process.env.TWILIO_AUTH_TOKEN     = 'test_token';
process.env.TWILIO_PHONE_NUMBER   = '+15550000000';
process.env.DATABASE_URL          = 'postgres://test';
process.env.REDIS_URL             = 'redis://test';

const request = require('supertest');
const express = require('express');
const pool    = require('../../src/db');
const { updateWeeklyAdherence }  = require('../../src/services/adherence');
const { checkAndAlertCaregivers } = require('../../src/services/caregiver');

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use('/sms', require('../../src/routes/sms'));
app.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));

const PATIENT = {
  id: 1,
  phone: '+15551234567',
  timezone: 'America/New_York',
  reminders_active: true,
};

const AWAITING_LOG = {
  id:           42,
  patient_id:   1,
  medication_id: 10,
  med_name:     'Lisinopril',
  dose:         '10mg',
  status:       'awaiting',
};

function post(body) {
  return request(app)
    .post('/sms/inbound')
    .type('form')
    .send({ From: PATIENT.phone, ...body });
}

beforeEach(() => {
  pool.query.mockReset();
  updateWeeklyAdherence.mockClear();
  checkAndAlertCaregivers.mockClear();
});

// ---------------------------------------------------------------------------
// Unknown phone
// ---------------------------------------------------------------------------
test('returns TwiML error for unknown phone number', async () => {
  pool.query.mockResolvedValueOnce({ rows: [] }); // no patient found
  const res = await post({ Body: 'Y' });
  expect(res.status).toBe(200);
  expect(res.text).toContain('not registered');
});

// ---------------------------------------------------------------------------
// STOP / START
// ---------------------------------------------------------------------------
test('STOP disables reminders and responds with unsubscribe message', async () => {
  pool.query
    .mockResolvedValueOnce({ rows: [PATIENT] }) // patient lookup
    .mockResolvedValueOnce({ rows: [] });        // update

  const res = await post({ Body: 'STOP' });
  expect(res.status).toBe(200);
  expect(res.text).toContain('unsubscribed');
  expect(pool.query.mock.calls[1][0]).toMatch(/reminders_active = FALSE/);
});

test('START re-enables reminders', async () => {
  pool.query
    .mockResolvedValueOnce({ rows: [PATIENT] })
    .mockResolvedValueOnce({ rows: [] });

  const res = await post({ Body: 'START' });
  expect(res.status).toBe(200);
  expect(res.text).toContain('re-enabled');
});

// ---------------------------------------------------------------------------
// HELP
// ---------------------------------------------------------------------------
test('H returns help text', async () => {
  pool.query.mockResolvedValueOnce({ rows: [PATIENT] });
  const res = await post({ Body: 'H' });
  expect(res.status).toBe(200);
  expect(res.text).toContain('MedPing commands');
});

test('HELP returns help text', async () => {
  pool.query.mockResolvedValueOnce({ rows: [PATIENT] });
  const res = await post({ Body: 'HELP' });
  expect(res.status).toBe(200);
  expect(res.text).toContain('MedPing commands');
});

// ---------------------------------------------------------------------------
// Y / YES — confirm
// ---------------------------------------------------------------------------
test('Y marks awaiting log as confirmed and updates adherence', async () => {
  pool.query
    .mockResolvedValueOnce({ rows: [PATIENT] })       // patient
    .mockResolvedValueOnce({ rows: [AWAITING_LOG] })  // awaiting log
    .mockResolvedValueOnce({ rows: [] });              // UPDATE

  const res = await post({ Body: 'Y' });
  expect(res.status).toBe(200);
  expect(res.text).toContain('marked as taken');
  expect(updateWeeklyAdherence).toHaveBeenCalledWith(1, '2026-04-06');
});

test('YES also works', async () => {
  pool.query
    .mockResolvedValueOnce({ rows: [PATIENT] })
    .mockResolvedValueOnce({ rows: [AWAITING_LOG] })
    .mockResolvedValueOnce({ rows: [] });

  const res = await post({ Body: 'YES' });
  expect(res.status).toBe(200);
  expect(res.text).toContain('marked as taken');
});

// ---------------------------------------------------------------------------
// S / SNOOZE
// ---------------------------------------------------------------------------
test('S marks log as snoozed and queues a 15-min delayed job', async () => {
  const { reminderQueue } = require('../../src/queues/reminderQueue');
  pool.query
    .mockResolvedValueOnce({ rows: [PATIENT] })
    .mockResolvedValueOnce({ rows: [AWAITING_LOG] })
    .mockResolvedValueOnce({ rows: [] });

  const res = await post({ Body: 'S' });
  expect(res.status).toBe(200);
  expect(res.text).toContain('15 minutes');
  expect(reminderQueue.add).toHaveBeenCalledWith(
    'send-reminder',
    { patientId: 1, medicationId: 10 },
    expect.objectContaining({ delay: 15 * 60 * 1000 })
  );
});

// ---------------------------------------------------------------------------
// N / NO — skip
// ---------------------------------------------------------------------------
test('N marks log as skipped, updates adherence, and checks caregiver alerts', async () => {
  pool.query
    .mockResolvedValueOnce({ rows: [PATIENT] })
    .mockResolvedValueOnce({ rows: [AWAITING_LOG] })
    .mockResolvedValueOnce({ rows: [] });

  const res = await post({ Body: 'N' });
  expect(res.status).toBe(200);
  expect(res.text).toContain('skipped');
  expect(updateWeeklyAdherence).toHaveBeenCalledWith(1, '2026-04-06');
  expect(checkAndAlertCaregivers).toHaveBeenCalledWith(1);
});

// ---------------------------------------------------------------------------
// No pending log
// ---------------------------------------------------------------------------
test('returns helpful message when no awaiting log exists', async () => {
  pool.query
    .mockResolvedValueOnce({ rows: [PATIENT] })
    .mockResolvedValueOnce({ rows: [] }); // no awaiting log

  const res = await post({ Body: 'Y' });
  expect(res.status).toBe(200);
  expect(res.text).toContain('No pending reminder');
});

// ---------------------------------------------------------------------------
// Unknown command
// ---------------------------------------------------------------------------
test('unrecognized command returns helpful error', async () => {
  pool.query
    .mockResolvedValueOnce({ rows: [PATIENT] })
    .mockResolvedValueOnce({ rows: [AWAITING_LOG] });

  const res = await post({ Body: 'WHAT' });
  expect(res.status).toBe(200);
  expect(res.text).toContain('Unrecognized command');
});

// ---------------------------------------------------------------------------
// STATUS
// ---------------------------------------------------------------------------
test('STATUS returns today schedule', async () => {
  pool.query
    .mockResolvedValueOnce({ rows: [PATIENT] })
    .mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ reminder_time: '08:00', name: 'Lisinopril', dose: '10mg', today_status: 'confirmed' }],
    });

  const res = await post({ Body: 'STATUS' });
  expect(res.status).toBe(200);
  expect(res.text).toContain("Today's medications");
  expect(res.text).toContain('Lisinopril');
});
