'use strict';
const express      = require('express');
const router       = express.Router();
const pool         = require('../db');
const { cancelReminder } = require('../queues/reminderQueue');
const asyncHandler       = require('../helpers/asyncHandler');

function parseId(str) {
  const n = parseInt(str, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// DELETE /medications/:id  (soft-delete — sets active = FALSE)
router.delete('/:id', asyncHandler(async (req, res) => {
  const medicationId = parseId(req.params.id);
  if (!medicationId) {
    return res.status(400).json({ error: 'Invalid medication ID' });
  }

  const result = await pool.query(
    `UPDATE medications
     SET active = FALSE
     WHERE id = $1
     RETURNING *`,
    [medicationId]
  );

  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'Medication not found' });
  }

  const medication = result.rows[0];

  // Cancel the BullMQ repeating job for this medication.
  await cancelReminder(medication.patient_id, medication.id);

  res.json({ message: 'Medication deactivated', medication });
}));

module.exports = router;
