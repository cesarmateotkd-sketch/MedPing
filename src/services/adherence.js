'use strict';
const pool   = require('../db');
const logger = require('../helpers/logger');

/**
 * Return the ISO-8601 Monday (YYYY-MM-DD) of the week containing `date`,
 * evaluated in the patient's IANA timezone so the week boundary matches
 * the patient's local calendar, not UTC.
 *
 * @param {string} [timezone='UTC']
 * @param {Date}   [date=new Date()]
 * @returns {string} YYYY-MM-DD
 */
function getWeekStart(timezone = 'UTC', date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const [year, month, day] = formatter.format(date).split('-').map(Number);
  const localNoon = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  const offset = (localNoon.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
  localNoon.setUTCDate(localNoon.getUTCDate() - offset);
  localNoon.setUTCHours(0, 0, 0, 0);
  return localNoon.toISOString().slice(0, 10);
}

/**
 * Recalculate and upsert the weekly adherence row for a patient.
 * Only resolved logs (confirmed/skipped/snoozed) count; awaiting logs are excluded.
 *
 * @param {number} patientId
 * @param {string} weekStart - YYYY-MM-DD Monday of the week.
 * @returns {Promise<number>} Adherence percentage (0–100).
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
  const pct = Number(total) > 0 ? (Number(confirmed) / Number(total)) * 100 : 0;

  await pool.query(
    `INSERT INTO adherence_weekly (patient_id, week_start, pct)
     VALUES ($1, $2, $3)
     ON CONFLICT (patient_id, week_start)
     DO UPDATE SET pct = EXCLUDED.pct`,
    [patientId, weekStart, pct.toFixed(2)]
  );

  logger.debug('Adherence updated', { patientId, weekStart, pct: pct.toFixed(2) });
  return pct;
}

module.exports = { updateWeeklyAdherence, getWeekStart };
