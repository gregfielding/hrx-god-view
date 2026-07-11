/**
 * Worker termination/separation (item 2, 2026-07-10 — Greg's decisions):
 * per-entity; auto-cancels future assignments; recruiter+ permission;
 * captures rehire eligibility; email+SMS notice sent by the caller flow.
 *
 * Sequencing matters for CA Labor Code §201–203: for INVOLUNTARY
 * separations the client dialog must confirm final pay is settled in
 * Everee BEFORE calling this — the callable enforces it
 * (finalPayConfirmed) and timestamps the confirmation in the audit
 * record, which is the §203 waiting-time-penalty defense. §201.3 nuance:
 * an assignment ending is NOT employment termination — only this action
 * starts the final-pay clock, so nothing here runs automatically.
 *
 * Everee has NO public termination API (verified 2026-07-10) — the Everee
 * side is a manual dashboard step; the mirror picks up the terminal
 * status on the next sync.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import * as admin from 'firebase-admin';

import { canManageAssignments, toDateOnly, getApplicationApplyDays } from '../placementsApi';
import { buildAdminEntityEmploymentLifecyclePatch } from '../onboarding/entityEmploymentLifecycle';
import { ASSIGNMENT_STATUS_QUERY_LIVE } from '../utils/assignmentStatusNormalize';
import { sendSeparationNotices } from './separationNotices';

const db = admin.firestore();

export type SeparationType = 'voluntary_notice' | 'voluntary_no_notice' | 'involuntary';

export interface SeparationRecord {
  entityId: string;
  entityName?: string | null;
  employmentId: string;
  separationType: SeparationType;
  /** ISO date — the worker's last day of employment. */
  lastDay: string;
  reasonCategory?: string | null;
  notes?: string | null;
  rehireEligible: boolean;
  /** True when the recruiter confirmed final pay was settled in Everee
   *  before completing (required for involuntary). */
  finalPayConfirmed: boolean;
  cancelledAssignmentIds: string[];
  separatedBy: string;
  separatedByName?: string | null;
  /** ISO — array elements can't hold serverTimestamp. */
  separatedAt: string;
  status: 'active' | 'reversed';
  reversedBy?: string;
  reversedAt?: string;
}

export const separateWorker = onCall({ memory: '512MiB', timeoutSeconds: 120 }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');

  const {
    tenantId,
    userId,
    entityId,
    entityName,
    separationType,
    lastDay,
    reasonCategory,
    notes,
    rehireEligible,
    finalPayConfirmed,
  } = (request.data || {}) as {
    tenantId?: string;
    userId?: string;
    entityId?: string;
    entityName?: string;
    separationType?: SeparationType;
    lastDay?: string;
    reasonCategory?: string;
    notes?: string;
    rehireEligible?: boolean;
    finalPayConfirmed?: boolean;
  };

  const validTypes: SeparationType[] = ['voluntary_notice', 'voluntary_no_notice', 'involuntary'];
  if (!tenantId || !userId || !entityId || !separationType || !validTypes.includes(separationType)) {
    throw new HttpsError(
      'invalid-argument',
      'tenantId, userId, entityId and a valid separationType are required.',
    );
  }
  if (!lastDay || !/^\d{4}-\d{2}-\d{2}$/.test(lastDay)) {
    throw new HttpsError('invalid-argument', 'lastDay (YYYY-MM-DD) is required.');
  }
  if (separationType === 'involuntary' && finalPayConfirmed !== true) {
    // CA §201: involuntary termination = final wages due same day. The
    // dialog must collect this confirmation; refusing here keeps a
    // termination from ever completing with wages knowingly outstanding.
    throw new HttpsError(
      'failed-precondition',
      'Involuntary separation requires confirming final pay is settled in Everee first.',
    );
  }
  if (!(await canManageAssignments(request.auth, tenantId, uid))) {
    throw new HttpsError('permission-denied', 'Recruiter access required.');
  }

  // ── Locate the entity employment row ─────────────────────────────────
  const emSnap = await db
    .collection(`tenants/${tenantId}/entity_employments`)
    .where('userId', '==', userId)
    .get();
  const emDoc = emSnap.docs.find((d) => {
    const e = d.data() as Record<string, unknown>;
    return (
      String(e.entityId || '') === entityId ||
      String(e.hiringEntityId || '') === entityId ||
      String(e.entityKey || '') === entityId
    );
  });
  if (!emDoc) {
    throw new HttpsError('not-found', 'No employment record for this worker at this entity.');
  }

  const callerSnap = await db.doc(`users/${uid}`).get();
  const caller = callerSnap.data() || {};
  const callerName =
    [caller.firstName, caller.lastName].filter(Boolean).join(' ') || caller.displayName || null;
  const nowIso = new Date().toISOString();

  // ── Auto-cancel live assignments at this entity (Greg: auto) ─────────
  // Mirrors placementsCancelAssignment's steps, with
  // notificationsSuppressed so the worker gets ONE separation notice
  // instead of a cancellation SMS per assignment.
  const liveSnap = await db
    .collection(`tenants/${tenantId}/assignments`)
    .where('userId', '==', userId)
    .where('status', 'in', [...ASSIGNMENT_STATUS_QUERY_LIVE])
    .get();
  const cancelledAssignmentIds: string[] = [];
  for (const aDoc of liveSnap.docs) {
    const a = aDoc.data() as Record<string, unknown>;
    let assignmentEntityId = String(a.hiringEntityId || '');
    if (!assignmentEntityId && a.jobOrderId) {
      const jo = await db.doc(`tenants/${tenantId}/job_orders/${String(a.jobOrderId)}`).get();
      assignmentEntityId = String(jo.data()?.hiringEntityId || '');
    }
    if (assignmentEntityId !== entityId) continue;
    try {
      await aDoc.ref.set(
        {
          status: 'cancelled',
          cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
          canceledBy: uid,
          cancellationReason: 'worker_separated',
          notificationsSuppressed: true,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      const shiftId = String(a.shiftId || '');
      const dayKey = toDateOnly(a.startDate);
      const placementId = dayKey ? `${shiftId}__${userId}__${dayKey}` : `${shiftId}__${userId}`;
      const applicationRef = a.applicationId
        ? db.doc(`tenants/${tenantId}/applications/${String(a.applicationId)}`)
        : null;
      await db.runTransaction(async (tx) => {
        const appSnap = applicationRef ? await tx.get(applicationRef) : null;
        tx.delete(aDoc.ref);
        if (shiftId) {
          tx.set(db.doc(`tenants/${tenantId}/placements/${placementId}`), {
            tenantId,
            jobOrderId: a.jobOrderId ?? null,
            shiftId,
            startDate: dayKey || '',
            userId,
            createdBy: uid,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        }
        if (applicationRef && appSnap) {
          const appData = appSnap.exists ? (appSnap.data() as Record<string, any>) : {};
          const currentDays = getApplicationApplyDays(appData);
          const remainingDays = dayKey ? currentDays.filter((day) => day !== dayKey) : currentDays;
          const dayPatch: Record<string, unknown> =
            currentDays.length > 0
              ? remainingDays.length > 0
                ? { applyDates: remainingDays, applyDate: remainingDays[0] }
                : {
                    applyDates: admin.firestore.FieldValue.delete(),
                    applyDate: admin.firestore.FieldValue.delete(),
                  }
              : {};
          tx.update(applicationRef, {
            status: 'submitted',
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            confirmedAt: admin.firestore.FieldValue.delete(),
            confirmedBy: admin.firestore.FieldValue.delete(),
            statusChangeReason: 'assignment_cancelled',
            ...dayPatch,
          });
        }
      });
      cancelledAssignmentIds.push(aDoc.id);
    } catch (err) {
      logger.warn('[separateWorker] assignment cancel failed (continuing)', {
        assignmentId: aDoc.id,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ── Flip the employment lifecycle ─────────────────────────────────────
  await emDoc.ref.set(
    buildAdminEntityEmploymentLifecyclePatch({
      status: 'terminated',
      terminationReason: `${separationType}${reasonCategory ? `: ${reasonCategory}` : ''}`,
      now: admin.firestore.FieldValue.serverTimestamp(),
    }),
    { merge: true },
  );

  // ── User-doc audit + enforcement flags ────────────────────────────────
  const record: SeparationRecord = {
    entityId,
    entityName: entityName ?? null,
    employmentId: emDoc.id,
    separationType,
    lastDay,
    reasonCategory: reasonCategory?.trim() ? reasonCategory.trim().slice(0, 200) : null,
    notes: notes?.trim() ? notes.trim().slice(0, 2000) : null,
    rehireEligible: rehireEligible !== false,
    finalPayConfirmed: finalPayConfirmed === true,
    cancelledAssignmentIds,
    separatedBy: uid,
    separatedByName: callerName,
    separatedAt: nowIso,
    status: 'active',
  };
  const userPatch: Record<string, unknown> = {
    separations: admin.firestore.FieldValue.arrayUnion(record),
    separatedEntityIds: admin.firestore.FieldValue.arrayUnion(entityId),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  if (rehireEligible === false) {
    userPatch.rehireEligible = false;
    userPatch.rehireIneligibleReason = record.reasonCategory ?? separationType;
    userPatch.rehireIneligibleAt = nowIso;
    userPatch.rehireIneligibleBy = uid;
  }
  await db.doc(`users/${userId}`).set(userPatch, { merge: true });

  // Worker notice (email + SMS + in-app, professional tone) — best-effort;
  // the separation stands regardless of delivery.
  const notices = await sendSeparationNotices({
    tenantId,
    userId,
    entityName: String(entityName || entityId),
    lastDay,
    requestedByUid: uid,
  });

  logger.info('[separateWorker] completed', {
    tenantId,
    userId,
    entityId,
    separationType,
    cancelled: cancelledAssignmentIds.length,
    rehireEligible: record.rehireEligible,
    notices,
  });

  return {
    ok: true,
    employmentId: emDoc.id,
    cancelledAssignments: cancelledAssignmentIds.length,
    notices,
    record,
  };
});
