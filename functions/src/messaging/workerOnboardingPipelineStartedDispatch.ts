/**
 * Fires automation rules for trigger `worker_onboarding_pipeline_started` when
 * `worker_onboarding/{pipelineId}` is created (first time per worker + entity key).
 * Independent of assignment confirmation; assignment/job context is included when present.
 */
import { logger } from 'firebase-functions/v2';
import { markLifecycleEventIfFirst } from './lifecycleDedupe';
import { dispatchSystemMessage } from './systemMessageDispatcher';
import { SYSTEM_TRIGGER_KEYS } from './triggerRegistry';

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

  const result = await dispatchSystemMessage({
    tenantId,
    userId,
    triggerKey: SYSTEM_TRIGGER_KEYS.workerOnboardingPipelineStarted,
    context: {
      hiringEntityName: entityName,
      hiringEntityId: entityId ?? '',
      onboardingPipelineId: pipelineId,
      entityKey,
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
