/**
 * Auto-seed Assignment Readiness items when a worker gets placed on a shift.
 * Watches `tenants/{tenantId}/assignments/{assignmentId}` for creates and
 * invokes the shared assignment seed runner with `'system'` as the actor uid.
 *
 * Reads the associated job order to decide which requirements to seed in
 * two passes:
 *
 * **(1) Flag-based requirements** (`buildRequirementsForJobOrder`):
 *   - Always seeds `shift_confirmation` (the cadence YES/HERE flow).
 *   - `backgroundCheckRequired` / `drugScreeningRequired` → those items.
 *   - `eVerifyRequired` → e_verify item.
 *   - `requiredPpe` / `safetyBriefingRequired` / `orientationRequired` flags.
 *
 * **(2) Phase B match items** (`buildPhaseBMatchSpecs`, since 2026-04):
 *   Loads the worker doc once, then runs the matchers in
 *   `shared/jobRequirementMatchers/` over the JO's requirement categories
 *   (certs, licenses, skills, education, languages, screening package). Each
 *   produces a per-requirement readiness item with status pre-computed at
 *   seed time. Replaces the legacy single `required_certification` item.
 *
 *   B.5 wires 5 of 6 matchers; cert_match items are seeded as `incomplete`
 *   shells until B.5.1 promotes the cert engine to functions-side.
 *
 * Idempotent — the runner skips existing item ids.
 *
 * @see functions/src/readiness/seedAssignmentReadinessItemsRunner.ts
 * @see functions/src/readiness/jobRequirementMatcherHelpers.ts (Phase B work)
 * @see docs/READINESS_EXECUTION_MATRIX.md §7 Phase B
 */

import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions/v2';
import * as admin from 'firebase-admin';

import type { SeedAssignmentReadinessRequirementSpec } from '../shared/seedAssignmentReadinessItems';
import { runAssignmentReadinessSeed } from './seedAssignmentReadinessItemsRunner';
import {
  buildPhaseBMatchSpecs,
  loadScreeningEvalForJobOrder,
  loadWorkerCertRecords,
  loadWorkerForMatching,
} from './jobRequirementMatcherHelpers';
import { stampExpiryOnSpecs } from './assignmentMatchExpiryHelpers';
import type { RequiredLicenseV1 } from '../shared/licenseRecord';

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

    // Phase B.5: load worker + (when applicable) the worker's most-recent
    // background-check eval so the matchers can compute initial status at
    // seed time. Worker load is best-effort; matchers degrade to `incomplete`
    // when fields are missing.
    const todayMs = Date.now();
    const todayISO = new Date(todayMs).toISOString().slice(0, 10);

    const [worker, screeningEval, workerCertRecords] = await Promise.all([
      loadWorkerForMatching(db, workerUid),
      loadScreeningEvalForJobOrder(db, {
        tenantId,
        workerUid,
        requiredPackageId: typeof joData.screeningPackageId === 'string' ? joData.screeningPackageId : null,
        requiredPackageName: typeof joData.screeningPackageName === 'string' ? joData.screeningPackageName : null,
      }),
      loadWorkerCertRecords(db, workerUid),
    ]);

    const baseRequirements = buildRequirementsForJobOrder(joData);
    const matchRequirements = buildPhaseBMatchSpecs({
      jo: joData,
      worker,
      screeningEval,
      workerCertRecords,
      todayISO,
      todayMs,
    });

    // Phase C: stamp expiresAtMs on license_match + screening_package_match
    // specs so the daily reconciler can flip them to 'expired' once they age
    // out. Other match types skip; cert_match expiry is handled inside the
    // engine (B.5.1) which already considers expiration in its status output.
    stampExpiryOnSpecs({
      specs: matchRequirements,
      workerLicenses: worker.licenses,
      requiredLicensesV2: pickRequiredLicensesForExpiry(joData.requiredLicensesV2),
      screeningEval,
    });
    const requirements = [...baseRequirements, ...matchRequirements];

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
        baseRequirementsCount: baseRequirements.length,
        phaseBMatchSpecsCount: matchRequirements.length,
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
 * Decide the flag-based requirement set for an assignment from the job order.
 *
 * Always includes `shift_confirmation` — every assignment needs the worker
 * to confirm (YES/HERE flow, tracked by the cadence system). The rest is
 * opt-in based on JO config flags.
 *
 * **Phase B.5:** the per-requirement match items (`cert_match`, `license_match`,
 * `skill_match`, `education_match`, `language_match`, `screening_package_match`)
 * are produced by `buildPhaseBMatchSpecs` instead and concatenated by the
 * caller. The legacy single `required_certification` seed was removed —
 * cert items are now N×`cert_match` shells (one per required cert).
 */
function buildRequirementsForJobOrder(jo: Record<string, unknown>): SeedAssignmentReadinessRequirementSpec[] {
  // R.1 — Stamp `resolutionMethod` per-type at seed time. Background / drug /
  // E-Verify resolve via external systems (AccuSource webhook + USCIS API)
  // even though those bridges currently write to `employeeReadinessItems`
  // rather than back into these assignment-side rows; the pathway label is
  // still 'external' so the chip aggregator can surface "waiting on vendor"
  // copy in the popover. The acknowledgement / briefing / orientation /
  // confirmation rows are left at `null` here — R.2 may flip the
  // ppe_acknowledgement row to `'self_attest'` when the willingness items
  // ship; the others keep `null` until R.3 generalises the CSA action surface.
  // Severity is omitted on these specs and resolves to the type-default
  // (`DEFAULT_REQUIREMENT_SEVERITY`) inside the seeder.
  const requirements: SeedAssignmentReadinessRequirementSpec[] = [
    { requirementType: 'shift_confirmation' },
  ];

  if (readBool(jo.backgroundCheckRequired) || readBool(jo.showBackgroundChecks)) {
    requirements.push({ requirementType: 'background_check', resolutionMethod: 'external' });
  }
  if (readBool(jo.drugScreeningRequired) || readBool(jo.showDrugScreening)) {
    requirements.push({ requirementType: 'drug_screen', resolutionMethod: 'external' });
  }
  if (readBool(jo.eVerifyRequired)) {
    requirements.push({ requirementType: 'e_verify', resolutionMethod: 'external' });
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
  // `required_certification` removed — replaced by N×`cert_match` shells in
  // `buildPhaseBMatchSpecs`. See type-union deprecation note in
  // `shared/assignmentReadinessItemV1.ts`.

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

/**
 * Phase C — defensive reader for `JobOrder.requiredLicensesV2` used by the
 * expiry-stamping helper. Same shape as the equivalent in
 * `jobRequirementMatcherHelpers.ts` but inlined here to avoid importing from
 * a file Cursor is concurrently editing for B.5.1.
 */
function pickRequiredLicensesForExpiry(v: unknown): RequiredLicenseV1[] {
  if (!Array.isArray(v)) return [];
  const out: RequiredLicenseV1[] = [];
  for (const e of v) {
    if (e && typeof e === 'object' && typeof (e as { licenseClass?: unknown }).licenseClass === 'string') {
      out.push({ licenseClass: (e as { licenseClass: string }).licenseClass });
    }
  }
  return out;
}
