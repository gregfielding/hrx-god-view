/**
 * Add / remove a DNR (Do Not Return) mark on a worker — the ONLY write path
 * for the user doc's `dnr` / `dnrAccountIds` fields (clients have no direct
 * write access to them; recruiter-level auth via canManageAssignments).
 * Removal keeps the entry in `dnr` with status 'removed' for audit.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

import { canManageAssignments } from '../placementsApi';
import type { DnrEntry } from './dnrShared';

const db = admin.firestore();

export const setWorkerDnr = onCall({ memory: '512MiB' }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');

  const {
    tenantId,
    userId,
    action,
    accountId,
    accountName,
    accountType,
    parentAccountId,
    parentAccountName,
    notes,
  } = (request.data || {}) as {
    tenantId?: string;
    userId?: string;
    action?: 'add' | 'remove';
    accountId?: string;
    accountName?: string;
    accountType?: string;
    parentAccountId?: string | null;
    parentAccountName?: string | null;
    notes?: string;
  };

  if (!tenantId || !userId || !accountId || (action !== 'add' && action !== 'remove')) {
    throw new HttpsError('invalid-argument', 'tenantId, userId, accountId and action (add|remove) are required.');
  }
  if (!(await canManageAssignments(request.auth, tenantId, uid))) {
    throw new HttpsError('permission-denied', 'Recruiter access required.');
  }

  const callerSnap = await db.doc(`users/${uid}`).get();
  const caller = callerSnap.data() || {};
  const callerName =
    [caller.firstName, caller.lastName].filter(Boolean).join(' ') || caller.displayName || null;

  const userRef = db.doc(`users/${userId}`);
  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(userRef);
    if (!snap.exists) throw new HttpsError('not-found', 'Worker not found.');
    const data = snap.data() || {};
    const dnr: DnrEntry[] = Array.isArray(data.dnr) ? [...(data.dnr as DnrEntry[])] : [];
    const nowIso = new Date().toISOString();

    if (action === 'add') {
      if (dnr.some((e) => e.status === 'active' && e.accountId === accountId)) {
        throw new HttpsError('already-exists', 'Worker is already DNR for this account.');
      }
      dnr.push({
        accountId,
        accountName: String(accountName || accountId),
        accountType: (accountType as DnrEntry['accountType']) ?? null,
        parentAccountId: parentAccountId ?? null,
        parentAccountName: parentAccountName ?? null,
        ...(notes && notes.trim() ? { notes: notes.trim().slice(0, 2000) } : {}),
        status: 'active',
        addedBy: uid,
        addedByName: callerName,
        addedAt: nowIso,
      });
    } else {
      const active = dnr.find((e) => e.status === 'active' && e.accountId === accountId);
      if (!active) throw new HttpsError('not-found', 'No active DNR for this account.');
      active.status = 'removed';
      active.removedBy = uid;
      active.removedByName = callerName;
      active.removedAt = nowIso;
      if (notes && notes.trim()) active.removedNotes = notes.trim().slice(0, 2000);
    }

    const dnrAccountIds = [
      ...new Set(dnr.filter((e) => e.status === 'active').map((e) => e.accountId)),
    ];
    tx.set(
      userRef,
      { dnr, dnrAccountIds, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
      { merge: true },
    );
    return { dnr, dnrAccountIds };
  });

  return { ok: true, ...result };
});
