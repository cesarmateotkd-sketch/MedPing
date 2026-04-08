'use strict';
const { Queue } = require('bullmq');
const Redis = require('ioredis');
const config = require('../config');

const connection = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });

const reminderQueue = new Queue('reminders', { connection });

/**
 * Schedule (or re-schedule) a daily repeating reminder for a patient/medication.
 *
 * @param {number} patientId     - Patient row ID.
 * @param {number} medicationId  - Medication row ID.
 * @param {string} reminderTime  - Time string in "HH:MM" 24-hour format.
 * @param {string} timezone      - IANA timezone string (e.g. "America/New_York").
 */
async function scheduleReminder(patientId, medicationId, reminderTime, timezone) {
  // Cancel any existing job for this pair first to avoid duplicates on re-schedule.
  await cancelReminder(patientId, medicationId);

  const [hours, minutes] = reminderTime.split(':').map(Number);
  // Standard 5-field cron: minute hour * * *
  const pattern = `${minutes} ${hours} * * *`;
  const jobId = `reminder:${patientId}:${medicationId}`;

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

  console.log(
    `[queue] Scheduled reminder — patient=${patientId} med=${medicationId} ` +
    `at ${reminderTime} (${timezone})`
  );
}

/**
 * Remove the daily repeating job for a patient/medication pair.
 *
 * @param {number} patientId
 * @param {number} medicationId
 */
async function cancelReminder(patientId, medicationId) {
  const targetId = `reminder:${patientId}:${medicationId}`;
  const jobs = await reminderQueue.getRepeatableJobs();

  for (const job of jobs) {
    if (job.id === targetId) {
      await reminderQueue.removeRepeatableByKey(job.key);
      console.log(`[queue] Cancelled reminder — patient=${patientId} med=${medicationId}`);
    }
  }
}

module.exports = { reminderQueue, scheduleReminder, cancelReminder };
