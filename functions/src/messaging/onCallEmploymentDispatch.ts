/**
 * Automation trigger `on_call_employment_started` — labor pool / pre-assignment hire.
 */
import { logger } from 'firebase-functions/v2';
import {
  buildWorkerEntityEmploymentUrl,
  buildWorkerPayrollEvereeTenantUrl,
} from '../utils/workerUrls';
import { getEvereeConfigForEntity } from '../integrations/everee/evereeConfig';
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

  // For 1099 / events workers, the My Employment hub is one extra hop away
  // from the actual Everee payroll iframe and the SMS just adds friction.
  // Resolve the entity's `evereeTenantId` so we can drop them into the
  // direct payroll Embed instead. We also expose `workerPayrollUrl` as a
  // separate variable for templates that want to render both links
  // explicitly. Falls back gracefully — if Everee isn't configured for this
  // entity (`getEvereeConfigForEntity` returns null) we keep the standard
  // hub URL, which is still functional just less direct.
  const fallbackHubUrl = buildWorkerEntityEmploymentUrl(args.pipelineId);
  let workerPayrollUrl = '';
  if (isEventsEntity) {
    try {
      const cfg = await getEvereeConfigForEntity(args.tenantId, args.hiringEntityId);
      const evereeTenantId = cfg?.evereeTenantId?.trim() || '';
      if (evereeTenantId) {
        workerPayrollUrl = buildWorkerPayrollEvereeTenantUrl(evereeTenantId);
      }
    } catch (e: unknown) {
      logger.warn('on_call_employment_started: evereeTenantId resolve failed', {
        tenantId: args.tenantId,
        hiringEntityId: args.hiringEntityId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  // Substitute the direct payroll URL for the standard hub URL when we have
  // it. Existing tenant templates that reference `{{workerEntityEmploymentUrl}}`
  // automatically pick up the better link without needing edits.
  const workerEntityEmploymentUrl =
    isEventsEntity && workerPayrollUrl ? workerPayrollUrl : fallbackHubUrl;

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
