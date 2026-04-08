'use strict';
require('dotenv').config();

const pool = require('../src/db');
const { scheduleReminder } = require('../src/queues/reminderQueue');

const TEST_PATIENT = {
  name:     'Alice Johnson',
  phone:    '+15551234567',
  timezone: 'America/New_York',
};

const TEST_MEDICATIONS = [
  {
    name:          'Lisinopril',
    dose:          '10mg',
    reminder_time: '08:00',
    food_note:     'Take with a full glass of water',
  },
  {
    name:          'Metformin',
    dose:          '500mg',
    reminder_time: '12:30',
    food_note:     'Take with food to reduce stomach upset',
  },
  {
    name:          'Atorvastatin',
    dose:          '20mg',
    reminder_time: '21:00',
    food_note:     'Take at bedtime',
  },
];

async function seed() {
  console.log('[seed] Starting...');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Remove existing test patient (cascades to medications, logs, etc.)
    await client.query('DELETE FROM patients WHERE phone = $1', [TEST_PATIENT.phone]);

    // Insert patient
    const patientResult = await client.query(
      `INSERT INTO patients (name, phone, timezone)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [TEST_PATIENT.name, TEST_PATIENT.phone, TEST_PATIENT.timezone]
    );
    const patient = patientResult.rows[0];
    console.log(`[seed] Created patient: ${patient.name} (id=${patient.id}, phone=${patient.phone})`);

    // Insert medications
    const insertedMeds = [];
    for (const med of TEST_MEDICATIONS) {
      const medResult = await client.query(
        `INSERT INTO medications (patient_id, name, dose, reminder_time, food_note)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [patient.id, med.name, med.dose, med.reminder_time, med.food_note]
      );
      const medication = medResult.rows[0];
      insertedMeds.push({ medication, med });
      console.log(
        `[seed]   Medication: ${medication.name} ${medication.dose} ` +
        `at ${medication.reminder_time} (id=${medication.id})`
      );
    }

    await client.query('COMMIT');

    // Schedule BullMQ repeating jobs (outside transaction — Redis calls)
    for (const { medication, med } of insertedMeds) {
      await scheduleReminder(
        patient.id,
        medication.id,
        med.reminder_time,
        TEST_PATIENT.timezone
      );
    }

    console.log('[seed] Done.');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  // Give BullMQ a moment to flush, then exit.
  setTimeout(() => process.exit(0), 500);
}

seed().catch((err) => {
  console.error('[seed] Failed:', err.message);
  process.exit(1);
});
