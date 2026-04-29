/**
 * **R.4.2 Phase L.4.2.4** — Shared seed pipeline for an existing
 * assignment doc.
 *
 * Extracted (mechanically) from `onAssignmentCreatedAutoSeed.ts` so
 * the auto-seed trigger AND the R.4.2 legacy backfill callable share
 * a single source of truth for requirement-building. Phase B / Phase C
 * drift between trigger and backfill is structurally impossible once
 * both call this helper.
 *
 * Pipeline (identical to the pre-extraction trigger body):
 *   1. Load the JO doc (`tenants/{tid}/jobOrders/{joId}`) — best-effort.
 *      Missing JO degrades to "no requirements apply" (rare; only
 *      relevant for orphaned legacy assignments).
 *   2. Parallel-load worker doc, screening eval, worker cert records.
 *   3. Build flag-based requirements via `buildRequirementsForJobOrder`
 *      (uses snapshot-aware `getEffectiveJobOrderField` for
 *      `eVerifyRequired` per R.16.2a).
 *   4. Build Phase B match specs via `buildPhaseBMatchSpecs`.
 *   5. Stamp Phase C expiry via `stampExpiryOnSpecs`.
 *   6. Call `runAssignmentReadinessSeed` with `actorUid: 'system'`
 *      and `source: { kind: 'jobOrderAssignment', ref: assignmentId }`.
 *
 * The seeder runner is itself idempotent (skips existing item ids),
 * so a re-run with all items already present returns
 * `{ itemsCreated: 0, itemsSkippedExisting: N }`.
 *
 * @see functions/src/readiness/onAssignmentCreatedAutoSeed.ts (trigger that delegates here)
 * @see functions/src/jobOrders/backfillLegacyAssignmentsCallable.ts (R.4.2 backfill caller)
 * @see docs/R4_2_LEGACY_BACKFILL_HANDOFF.md §L.4.2.4
 */

import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';

import type { SeedAssignmentReadinessRequirementSpec } from '../shared/seedAssignmentReadinessItems';
import {
  getEffectiveJobOrderField,
  type JobOrderForEffectiveRead,
} from '../shared/jobOrder/getEffectiveJobOrderField';
import {
  runAssignmentReadinessSeed,
  type AssignmentSeedRunnerResult,
} from './seedAssignmentReadinessItemsRunner';
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

export interface SeedReadinessForExistingAssignmentArgs {
  tenantId: string;
  assignmentId: string;
  /**
   * The assignment doc data. Trigger passes `event.data.data()`;
   * backfill passes the doc snapshot's `.data()`. Both shapes are the
   * same Firestore record, so the helper is agnostic.
   */
  assignmentData: Record<string, unknown>;
  /**
   * Optional injected Firestore. Used by tests; the trigger and
   * backfill omit this and the helper falls back to the module-level
   * admin instance.
   */
  fdb?: admin.firestore.Firestore;
  /**
   * Tag passed through to log keys so an operator can grep by call
   * site (`'auto_seed_trigger'` vs `'r4_2_backfill'`). Cosmetic — does
   * not affect the seed behaviour.
   */
  callSiteTag?: string;
}

export type SeedReadinessOutcome =
  | { kind: 'seeded'; result: AssignmentSeedRunnerResult; baseRequirementsCount: number; phaseBMatchSpecsCount: number }
  | { kind: 'skipped_no_requirements' }
  | { kind: 'skipped_missing_inputs'; reason: string };

/**
 * Run the assignment-readiness seed pipeline against an existing
 * assignment doc.
 *
 * Returns a structured outcome rather than throwing on missing inputs
 * (unlike the original trigger body which `return`-ed early), so the
 * R.4.2 backfill page driver can record the per-assignment bucket
 * without a try/catch dance. Throws only on actual seed failures
 * propagated up from `runAssignmentReadinessSeed` — backfill catches
 * those and reports `'stamped_only_seed_failed'`.
 */
export async function seedReadinessForExistingAssignment(
  args: SeedReadinessForExistingAssignmentArgs,
): Promise<SeedReadinessOutcome> {
  const { tenantId, assignmentId, assignmentData } = args;
  const fdb = args.fdb ?? db;
  const tag = args.callSiteTag ?? 'seed_readiness_for_existing_assignment';

  const workerUid = pickString(
    (assignmentData as { userId?: unknown }).userId,
    (assignmentData as { candidateId?: unknown }).candidateId,
    (assignmentData as { workerUid?: unknown }).workerUid,
  );
  const jobOrderId = pickString((assignmentData as { jobOrderId?: unknown }).jobOrderId);
  const shiftId = pickString((assignmentData as { shiftId?: unknown }).shiftId) || undefined;

  if (!workerUid || !jobOrderId) {
    return {
      kind: 'skipped_missing_inputs',
      reason: !workerUid ? 'missing workerUid' : 'missing jobOrderId',
    };
  }

  // Step 1 — load the JO. Best-effort, mirrors the original trigger.
  let joData: Record<string, unknown> = {};
  try {
    const joSnap = await fdb.doc(`tenants/${tenantId}/jobOrders/${jobOrderId}`).get();
    if (joSnap.exists) joData = (joSnap.data() ?? {}) as Record<string, unknown>;
  } catch (err) {
    logger.warn(`${tag}: jobOrder lookup failed — using minimal set`, {
      tenantId,
      jobOrderId,
      err: (err as Error).message,
    });
  }

  // Steps 2-3 — parallel load worker / screening eval / cert records.
  const todayMs = Date.now();
  const todayISO = new Date(todayMs).toISOString().slice(0, 10);

  const [worker, screeningEval, workerCertRecords] = await Promise.all([
    loadWorkerForMatching(fdb, workerUid),
    loadScreeningEvalForJobOrder(fdb, {
      tenantId,
      workerUid,
      requiredPackageId:
        typeof joData.screeningPackageId === 'string' ? joData.screeningPackageId : null,
      requiredPackageName:
        typeof joData.screeningPackageName === 'string' ? joData.screeningPackageName : null,
    }),
    loadWorkerCertRecords(fdb, workerUid),
  ]);

  // Step 4 — flag-based requirements (snapshot-aware eVerify per R.16.2a).
  const baseRequirements = buildRequirementsForJobOrder(joData);
  const matchRequirements = buildPhaseBMatchSpecs({
    jo: joData,
    worker,
    screeningEval,
    workerCertRecords,
    todayISO,
    todayMs,
  });

  // Step 5 — Phase C expiry stamping.
  stampExpiryOnSpecs({
    specs: matchRequirements,
    workerLicenses: worker.licenses,
    requiredLicensesV2: pickRequiredLicensesForExpiry(joData.requiredLicensesV2),
    screeningEval,
  });

  const requirements = [...baseRequirements, ...matchRequirements];
  if (requirements.length === 0) {
    logger.info(`${tag}: no requirements apply — skipping`, { tenantId, assignmentId });
    return { kind: 'skipped_no_requirements' };
  }

  // Step 6 — invoke the (idempotent) seed runner.
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

  return {
    kind: 'seeded',
    result,
    baseRequirementsCount: baseRequirements.length,
    phaseBMatchSpecsCount: matchRequirements.length,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Pure helpers — extracted byte-identical from
// `onAssignmentCreatedAutoSeed.ts` (lines 196-277 of the pre-extraction
// file). Keeping them here so the seed pipeline is self-contained.
// ─────────────────────────────────────────────────────────────────────

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
export function buildRequirementsForJobOrder(
  jo: Record<string, unknown>,
): SeedAssignmentReadinessRequirementSpec[] {
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
  // R.16.2a — read e-verify through the snapshot-aware helper so the
  // assignment seed honours the activation snapshot for non-draft JOs
  // (parent-account edits don't bleed into already-active orders unless
  // the operator explicitly Push-to-Actives them). Fallback preserves
  // the legacy live-read shape for drafts and pre-§16.1 JOs.
  const { value: eVerifyRequired } = getEffectiveJobOrderField<boolean>(
    jo as JobOrderForEffectiveRead,
    'eVerifyRequired',
    { fallback: readBool(jo.eVerifyRequired) },
  );
  if (eVerifyRequired === true) {
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
