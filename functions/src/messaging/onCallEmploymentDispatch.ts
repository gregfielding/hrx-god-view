/**
 * Automation trigger `on_call_employment_started` — labor pool / pre-assignment hire.
 */
import { logger } from 'firebase-functions/v2';
import { resolveWorkerOnboardingLink } from '../integrations/everee/resolveWorkerOnboardingLink';
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

  const isEventsEntity = String(args.entityKey || '').trim().toLowerCase() === 'events';
  const i9SupportingDocumentsApplicable = !isEventsEntity;

  // Drop the worker straight into the Everee payroll iframe whenever the
  // hiring entity is Everee-enabled (any entity with an `evereeTenantId`,
  // not just events / 1099). Everee surfaces I-9 + W-4 + W-9 + banking on
  // its tenant page so this is fewer hops than the My Employment hub for
  // both W2 employees and 1099 contractors. Existing tenant templates
  // referencing `{{workerEntityEmploymentUrl}}` automatically pick up the
  // better link without edits; templates can also reference the explicit
  // `{{workerPayrollUrl}}` var when they want to call out payroll
  // separately.
  const resolved = await resolveWorkerOnboardingLink({
    tenantId: args.tenantId,
    entityId: args.hiringEntityId,
    pipelineId: args.pipelineId,
    context: 'on_call_employment_started',
  });
  const workerEntityEmploymentUrl = resolved.link;
  const workerPayrollUrl = resolved.isEvereeDirect ? resolved.link : '';

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
      ...(workerPayrollUrl ? { workerPayrollUrl } : {}),
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
