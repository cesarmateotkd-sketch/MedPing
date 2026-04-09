'use strict';

jest.mock('../../src/db', () => ({ query: jest.fn() }));
// API_KEY not set in test → auth middleware allows through with a warning.
delete process.env.API_KEY;

const request = require('supertest');
const express = require('express');
const pool    = require('../../src/db');

const app = express();
app.use(express.json());
app.use('/caregivers', require('../../src/routes/caregivers'));
app.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));

beforeEach(() => pool.query.mockReset());

// ---------------------------------------------------------------------------
// DELETE /caregivers/:id
// ---------------------------------------------------------------------------
describe('DELETE /caregivers/:id', () => {
  test('200: deactivates caregiver', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 5, active: false }] });

    const res = await request(app).delete('/caregivers/5');

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/deactivated/i);
    expect(res.body.caregiver).toMatchObject({ id: 5, active: false });
  });

  test('400: non-numeric ID', async () => {
    const res = await request(app).delete('/caregivers/abc');
    expect(res.status).toBe(400);
  });

  test('404: not found (query returns empty rows)', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app).delete('/caregivers/999');
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// PATCH /caregivers/:id
// ---------------------------------------------------------------------------
describe('PATCH /caregivers/:id', () => {
  test('200: updates threshold', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 5, threshold: 50 }] });

    const res = await request(app).patch('/caregivers/5').send({ threshold: 50 });

    expect(res.status).toBe(200);
    expect(res.body.threshold).toBe(50);
  });

  test('200: reactivates caregiver', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 5, active: true }] });

    const res = await request(app).patch('/caregivers/5').send({ active: true });

    expect(res.status).toBe(200);
    expect(res.body.active).toBe(true);
  });

  test('400: no fields provided', async () => {
    const res = await request(app).patch('/caregivers/5').send({});
    expect(res.status).toBe(400);
  });

  test('400: threshold = 0', async () => {
    const res = await request(app).patch('/caregivers/5').send({ threshold: 0 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/threshold/i);
  });

  test('400: non-numeric ID', async () => {
    const res = await request(app).patch('/caregivers/abc').send({ threshold: 10 });
    expect(res.status).toBe(400);
  });

  test('404: not found (query returns empty rows)', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app).patch('/caregivers/999').send({ threshold: 10 });
    expect(res.status).toBe(404);
  });
});
