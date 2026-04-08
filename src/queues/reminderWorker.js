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

    // Insert reminder log
    const logResult = await pool.query(
      `INSERT INTO reminder_logs (patient_id, medication_id, status)
       VALUES ($1, $2, 'awaiting')
       RETURNING id`,
      [patientId, medicationId]
    );

    // Build SMS body
    let body = `MedPing: Time to take ${medication.name} ${medication.dose}.`;
    if (medication.food_note) {
      body += ` ${medication.food_note}.`;
    }
    body += ' Reply Y=Taken, S=Snooze 15min, N=Skip, H=Help';

    await sendSMS(patient.phone, body);

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

console.log('[worker] Reminder worker started');

module.exports = worker;
