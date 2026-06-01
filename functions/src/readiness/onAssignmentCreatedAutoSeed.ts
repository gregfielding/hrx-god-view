/**
 * Auto-seed Assignment Readiness items when a worker gets placed on a shift.
 * Watches `tenants/{tenantId}/assignments/{assignmentId}` for creates and
 * delegates to the shared `seedReadinessForExistingAssignment` helper
 * (extracted in **R.4.2 / L.4.2.4** so the trigger and the legacy backfill
 * callable share a single code path).
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
 * @see functions/src/readiness/seedReadinessForExistingAssignment.ts (shared pipeline)
 * @see functions/src/readiness/seedAssignmentReadinessItemsRunner.ts
 * @see functions/src/readiness/jobRequirementMatcherHelpers.ts (Phase B work)
 * @see functions/src/jobOrders/backfillLegacyAssignmentsCallable.ts (R.4.2 caller)
 * @see docs/READINESS_EXECUTION_MATRIX.md §7 Phase B
 * @see docs/R4_2_LEGACY_BACKFILL_HANDOFF.md §L.4.2.4
 */

import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions/v2';
import * as admin from 'firebase-admin';

import { seedReadinessForExistingAssignment } from './seedReadinessForExistingAssignment';

if (!admin.apps.length) {
  admin.initializeApp();
}

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
      logger.warn('onAssignmentCreatedAutoSeedReadiness: event.data missing', {
        tenantId,
        assignmentId,
      });
      return;
    }

    // Retroactive admin adds (see `addRetroactiveWorker` callable) record
    // work that has already happened. The cadence seed would queue a
    // "confirm your shift" SMS for a shift that's in the past — wrong
    // signal for the worker, noisy for the recruiter. Skip.
    if (data.retroactive === true) {
      logger.info('onAssignmentCreatedAutoSeedReadiness: skipping retroactive add', {
        tenantId,
        assignmentId,
      });
      return;
    }

    try {
      const outcome = await seedReadinessForExistingAssignment({
        tenantId,
        assignmentId,
        assignmentData: data,
        callSiteTag: 'onAssignmentCreatedAutoSeedReadiness',
      });

      switch (outcome.kind) {
        case 'skipped_missing_inputs':
          // Preserve the original "missing workerUid or jobOrderId" log
          // shape so alert filters keyed on the message keep working.
          logger.warn(
            'onAssignmentCreatedAutoSeedReadiness: missing workerUid or jobOrderId',
            {
              tenantId,
              assignmentId,
              workerUid:
                typeof data.userId === 'string'
                  ? data.userId
                  : typeof data.candidateId === 'string'
                    ? data.candidateId
                    : '',
              jobOrderId: typeof data.jobOrderId === 'string' ? data.jobOrderId : '',
              reason: outcome.reason,
            },
          );
          return;
        case 'skipped_no_requirements':
          // Helper already logs this case at info level. Trigger-side
          // intentionally silent so the previous on-line log is the
          // single source.
          return;
        case 'seeded':
          logger.info('onAssignmentCreatedAutoSeedReadiness: seeded', {
            tenantId,
            assignmentId,
            workerUid:
              typeof data.userId === 'string'
                ? data.userId
                : typeof data.candidateId === 'string'
                  ? data.candidateId
                  : '',
            jobOrderId: typeof data.jobOrderId === 'string' ? data.jobOrderId : '',
            itemsCreated: outcome.result.itemsCreated,
            itemsSkippedExisting: outcome.result.itemsSkippedExisting,
            baseRequirementsCount: outcome.baseRequirementsCount,
            phaseBMatchSpecsCount: outcome.phaseBMatchSpecsCount,
            primarySource: outcome.result.ownership.primarySource,
            primaryRecruiterId: outcome.result.ownership.primaryRecruiterId,
          });
          return;
      }
    } catch (err) {
      logger.error('onAssignmentCreatedAutoSeedReadiness: seed failed', {
        tenantId,
        assignmentId,
        workerUid:
          typeof data.userId === 'string'
            ? data.userId
            : typeof data.candidateId === 'string'
              ? data.candidateId
              : '',
        jobOrderId: typeof data.jobOrderId === 'string' ? data.jobOrderId : '',
        err: (err as Error).message,
      });
    }
  },
);
