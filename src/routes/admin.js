'use strict';
const express      = require('express');
const router       = express.Router();
const { reminderQueue } = require('../queues/reminderQueue');
const asyncHandler  = require('../helpers/asyncHandler');
const requireApiKey = require('../middleware/auth');

// ---------------------------------------------------------------------------
// GET /admin/queue  — BullMQ queue health and recent failures
// ---------------------------------------------------------------------------
router.get('/queue', requireApiKey, asyncHandler(async (_req, res) => {
  const [waiting, active, completed, failed, delayed, repeatableJobs] = await Promise.all([
    reminderQueue.getWaitingCount(),
    reminderQueue.getActiveCount(),
    reminderQueue.getCompletedCount(),
    reminderQueue.getFailedCount(),
    reminderQueue.getDelayedCount(),
    reminderQueue.getRepeatableJobs(),
  ]);

  // Return up to 20 most-recent failed jobs with sanitized details.
  const recentFailures = await reminderQueue.getFailed(0, 19);

  res.json({
    counts: {
      waiting,
      active,
      completed,
      failed,
      delayed,
      repeatable: repeatableJobs.length,
    },
    repeatable_jobs: repeatableJobs.map((j) => ({
      id:      j.id,
      pattern: j.pattern,
      tz:      j.tz,
      next:    j.next,
    })),
    recent_failures: recentFailures.map((j) => ({
      id:          j.id,
      data:        j.data,
      reason:      j.failedReason,
      attempts:    j.attemptsMade,
      finished_at: j.finishedOn ? new Date(j.finishedOn).toISOString() : null,
    })),
  });
}));

// ---------------------------------------------------------------------------
// POST /admin/queue/retry-failed  — retry all failed jobs
// ---------------------------------------------------------------------------
router.post('/queue/retry-failed', requireApiKey, asyncHandler(async (_req, res) => {
  const failed = await reminderQueue.getFailed(0, 999);
  let retried = 0;
  for (const job of failed) {
    await job.retry();
    retried++;
  }
  res.json({ retried });
}));

module.exports = router;
