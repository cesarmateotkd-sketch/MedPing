# MedPing

SMS medication reminder app built with Node.js, Express, Twilio, BullMQ, and PostgreSQL.

---

## Architecture

```
┌─────────────┐    SMS     ┌─────────────┐   webhook   ┌──────────────────┐
│   Twilio    │◄──────────►│  MedPing    │◄────────────│  POST /sms/inbound│
│  (carrier)  │            │  Express    │             └──────────────────┘
└─────────────┘            │  server     │
                           └──────┬──────┘
                                  │
                    ┌─────────────┼─────────────┐
                    ▼             ▼             ▼
               PostgreSQL      Redis        BullMQ
               (patients,    (job store)   (reminder
               meds, logs)                  worker)
```

The **web process** (`npm start`) handles inbound HTTP requests.  
The **worker process** (`npm run worker`) consumes the BullMQ `reminders` queue and fires SMS reminders. Run both concurrently.

---

## Prerequisites

- Node.js ≥ 18
- PostgreSQL ≥ 14
- Redis ≥ 6
- A [Twilio](https://www.twilio.com) account with an SMS-capable phone number

---

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env with your credentials
```

| Variable | Description |
|---|---|
| `TWILIO_ACCOUNT_SID` | From Twilio Console → Account Info |
| `TWILIO_AUTH_TOKEN` | From Twilio Console → Account Info |
| `TWILIO_PHONE_NUMBER` | Your Twilio number in E.164 (e.g. `+15551234000`) |
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string |
| `PORT` | HTTP port (default `3000`) |
| `SKIP_TWILIO_VALIDATION` | Set `true` for local dev without ngrok (**never in production**) |

### 3. Create the database

```bash
createdb medping           # or use psql / your preferred tool
npm run migrate            # applies src/db/schema.sql
```

### 4. (Optional) Seed test data

```bash
npm run seed
# Creates patient "Alice Johnson" (+15551234567) with 3 medications
```

---

## Running

Open **two terminals**:

```bash
# Terminal 1 — web server
npm start          # or: npm run dev  (nodemon)

# Terminal 2 — reminder worker
npm run worker
```

---

## Twilio Webhook Setup

Twilio must be able to reach your server over HTTPS.

### Local development with ngrok

```bash
ngrok http 3000
# Twilio webhook URL: https://<random>.ngrok.io/sms/inbound
```

### Production

Set the webhook URL in the [Twilio Console](https://console.twilio.com):

1. Go to **Phone Numbers → Manage → Active Numbers**.
2. Click your number.
3. Under **Messaging → A MESSAGE COMES IN**, set:
   - **Webhook**: `https://your-domain.com/sms/inbound`
   - **HTTP Method**: `HTTP POST`
4. Save.

> Twilio signature validation is enforced on every inbound request. Requests with an invalid or missing `X-Twilio-Signature` header receive a `403` response.

---

## REST API

### Create a patient

```
POST /patients
Content-Type: application/json

{
  "name": "Alice Johnson",
  "phone": "+15551234567",
  "timezone": "America/New_York"
}
```

`phone` is normalized to E.164 automatically.

---

### Add a medication

```
POST /patients/:id/medications
Content-Type: application/json

{
  "name": "Lisinopril",
  "dose": "10mg",
  "reminder_time": "08:00",
  "food_note": "Take with a full glass of water"
}
```

`reminder_time` — 24-hour `HH:MM`. A daily BullMQ cron job is created immediately.

---

### Dashboard

```
GET /patients/:id/dashboard
```

Returns:

```json
{
  "patient": { ... },
  "today_schedule": [
    { "name": "Lisinopril", "dose": "10mg", "reminder_time": "08:00", "today_status": "confirmed" }
  ],
  "weekly_adherence": [
    { "week_start": "2026-04-06", "pct": "83.33" }
  ]
}
```

---

### Delete (deactivate) a medication

```
DELETE /medications/:id
```

Soft-deletes the medication (`active = FALSE`) and cancels its BullMQ repeating job.

---

## SMS Commands

| Reply | Action |
|---|---|
| `Y` or `YES` | Mark most recent reminder as **taken** |
| `S` or `SNOOZE` | Snooze — re-send reminder in **15 minutes** |
| `N` or `NO` | Mark as **skipped** (triggers caregiver alert if threshold reached) |
| `STATUS` | View today's medication schedule |
| `STOP` | Unsubscribe from all reminders |
| `START` | Re-enable reminders |
| `H` or `HELP` | Show command list |

---

## Caregiver Alerts

Caregivers are stored in the `caregivers` table.  
After each skipped dose, MedPing counts consecutive skipped doses (since the last confirmed dose). When that count equals a caregiver's `threshold`, an alert SMS is sent to that caregiver.

To add a caregiver, insert directly into the `caregivers` table (no API endpoint is required by the spec):

```sql
INSERT INTO caregivers (patient_id, name, phone, relationship, threshold)
VALUES (1, 'Bob Johnson', '+15559876543', 'son', 3);
```

---

## Database Schema

| Table | Key columns |
|---|---|
| `patients` | `id`, `name`, `phone` (E.164), `timezone`, `reminders_active` |
| `medications` | `id`, `patient_id`, `name`, `dose`, `reminder_time`, `food_note`, `active` |
| `reminder_logs` | `id`, `patient_id`, `medication_id`, `sent_at`, `status` (`awaiting`/`confirmed`/`skipped`/`snoozed`), `confirmed_at` |
| `adherence_weekly` | `id`, `patient_id`, `week_start`, `pct` |
| `caregivers` | `id`, `patient_id`, `name`, `phone`, `relationship`, `threshold`, `active` |
