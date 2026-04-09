'use strict';
const express      = require('express');
const router       = express.Router();
const pool         = require('../db');
const { scheduleReminder } = require('../queues/reminderQueue');
const { normalizePhone }   = require('../helpers/phone');
const { parseId, isValidReminderTime, isValidTimezone } = require('../helpers/validation');
const asyncHandler  = require('../helpers/asyncHandler');
const requireApiKey = require('../middleware/auth');

// ---------------------------------------------------------------------------
// GET /patients  — list all patients (paginated)
// ---------------------------------------------------------------------------
router.get('/', requireApiKey, asyncHandler(async (req, res) => {
  const page   = Math.max(1, parseInt(req.query.page,  10) || 1);
  const limit  = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const offset = (page - 1) * limit;

  const { rows, rowCount } = await pool.query(
    `SELECT id, name, phone, timezone, reminders_active, created_at
     FROM patients
     ORDER BY id
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );

  const total = parseInt(
    (await pool.query('SELECT COUNT(*) FROM patients')).rows[0].count,
    10
  );

  res.json({ data: rows, meta: { page, limit, total } });
}));

// ---------------------------------------------------------------------------
// POST /patients
// ---------------------------------------------------------------------------
router.post('/', requireApiKey, asyncHandler(async (req, res) => {
  const { name, phone, timezone = 'UTC' } = req.body;

  if (!name || !phone) {
    return res.status(400).json({ error: 'name and phone are required' });
  }

  if (!isValidTimezone(timezone)) {
    return res.status(400).json({ error: `Invalid timezone "${timezone}" — must be a valid IANA timezone` });
  }

  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) {
    return res.status(400).json({ error: 'Invalid phone number — must be a valid E.164 or recognized local format' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO patients (name, phone, timezone) VALUES ($1, $2, $3) RETURNING *`,
      [name, normalizedPhone, timezone]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'A patient with this phone number already exists' });
    }
    throw err;
  }
}));

// ---------------------------------------------------------------------------
// PUT /patients/:id  — update name and/or timezone
// ---------------------------------------------------------------------------
router.put('/:id', requireApiKey, asyncHandler(async (req, res) => {
  const patientId = parseId(req.params.id);
  if (!patientId) return res.status(400).json({ error: 'Invalid patient ID' });

  const { name, timezone } = req.body;
  if (!name && !timezone) {
    return res.status(400).json({ error: 'Provide at least one of: name, timezone' });
  }

  if (timezone && !isValidTimezone(timezone)) {
    return res.status(400).json({ error: `Invalid timezone "${timezone}" — must be a valid IANA timezone` });
  }

  const result = await pool.query(
    `UPDATE patients
     SET name     = COALESCE($2, name),
         timezone = COALESCE($3, timezone)
     WHERE id = $1
     RETURNING *`,
    [patientId, name ?? null, timezone ?? null]
  );

  if (result.rows.length === 0) return res.status(404).json({ error: 'Patient not found' });

  res.json(result.rows[0]);
}));

// ---------------------------------------------------------------------------
// POST /patients/:id/medications
// ---------------------------------------------------------------------------
router.post('/:id/medications', requireApiKey, asyncHandler(async (req, res) => {
  const patientId = parseId(req.params.id);
  if (!patientId) return res.status(400).json({ error: 'Invalid patient ID' });

  const { name, dose, reminder_time, food_note } = req.body;

  if (!name || !dose || !reminder_time) {
    return res.status(400).json({ error: 'name, dose, and reminder_time are required' });
  }

  if (!isValidReminderTime(reminder_time)) {
    return res.status(400).json({
      error: 'reminder_time must be in HH:MM format with a valid hour (00–23) and minute (00–59)',
    });
  }

  const patientResult = await pool.query('SELECT * FROM patients WHERE id = $1', [patientId]);
  if (patientResult.rows.length === 0) return res.status(404).json({ error: 'Patient not found' });

  const patient = patientResult.rows[0];

  const medResult = await pool.query(
    `INSERT INTO medications (patient_id, name, dose, reminder_time, food_note)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [patientId, name, dose, reminder_time, food_note ?? null]
  );

  const medication = medResult.rows[0];
  if (patient.reminders_active) {
    await scheduleReminder(patientId, medication.id, reminder_time, patient.timezone);
  }

  res.status(201).json(medication);
}));

// ---------------------------------------------------------------------------
// GET /patients/:id/dashboard
// ---------------------------------------------------------------------------
router.get('/:id/dashboard', requireApiKey, asyncHandler(async (req, res) => {
  const patientId = parseId(req.params.id);
  if (!patientId) return res.status(400).json({ error: 'Invalid patient ID' });

  const patientResult = await pool.query('SELECT * FROM patients WHERE id = $1', [patientId]);
  if (patientResult.rows.length === 0) return res.status(404).json({ error: 'Patient not found' });

  const patient = patientResult.rows[0];

  const [scheduleResult, adherenceResult] = await Promise.all([
    pool.query(
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
       WHERE m.patient_id = $1 AND m.active = TRUE
       ORDER BY m.reminder_time`,
      [patientId, patient.timezone]
    ),
    pool.query(
      `SELECT week_start, pct FROM adherence_weekly
       WHERE patient_id = $1
       ORDER BY week_start DESC LIMIT 4`,
      [patientId]
    ),
  ]);

  res.json({
    patient: {
      id: patient.id, name: patient.name, phone: patient.phone,
      timezone: patient.timezone, reminders_active: patient.reminders_active,
    },
    today_schedule:   scheduleResult.rows,
    weekly_adherence: adherenceResult.rows,
  });
}));

// ---------------------------------------------------------------------------
// POST /patients/:id/caregivers
// ---------------------------------------------------------------------------
router.post('/:id/caregivers', requireApiKey, asyncHandler(async (req, res) => {
  const patientId = parseId(req.params.id);
  if (!patientId) return res.status(400).json({ error: 'Invalid patient ID' });

  const { name, phone, relationship, threshold = 3 } = req.body;
  if (!name || !phone) return res.status(400).json({ error: 'name and phone are required' });

  const thresholdNum = parseInt(threshold, 10);
  if (!Number.isInteger(thresholdNum) || thresholdNum < 1) {
    return res.status(400).json({ error: 'threshold must be a positive integer' });
  }

  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) {
    return res.status(400).json({ error: 'Invalid phone number — must be a valid E.164 or recognized local format' });
  }

  const patientResult = await pool.query('SELECT id FROM patients WHERE id = $1', [patientId]);
  if (patientResult.rows.length === 0) return res.status(404).json({ error: 'Patient not found' });

  const result = await pool.query(
    `INSERT INTO caregivers (patient_id, name, phone, relationship, threshold)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [patientId, name, normalizedPhone, relationship ?? null, thresholdNum]
  );

  res.status(201).json(result.rows[0]);
}));

// ---------------------------------------------------------------------------
// GET /patients/:id/caregivers
// ---------------------------------------------------------------------------
router.get('/:id/caregivers', requireApiKey, asyncHandler(async (req, res) => {
  const patientId = parseId(req.params.id);
  if (!patientId) return res.status(400).json({ error: 'Invalid patient ID' });

  const patientResult = await pool.query('SELECT id FROM patients WHERE id = $1', [patientId]);
  if (patientResult.rows.length === 0) return res.status(404).json({ error: 'Patient not found' });

  const result = await pool.query(
    'SELECT * FROM caregivers WHERE patient_id = $1 ORDER BY id',
    [patientId]
  );

  res.json(result.rows);
}));

module.exports = router;
