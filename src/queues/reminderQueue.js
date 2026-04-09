'use strict';
const { Queue } = require('bullmq');
const Redis  = require('ioredis');
const config = require('../config');
const logger = require('../helpers/logger');

const connection = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });

connection.on('error', (err) =>
  logger.error('Redis connection error', { message: err.message })
);

const reminderQueue = new Queue('reminders', { connection });

/**
 * Schedule (or re-schedule) a daily repeating reminder for a patient/medication.
 *
 * @param {number} patientId
 * @param {number} medicationId
 * @param {string} reminderTime - "HH:MM" 24-hour format.
 * @param {string} timezone     - IANA timezone string.
 */
async function scheduleReminder(patientId, medicationId, reminderTime, timezone) {
  await cancelReminder(patientId, medicationId);

  const [hours, minutes] = reminderTime.split(':').map(Number);
  const pattern = `${minutes} ${hours} * * *`;
  const jobId   = `reminder:${patientId}:${medicationId}`;

  await reminderQueue.add(
    'send-reminder',
    { patientId, medicationId },
    {
      repeat: { pattern, tz: timezone },
      jobId,
      removeOnComplete: { count: 100 },
      removeOnFail:     { count: 50  },
    }
  );

  logger.info('Reminder scheduled', { patientId, medicationId, reminderTime, timezone });
}

/**
 * Remove the daily repeating job for a patient/medication pair.
 */
async function cancelReminder(patientId, medicationId) {
  const targetId = `reminder:${patientId}:${medicationId}`;
  const jobs = await reminderQueue.getRepeatableJobs();

  for (const job of jobs) {
    if (job.id === targetId) {
      await reminderQueue.removeRepeatableByKey(job.key);
      logger.info('Reminder cancelled', { patientId, medicationId });
    }
  }
}

// Export connection so app.js health check can ping Redis without a second client.
module.exports = { reminderQueue, scheduleReminder, cancelReminder, connection };
