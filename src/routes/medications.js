'use strict';
const express      = require('express');
const router       = express.Router();
const pool         = require('../db');
const { scheduleReminder, cancelReminder } = require('../queues/reminderQueue');
const { parseId, isValidReminderTime }     = require('../helpers/validation');
const asyncHandler  = require('../helpers/asyncHandler');
const requireApiKey = require('../middleware/auth');

// ---------------------------------------------------------------------------
// DELETE /medications/:id  (soft-delete — sets active = FALSE)
// ---------------------------------------------------------------------------
router.delete('/:id', requireApiKey, asyncHandler(async (req, res) => {
  const medicationId = parseId(req.params.id);
  if (!medicationId) return res.status(400).json({ error: 'Invalid medication ID' });

  const result = await pool.query(
    `UPDATE medications SET active = FALSE WHERE id = $1 RETURNING *`,
    [medicationId]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Medication not found' });

  const medication = result.rows[0];
  await cancelReminder(medication.patient_id, medication.id);

  res.json({ message: 'Medication deactivated', medication });
}));

// ---------------------------------------------------------------------------
// PUT /medications/:id  — update name, dose, reminder_time, and/or food_note
// ---------------------------------------------------------------------------
router.put('/:id', requireApiKey, asyncHandler(async (req, res) => {
  const medicationId = parseId(req.params.id);
  if (!medicationId) return res.status(400).json({ error: 'Invalid medication ID' });

  const { name, dose, reminder_time } = req.body;
  // food_note may be explicitly set to null to clear it, so check key presence.
  const hasFoodNote = 'food_note' in req.body;

  if (!name && !dose && !reminder_time && !hasFoodNote) {
    return res.status(400).json({ error: 'Provide at least one field to update' });
  }

  if (reminder_time && !isValidReminderTime(reminder_time)) {
    return res.status(400).json({
      error: 'reminder_time must be in HH:MM format with a valid hour (00–23) and minute (00–59)',
    });
  }

  const result = await pool.query(
    `UPDATE medications
     SET name          = COALESCE($2, name),
         dose          = COALESCE($3, dose),
         reminder_time = COALESCE($4::time, reminder_time),
         food_note     = CASE WHEN $5 THEN $6 ELSE food_note END
     WHERE id = $1 AND active = TRUE
     RETURNING *`,
    [medicationId, name ?? null, dose ?? null, reminder_time ?? null, hasFoodNote, req.body.food_note ?? null]
  );

  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'Medication not found or inactive' });
  }

  const medication = result.rows[0];

  // If reminder_time changed, re-schedule the cron job with the new time.
  if (reminder_time) {
    const patientResult = await pool.query(
      'SELECT id, timezone, reminders_active FROM patients WHERE id = $1',
      [medication.patient_id]
    );
    if (patientResult.rows.length > 0) {
      const patient = patientResult.rows[0];
      if (patient.reminders_active) {
        await scheduleReminder(medication.patient_id, medication.id, reminder_time, patient.timezone);
      }
    }
  }

  res.json(medication);
}));

module.exports = router;
