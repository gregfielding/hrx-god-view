/**
 * Phase A trigger — bridge
 * `tenants/{tid}/worker_onboarding/{userId}__{entityKey}.externalOnboardingSteps`
 * writes into the corresponding `employee_readiness_items.{...}.status`.
 *
 * Closes Critical hole #1 (worker_onboarding branch) and Critical hole
 * #3 (the parallel-onboarding-systems gap) per
 * `docs/READINESS_EXECUTION_MATRIX.md` §6 / §7.
 *
 * The CSA verification callable (`updateExternalOnboardingStepVerification`)
 * writes step status into `worker_onboarding.externalOnboardingSteps[stepKey]`.
 * This trigger detects which step(s) changed and fans out to the matching
 * readiness items via the bridge map in
 * `shared/readinessStatusFromOnboardingStep.ts`.
 *
 * The doc id is `${userId}__${entityKey}`, where `entityKey` is one of
 * `'select' | 'workforce' | 'events'` per the canonical onboarding step
 * matrix. We resolve `entityKey → hiringEntityId` by reading the doc's
 * `hiringEntityId` field (set when the doc was created by the
 * onboarding pipeline).
 *
 * I-9 §1 / §2 are NOT covered by this trigger — those live on the
 * older `worker_onboarding.steps[]` array, not `externalOnboardingSteps`.
 * They get their own bridge trigger (queued; see matrix §7 Phase D).
 *
 * @see shared/readinessStatusFromOnboardingStep.ts
 * @see updateReadinessItemStatus.ts
 */

import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions/v2';
import * as admin from 'firebase-admin';

import {
  ONBOARDING_STEP_TO_REQUIREMENT_TYPE,
  onboardingStepToReadinessStatus,
  type OnboardingStepStatus,
} from '../shared/readinessStatusFromOnboardingStep';
import { updateReadinessItemStatus } from './updateReadinessItemStatus';

if (!admin.apps.length) {
  admin.initializeApp();
}

function pickString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const t = value.trim();
  return t === '' ? null : t;
}

/**
 * Pull the per-step status out of an `externalOnboardingSteps` map.
 * Returns null when the entry is missing or has no status field.
 */
function readStepStatus(
  external: unknown,
  stepKey: string,
): OnboardingStepStatus | null | undefined {
  if (!external || typeof external !== 'object') return undefined;
  const entry = (external as Record<string, unknown>)[stepKey];
  if (!entry || typeof entry !== 'object') return undefined;
  const status = (entry as Record<string, unknown>).status;
  if (typeof status !== 'string') return undefined;
  // Defensive cast — the union members come from the callable's contract.
  return status as OnboardingStepStatus;
}

export const onOnboardingStepVerifiedUpdateReadiness = onDocumentWritten(
  {
    document: 'tenants/{tenantId}/worker_onboarding/{onboardingId}',
    region: 'us-central1',
    maxInstances: 5,
    memory: '512MiB',
    retry: false,
  },
  async (event) => {
    const tenantId = String(event.params.tenantId);
    const onboardingId = String(event.params.onboardingId);

    const beforeData = event.data?.before?.exists
      ? ((event.data.before.data() ?? {}) as Record<string, unknown>)
      : null;
    const afterData = event.data?.after?.exists
      ? ((event.data.after.data() ?? {}) as Record<string, unknown>)
      : null;

    if (!afterData) {
      // Onboarding doc deleted — don't roll back readiness items;
      // deletion is rare and a CSA decision belongs there explicitly.
      return;
    }

    const userId = pickString(afterData.userId);
    const hiringEntityId =
      pickString(afterData.hiringEntityId) ?? pickString(afterData.entityId);
    if (!userId || !hiringEntityId) {
      // Some legacy onboarding docs lack hiringEntityId. We can't route
      // a status update without it, so log + skip.
      logger.warn('onOnboardingStepVerifiedUpdateReadiness: missing userId or hiringEntityId', {
        tenantId,
        onboardingId,
        userId,
        hiringEntityId,
      });
      return;
    }

    const beforeExternal = beforeData?.externalOnboardingSteps;
    const afterExternal = afterData.externalOnboardingSteps;

    // Walk every mapped step key and update only the items where the
    // status actually changed. Avoids fan-out to N items on every write
    // when only one step moved.
    const updates = await Promise.all(
      Object.entries(ONBOARDING_STEP_TO_REQUIREMENT_TYPE).map(async ([stepKey, requirementType]) => {
        const beforeStatus = readStepStatus(beforeExternal, stepKey);
        const afterStatus = readStepStatus(afterExternal, stepKey);
        if (beforeStatus === afterStatus) {
          return { stepKey, requirementType, changed: false, skipped: 'unchanged' as const };
        }

        const newStatus = onboardingStepToReadinessStatus({ status: afterStatus });
        const result = await updateReadinessItemStatus({
          tenantId,
          workerUid: userId,
          hiringEntityId,
          requirementType,
          newStatus,
          source: 'worker_onboarding_step_change',
          externalRef: onboardingId,
        });
        return {
          stepKey,
          requirementType,
          changed: result.changed,
          skipped: result.skippedReason,
        };
      }),
    );

    const movedSteps = updates.filter((u) => u.changed);
    if (movedSteps.length > 0) {
      logger.info('onOnboardingStepVerifiedUpdateReadiness: reconciled', {
        tenantId,
        onboardingId,
        userId,
        hiringEntityId,
        moved: movedSteps.map((m) => `${m.stepKey}→${m.requirementType}`),
      });
    }
  },
);
