/**
 * Auto-seed Assignment Readiness items when a worker gets placed on a shift.
 * Watches `tenants/{tenantId}/assignments/{assignmentId}` for creates and
 * invokes the shared assignment seed runner with `'system'` as the actor uid.
 *
 * Reads the associated job order + the shift (if present) to decide which
 * requirements to seed:
 *   - Always seeds `shift_confirmation` (the cadence YES/HERE flow).
 *   - If the job order's package requires `backgroundCheckRequired` /
 *     `drugScreeningRequired` → add those items. Otherwise skip.
 *   - If the job order has `requiredPpe` / `safetyBriefingRequired` /
 *     `orientationRequired` flags → add those items.
 *
 * Idempotent — the runner skips existing item ids.
 *
 * @see functions/src/readiness/seedAssignmentReadinessItemsRunner.ts
 * @see recruiter-ownership-model.md §4b (JO-tier ownership resolution)
 */

import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions/v2';
import * as admin from 'firebase-admin';

import type { SeedAssignmentReadinessRequirementSpec } from '../shared/seedAssignmentReadinessItems';
import { runAssignmentReadinessSeed } from './seedAssignmentReadinessItemsRunner';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

export const onAssignmentCreatedAutoSeedReadiness = onDocumentCreated(
  {
    document: 'tenants/{tenantId}/assignments/{assignmentId}',
    region: 'us-central1',
    maxInstances: 3,
    retry: false,
  },
  async (event) => {
    const tenantId = String(event.params.tenantId);
    const assignmentId = String(event.params.assignmentId);
    const data = event.data?.data() as Record<string, unknown> | undefined;

    if (!data) {
      logger.warn('onAssignmentCreatedAutoSeedReadiness: event.data missing', { tenantId, assignmentId });
      return;
    }

    const workerUid = pickString(data.userId, data.candidateId, data.workerUid);
    const jobOrderId = pickString(data.jobOrderId);
    const shiftId = pickString(data.shiftId) || undefined;

    if (!workerUid || !jobOrderId) {
      logger.warn('onAssignmentCreatedAutoSeedReadiness: missing workerUid or jobOrderId', {
        tenantId,
        assignmentId,
        workerUid,
        jobOrderId,
      });
      return;
    }

    // Load the job order to decide which requirements apply.
    let joData: Record<string, unknown> = {};
    try {
      const joSnap = await db.doc(`tenants/${tenantId}/jobOrders/${jobOrderId}`).get();
      if (joSnap.exists) joData = (joSnap.data() ?? {}) as Record<string, unknown>;
    } catch (err) {
      logger.warn('onAssignmentCreatedAutoSeedReadiness: jobOrder lookup failed — using minimal set', {
        tenantId,
        jobOrderId,
        err: (err as Error).message,
      });
    }

    const requirements = buildRequirementsForJobOrder(joData);
    if (requirements.length === 0) {
      logger.info('onAssignmentCreatedAutoSeedReadiness: no requirements apply — skipping', {
        tenantId,
        assignmentId,
      });
      return;
    }

    try {
      const result = await runAssignmentReadinessSeed({
        tenantId,
        assignmentId,
        workerUid,
        jobOrderId,
        shiftId,
        requirements,
        actorUid: 'system',
        source: { kind: 'jobOrderAssignment', ref: assignmentId },
      });
      logger.info('onAssignmentCreatedAutoSeedReadiness: seeded', {
        tenantId,
        assignmentId,
        workerUid,
        jobOrderId,
        itemsCreated: result.itemsCreated,
        itemsSkippedExisting: result.itemsSkippedExisting,
        primarySource: result.ownership.primarySource,
        primaryRecruiterId: result.ownership.primaryRecruiterId,
      });
    } catch (err) {
      logger.error('onAssignmentCreatedAutoSeedReadiness: seed failed', {
        tenantId,
        assignmentId,
        workerUid,
        jobOrderId,
        err: (err as Error).message,
      });
    }
  },
);

/**
 * Decide the requirement set for an assignment from the job order's flags.
 *
 * Always includes `shift_confirmation` — every assignment needs the worker
 * to confirm (YES/HERE flow, tracked by the cadence system). The rest is
 * opt-in based on JO config.
 */
function buildRequirementsForJobOrder(jo: Record<string, unknown>): SeedAssignmentReadinessRequirementSpec[] {
  const requirements: SeedAssignmentReadinessRequirementSpec[] = [
    { requirementType: 'shift_confirmation' },
  ];

  if (readBool(jo.backgroundCheckRequired) || readBool(jo.showBackgroundChecks)) {
    requirements.push({ requirementType: 'background_check' });
  }
  if (readBool(jo.drugScreeningRequired) || readBool(jo.showDrugScreening)) {
    requirements.push({ requirementType: 'drug_screen' });
  }
  if (readBool(jo.eVerifyRequired)) {
    requirements.push({ requirementType: 'e_verify' });
  }
  if (readBool(jo.safetyBriefingRequired)) {
    requirements.push({ requirementType: 'safety_briefing' });
  }
  if (readBool(jo.orientationRequired)) {
    requirements.push({ requirementType: 'orientation' });
  }
  if (hasNonEmptyArray(jo.requiredPpe) || readBool(jo.showRequiredPpe)) {
    requirements.push({ requirementType: 'ppe_acknowledgement' });
  }
  if (hasNonEmptyArray(jo.requiredCertifications) || hasNonEmptyArray(jo.licensesCerts)) {
    requirements.push({ requirementType: 'required_certification' });
  }

  return requirements;
}

function readBool(v: unknown): boolean {
  return v === true;
}

function hasNonEmptyArray(v: unknown): boolean {
  return Array.isArray(v) && v.length > 0;
}

function pickString(...candidates: unknown[]): string {
  for (const v of candidates) {
    if (typeof v === 'string' && v.trim().length > 0) return v.trim();
  }
  return '';
}
