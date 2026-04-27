/**
 * When worker_onboarding changes, run the onboarding completion engine with the **same inputs as the UI**
 * (assignments, instances, envelopes, backgrounds, payroll, entity settings, automation dispatch, E-Verify).
 * Pipeline fields are taken from the trigger payload so the write is authoritative.
 */
import * as path from 'path';
import * as admin from 'firebase-admin';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { logger } from '../utils/logger';
import {
  deserializeEngineBuildContext,
  loadSerializedEntityOnboardingEngineBuildContextAdmin,
} from './loadEntityOnboardingEngineBuildContextAdmin';
import { buildEngineSyncLifecycleFragment } from './entityEmploymentLifecycle';

type EntityKey = 'select' | 'workforce' | 'events';

function parseWorkerOnboardingDocId(
  pipelineId: string
): { userId: string; entityKey: EntityKey } | null {
  const suffixes: EntityKey[] = ['select', 'workforce', 'events'];
  for (const ek of suffixes) {
    const suf = `__${ek}`;
    if (pipelineId.endsWith(suf)) {
      return { userId: pipelineId.slice(0, -suf.length), entityKey: ek };
    }
  }
  return null;
}

function loadOnboardingEngineBundle(): {
  computeEntityOnboardingEngineFromBuildContext: (ctx: Record<string, unknown>) => {
    taxIdentityStatus: string;
    handbookStatus: string;
    payrollStatus: string;
    recruiterFollowUpGatingStatus: string;
    onboardingComplete: boolean;
  };
} {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require(path.join(__dirname, '../onboardingEngineSync.js'));
}

export async function reconcileEntityEmploymentOnboardingFromPipelineData(args: {
  tenantId: string;
  pipelineId: string;
  pipelineData: Record<string, unknown>;
}): Promise<void> {
  const { tenantId, pipelineId, pipelineData } = args;
  const parsed = parseWorkerOnboardingDocId(pipelineId);
  if (!parsed) {
    logger.warn('[entityEmploymentOnboardingSync] Unrecognized worker_onboarding doc id', { pipelineId });
    return;
  }
  const { userId, entityKey } = parsed;
  const db = admin.firestore();

  const employmentRef = db.doc(`tenants/${tenantId}/entity_employments/${pipelineId}`);
  const employmentSnap = await employmentRef.get();
  if (!employmentSnap.exists) return;

  const employment = employmentSnap.data() || {};
  const statusNow = String(employment.status || '').toLowerCase();

  let serialized;
  try {
    serialized = await loadSerializedEntityOnboardingEngineBuildContextAdmin(db, {
      tenantId,
      userId,
      entityKey,
      pipelineId,
      pipelineData,
    });
  } catch (e) {
    logger.error('[entityEmploymentOnboardingSync] loadSerializedEntityOnboardingEngineBuildContextAdmin failed', {
      tenantId,
      pipelineId,
      err: e instanceof Error ? e.message : String(e),
    });
    return;
  }

  const ctx = deserializeEngineBuildContext(serialized);

  let engine: ReturnType<ReturnType<typeof loadOnboardingEngineBundle>['computeEntityOnboardingEngineFromBuildContext']>;
  try {
    const { computeEntityOnboardingEngineFromBuildContext } = loadOnboardingEngineBundle();
    engine = computeEntityOnboardingEngineFromBuildContext(ctx);
  } catch (e) {
    logger.error('[entityEmploymentOnboardingSync] computeEntityOnboardingEngineFromBuildContext failed', {
      tenantId,
      pipelineId,
      err: e instanceof Error ? e.message : String(e),
    });
    return;
  }

  const ts = admin.firestore.FieldValue.serverTimestamp();
  const updates: Record<string, unknown> = {
    taxIdentityStatus: engine.taxIdentityStatus,
    handbookStatus: engine.handbookStatus,
    payrollStatus: engine.payrollStatus,
    recruiterFollowUpGatingStatus: engine.recruiterFollowUpGatingStatus,
    onboardingComplete: engine.onboardingComplete,
    updatedAt: ts,
  };

  Object.assign(
    updates,
    buildEngineSyncLifecycleFragment({
      employmentStatusNowLower: statusNow,
      engineOnboardingComplete: engine.onboardingComplete,
      serverTimestamp: ts,
    })
  );

  await employmentRef.set(updates, { merge: true });
}

export const syncEntityEmploymentOnboardingFromWorkerOnboarding = onDocumentWritten(
  'tenants/{tenantId}/worker_onboarding/{pipelineId}',
  async (event) => {
    const tenantId = event.params.tenantId as string;
    const pipelineId = event.params.pipelineId as string;
    const after = event.data?.after;
    if (!after?.exists) return;
    const pipelineData = after.data() as Record<string, unknown>;
    try {
      await reconcileEntityEmploymentOnboardingFromPipelineData({ tenantId, pipelineId, pipelineData });
    } catch (e) {
      logger.error('[syncEntityEmploymentOnboardingFromWorkerOnboarding] failed', {
        tenantId,
        pipelineId,
        err: e instanceof Error ? e.message : String(e),
      });
    }
  }
);
