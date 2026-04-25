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
  BASELINE_SELECT_REQUIREMENTS,
  BASELINE_WORKFORCE_REQUIREMENTS,
  BASELINE_EVENTS_REQUIREMENTS,
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

/**
 * Resolve the entity to one of three keys based on its `name`. Mirrors
 * `deriveEntityKeyFromName` in `functions/src/onboarding/workerOnboardingPipeline.ts`.
 *
 * Priority — substring of the entity's name (case-insensitive):
 *   - "select" → 'select'  (W-2 with E-Verify)
 *   - "event"  → 'events'  (1099 contractor)
 *   - else     → 'workforce' (W-2 without E-Verify; default for legacy
 *                names that don't match either)
 *
 * Falls back to workerType for entities that lack a recognizable name —
 * a 1099 entity called "Foo LLC" still gets the events baseline rather
 * than the W-2 default.
 */
function deriveEntityKey(cfg: EntityConfig): 'select' | 'workforce' | 'events' {
  const name = (cfg.name || '').toLowerCase();
  if (name.includes('select')) return 'select';
  if (name.includes('event')) return 'events';
  if (cfg.workerType === '1099') return 'events';
  return 'workforce';
}

function buildRequirementSetForEntity(cfg: EntityConfig): SeedEmployeeReadinessRequirementSpec[] {
  // Pick the baseline by entity. The three lists are explicit (no
  // everifyRequired trim hack) — see `docs/READINESS_MODEL.md` §3 and
  // `shared/seedEmployeeReadinessItems.ts`.
  const entityKey = deriveEntityKey(cfg);
  let requirements: SeedEmployeeReadinessRequirementSpec[];
  switch (entityKey) {
    case 'select':
      requirements = BASELINE_SELECT_REQUIREMENTS.slice();
      break;
    case 'workforce':
      requirements = BASELINE_WORKFORCE_REQUIREMENTS.slice();
      break;
    case 'events':
      requirements = BASELINE_EVENTS_REQUIREMENTS.slice();
      break;
  }

  // Per-entity override: if `everifyRequired` is explicitly set on the
  // entity doc, honor it. Lets a tenant turn E-Verify off on Select for
  // testing, or on Workforce if they want it (rare). Without this
  // override, Select includes E-Verify and Workforce / Events don't.
  if (cfg.everifyRequired === false) {
    requirements = requirements.filter((r) => r.requirementType !== 'e_verify');
  } else if (cfg.everifyRequired === true && !requirements.some((r) => r.requirementType === 'e_verify')) {
    requirements = [...requirements, { requirementType: 'e_verify' }];
  }

  // `everee_profile` only makes sense when the entity actually uses Everee.
  // Drop it for tenants still on TempWorks / ADP etc.
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
