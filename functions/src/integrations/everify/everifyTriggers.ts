/**
 * E-Verify Firestore triggers.
 * On user_employments i9Status → completed: enqueue Cloud Task to create case.
 * On everify_cases status change: sync to worker_onboarding e_verify step and entity_employments.
 * Config-driven worker URL; creates/verifies EVERIFY_QUEUE.
 */

import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions/v2';
import { CloudTasksClient } from '@google-cloud/tasks';
import { getEverifyWorkerUrl, getEverifyQueueName } from './everifyConfig';
import { syncEverifyStatusToPipelineAndEmployment } from '../../onboarding/workerOnboardingPipeline';

const tasksClient = new CloudTasksClient();
const PROJECT = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || '';
const LOCATION = process.env.FUNCTIONS_REGION || 'us-central1';

/** Gen2 Firestore triggers: full bundle cold start — explicit memory avoids Cloud Run deploy healthcheck flakes. */
const EVERIFY_FS_TRIGGER_OPTS = {
  region: LOCATION,
  memory: '512MiB' as const,
  timeoutSeconds: 300,
};

/** Get worker URL: config-driven (EVERIFY_WORKER_URL) or default v2 pattern */
function getWorkerUrl(): string | null {
  const configured = getEverifyWorkerUrl();
  if (configured) return configured;
  if (!PROJECT || !LOCATION) return null;
  return `https://${LOCATION}-${PROJECT}.cloudfunctions.net/processEverifyCaseFromEmployment`;
}

/**
 * Enqueue Cloud Task to create E-Verify case (shared by trigger and retry callable).
 * @returns true if a task was created; false if project/worker URL missing (caller may fall back).
 */
export async function enqueueEverifyTask(tenantId: string, userEmploymentId: string): Promise<boolean> {
  const queueName = getEverifyQueueName();
  const workerUrl = getWorkerUrl();
  if (!PROJECT) {
    logger.warn('GCLOUD_PROJECT/GCP_PROJECT not set, skipping E-Verify enqueue');
    return false;
  }
  if (!workerUrl) {
    logger.warn('E-Verify worker URL not configured, skipping enqueue');
    return false;
  }
  const parent = tasksClient.queuePath(PROJECT, LOCATION, queueName);
  const taskName = `${parent}/tasks/everify-${tenantId}-${userEmploymentId}-${Date.now()}`;
  const task = {
    name: taskName,
    httpRequest: {
      httpMethod: 'POST' as const,
      url: workerUrl,
      headers: { 'Content-Type': 'application/json' },
      body: Buffer.from(JSON.stringify({ tenantId, userEmploymentId })).toString('base64'),
    },
    scheduleTime: {
      seconds: Math.floor(Date.now() / 1000) + 5,
    },
  };
  await tasksClient.createTask({ parent, task });
  logger.info('E-Verify task enqueued', { tenantId, userEmploymentId, queue: queueName });
  return true;
}

export const onUserEmploymentUpdatedEverify = onDocumentUpdated(
  {
    document: 'tenants/{tenantId}/user_employments/{employmentId}',
    ...EVERIFY_FS_TRIGGER_OPTS,
  },
  async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    const tenantId = event.params.tenantId;
    const employmentId = event.params.employmentId;

    if (!before || !after) return;

    const beforeI9 = String(before.i9Status || '').toLowerCase();
    const afterI9 = String(after.i9Status || '').toLowerCase();

    if (beforeI9 === 'completed' || afterI9 !== 'completed') return;

    const isEmulator =
      process.env.FUNCTIONS_EMULATOR === 'true' ||
      !!process.env.FIREBASE_EMULATOR_HUB ||
      !!process.env.FIRESTORE_EMULATOR_HOST;

    if (isEmulator) {
      logger.info(`[EMULATOR] Skipping E-Verify enqueue for user_employments/${employmentId}`);
      return;
    }

    if (!PROJECT) {
      logger.warn('GCLOUD_PROJECT not set, skipping E-Verify enqueue');
      return;
    }

    try {
      await enqueueEverifyTask(tenantId, employmentId);
    } catch (err: unknown) {
      logger.error(`Error enqueueing E-Verify task for ${employmentId}:`, err);
    }
  }
);

/** When everify_cases doc is updated and status changed, sync to pipeline + entity_employments. */
export const onEverifyCaseUpdatedSyncOnboarding = onDocumentUpdated(
  {
    document: 'tenants/{tenantId}/everify_cases/{caseId}',
    ...EVERIFY_FS_TRIGGER_OPTS,
  },
  async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    const tenantId = event.params.tenantId;

    if (!before || !after) return;
    const prevStatus = String(before.status || '');
    const newStatus = String(after.status || '');
    if (prevStatus === newStatus) return;

    const userId = (after.userId as string) || null;
    const entityId = (after.entityId as string) || null;
    try {
      await syncEverifyStatusToPipelineAndEmployment({
        tenantId,
        userId,
        entityId,
        caseStatus: newStatus,
      });
    } catch (err: unknown) {
      logger.error('E-Verify sync to onboarding failed', {
        tenantId,
        caseId: event.params.caseId,
        userId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
);
