-- MedPing database schema

CREATE TABLE IF NOT EXISTS patients (
  id               SERIAL      PRIMARY KEY,
  name             TEXT        NOT NULL,
  phone            TEXT        NOT NULL UNIQUE,   -- E.164 format
  timezone         TEXT        NOT NULL DEFAULT 'UTC',
  reminders_active BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS medications (
  id            SERIAL      PRIMARY KEY,
  patient_id    INT         NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  name          TEXT        NOT NULL,
  dose          TEXT        NOT NULL,
  reminder_time TIME        NOT NULL,
  food_note     TEXT,
  active        BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reminder_logs (
  id            SERIAL      PRIMARY KEY,
  patient_id    INT         NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  medication_id INT         NOT NULL REFERENCES medications(id) ON DELETE CASCADE,
  sent_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status        TEXT        NOT NULL DEFAULT 'awaiting'
                  CHECK (status IN ('awaiting', 'confirmed', 'skipped', 'snoozed')),
  confirmed_at  TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS adherence_weekly (
  id          SERIAL       PRIMARY KEY,
  patient_id  INT          NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  week_start  DATE         NOT NULL,  -- ISO Monday of the week
  pct         NUMERIC(5,2) NOT NULL DEFAULT 0,
  UNIQUE (patient_id, week_start)
);

CREATE TABLE IF NOT EXISTS caregivers (
  id           SERIAL      PRIMARY KEY,
  patient_id   INT         NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  name         TEXT        NOT NULL,
  phone        TEXT        NOT NULL,  -- E.164 format
  relationship TEXT,
  threshold    INT         NOT NULL DEFAULT 3,  -- consecutive missed doses before alert
  active       BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_reminder_logs_patient_id    ON reminder_logs(patient_id);
CREATE INDEX IF NOT EXISTS idx_reminder_logs_medication_id ON reminder_logs(medication_id);
CREATE INDEX IF NOT EXISTS idx_reminder_logs_status        ON reminder_logs(status);
CREATE INDEX IF NOT EXISTS idx_medications_patient_id      ON medications(patient_id);
CREATE INDEX IF NOT EXISTS idx_caregivers_patient_id       ON caregivers(patient_id);
