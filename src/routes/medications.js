'use strict';
const express      = require('express');
const router       = express.Router();
const pool         = require('../db');
const { cancelReminder } = require('../queues/reminderQueue');
const asyncHandler       = require('../helpers/asyncHandler');

// DELETE /medications/:id  (soft-delete — sets active = FALSE)
router.delete('/:id', asyncHandler(async (req, res) => {
  const medicationId = parseInt(req.params.id, 10);

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
