/**
 * Auto-seed Employee Readiness items when a worker first lands on a hiring
 * entity. Watches `tenants/{tenantId}/entity_employments/{employmentId}` for
 * creates and invokes the shared seed runner with `'system'` as the actor uid.
 *
 * Reads the hiring entity's own config to decide which baseline to use:
 *   - `entity.workerType === 'W2'`   → BASELINE_W2_REQUIREMENTS
 *   - `entity.workerType === '1099'` → BASELINE_1099_REQUIREMENTS
 *   - anything else                  → defaults to W2 (safe for C1's current mix)
 *
 * And trims the requirement list based on per-entity toggles:
 *   - `entity.everifyRequired === false` → drops the `e_verify` item
 *   - `entity.payrollProvider !== 'everee'` → drops the `everee_profile` item
 *     (items for TempWorks, ADP, etc. can be added later as custom specs)
 *
 * Idempotent — the runner skips any item ids that already exist. Safe to
 * replay if a manual seed ran first.
 *
 * @see functions/src/readiness/seedEmployeeReadinessItemsRunner.ts
 * @see recruiter-ownership-model.md §9 #3 (per-entity onboarding decision)
 */

import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions/v2';
import * as admin from 'firebase-admin';

import {
  BASELINE_W2_REQUIREMENTS,
  BASELINE_1099_REQUIREMENTS,
  type SeedEmployeeReadinessRequirementSpec,
} from '../shared/seedEmployeeReadinessItems';
import { runEmployeeReadinessSeed } from './seedEmployeeReadinessItemsRunner';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

export const onEntityEmploymentCreatedAutoSeedReadiness = onDocumentCreated(
  {
    document: 'tenants/{tenantId}/entity_employments/{employmentId}',
    region: 'us-central1',
    maxInstances: 3,
    retry: false,
  },
  async (event) => {
    const tenantId = String(event.params.tenantId);
    const employmentId = String(event.params.employmentId);
    const data = event.data?.data() as Record<string, unknown> | undefined;

    if (!data) {
      logger.warn('onEntityEmploymentCreatedAutoSeedReadiness: event.data missing', { tenantId, employmentId });
      return;
    }

    const workerUid = pickString(data.userId, data.candidateId, data.workerUid);
    const hiringEntityId = pickString(data.hiringEntityId, data.entityId);
    if (!workerUid || !hiringEntityId) {
      logger.warn('onEntityEmploymentCreatedAutoSeedReadiness: missing workerUid or hiringEntityId', {
        tenantId,
        employmentId,
        workerUid,
        hiringEntityId,
      });
      return;
    }

    // Resolve entity config to pick the right baseline + trim requirements.
    let entityConfig: EntityConfig = {};
    try {
      const entitySnap = await db.doc(`tenants/${tenantId}/entities/${hiringEntityId}`).get();
      if (entitySnap.exists) {
        entityConfig = readEntityConfig(entitySnap.data() as Record<string, unknown>);
      }
    } catch (err) {
      logger.warn('onEntityEmploymentCreatedAutoSeedReadiness: entity config lookup failed — using W2 defaults', {
        tenantId,
        hiringEntityId,
        err: (err as Error).message,
      });
    }

    const requirements = buildRequirementSetForEntity(entityConfig);
    if (requirements.length === 0) {
      logger.warn('onEntityEmploymentCreatedAutoSeedReadiness: empty requirement set — skipping', {
        tenantId,
        employmentId,
        entityConfig,
      });
      return;
    }

    try {
      const result = await runEmployeeReadinessSeed({
        tenantId,
        workerUid,
        hiringEntityId,
        hiringEntityName: entityConfig.name,
        requirements,
        actorUid: 'system',
        source: { kind: 'migration', ref: `entity_employment:${employmentId}` },
      });
      logger.info('onEntityEmploymentCreatedAutoSeedReadiness: seeded', {
        tenantId,
        employmentId,
        workerUid,
        hiringEntityId,
        itemsCreated: result.itemsCreated,
        itemsSkippedExisting: result.itemsSkippedExisting,
        primarySource: result.ownership.primarySource,
        primaryRecruiterId: result.ownership.primaryRecruiterId,
      });
    } catch (err) {
      logger.error('onEntityEmploymentCreatedAutoSeedReadiness: seed failed', {
        tenantId,
        employmentId,
        workerUid,
        hiringEntityId,
        err: (err as Error).message,
      });
    }
  },
);

type EntityConfig = {
  name?: string;
  workerType?: string;
  everifyRequired?: boolean;
  payrollProvider?: string;
};

function readEntityConfig(raw: Record<string, unknown>): EntityConfig {
  return {
    name: typeof raw.name === 'string' ? raw.name : undefined,
    workerType: typeof raw.workerType === 'string' ? raw.workerType : undefined,
    everifyRequired: typeof raw.everifyRequired === 'boolean' ? raw.everifyRequired : undefined,
    payrollProvider: typeof raw.payrollProvider === 'string' ? raw.payrollProvider : undefined,
  };
}

function buildRequirementSetForEntity(cfg: EntityConfig): SeedEmployeeReadinessRequirementSpec[] {
  const baseline =
    cfg.workerType === '1099' ? BASELINE_1099_REQUIREMENTS.slice() : BASELINE_W2_REQUIREMENTS.slice();

  // E-Verify is config-driven per entity (C1 Select = always true, C1 Events / C1 Workforce may differ).
  // Drop it when the entity says not required.
  let requirements = baseline;
  if (cfg.everifyRequired === false) {
    requirements = requirements.filter((r) => r.requirementType !== 'e_verify');
  }

  // `everee_profile` only makes sense when the entity actually uses Everee.
  // Tenants still on TempWorks / ADP etc. can add their own custom onboarding
  // step as a follow-up; we drop the Everee-specific one to avoid a phantom
  // requirement that doesn't map to real user work.
  if (cfg.payrollProvider && cfg.payrollProvider !== 'everee') {
    requirements = requirements.filter((r) => r.requirementType !== 'everee_profile');
  }

  return requirements;
}

function pickString(...candidates: unknown[]): string {
  for (const v of candidates) {
    if (typeof v === 'string' && v.trim().length > 0) return v.trim();
  }
  return '';
}
