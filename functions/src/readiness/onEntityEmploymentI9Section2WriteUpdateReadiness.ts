/**
 * **E.3 addendum** — Phase A trigger that bridges
 * `tenants/{tid}/entity_employments/{employmentId}` writes into
 * `employeeReadinessItems.{...}.i9_section_2.status`.
 *
 * I-9 has two halves with distinct ownership:
 *
 *   - Section 1 (worker portion) — handled by Everee in their onboarding
 *     flow. Mirrored by `onEvereeWorkerWriteUpdateReadiness` from the
 *     `everee_workers.readinessMirror.i9SignedAt` snapshot field into
 *     the `i9_section_1` readiness item.
 *
 *   - Section 2 (employer portion) — federal law assigns this to the
 *     employer (C1 Staffing as employer of record). Everee CANNOT do it
 *     for us; a CSA must physically inspect the worker's identity +
 *     work-authorization documents and sign the form within 3 business
 *     days of hire. The completion stamp lives on
 *     `entity_employments.i9Section2CompletedAt`. This trigger reflects
 *     that field into the `i9_section_2` readiness item.
 *
 * Writing the field is E.7's job (the unified /onboarding queue rewrite
 * — that's where CSAs will mark Section 2 complete via a callable). E.3
 * just adds the read path so the readiness chip + matrix can render the
 * employer-portion state alongside the Everee-driven worker portion.
 *
 * Short-circuits unless the (`workerType`, `i9Section2CompletedAt`)
 * fingerprint changed. Other entity_employments mutations (e.g. status,
 * onboardingComplete, payrollStatus) flow through their own triggers.
 *
 * Sister to `onEvereeWorkerWriteUpdateReadiness` — same shape (pure
 * planner + thin I/O wrapper + idempotent `updateReadinessItemStatus`).
 *
 * @see ./entityEmploymentI9Section2Plan.ts (pure planner)
 * @see ./updateReadinessItemStatus.ts (idempotent per-item writer)
 */

import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions/v2';
import * as admin from 'firebase-admin';

import { planEntityEmploymentI9Section2Update } from './entityEmploymentI9Section2Plan';
import { updateReadinessItemStatus } from './updateReadinessItemStatus';

if (!admin.apps.length) {
  admin.initializeApp();
}

export const onEntityEmploymentI9Section2WriteUpdateReadiness = onDocumentWritten(
  {
    document: 'tenants/{tenantId}/entity_employments/{employmentId}',
    region: 'us-central1',
    maxInstances: 5,
    memory: '512MiB',
    retry: false,
  },
  async (event) => {
    const tenantId = String(event.params.tenantId);
    const employmentId = String(event.params.employmentId);

    const beforeData = event.data?.before?.exists
      ? ((event.data.before.data() ?? {}) as Record<string, unknown>)
      : null;
    const afterData = event.data?.after?.exists
      ? ((event.data.after.data() ?? {}) as Record<string, unknown>)
      : null;

    if (!afterData) {
      // Doc deleted — nothing to do. The Employee Readiness item lives
      // independently and will be cleaned up via the entity-deletion
      // path (out of scope for this trigger).
      return;
    }

    // ── I-9 complete ⇒ Active (Greg 2026-08-14, WorkBright cutover) ──
    //
    // Section 2 landing is the legal employability milestone, so it now
    // drives the onboarding→active status transition — the yellow
    // "Onboarding" chips (profile header, user/applicant tables, placement
    // tiles) all fold from this doc's status/employmentState and flip
    // green everywhere at once. Regardless of which writer stamped it:
    // Everee mirror (WorkBright pipeline), reconcile cron, or a manual
    // CSA mark.
    //
    // Status/display only: payroll submit gates and Everee payability are
    // untouched (bank/W-4 keep their own chips). Only the onboarding→
    // active transition — never resurrects inactive/terminated/blocked,
    // never fires for DNR'd rows. Self-terminating: the re-fire from this
    // write sees status 'active' and skips.
    const s2At = afterData.i9Section2CompletedAt;
    const legacyStatus = String(afterData.status ?? '').trim().toLowerCase();
    const canonState = String(afterData.employmentState ?? '').trim().toLowerCase();
    const hasTerminal =
      (afterData.terminatedAt != null && afterData.terminatedAt !== '') ||
      afterData.doNotReturn === true;
    if (
      s2At != null &&
      s2At !== '' &&
      !hasTerminal &&
      (legacyStatus === 'onboarding' || canonState === 'onboarding')
    ) {
      try {
        const patch: Record<string, unknown> = {
          activatedAt: admin.firestore.FieldValue.serverTimestamp(),
          activationSource: 'i9_section2_complete',
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };
        if (legacyStatus === 'onboarding') patch.status = 'active';
        if (canonState === 'onboarding') patch.employmentState = 'active';
        await event.data!.after.ref.update(patch);
        logger.info('onEntityEmploymentI9Section2WriteUpdateReadiness: activated on I-9 complete', {
          tenantId,
          employmentId,
        });
      } catch (e) {
        logger.warn('onEntityEmploymentI9Section2WriteUpdateReadiness: activation write failed', {
          tenantId,
          employmentId,
          message: e instanceof Error ? e.message.slice(0, 240) : String(e),
        });
      }
    }

    const plan = planEntityEmploymentI9Section2Update({
      before: beforeData,
      after: afterData,
    });

    if (!plan.shouldFire) return;

    if (!plan.workerUid || !plan.hiringEntityId) {
      logger.warn(
        'onEntityEmploymentI9Section2WriteUpdateReadiness: missing userId or hiringEntityId',
        {
          tenantId,
          employmentId,
          workerUid: plan.workerUid,
          hiringEntityId: plan.hiringEntityId,
        },
      );
      return;
    }

    const result = await updateReadinessItemStatus({
      tenantId,
      workerUid: plan.workerUid,
      hiringEntityId: plan.hiringEntityId,
      requirementType: 'i9_section_2',
      newStatus: plan.newStatus,
      source: 'entity_employments_write',
      externalRef: employmentId,
    });

    logger.info('onEntityEmploymentI9Section2WriteUpdateReadiness: reconciled', {
      tenantId,
      employmentId,
      workerUid: plan.workerUid,
      hiringEntityId: plan.hiringEntityId,
      workerTypeNormalized: plan.debug.workerTypeNormalized,
      section2Completed: plan.debug.section2Completed,
      newStatus: plan.newStatus,
      changed: result.changed,
      skippedReason: result.skippedReason,
    });
  },
);
