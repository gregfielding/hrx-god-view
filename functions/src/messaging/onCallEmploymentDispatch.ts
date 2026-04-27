/**
 * Automation trigger `on_call_employment_started` — labor pool / pre-assignment hire.
 */
import { logger } from 'firebase-functions/v2';
import { buildWorkerEntityEmploymentUrl } from '../utils/workerUrls';
import { markLifecycleEventIfFirst } from './lifecycleDedupe';
import { dispatchSystemMessage } from './systemMessageDispatcher';
import { SYSTEM_TRIGGER_KEYS } from './triggerRegistry';

const DEDUPE_V = 'v1';

export async function dispatchOnCallEmploymentStarted(args: {
  tenantId: string;
  userId: string;
  pipelineId: string;
  hiringEntityId: string;
  entityName: string;
  entityKey: string;
  initiatedByUid: string;
}): Promise<void> {
  const dedupeKey = `on_call_employment_started__${DEDUPE_V}__${args.tenantId}__${args.pipelineId}`;
  const first = await markLifecycleEventIfFirst({
    tenantId: args.tenantId,
    dedupeKey,
    eventType: 'on_call_employment_started',
    context: { pipelineId: args.pipelineId, userId: args.userId },
  });
  if (!first) {
    logger.info('on_call_employment_started: dedupe skip', {
      tenantId: args.tenantId,
      pipelineId: args.pipelineId,
    });
    return;
  }

  const workerEntityEmploymentUrl = buildWorkerEntityEmploymentUrl(args.pipelineId);
  const i9SupportingDocumentsApplicable = String(args.entityKey || '').trim().toLowerCase() !== 'events';

  const result = await dispatchSystemMessage({
    tenantId: args.tenantId,
    userId: args.userId,
    triggerKey: SYSTEM_TRIGGER_KEYS.onCallEmploymentStarted,
    context: {
      hiringEntityName: args.entityName,
      hiringEntityId: args.hiringEntityId,
      onboardingPipelineId: args.pipelineId,
      entityKey: args.entityKey,
      workerEntityEmploymentUrl,
      i9SupportingDocumentsApplicable,
      onCallEmployment: 'true',
      initiatedByUid: args.initiatedByUid,
    },
    metadata: {
      pipelineId: args.pipelineId,
      hiringEntityId: args.hiringEntityId,
      entityId: args.hiringEntityId,
      source: 'on_call_employment',
    },
    source: 'on_call_employment',
    sourceId: args.pipelineId,
  });

  if (!result.handled) {
    logger.info('on_call_employment_started: no active automation rules', {
      tenantId: args.tenantId,
      pipelineId: args.pipelineId,
    });
  } else if (!result.sent && result.errors.length) {
    logger.warn('on_call_employment_started: send failed', {
      tenantId: args.tenantId,
      errors: result.errors,
    });
  }
}
