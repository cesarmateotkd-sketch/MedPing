'use strict';

jest.mock('../../src/db', () => ({ query: jest.fn() }));
jest.mock('../../src/queues/reminderQueue', () => ({
  reminderQueue:   { add: jest.fn().mockResolvedValue(undefined) },
  scheduleReminder: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../src/services/adherence', () => ({
  getWeekStart:          jest.fn().mockReturnValue('2026-04-07'),
  updateWeeklyAdherence: jest.fn().mockResolvedValue(75),
}));
jest.mock('../../src/services/caregiver', () => ({
  checkAndAlertCaregivers: jest.fn().mockResolvedValue(undefined),
}));

process.env.SKIP_TWILIO_VALIDATION = 'true';
process.env.TWILIO_ACCOUNT_SID   = 'ACtest';
process.env.TWILIO_AUTH_TOKEN    = 'test_token';
process.env.TWILIO_PHONE_NUMBER  = '+15550000000';
process.env.DATABASE_URL         = 'postgres://test';
process.env.REDIS_URL            = 'redis://test';

const request = require('supertest');
const express = require('express');
const pool    = require('../../src/db');
const { scheduleReminder }        = require('../../src/queues/reminderQueue');
const { updateWeeklyAdherence }   = require('../../src/services/adherence');
const { checkAndAlertCaregivers } = require('../../src/services/caregiver');

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use('/sms', require('../../src/routes/sms'));
app.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));

const PATIENT = { id: 1, phone: '+12128675309', timezone: 'America/New_York', reminders_active: true };
const LOG     = { id: 42, patient_id: 1, medication_id: 10, med_name: 'Lisinopril', dose: '10mg', status: 'awaiting' };

function post(body) {
  return request(app).post('/sms/inbound').type('form').send({ From: PATIENT.phone, ...body });
}

beforeEach(() => {
  pool.query.mockReset();
  scheduleReminder.mockClear();
  updateWeeklyAdherence.mockClear();
  checkAndAlertCaregivers.mockClear();
});

test('unknown phone returns not-registered message', async () => {
  pool.query.mockResolvedValueOnce({ rows: [] });
  const res = await post({ Body: 'Y' });
  expect(res.status).toBe(200);
  expect(res.text).toContain('Thank you for contacting MedPing');
});

test('STOP disables reminders', async () => {
  pool.query.mockResolvedValueOnce({ rows: [PATIENT] }).mockResolvedValueOnce({ rows: [] });
  const res = await post({ Body: 'STOP' });
  expect(res.status).toBe(200);
  expect(res.text).toContain('unsubscribed');
  expect(pool.query.mock.calls[1][0]).toMatch(/reminders_active = FALSE/);
});

test('START re-enables reminders and re-schedules jobs', async () => {
  const meds = [
    { id: 10, reminder_time: '08:00:00' },
    { id: 11, reminder_time: '21:00:00' },
  ];
  pool.query
    .mockResolvedValueOnce({ rows: [PATIENT] })         // patient lookup
    .mockResolvedValueOnce({ rows: [] })                 // UPDATE reminders_active
    .mockResolvedValueOnce({ rows: meds, rowCount: 2 }); // SELECT medications

  const res = await post({ Body: 'START' });
  expect(res.status).toBe(200);
  expect(res.text).toContain('re-enabled');
  expect(scheduleReminder).toHaveBeenCalledTimes(2);
  expect(scheduleReminder).toHaveBeenCalledWith(1, 10, '08:00', 'America/New_York');
  expect(scheduleReminder).toHaveBeenCalledWith(1, 11, '21:00', 'America/New_York');
});

test('H returns help text', async () => {
  pool.query.mockResolvedValueOnce({ rows: [PATIENT] });
  const res = await post({ Body: 'H' });
  expect(res.text).toContain('MedPing commands');
});

test('HELP also returns help text', async () => {
  pool.query.mockResolvedValueOnce({ rows: [PATIENT] });
  const res = await post({ Body: 'HELP' });
  expect(res.text).toContain('MedPing commands');
});

test('Y confirms dose and updates adherence', async () => {
  pool.query
    .mockResolvedValueOnce({ rows: [PATIENT] })
    .mockResolvedValueOnce({ rows: [LOG] })
    .mockResolvedValueOnce({ rows: [] });

  const res = await post({ Body: 'Y' });
  expect(res.text).toContain('marked as taken');
  expect(updateWeeklyAdherence).toHaveBeenCalledWith(1, '2026-04-07');
});

test('YES also confirms', async () => {
  pool.query
    .mockResolvedValueOnce({ rows: [PATIENT] })
    .mockResolvedValueOnce({ rows: [LOG] })
    .mockResolvedValueOnce({ rows: [] });

  const res = await post({ Body: 'YES' });
  expect(res.text).toContain('marked as taken');
});

test('S snoozed and queues 15-min delayed job', async () => {
  pool.query
    .mockResolvedValueOnce({ rows: [PATIENT] })
    .mockResolvedValueOnce({ rows: [LOG] })
    .mockResolvedValueOnce({ rows: [] });

  const res = await post({ Body: 'S' });
  expect(res.text).toContain('15 minutes');
  const { reminderQueue } = require('../../src/queues/reminderQueue');
  expect(reminderQueue.add).toHaveBeenCalledWith(
    'send-reminder',
    { patientId: 1, medicationId: 10 },
    expect.objectContaining({ delay: 15 * 60 * 1000 })
  );
});

test('N skips dose, updates adherence, checks caregiver alerts', async () => {
  pool.query
    .mockResolvedValueOnce({ rows: [PATIENT] })
    .mockResolvedValueOnce({ rows: [LOG] })
    .mockResolvedValueOnce({ rows: [] });

  const res = await post({ Body: 'N' });
  expect(res.text).toContain('skipped');
  expect(updateWeeklyAdherence).toHaveBeenCalled();
  expect(checkAndAlertCaregivers).toHaveBeenCalledWith(1);
});

test('NO also skips', async () => {
  pool.query
    .mockResolvedValueOnce({ rows: [PATIENT] })
    .mockResolvedValueOnce({ rows: [LOG] })
    .mockResolvedValueOnce({ rows: [] });
  const res = await post({ Body: 'NO' });
  expect(res.text).toContain('skipped');
});

test('STATUS returns today schedule', async () => {
  pool.query
    .mockResolvedValueOnce({ rows: [PATIENT] })
    .mockResolvedValueOnce({ rowCount: 1, rows: [{ reminder_time: '08:00', name: 'Lisinopril', dose: '10mg', today_status: 'confirmed' }] });
  const res = await post({ Body: 'STATUS' });
  expect(res.text).toContain("Today's medications");
  expect(res.text).toContain('Lisinopril');
});

test('no pending log returns helpful message', async () => {
  pool.query.mockResolvedValueOnce({ rows: [PATIENT] }).mockResolvedValueOnce({ rows: [] });
  const res = await post({ Body: 'Y' });
  expect(res.text).toContain('No pending reminder');
});

test('unrecognized command returns helpful error', async () => {
  pool.query.mockResolvedValueOnce({ rows: [PATIENT] }).mockResolvedValueOnce({ rows: [LOG] });
  const res = await post({ Body: 'WHAT' });
  expect(res.text).toContain('Unrecognized command');
});
