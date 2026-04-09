'use strict';
const express      = require('express');
const router       = express.Router();
const pool         = require('../db');
const { parseId }   = require('../helpers/validation');
const asyncHandler  = require('../helpers/asyncHandler');
const requireApiKey = require('../middleware/auth');

// ---------------------------------------------------------------------------
// DELETE /caregivers/:id  (soft-delete — sets active = FALSE)
// ---------------------------------------------------------------------------
router.delete('/:id', requireApiKey, asyncHandler(async (req, res) => {
  const caregiverId = parseId(req.params.id);
  if (!caregiverId) return res.status(400).json({ error: 'Invalid caregiver ID' });

  const result = await pool.query(
    `UPDATE caregivers SET active = FALSE WHERE id = $1 RETURNING *`,
    [caregiverId]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Caregiver not found' });

  res.json({ message: 'Caregiver deactivated', caregiver: result.rows[0] });
}));

// ---------------------------------------------------------------------------
// PATCH /caregivers/:id  — update threshold or reactivate
// ---------------------------------------------------------------------------
router.patch('/:id', requireApiKey, asyncHandler(async (req, res) => {
  const caregiverId = parseId(req.params.id);
  if (!caregiverId) return res.status(400).json({ error: 'Invalid caregiver ID' });

  const { threshold, active } = req.body;

  if (threshold === undefined && active === undefined) {
    return res.status(400).json({ error: 'Provide at least one of: threshold, active' });
  }

  if (threshold !== undefined) {
    const t = parseInt(threshold, 10);
    if (!Number.isInteger(t) || t < 1) {
      return res.status(400).json({ error: 'threshold must be a positive integer' });
    }
  }

  const result = await pool.query(
    `UPDATE caregivers
     SET threshold = COALESCE($2, threshold),
         active    = COALESCE($3, active)
     WHERE id = $1
     RETURNING *`,
    [caregiverId, threshold ?? null, active ?? null]
  );

  if (result.rows.length === 0) return res.status(404).json({ error: 'Caregiver not found' });

  res.json(result.rows[0]);
}));

module.exports = router;
