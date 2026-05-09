/**
 * Fires automation rules for trigger `worker_onboarding_pipeline_started` when
 * `worker_onboarding/{pipelineId}` is created (first time per worker + entity key).
 * Independent of assignment confirmation; assignment/job context is included when present.
 */
import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';
import {
  buildWorkerEntityEmploymentUrl,
  buildWorkerPayrollEvereeTenantUrl,
} from '../utils/workerUrls';
import { getEvereeConfigForEntity } from '../integrations/everee/evereeConfig';
import { markLifecycleEventIfFirst } from './lifecycleDedupe';
import { dispatchSystemMessage } from './systemMessageDispatcher';
import { SYSTEM_TRIGGER_KEYS } from './triggerRegistry';
import { userIsInActiveMigration, MIGRATION_SUPPRESSION_LOG_TAG } from './migrationSuppress';

const DEDUPE_V = 'v1';

export async function dispatchWorkerOnboardingPipelineStarted(args: {
  tenantId: string;
  userId: string;
  pipelineId: string;
  entityId: string | null;
  entityName: string;
  entityKey: string;
  assignmentId?: string | null;
  jobOrderId?: string | null;
  triggerSource: string;
}): Promise<void> {
  const {
    tenantId,
    userId,
    pipelineId,
    entityId,
    entityName,
    entityKey,
    assignmentId,
    jobOrderId,
    triggerSource,
  } = args;

  // Bulk-migration suppression gate (BI.0 / BI.1 architectural defense).
  // Check user.migrationSource BEFORE marking the lifecycle event so a user
  // who exits migration could in principle re-trigger later. Mirrors the
  // gate in `dispatchWorkerHired` and the contract documented in
  // `migrationSuppress.ts`. Belt-and-suspenders with the in-process
  // `suppressOutboundAutomation` / `suppressPipelineStartedAutomation`
  // flags on `ensureWorkerOnboardingPipeline`.
  try {
    const snap = await admin.firestore().doc(`users/${userId}`).get();
    if (snap.exists && userIsInActiveMigration(snap.data() as Record<string, unknown>)) {
      logger.info(`worker_onboarding_pipeline_started: suppressed (${MIGRATION_SUPPRESSION_LOG_TAG})`, {
        tenantId,
        userId,
        pipelineId,
        entityKey,
        migrationSource: String((snap.data() || {}).migrationSource || ''),
        gate: 'dispatcher',
      });
      return;
    }
  } catch (e) {
    // Fail open — if we can't read the user doc, fall through to the
    // existing behavior. The gate is defense-in-depth; the load-bearing
    // suppression for BI.0 lives in the in-process flags upstream.
    logger.warn('worker_onboarding_pipeline_started: migration gate read_failed (fail open)', {
      tenantId,
      userId,
      error: e instanceof Error ? e.message : String(e),
    });
  }

  const dedupeKey = `worker_onboarding_pipeline_started__${DEDUPE_V}__${tenantId}__${pipelineId}`;
  const first = await markLifecycleEventIfFirst({
    tenantId,
    dedupeKey,
    eventType: 'worker_onboarding_pipeline_started',
    context: { pipelineId, userId, triggerSource },
  });
  if (!first) {
    logger.info('worker_onboarding_pipeline_started: dedupe skip', { tenantId, pipelineId, userId });
    return;
  }

  const isEventsEntity = String(entityKey || '').trim().toLowerCase() === 'events';
  const i9SupportingDocumentsApplicable = !isEventsEntity;

  // Same pattern as `dispatchOnCallEmploymentStarted`: for events / 1099
  // workers we resolve the entity's `evereeTenantId` and substitute the
  // direct payroll iframe URL for the standard My Employment hub URL.
  // Templates referencing `{{workerEntityEmploymentUrl}}` keep working with
  // no edits; new templates can opt into the explicit `{{workerPayrollUrl}}`
  // variable. Falls back to the hub URL if Everee isn't configured on the
  // entity — preserves the previous behavior for that case.
  const fallbackHubUrl = buildWorkerEntityEmploymentUrl(pipelineId);
  let workerPayrollUrl = '';
  if (isEventsEntity && entityId) {
    try {
      const cfg = await getEvereeConfigForEntity(tenantId, entityId);
      const evereeTenantId = cfg?.evereeTenantId?.trim() || '';
      if (evereeTenantId) {
        workerPayrollUrl = buildWorkerPayrollEvereeTenantUrl(evereeTenantId);
      }
    } catch (e: unknown) {
      logger.warn('worker_onboarding_pipeline_started: evereeTenantId resolve failed', {
        tenantId,
        entityId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  const workerEntityEmploymentUrl =
    isEventsEntity && workerPayrollUrl ? workerPayrollUrl : fallbackHubUrl;

  const result = await dispatchSystemMessage({
    tenantId,
    userId,
    triggerKey: SYSTEM_TRIGGER_KEYS.workerOnboardingPipelineStarted,
    context: {
      hiringEntityName: entityName,
      hiringEntityId: entityId ?? '',
      onboardingPipelineId: pipelineId,
      entityKey,
      workerEntityEmploymentUrl,
      ...(workerPayrollUrl ? { workerPayrollUrl } : {}),
      i9SupportingDocumentsApplicable,
      ...(assignmentId ? { assignmentId } : {}),
      ...(jobOrderId ? { jobOrderId } : {}),
      onboardingTriggerSource: triggerSource,
    },
    metadata: {
      pipelineId,
      hiringEntityId: entityId,
      entityId: entityId ?? undefined,
      onboardingTriggerSource: triggerSource,
    },
    source: 'worker_onboarding_pipeline',
    sourceId: pipelineId,
  });

  if (!result.handled) {
    logger.info('worker_onboarding_pipeline_started: no active automation rules', {
      tenantId,
      pipelineId,
      userId,
    });
  } else if (!result.sent && result.errors.length) {
    logger.warn('worker_onboarding_pipeline_started: rules ran but send failed', {
      tenantId,
      pipelineId,
      userId,
      errors: result.errors,
    });
  }
}
