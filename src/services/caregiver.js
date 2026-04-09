'use strict';
const pool   = require('../db');
const logger = require('../helpers/logger');
const { sendSMS } = require('../helpers/twilio');

/**
 * After a dose is skipped, count consecutive skips since the last confirmation
 * and alert any active caregiver whose threshold has been exactly reached.
 *
 * Alerting at exactly `threshold` (not >=) prevents repeated alerts on every
 * subsequent miss once the threshold is crossed.
 *
 * @param {number} patientId
 */
async function checkAndAlertCaregivers(patientId) {
  const missedResult = await pool.query(
    `SELECT COUNT(*) AS consecutive_missed
     FROM reminder_logs
     WHERE patient_id = $1
       AND status = 'skipped'
       AND id > COALESCE(
             (SELECT MAX(id) FROM reminder_logs
              WHERE patient_id = $1 AND status = 'confirmed'),
             0
           )`,
    [patientId]
  );

  const consecutiveMissed = Number(missedResult.rows[0].consecutive_missed);
  if (consecutiveMissed === 0) return;

  const caregiversResult = await pool.query(
    `SELECT c.*, p.name AS patient_name
     FROM caregivers c
     JOIN patients p ON p.id = c.patient_id
     WHERE c.patient_id = $1
       AND c.active = TRUE
       AND c.threshold = $2`,
    [patientId, consecutiveMissed]
  );

  for (const caregiver of caregiversResult.rows) {
    const message =
      `MedPing Alert: ${caregiver.patient_name} has missed ` +
      `${consecutiveMissed} consecutive medication dose(s). ` +
      `Please check in with them.`;

    try {
      await sendSMS(caregiver.phone, message);
      logger.info('Caregiver alert sent', {
        patientId,
        caregiverId: caregiver.id,
        consecutiveMissed,
      });
    } catch (err) {
      logger.error('Failed to send caregiver alert', {
        caregiverId: caregiver.id,
        message: err.message,
      });
    }
  }
}

module.exports = { checkAndAlertCaregivers };
