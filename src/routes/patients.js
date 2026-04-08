'use strict';
const express      = require('express');
const router       = express.Router();
const pool         = require('../db');
const { scheduleReminder } = require('../queues/reminderQueue');
const { normalizePhone }   = require('../helpers/phone');
const asyncHandler         = require('../helpers/asyncHandler');

// POST /patients
router.post('/', asyncHandler(async (req, res) => {
  const { name, phone, timezone = 'UTC' } = req.body;

  if (!name || !phone) {
    return res.status(400).json({ error: 'name and phone are required' });
  }

  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) {
    return res.status(400).json({ error: 'Invalid phone number — must be valid E.164 or a recognized local format' });
  }

  const result = await pool.query(
    `INSERT INTO patients (name, phone, timezone)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [name, normalizedPhone, timezone]
  );

  res.status(201).json(result.rows[0]);
}));

// POST /patients/:id/medications
router.post('/:id/medications', asyncHandler(async (req, res) => {
  const patientId = parseInt(req.params.id, 10);
  const { name, dose, reminder_time, food_note } = req.body;

  if (!name || !dose || !reminder_time) {
    return res.status(400).json({ error: 'name, dose, and reminder_time are required' });
  }

  if (!/^\d{2}:\d{2}$/.test(reminder_time)) {
    return res.status(400).json({ error: 'reminder_time must be in HH:MM format (24-hour)' });
  }

  const patientResult = await pool.query(
    'SELECT * FROM patients WHERE id = $1',
    [patientId]
  );
  if (patientResult.rows.length === 0) {
    return res.status(404).json({ error: 'Patient not found' });
  }

  const patient = patientResult.rows[0];

  const medResult = await pool.query(
    `INSERT INTO medications (patient_id, name, dose, reminder_time, food_note)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [patientId, name, dose, reminder_time, food_note || null]
  );

  const medication = medResult.rows[0];

  if (patient.reminders_active) {
    await scheduleReminder(patientId, medication.id, reminder_time, patient.timezone);
  }

  res.status(201).json(medication);
}));

// GET /patients/:id/dashboard
router.get('/:id/dashboard', asyncHandler(async (req, res) => {
  const patientId = parseInt(req.params.id, 10);

  const patientResult = await pool.query(
    'SELECT * FROM patients WHERE id = $1',
    [patientId]
  );
  if (patientResult.rows.length === 0) {
    return res.status(404).json({ error: 'Patient not found' });
  }

  const patient = patientResult.rows[0];

  // Today's schedule — latest log status per medication for today in patient's tz
  const scheduleResult = await pool.query(
    `SELECT
       m.id,
       m.name,
       m.dose,
       TO_CHAR(m.reminder_time, 'HH24:MI') AS reminder_time,
       m.food_note,
       COALESCE(
         (SELECT rl.status
          FROM reminder_logs rl
          WHERE rl.medication_id = m.id
            AND DATE(rl.sent_at AT TIME ZONE $2) = DATE(NOW() AT TIME ZONE $2)
          ORDER BY rl.sent_at DESC
          LIMIT 1),
         'pending'
       ) AS today_status
     FROM medications m
     WHERE m.patient_id = $1
       AND m.active = TRUE
     ORDER BY m.reminder_time`,
    [patientId, patient.timezone]
  );

  // Last 4 weeks of adherence
  const adherenceResult = await pool.query(
    `SELECT week_start, pct
     FROM adherence_weekly
     WHERE patient_id = $1
     ORDER BY week_start DESC
     LIMIT 4`,
    [patientId]
  );

  res.json({
    patient: {
      id:               patient.id,
      name:             patient.name,
      phone:            patient.phone,
      timezone:         patient.timezone,
      reminders_active: patient.reminders_active,
    },
    today_schedule:   scheduleResult.rows,
    weekly_adherence: adherenceResult.rows,
  });
}));

module.exports = router;
