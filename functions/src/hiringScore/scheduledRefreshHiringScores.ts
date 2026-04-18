/**
 * Daily low-frequency pass: refresh stale Hiring Score rows (signature-guarded writes).
 * Does not attach to `users` onWrite — avoids feedback loops.
 */
import * as admin from 'firebase-admin';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import { runRefreshHiringScoresBatch } from './refreshHiringScoresCore';

/** Same workload as `npm run score:refresh -- --only-stale --limit=500` */
export const scheduledRefreshStaleHiringScores = onSchedule(
  {
    schedule: '0 4 * * *',
    timeZone: 'America/New_York',
    maxInstances: 1,
    memory: '512MiB',
    timeoutSeconds: 540,
  },
  async () => {
    const db = admin.firestore();
    const r = await runRefreshHiringScoresBatch(db, {
      dryRun: false,
      limit: 500,
      onlyMissing: false,
      onlyStale: true,
      userId: null,
      startAfterUserId: null,
    });
    logger.info('scheduledRefreshStaleHiringScores: done', r);
  },
);
