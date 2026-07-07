/**
 * **swapScheduledAssignmentWorker — move a scheduled assignment (and its
 * timesheet entries) to the correct worker.**
 *
 * Greg (2026-07-07): the Import tab can re-match a wrongly-matched worker,
 * but the Timesheet Grid had no equivalent for scheduled rows. The catch:
 * identity is structural on this side —
 *
 *   - assignment doc id  = `${shiftId}__${userId}`
 *   - entry doc id       = `${assignmentId}_${workDate}`
 *
 * so a swap is a MOVE: create the new worker's assignment doc (copying the
 * old one's engagement fields, refreshed identity fields, readiness reset
 * so the new worker is evaluated fresh), rewrite every timesheet entry to
 * its new doc id with the new workerId, and DELETE the old assignment —
 * the grid resolver has no status filter, so a merely-cancelled assignment
 * would keep phantom rows alive, and the wrong worker's app must stop
 * showing the shift.
 *
 * Guards:
 *   - Any entry `sent_to_everee`/`paid` under the assignment → refuse
 *     (recall the entry first — money already moved).
 *   - Target worker already has this shift's assignment with conflicting
 *     entries → refuse rather than merge silently.
 *
 * Auth: securityLevel >= 5 (recruiter/manager/admin) or HRX — the same
 * gate as searchTimesheetWorkers; drafts only, so no Everee boundary.
 */

import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

const LIVE_ENTRY_STATUSES = new Set(['sent_to_everee', 'paid']);
const ACTOR = 'swapScheduledAssignmentWorker';

interface Input {
  tenantId: string;
  assignmentId: string;
  newUserId: string;
}

interface Output {
  ok: true;
  newAssignmentId: string;
  entriesMoved: number;
}

async function assertCallerCanEdit(callerUid: string, tenantId: string): Promise<void> {
  const snap = await db.collection('users').doc(callerUid).get();
  if (!snap.exists) throw new HttpsError('permission-denied', 'User not found');
  const data = snap.data() as Record<string, unknown>;
  if (data.isHRX === true || data.hrx === true) return;
  const tenantMeta = (data.tenantIds as Record<string, unknown> | undefined)?.[tenantId] as
    | Record<string, unknown>
    | undefined;
  if (!tenantMeta) throw new HttpsError('permission-denied', 'No access to this tenant');
  const role = String(tenantMeta.role || '').trim().toLowerCase();
  if (['recruiter', 'manager', 'admin'].includes(role)) return;
  const sec = parseInt(String(tenantMeta.securityLevel ?? data.securityLevel ?? '0'), 10);
  if (!Number.isNaN(sec) && sec >= 5) return;
  throw new HttpsError('permission-denied', 'Not authorized to swap workers');
}

export const swapScheduledAssignmentWorker = onCall<Input, Promise<Output>>(
  {
    enforceAppCheck: false,
    cors: true,
    memory: '512MiB',
    timeoutSeconds: 120,
  },
  async (req): Promise<Output> => {
    if (!req.auth?.uid) throw new HttpsError('unauthenticated', 'Authentication required');
    const { tenantId, assignmentId, newUserId } = req.data || ({} as Input);
    if (!tenantId || !assignmentId?.trim() || !newUserId?.trim()) {
      throw new HttpsError('invalid-argument', 'tenantId, assignmentId, newUserId are required');
    }
    await assertCallerCanEdit(req.auth.uid, tenantId);

    const oldRef = db.doc(`tenants/${tenantId}/assignments/${assignmentId}`);
    const oldSnap = await oldRef.get();
    if (!oldSnap.exists) throw new HttpsError('not-found', 'Assignment not found');
    const old = oldSnap.data() as Record<string, unknown>;
    const shiftId = String(old.shiftId ?? '').trim();
    const oldUserId = String(old.userId ?? old.candidateId ?? '').trim();
    if (!shiftId) {
      throw new HttpsError('failed-precondition', 'Assignment has no shiftId — cannot rekey');
    }
    if (oldUserId === newUserId.trim()) {
      throw new HttpsError('invalid-argument', 'Assignment already belongs to that worker');
    }

    const userSnap = await db.doc(`users/${newUserId}`).get();
    if (!userSnap.exists) throw new HttpsError('not-found', 'Target worker not found');
    const user = userSnap.data() as Record<string, unknown>;
    const firstName = String(user.firstName ?? '').trim();
    const lastName = String(user.lastName ?? '').trim();
    const workerDisplayName =
      `${firstName} ${lastName}`.trim() || String(user.displayName ?? '').trim() || newUserId;

    // Entries under the old assignment. Refuse when money already moved.
    const entriesSnap = await db
      .collection(`tenants/${tenantId}/timesheet_entries`)
      .where('assignmentId', '==', assignmentId)
      .get();
    for (const d of entriesSnap.docs) {
      const status = String((d.data() as Record<string, unknown>).status ?? '');
      if (LIVE_ENTRY_STATUSES.has(status)) {
        throw new HttpsError(
          'failed-precondition',
          `Entry ${d.id} is ${status} — recall it from Everee before swapping the worker`,
        );
      }
    }

    const newAssignmentId = `${shiftId}__${newUserId.trim()}`;
    const newRef = db.doc(`tenants/${tenantId}/assignments/${newAssignmentId}`);
    const newSnap = await newRef.get();

    // Collision check on target entries BEFORE writing anything.
    const batch = db.batch();
    let entriesMoved = 0;
    for (const d of entriesSnap.docs) {
      const e = d.data() as Record<string, unknown>;
      const workDate = String(e.workDate ?? '');
      const targetId = `${newAssignmentId}_${workDate}`;
      const target = await db.doc(`tenants/${tenantId}/timesheet_entries/${targetId}`).get();
      if (target.exists) {
        throw new HttpsError(
          'failed-precondition',
          `${workerDisplayName} already has a timesheet entry for ${workDate} on this shift — resolve that overlap first`,
        );
      }
      batch.set(db.doc(`tenants/${tenantId}/timesheet_entries/${targetId}`), {
        ...e,
        workerId: newUserId.trim(),
        assignmentId: newAssignmentId,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: `${ACTOR}:${req.auth.uid}`,
        swappedFromEntryId: d.id,
      });
      batch.delete(d.ref);
      entriesMoved++;
    }

    if (!newSnap.exists) {
      // Copy the engagement, refresh the identity, reset per-worker state.
      const copy: Record<string, unknown> = {
        ...old,
        userId: newUserId.trim(),
        candidateId: newUserId.trim(),
        firstName,
        lastName,
        workerDisplayName,
        email: String(user.email ?? '').trim(),
        phone: String(user.phone ?? user.phoneNumber ?? '').trim(),
        suppressInitialNotification: true,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        createdBy: `${ACTOR}:${req.auth.uid}`,
        swappedFromAssignmentId: assignmentId,
        swappedFromUserId: oldUserId,
      };
      // Readiness must re-evaluate for the NEW worker — stale results for
      // the wrong person are worse than none. Drop the copied key.
      delete copy.assignmentReadinessV1;
      batch.set(newRef, copy);
    }

    // Hard delete — the grid resolver has no status filter, and the wrong
    // worker's app must stop showing this shift.
    batch.delete(oldRef);
    await batch.commit();

    logger.info('[swapScheduledAssignmentWorker] swapped', {
      tenantId,
      oldAssignmentId: assignmentId,
      newAssignmentId,
      oldUserId,
      newUserId: newUserId.trim(),
      entriesMoved,
      targetAssignmentExisted: newSnap.exists,
      by: req.auth.uid,
    });

    return { ok: true, newAssignmentId, entriesMoved };
  },
);
