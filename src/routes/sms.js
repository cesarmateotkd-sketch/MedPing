'use strict';
const express      = require('express');
const router       = express.Router();
const twilio       = require('twilio');
const config       = require('../config');
const pool         = require('../db');
const { reminderQueue }         = require('../queues/reminderQueue');
const { updateWeeklyAdherence, getWeekStart } = require('../services/adherence');
const { checkAndAlertCaregivers }             = require('../services/caregiver');
const asyncHandler = require('../helpers/asyncHandler');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a TwiML MessagingResponse XML string. */
function twiml(message) {
  const resp = new twilio.twiml.MessagingResponse();
  resp.message(message);
  return resp.toString();
}

/**
 * Validate the Twilio request signature.
 * Set SKIP_TWILIO_VALIDATION=true in .env for local testing without ngrok.
 */
function validateTwilioSignature(req, res, next) {
  if (process.env.SKIP_TWILIO_VALIDATION === 'true') {
    return next();
  }

  const authToken  = config.TWILIO_AUTH_TOKEN;
  const signature  = req.headers['x-twilio-signature'] || '';

  // Reconstruct the full public URL (works behind ngrok / reverse-proxies).
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  const host  = req.headers['x-forwarded-host']  || req.get('host');
  const url   = `${proto}://${host}${req.originalUrl}`;

  if (!twilio.validateRequest(authToken, signature, url, req.body)) {
    console.warn(`[sms] Invalid Twilio signature — ip=${req.ip} url=${url}`);
    return res
      .status(403)
      .type('text/xml')
      .send(twiml('Forbidden'));
  }

  next();
}

// ---------------------------------------------------------------------------
// POST /sms/inbound
// ---------------------------------------------------------------------------
router.post(
  '/inbound',
  validateTwilioSignature,
  asyncHandler(async (req, res) => {
    const from    = req.body.From || '';
    const rawBody = (req.body.Body || '').trim();
    const cmd     = rawBody.toUpperCase();

    if (!from) {
      return res.type('text/xml').send(twiml('Invalid request.'));
    }

    // Look up patient by phone number (Twilio sends E.164).
    const patientResult = await pool.query(
      'SELECT * FROM patients WHERE phone = $1',
      [from]
    );

    if (patientResult.rows.length === 0) {
      return res.type('text/xml').send(
        twiml('Your number is not registered with MedPing.')
      );
    }

    const patient = patientResult.rows[0];

    // ------------------------------------------------------------------
    // STOP — unsubscribe
    // ------------------------------------------------------------------
    if (cmd === 'STOP') {
      await pool.query(
        'UPDATE patients SET reminders_active = FALSE WHERE id = $1',
        [patient.id]
      );
      return res.type('text/xml').send(
        twiml('You have been unsubscribed from MedPing reminders. Reply START to re-enable.')
      );
    }

    // ------------------------------------------------------------------
    // START — re-subscribe
    // ------------------------------------------------------------------
    if (cmd === 'START') {
      await pool.query(
        'UPDATE patients SET reminders_active = TRUE WHERE id = $1',
        [patient.id]
      );
      return res.type('text/xml').send(
        twiml('MedPing reminders re-enabled. You will receive your scheduled medication reminders.')
      );
    }

    // ------------------------------------------------------------------
    // HELP
    // ------------------------------------------------------------------
    if (cmd === 'H' || cmd === 'HELP') {
      return res.type('text/xml').send(
        twiml(
          'MedPing commands:\n' +
          'Y or YES  — mark last reminder as taken\n' +
          'S or SNOOZE — remind again in 15 min\n' +
          'N or NO   — mark as skipped\n' +
          'STATUS    — view today\'s schedule\n' +
          'STOP      — unsubscribe\n' +
          'START     — re-subscribe\n' +
          'H         — show this help'
        )
      );
    }

    // ------------------------------------------------------------------
    // STATUS
    // ------------------------------------------------------------------
    if (cmd === 'STATUS') {
      const rows = await pool.query(
        `SELECT
           TO_CHAR(m.reminder_time, 'HH24:MI') AS reminder_time,
           m.name,
           m.dose,
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
        [patient.id, patient.timezone]
      );

      if (rows.rowCount === 0) {
        return res.type('text/xml').send(twiml('No medications on file.'));
      }

      const lines = rows.rows.map(
        (m) => `${m.reminder_time} ${m.name} ${m.dose}: ${m.today_status}`
      );
      return res.type('text/xml').send(
        twiml(`Today\'s medications:\n${lines.join('\n')}`)
      );
    }

    // ------------------------------------------------------------------
    // Y/YES, S/SNOOZE, N/NO — act on the most recent awaiting log
    // ------------------------------------------------------------------
    const logResult = await pool.query(
      `SELECT rl.*, m.name AS med_name, m.dose
       FROM reminder_logs rl
       JOIN medications m ON m.id = rl.medication_id
       WHERE rl.patient_id = $1
         AND rl.status = 'awaiting'
       ORDER BY rl.sent_at DESC
       LIMIT 1`,
      [patient.id]
    );

    if (logResult.rows.length === 0) {
      return res.type('text/xml').send(
        twiml('No pending reminder found. Reply STATUS to view today\'s schedule or H for help.')
      );
    }

    const log       = logResult.rows[0];
    const weekStart = getWeekStart();
    let reply       = '';

    if (cmd === 'Y' || cmd === 'YES') {
      await pool.query(
        `UPDATE reminder_logs
         SET status = 'confirmed', confirmed_at = NOW()
         WHERE id = $1`,
        [log.id]
      );
      await updateWeeklyAdherence(patient.id, weekStart);
      reply = `Got it! ${log.med_name} ${log.dose} marked as taken. Keep it up!`;

    } else if (cmd === 'S' || cmd === 'SNOOZE') {
      await pool.query(
        `UPDATE reminder_logs SET status = 'snoozed' WHERE id = $1`,
        [log.id]
      );
      // One-time delayed job — not a repeating job
      await reminderQueue.add(
        'send-reminder',
        { patientId: patient.id, medicationId: log.medication_id },
        { delay: 15 * 60 * 1000, removeOnComplete: true, removeOnFail: { count: 3 } }
      );
      reply = `OK, we'll remind you about ${log.med_name} again in 15 minutes.`;

    } else if (cmd === 'N' || cmd === 'NO') {
      await pool.query(
        `UPDATE reminder_logs SET status = 'skipped' WHERE id = $1`,
        [log.id]
      );
      await updateWeeklyAdherence(patient.id, weekStart);
      await checkAndAlertCaregivers(patient.id);
      reply = `${log.med_name} marked as skipped for now.`;

    } else {
      reply = `Unrecognized command "${rawBody}". Reply H for help.`;
    }

    return res.type('text/xml').send(twiml(reply));
  })
);

module.exports = router;
