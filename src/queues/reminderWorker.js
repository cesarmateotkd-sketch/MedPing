'use strict';
require('dotenv').config();

const { Worker } = require('bullmq');
const Redis  = require('ioredis');
const config = require('../config');
const pool   = require('../db');
const logger = require('../helpers/logger');
const { sendSMS } = require('../helpers/twilio');

const connection = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });

connection.on('error', (err) =>
  logger.error('Redis connection error (worker)', { message: err.message })
);

const worker = new Worker(
  'reminders',
  async (job) => {
    const { patientId, medicationId } = job.data;

    const patientResult = await pool.query(
      'SELECT * FROM patients WHERE id = $1 AND reminders_active = TRUE',
      [patientId]
    );
    if (patientResult.rows.length === 0) {
      logger.info('Skipping reminder — patient inactive or not found', { patientId });
      return;
    }

    const medResult = await pool.query(
      'SELECT * FROM medications WHERE id = $1 AND active = TRUE',
      [medicationId]
    );
    if (medResult.rows.length === 0) {
      logger.info('Skipping reminder — medication inactive or not found', { medicationId });
      return;
    }

    const patient    = patientResult.rows[0];
    const medication = medResult.rows[0];

    let body = `MedPing: Time to take ${medication.name} ${medication.dose}.`;
    if (medication.food_note) body += ` ${medication.food_note}.`;
    body += ' Reply Y=Taken, S=Snooze 15min, N=Skip, H=Help';

    // Send SMS first — if this fails, the job retries without creating an orphaned log.
    await sendSMS(patient.phone, body);

    const logResult = await pool.query(
      `INSERT INTO reminder_logs (patient_id, medication_id, status)
       VALUES ($1, $2, 'awaiting') RETURNING id`,
      [patientId, medicationId]
    );

    logger.info('Reminder sent', {
      patientId,
      medicationId,
      logId: logResult.rows[0].id,
      medication: medication.name,
    });
  },
  { connection }
);

worker.on('completed', (job) => logger.info('Job completed', { jobId: job.id }));
worker.on('failed', (job, err) =>
  logger.error('Job failed', { jobId: job?.id, message: err.message })
);

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------
async function shutdown(signal) {
  logger.info(`${signal} received — shutting down worker`);
  try {
    await worker.close();
    await connection.quit();
    await pool.end();
    logger.info('Worker shutdown complete');
  } catch (err) {
    logger.error('Error during shutdown', { message: err.message });
  }
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

logger.info('Reminder worker started');

module.exports = worker;
