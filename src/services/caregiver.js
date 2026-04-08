'use strict';
const pool = require('../db');
const { sendSMS } = require('../helpers/twilio');

/**
 * After a dose is marked skipped, count consecutive skipped doses for the patient
 * (skips since the last confirmation) and notify any active caregivers whose
 * threshold has been exactly reached.
 *
 * Alerting at exactly `threshold` (rather than >=) prevents re-alerting the same
 * caregiver on every subsequent missed dose once the threshold is passed.
 *
 * @param {number} patientId
 */
async function checkAndAlertCaregivers(patientId) {
  // Count skipped logs since the most recent confirmed log (or from the beginning).
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

  // Fetch active caregivers whose threshold equals the current consecutive count.
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
      console.log(
        `[caregiver] Alert sent to ${caregiver.name} (${caregiver.phone}) ` +
        `— patient=${patientId} consecutive_missed=${consecutiveMissed}`
      );
    } catch (err) {
      console.error(
        `[caregiver] Failed to alert ${caregiver.phone}:`, err.message
      );
    }
  }
}

module.exports = { checkAndAlertCaregivers };
