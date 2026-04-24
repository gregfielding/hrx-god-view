/**
 * Callable — flip AccountWorkforce status between `active` and `inactive`.
 *
 * Phase 2 of `docs/WORKFORCE_DOMAIN_MODEL.md`. The only write path for manual
 * deactivation and reactivation from the Workforce tab UI.
 *
 * Contract (doc §6.2):
 *   - Permission: tenant security level 5, 6, or 7 on the account's tenant.
 *     No per-account ownership check — if the user has admin-class access,
 *     they can deactivate any worker for any account in that tenant. The
 *     `deactivatedBy` audit field preserves who did it.
 *   - Deactivation cascade: the `cancelFutureAssignmentIds` input carries
 *     the exact list of future confirmed assignments the recruiter chose
 *     to cancel in the dialog (default = all future confirmed, editable).
 *     Each transitions to `cancelled_business` with notes referencing the
 *     deactivation. Atomic — we fail the whole call if any cancellation
 *     fails.
 *   - Reactivation clears deactivation fields and any
 *     `CONFIRMED_WHILE_INACTIVE` blockers (they're stale after reactivation).
 *
 * @see docs/WORKFORCE_DOMAIN_MODEL.md §3.5, §6.2
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import * as admin from 'firebase-admin';

import {
  accountWorkforceDocId,
  type AccountWorkforceDeactivationReason,
  type SetAccountWorkforceStatusInput,
  type SetAccountWorkforceStatusResult,
} from '../shared/accountWorkforce';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

/** Valid deactivation reason codes. Must stay in lockstep with the shared type. */
const VALID_DEACTIVATION_REASONS: readonly AccountWorkforceDeactivationReason[] = [
  'no_show',
  'left_early_repeat',
  'client_requested',
  'performance',
  'attendance',
  'policy',
  'worker_request',
  'other',
] as const;

/**
 * Resolve the caller's effective security level for `tenantId`.
 *
 * Mirrors the AccuSource admin gate (`accusourceAdminGate.ts`):
 *   - prefer `users.{uid}.tenantIds[tenantId].securityLevel` when present,
 *   - fall back to the legacy top-level `users.{uid}.securityLevel`,
 *   - HRX users auto-qualify via `auth.token.hrx === true`.
 */
async function resolveCallerSecurityLevel(
  uid: string,
  authToken: Record<string, unknown> | undefined,
  tenantId: string,
): Promise<{ securityLevel: number; isHrx: boolean }> {
  const isHrx = authToken?.hrx === true;

  const userSnap = await db.collection('users').doc(uid).get();
  if (!userSnap.exists) {
    return { securityLevel: 0, isHrx };
  }
  const data = userSnap.data() as Record<string, unknown>;
  const tenantIds = data.tenantIds as Record<string, Record<string, unknown>> | undefined;
  const nested = tenantIds?.[tenantId];

  const raw =
    nested && nested.securityLevel != null && String(nested.securityLevel).trim() !== ''
      ? nested.securityLevel
      : data.securityLevel;
  const parsed = Number.parseInt(String(raw ?? '0'), 10);
  return { securityLevel: Number.isNaN(parsed) ? 0 : parsed, isHrx };
}

/** Gate: HRX or security level 5–7 for the tenant. Matches doc §3.5 / §6.2. */
async function assertWorkforceAdmin(
  uid: string,
  authToken: Record<string, unknown> | undefined,
  tenantId: string,
): Promise<void> {
  const { securityLevel, isHrx } = await resolveCallerSecurityLevel(uid, authToken, tenantId);
  if (isHrx) return;
  if (securityLevel >= 5 && securityLevel <= 7) return;
  throw new HttpsError(
    'permission-denied',
    'Workforce status changes require tenant security level 5, 6, or 7.',
  );
}

function normalizeInput(raw: unknown): SetAccountWorkforceStatusInput {
  const d = (raw || {}) as Record<string, unknown>;
  const tenantId = String(d.tenantId || '').trim();
  const accountId = String(d.accountId || '').trim();
  const workerId = String(d.workerId || '').trim();
  const nextStatus = String(d.nextStatus || '').trim().toLowerCase();

  if (!tenantId || !accountId || !workerId) {
    throw new HttpsError(
      'invalid-argument',
      'tenantId, accountId, and workerId are required.',
    );
  }
  if (nextStatus !== 'active' && nextStatus !== 'inactive') {
    throw new HttpsError(
      'invalid-argument',
      "nextStatus must be 'active' or 'inactive'.",
    );
  }

  const result: SetAccountWorkforceStatusInput = {
    tenantId,
    accountId,
    workerId,
    nextStatus: nextStatus as 'active' | 'inactive',
  };

  if (nextStatus === 'inactive') {
    const reason = String(d.deactivationReason || '').trim().toLowerCase();
    if (!(VALID_DEACTIVATION_REASONS as readonly string[]).includes(reason)) {
      throw new HttpsError(
        'invalid-argument',
        `deactivationReason must be one of: ${VALID_DEACTIVATION_REASONS.join(', ')}.`,
      );
    }
    result.deactivationReason = reason as AccountWorkforceDeactivationReason;
    const notes = typeof d.deactivationNotes === 'string' ? d.deactivationNotes.trim() : '';
    if (reason === 'other' && !notes) {
      throw new HttpsError(
        'invalid-argument',
        "deactivationNotes is required when deactivationReason === 'other'.",
      );
    }
    if (notes) result.deactivationNotes = notes;
    if (Array.isArray(d.cancelFutureAssignmentIds)) {
      result.cancelFutureAssignmentIds = d.cancelFutureAssignmentIds
        .map((id) => String(id || '').trim())
        .filter((id) => id.length > 0);
    }
  } else {
    const notes = typeof d.reactivationNotes === 'string' ? d.reactivationNotes.trim() : '';
    if (notes) result.reactivationNotes = notes;
  }

  return result;
}

export const setAccountWorkforceStatus = onCall(
  { cors: true, memory: '256MiB', timeoutSeconds: 60 },
  async (request): Promise<SetAccountWorkforceStatusResult> => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Authentication required.');
    }
    const actorUid = request.auth.uid;

    const input = normalizeInput(request.data);
    await assertWorkforceAdmin(actorUid, request.auth.token as Record<string, unknown>, input.tenantId);

    const docId = accountWorkforceDocId(input.accountId, input.workerId);
    const ref = db.doc(`tenants/${input.tenantId}/account_workforce/${docId}`);

    // Whole mutation runs in a transaction so the status flip and the
    // assignment cascade either both land or both roll back — no orphan
    // future shifts on a deactivated worker.
    const result = await db.runTransaction(async (tx) => {
      const existingSnap = await tx.get(ref);

      // Resolve assignment refs BEFORE deciding what to do — we may need
      // both (a) to validate the ids belong to this worker/account and
      // (b) to snapshot their status so the trigger's counter rollup works.
      const cancellationRefs: admin.firestore.DocumentReference[] = [];
      const cancellationSnaps: admin.firestore.DocumentSnapshot[] = [];
      if (
        input.nextStatus === 'inactive' &&
        Array.isArray(input.cancelFutureAssignmentIds) &&
        input.cancelFutureAssignmentIds.length > 0
      ) {
        for (const assignmentId of input.cancelFutureAssignmentIds) {
          const aRef = db.doc(`tenants/${input.tenantId}/assignments/${assignmentId}`);
          cancellationRefs.push(aRef);
        }
        // Transactions require all reads before writes — snapshot them up front.
        for (const aRef of cancellationRefs) {
          cancellationSnaps.push(await tx.get(aRef));
        }
      }

      const now = admin.firestore.Timestamp.now();

      // --- Status flip on the AccountWorkforce doc ---
      const basePatch: Record<string, unknown> = {
        tenantId: input.tenantId,
        accountId: input.accountId,
        workerId: input.workerId,
        status: input.nextStatus,
        updatedAt: now,
      };

      if (input.nextStatus === 'inactive') {
        basePatch.deactivatedAt = now;
        basePatch.deactivatedBy = actorUid;
        basePatch.deactivationReason = input.deactivationReason;
        if (input.deactivationNotes) basePatch.deactivationNotes = input.deactivationNotes;
        else basePatch.deactivationNotes = admin.firestore.FieldValue.delete();
        // Any previous reactivation fields are now stale; clear them so the
        // doc can't claim two simultaneous histories.
        basePatch.reactivatedAt = admin.firestore.FieldValue.delete();
        basePatch.reactivatedBy = admin.firestore.FieldValue.delete();
        basePatch.reactivationNotes = admin.firestore.FieldValue.delete();
      } else {
        basePatch.reactivatedAt = now;
        basePatch.reactivatedBy = actorUid;
        if (input.reactivationNotes) basePatch.reactivationNotes = input.reactivationNotes;
        else basePatch.reactivationNotes = admin.firestore.FieldValue.delete();
        // Clear deactivation audit + stale blockers on reactivation.
        basePatch.deactivatedAt = admin.firestore.FieldValue.delete();
        basePatch.deactivatedBy = admin.firestore.FieldValue.delete();
        basePatch.deactivationReason = admin.firestore.FieldValue.delete();
        basePatch.deactivationNotes = admin.firestore.FieldValue.delete();
        basePatch.blockers = admin.firestore.FieldValue.delete();
      }

      // Preserve firstConfirmedAt / counters if the doc already exists. If it
      // doesn't (unusual — deactivating someone who never committed), we
      // create a shell so the audit trail has a home; the assignment trigger
      // will fill counters / firstConfirmedAt on the next confirm.
      if (!existingSnap.exists) {
        basePatch.firstConfirmedAt = now;
        basePatch.totalShifts = 0;
        basePatch.completedShifts = 0;
        basePatch.createdAt = now;
        tx.set(ref, basePatch, { merge: false });
      } else {
        tx.set(ref, basePatch, { merge: true });
      }

      // --- Cascade cancellations, if any ---
      let assignmentsCancelled = 0;
      if (cancellationSnaps.length > 0) {
        const reasonLabel = input.deactivationReason ?? 'deactivated';
        for (let i = 0; i < cancellationSnaps.length; i += 1) {
          const aSnap = cancellationSnaps[i];
          const aRef = cancellationRefs[i];
          if (!aSnap.exists) continue;
          const aData = aSnap.data() as Record<string, unknown>;
          // Safety: only touch assignments that belong to this worker AND
          // this account (via recruiterAccountId when present). Never rewrite
          // cross-account assignments just because the client asked.
          const aWorkerId = pickString(aData.userId, aData.candidateId);
          if (aWorkerId !== input.workerId) {
            logger.warn('setAccountWorkforceStatus: cancellation target worker mismatch — skipping', {
              assignmentId: aRef.id,
              expectedWorkerId: input.workerId,
              actualWorkerId: aWorkerId,
            });
            continue;
          }
          const aAccountId = pickString((aData as any).recruiterAccountId);
          if (aAccountId && aAccountId !== input.accountId) {
            logger.warn('setAccountWorkforceStatus: cancellation target account mismatch — skipping', {
              assignmentId: aRef.id,
              expectedAccountId: input.accountId,
              actualAccountId: aAccountId,
            });
            continue;
          }
          // Already-terminal assignments aren't re-cancelled (idempotent).
          const currentStatus = String(aData.status || '').toLowerCase();
          if (
            currentStatus === 'cancelled_business' ||
            currentStatus === 'cancelled_worker' ||
            currentStatus === 'cancelled' ||
            currentStatus === 'completed' ||
            currentStatus === 'no_show' ||
            currentStatus === 'left_early'
          ) {
            continue;
          }
          tx.set(
            aRef,
            {
              status: 'cancelled_business',
              outcomeStatus: 'cancelled_business',
              outcomeAt: now,
              outcomeBy: actorUid,
              outcomeNotes: `Cancelled via AccountWorkforce deactivation (reason: ${reasonLabel}).`,
              updatedAt: now,
              updatedBy: actorUid,
            },
            { merge: true },
          );
          assignmentsCancelled += 1;
        }
      }

      return { assignmentsCancelled };
    });

    logger.info('setAccountWorkforceStatus: applied', {
      tenantId: input.tenantId,
      accountId: input.accountId,
      workerId: input.workerId,
      nextStatus: input.nextStatus,
      actorUid,
      assignmentsCancelled: result.assignmentsCancelled,
    });

    return {
      ok: true as const,
      accountWorkforceId: docId,
      nextStatus: input.nextStatus,
      assignmentsCancelled: result.assignmentsCancelled,
    };
  },
);

function pickString(...values: unknown[]): string | null {
  for (const v of values) {
    if (typeof v === 'string' && v.trim() !== '') return v.trim();
  }
  return null;
}
