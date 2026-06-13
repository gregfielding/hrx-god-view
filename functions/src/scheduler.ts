import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onCall } from 'firebase-functions/v2/https';

import { logger } from './utils/logger';

const DISABLED_REASON =
  'AI Moments + scheduled moments were removed for HRX1 cost hardening. Scheduler is paused until the new workflow ships.';

export const runAIScheduler = onSchedule(
  {
    schedule: '0 9 * * *',
    timeZone: 'America/New_York',
    maxInstances: 1,
    retryCount: 0,
    timeoutSeconds: 60,
    memory: '512MiB', // 256MiB OOMs on cold start (bundle ~200+MiB)
  },
  async () => {
    await logger.info('runAIScheduler skipped', {
      context: 'Scheduler',
      extra: { reason: DISABLED_REASON },
    });
  }
);

export const manualSchedulerRun = onCall(
  {
    cors: true,
    maxInstances: 1,
  },
  async (request) => {
    await logger.warn('manualSchedulerRun invoked while scheduler is disabled', {
      context: 'Scheduler',
      extra: { userId: request.auth?.uid || 'anonymous' },
    });

    return {
      success: false,
      disabled: true,
      message: DISABLED_REASON,
    };
  }
);
