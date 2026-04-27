/**
 * **R.5** — Helpers for keeping the `EmployeeReadinessItem.workerAction`
 * marker in sync with the E-Verify TNC workflow.
 *
 * Today the Phase A trigger (`onEverifyCaseWriteUpdateReadiness`) bridges
 * the case `status` field into `employee_readiness_items.{...}.e_verify.status`
 * via `everifyToReadinessStatus`. That handles the colour of the chip and
 * the row in the readiness queue. R.5 adds an orthogonal `workerAction`
 * field to the same readiness item so the Flutter worker app (R.9) can
 * render the TNC decision card without re-deriving "is the worker on the
 * hook?" from the case doc.
 *
 * State machine (Q-R5-1 lock):
 *   - `everifyMarkEmployeeNotified` →
 *       set `workerAction.kind = 'everify_tnc_pending_decision'`,
 *       flip `actor='worker'`.
 *   - `everifyRecordWorkerDecision({ contests })` →
 *       clear `workerAction`,
 *       flip `actor='recruiter'` (recruiter must initiate referral or close).
 *   - `everifyMarkReferralInitiated` →
 *       clear `workerAction` (idempotent if decision callable already cleared),
 *       leave `actor='recruiter'` (system is now waiting on USCIS).
 *
 * The post-decision state ("worker contested, recruiter must refer" /
 * "referral filed, USCIS verifying") is fully derivable from the case
 * status (which already lands on the readiness item via the Phase A
 * bridge) — so the marker carries only the one `pending_decision` kind.
 *
 * All operations are idempotent. The readiness item is identified by
 * `${userId}__${entityId}__e_verify`; if the item doesn't exist (e.g.
 * the seed runner hasn't fired yet for this entity_employment) we log
 * and no-op rather than create it — matches `updateReadinessItemStatus`'s
 * stance.
 *
 * @see shared/employeeReadinessItemV1.ts for the `workerAction` shape.
 */

import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';

import { buildEmployeeReadinessItemId } from '../../shared/employeeReadinessItemV1';

if (!admin.apps.length) {
  admin.initializeApp();
}

interface CaseLinkage {
  tenantId: string;
  caseId: string;
  workerUid: string;
  hiringEntityId: string;
}

interface SetTncPendingDecisionInput extends CaseLinkage {
  notifiedAt: string;
  tncResponseDueAt?: string | null;
  referralDueAt?: string | null;
}

interface ClearWorkerActionInput extends CaseLinkage {
  /** Why we're clearing — for log clarity. */
  reason:
    | 'worker_decision_recorded'
    | 'referral_initiated'
    | 'case_resolved';
  /**
   * Optional new `actor` value. When omitted the actor field is left
   * untouched (e.g. `everifyMarkReferralInitiated` calls clear with no
   * actor change because the recruiter is already the actor).
   */
  newActor?: 'recruiter' | 'worker' | 'vendor' | 'system';
}

/** Build the deterministic doc ref. */
function readinessItemRef(input: CaseLinkage): admin.firestore.DocumentReference {
  const itemId = buildEmployeeReadinessItemId({
    workerUid: input.workerUid,
    hiringEntityId: input.hiringEntityId,
    requirementType: 'e_verify',
  });
  return admin.firestore().doc(`tenants/${input.tenantId}/employeeReadinessItems/${itemId}`);
}

/**
 * Set the worker-action marker for a freshly-notified TNC. Idempotent — if
 * the marker is already in `pending_decision` for the same case, this
 * still updates `notifiedAt` and the deadlines (in case the recruiter
 * re-records after deadlines moved upstream).
 */
export async function setTncPendingDecisionMarker(
  input: SetTncPendingDecisionInput,
): Promise<{ written: boolean; skippedReason?: 'doc_not_found' }> {
  const ref = readinessItemRef(input);
  const snap = await ref.get();
  if (!snap.exists) {
    logger.warn('setTncPendingDecisionMarker: readiness item not found — skipping', {
      tenantId: input.tenantId,
      workerUid: input.workerUid,
      hiringEntityId: input.hiringEntityId,
      caseId: input.caseId,
    });
    return { written: false, skippedReason: 'doc_not_found' };
  }
  const workerAction: Record<string, string> = {
    kind: 'everify_tnc_pending_decision',
    caseId: input.caseId,
    notifiedAt: input.notifiedAt,
  };
  if (input.tncResponseDueAt) workerAction.tncResponseDueAt = input.tncResponseDueAt;
  if (input.referralDueAt) workerAction.referralDueAt = input.referralDueAt;

  const nowIso = new Date().toISOString();
  await ref.update({
    workerAction,
    actor: 'worker',
    updatedAt: nowIso,
  });
  logger.info('setTncPendingDecisionMarker: marker written', {
    tenantId: input.tenantId,
    workerUid: input.workerUid,
    hiringEntityId: input.hiringEntityId,
    caseId: input.caseId,
  });
  return { written: true };
}

/**
 * Clear the worker-action marker. Used when:
 *   - worker decision recorded (no further worker action regardless of
 *     contest / decline; system-side wait kicks in),
 *   - referral has been initiated (system waits on USCIS),
 *   - case got closed manually.
 *
 * Optionally flips `actor` (decision callable flips to 'recruiter';
 * referral callable leaves it alone).
 *
 * Idempotent: if no marker is set, this still updates `actor` if asked
 * and is otherwise a no-op write of `updatedAt`.
 */
export async function clearWorkerActionMarker(
  input: ClearWorkerActionInput,
): Promise<{ written: boolean; skippedReason?: 'doc_not_found' }> {
  const ref = readinessItemRef(input);
  const snap = await ref.get();
  if (!snap.exists) {
    logger.warn('clearWorkerActionMarker: readiness item not found — skipping', {
      tenantId: input.tenantId,
      workerUid: input.workerUid,
      hiringEntityId: input.hiringEntityId,
      caseId: input.caseId,
      reason: input.reason,
    });
    return { written: false, skippedReason: 'doc_not_found' };
  }
  const data = snap.data();
  const hasMarker = Boolean(data?.workerAction);
  const needsActorFlip = input.newActor && data?.actor !== input.newActor;
  if (!hasMarker && !needsActorFlip) {
    return { written: false };
  }
  const nowIso = new Date().toISOString();
  const patch: Record<string, unknown> = { updatedAt: nowIso };
  if (hasMarker) patch.workerAction = admin.firestore.FieldValue.delete();
  if (input.newActor) patch.actor = input.newActor;
  await ref.update(patch);
  logger.info('clearWorkerActionMarker: marker cleared', {
    tenantId: input.tenantId,
    workerUid: input.workerUid,
    hiringEntityId: input.hiringEntityId,
    caseId: input.caseId,
    reason: input.reason,
    actorFlipped: needsActorFlip ? input.newActor : null,
  });
  return { written: true };
}

/**
 * Convenience: pull the case linkage we need from a fetched `everify_cases`
 * doc. Returns `null` if userId/entityId are missing — we can't safely
 * write the readiness marker without both.
 */
export function caseLinkageFromDoc(args: {
  tenantId: string;
  caseId: string;
  caseData: Record<string, unknown>;
}): CaseLinkage | null {
  const userId = typeof args.caseData.userId === 'string' ? args.caseData.userId.trim() : '';
  const entityId = typeof args.caseData.entityId === 'string' ? args.caseData.entityId.trim() : '';
  if (!userId || !entityId) return null;
  return {
    tenantId: args.tenantId,
    caseId: args.caseId,
    workerUid: userId,
    hiringEntityId: entityId,
  };
}

/** Round-trip a Firestore Timestamp / ISO string / undefined into ISO or null. */
export function isoFromTimestampLike(v: unknown): string | null {
  if (!v) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'object' && v !== null) {
    const maybe = v as { toMillis?: () => number; toDate?: () => Date };
    if (typeof maybe.toDate === 'function') return maybe.toDate().toISOString();
    if (typeof maybe.toMillis === 'function') return new Date(maybe.toMillis()).toISOString();
  }
  return null;
}
