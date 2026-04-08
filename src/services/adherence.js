'use strict';
const pool = require('../db');

/**
 * Return the ISO-8601 Monday (YYYY-MM-DD) of the week containing `date`.
 * Weeks run Monday–Sunday.
 *
 * @param {Date} [date=new Date()]
 * @returns {string}
 */
function getWeekStart(date = new Date()) {
  const d = new Date(date);
  // getUTCDay() → 0=Sun … 6=Sat; offset so Monday=0
  const offset = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - offset);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

/**
 * Recalculate and upsert the weekly adherence row for a patient.
 * Counts only logs whose sent_at falls within the 7-day window starting on weekStart.
 * "Awaiting" logs (not yet responded to) are excluded from both numerator and denominator.
 *
 * @param {number} patientId
 * @param {string} weekStart - YYYY-MM-DD Monday of the week.
 * @returns {Promise<number>} The updated adherence percentage (0–100).
 */
async function updateWeeklyAdherence(patientId, weekStart) {
  const result = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'confirmed')                          AS confirmed,
       COUNT(*) FILTER (WHERE status IN ('confirmed', 'skipped', 'snoozed')) AS total
     FROM reminder_logs
     WHERE patient_id = $1
       AND sent_at >= $2::date
       AND sent_at <  ($2::date + INTERVAL '7 days')`,
    [patientId, weekStart]
  );

  const { confirmed, total } = result.rows[0];
  const pct = Number(total) > 0
    ? (Number(confirmed) / Number(total)) * 100
    : 0;

  await pool.query(
    `INSERT INTO adherence_weekly (patient_id, week_start, pct)
     VALUES ($1, $2, $3)
     ON CONFLICT (patient_id, week_start)
     DO UPDATE SET pct = EXCLUDED.pct`,
    [patientId, weekStart, pct.toFixed(2)]
  );

  return pct;
}

module.exports = { updateWeeklyAdherence, getWeekStart };
