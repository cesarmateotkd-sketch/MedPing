'use strict';
require('dotenv').config();

const { Worker } = require('bullmq');
const Redis = require('ioredis');
const config = require('../config');
const pool = require('../db');
const { sendSMS } = require('../helpers/twilio');

const connection = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });

const worker = new Worker(
  'reminders',
  async (job) => {
    const { patientId, medicationId } = job.data;

    // Check patient still active
    const patientResult = await pool.query(
      'SELECT * FROM patients WHERE id = $1 AND reminders_active = TRUE',
      [patientId]
    );
    if (patientResult.rows.length === 0) {
      console.log(`[worker] Patient ${patientId} inactive or not found — skipping`);
      return;
    }

    // Check medication still active
    const medResult = await pool.query(
      'SELECT * FROM medications WHERE id = $1 AND active = TRUE',
      [medicationId]
    );
    if (medResult.rows.length === 0) {
      console.log(`[worker] Medication ${medicationId} inactive or not found — skipping`);
      return;
    }

    const patient    = patientResult.rows[0];
    const medication = medResult.rows[0];

    // Build SMS body
    let body = `MedPing: Time to take ${medication.name} ${medication.dose}.`;
    if (medication.food_note) {
      body += ` ${medication.food_note}.`;
    }
    body += ' Reply Y=Taken, S=Snooze 15min, N=Skip, H=Help';

    // Send SMS FIRST — if this fails the job retries without creating an orphaned log.
    await sendSMS(patient.phone, body);

    // Insert the log only after a confirmed SMS delivery to avoid duplicate
    // awaiting logs when BullMQ retries a failed job.
    const logResult = await pool.query(
      `INSERT INTO reminder_logs (patient_id, medication_id, status)
       VALUES ($1, $2, 'awaiting')
       RETURNING id`,
      [patientId, medicationId]
    );

    console.log(
      `[worker] Sent reminder to ${patient.phone} — ${medication.name} ` +
      `(log #${logResult.rows[0].id})`
    );
  },
  { connection }
);

worker.on('completed', (job) => {
  console.log(`[worker] Job ${job.id} completed`);
});

worker.on('failed', (job, err) => {
  console.error(`[worker] Job ${job?.id} failed:`, err.message);
});

// ---------------------------------------------------------------------------
// Graceful shutdown — drain in-flight jobs before exit
// ---------------------------------------------------------------------------
async function shutdown(signal) {
  console.log(`[worker] ${signal} received — shutting down gracefully...`);
  try {
    await worker.close();      // waits for active jobs to finish
    await connection.quit();   // close Redis connection cleanly
    await pool.end();          // close PostgreSQL pool
    console.log('[worker] Shutdown complete');
  } catch (err) {
    console.error('[worker] Error during shutdown:', err.message);
  }
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

console.log('[worker] Reminder worker started');

module.exports = worker;
