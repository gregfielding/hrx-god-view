/**
 * Callable: `seedEmployeeReadinessItems`
 *
 * Manually trigger the creation of `EmployeeReadinessItem` docs for a worker
 * × hiring entity. Auth-gates with `canManageOnboarding` (L4+), picks the
 * requirement set, and delegates to `runEmployeeReadinessSeed`.
 *
 * The automatic `onEntityEmploymentCreatedAutoSeedReadiness` trigger (separate
 * file) uses the same runner but with `'system'` as the actor uid and no auth
 * gate. This callable stays around for manual backfills, QA, and one-off
 * reseeds after policy changes.
 *
 * @see functions/src/readiness/seedEmployeeReadinessItemsRunner.ts
 * @see functions/src/readiness/onEntityEmploymentCreatedAutoSeed.ts
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import {
  BASELINE_W2_REQUIREMENTS,
  BASELINE_1099_REQUIREMENTS,
  type SeedEmployeeReadinessRequirementSpec,
} from '../shared/seedEmployeeReadinessItems';

import { canManageOnboarding } from '../onboarding/workerOnboardingPipeline';
import { runEmployeeReadinessSeed, type SeedRunnerResult } from './seedEmployeeReadinessItemsRunner';

type BaselinePreset = 'w2' | '1099' | 'none';

interface SeedPayload {
  tenantId: string;
  workerUid: string;
  hiringEntityId: string;
  hiringEntityName?: string;
  baseline?: BaselinePreset;
  requirements?: SeedEmployeeReadinessRequirementSpec[];
  dryRun?: boolean;
}

export const seedEmployeeReadinessItemsCallable = onCall(
  {
    cors: true,
    memory: '256MiB',
    timeoutSeconds: 60,
  },
  async (request): Promise<SeedRunnerResult> => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Authentication required');
    }
    const callerUid = request.auth.uid;

    const data = (request.data || {}) as SeedPayload;
    const tenantId = String(data.tenantId || '').trim();
    const workerUid = String(data.workerUid || '').trim();
    const hiringEntityId = String(data.hiringEntityId || '').trim();

    if (!tenantId || !workerUid || !hiringEntityId) {
      throw new HttpsError('invalid-argument', 'tenantId, workerUid, and hiringEntityId are required');
    }

    if (!(await canManageOnboarding(request.auth, tenantId, callerUid))) {
      throw new HttpsError('permission-denied', 'Not authorized to seed readiness items for this tenant');
    }

    const requirements = pickRequirementSet(data);
    if (requirements.length === 0) {
      throw new HttpsError('invalid-argument', 'Empty requirement set — pass either `requirements` or `baseline`');
    }

    try {
      return await runEmployeeReadinessSeed({
        tenantId,
        workerUid,
        hiringEntityId,
        hiringEntityName: data.hiringEntityName,
        requirements,
        actorUid: callerUid,
        source: { kind: 'recruiterManual', ref: callerUid },
        dryRun: data.dryRun,
      });
    } catch (err) {
      const msg = (err as Error).message || 'Readiness seed failed';
      throw new HttpsError('internal', msg);
    }
  },
);

function pickRequirementSet(data: SeedPayload): SeedEmployeeReadinessRequirementSpec[] {
  if (Array.isArray(data.requirements) && data.requirements.length > 0) {
    return data.requirements;
  }
  switch (data.baseline) {
    case '1099':
      return BASELINE_1099_REQUIREMENTS;
    case 'none':
      return [];
    case 'w2':
    default:
      return BASELINE_W2_REQUIREMENTS;
  }
}
