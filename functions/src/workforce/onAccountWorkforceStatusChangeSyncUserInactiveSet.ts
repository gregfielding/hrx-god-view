/**
 * Workforce denormalization trigger — keeps `users.{uid}.inactiveAtAccounts`
 * in sync with the AccountWorkforce roster.
 *
 * Phase 5b of `docs/WORKFORCE_DOMAIN_MODEL.md` (§10). Purpose: Labor Pool
 * search needs to render a quiet "Inactive at N account(s)" chip on
 * every candidate row. Without this cache, rendering would require one
 * cross-collection join per row. With it, the UI reads a single field
 * on the user doc it already has in hand.
 *
 * Behavior:
 *   - Status went `active → inactive`, or new doc created as inactive →
 *     upsert an entry in `users.{uid}.inactiveAtAccounts[]` for this
 *     accountId. The entry carries accountName (resolved on write),
 *     reason, deactivatedAt, deactivatedBy.
 *   - Status went `inactive → active`, or doc deleted while inactive →
 *     remove that account's entry from the array.
 *   - Status stayed `inactive` but reason/notes/actor changed → replace
 *     the entry so the chip tooltip reflects current data.
 *
 * Transactional read-modify-write on the user doc — the array is small
 * (a worker is rarely inactive at many accounts) so rewriting it
 * wholesale is fine and avoids the `arrayRemove` exact-match problem.
 *
 * @see docs/WORKFORCE_DOMAIN_MODEL.md §10, §6 triggers
 */

import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions/v2';
import * as admin from 'firebase-admin';

import type {
  AccountWorkforce,
  AccountWorkforceDeactivationReason,
  UserInactiveAtAccountEntry,
} from '../shared/accountWorkforce';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

function toIso(value: unknown): string | undefined {
  if (value instanceof admin.firestore.Timestamp) return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (typeof (value as any)?.toDate === 'function') {
    try {
      return (value as any).toDate().toISOString();
    } catch {
      return undefined;
    }
  }
  if (typeof value === 'string') return value;
  return undefined;
}

async function resolveAccountName(tenantId: string, accountId: string): Promise<string> {
  try {
    const snap = await db.doc(`tenants/${tenantId}/accounts/${accountId}`).get();
    if (!snap.exists) return accountId;
    const data = snap.data() as Record<string, unknown>;
    const name = typeof data?.name === 'string' ? data.name.trim() : '';
    return name || accountId;
  } catch {
    return accountId;
  }
}

export const onAccountWorkforceStatusChangeSyncUserInactiveSet = onDocumentWritten(
  {
    document: 'tenants/{tenantId}/account_workforce/{docId}',
    region: 'us-central1',
    maxInstances: 5,
    retry: false,
  },
  async (event) => {
    const tenantId = String(event.params.tenantId);

    const beforeData = event.data?.before?.exists
      ? ((event.data.before.data() ?? {}) as Record<string, unknown>)
      : null;
    const afterData = event.data?.after?.exists
      ? ((event.data.after.data() ?? {}) as Record<string, unknown>)
      : null;

    // Resolve (workerId, accountId) — these are on both before/after;
    // we only need them once. Deletion of a doc means we should remove
    // the entry from the user's array.
    const source = afterData ?? beforeData;
    if (!source) return;
    const workerId =
      typeof source.workerId === 'string' ? source.workerId.trim() : '';
    const accountId =
      typeof source.accountId === 'string' ? source.accountId.trim() : '';
    if (!workerId || !accountId) return;

    const beforeStatus = String(beforeData?.status || '').toLowerCase();
    const afterStatus = String(afterData?.status || '').toLowerCase();

    // Short-circuit: neither side involved `inactive` AND the doc still
    // exists → nothing for this trigger to maintain.
    const wasInactive = beforeStatus === 'inactive';
    const isInactive = afterStatus === 'inactive' && afterData !== null;
    if (!wasInactive && !isInactive) return;

    // Build the desired entry when the post-state is `inactive`. Resolved
    // account name is denormalized at write time.
    let desiredEntry: UserInactiveAtAccountEntry | null = null;
    if (isInactive && afterData) {
      const accountName = await resolveAccountName(tenantId, accountId);
      const reason =
        (afterData.deactivationReason as AccountWorkforceDeactivationReason | undefined) ??
        'other';
      const deactivatedAt =
        toIso(afterData.deactivatedAt) ??
        toIso(afterData.updatedAt) ??
        new Date().toISOString();
      const deactivatedBy =
        typeof afterData.deactivatedBy === 'string' ? afterData.deactivatedBy : undefined;
      desiredEntry = {
        accountId,
        accountName,
        reason,
        deactivatedAt,
        ...(deactivatedBy ? { deactivatedBy } : {}),
      };
    }

    const userRef = db.doc(`users/${workerId}`);
    await db.runTransaction(async (tx) => {
      const userSnap = await tx.get(userRef);
      // If the user doc doesn't exist, still write the minimal shape —
      // downstream readers shouldn't care whether it pre-existed.
      const existing =
        userSnap.exists
          ? ((userSnap.data()?.inactiveAtAccounts as UserInactiveAtAccountEntry[] | undefined) ??
            [])
          : [];
      // Drop any entry for this account id, then append the desired one
      // (if any). Other accounts' entries are untouched.
      const nextArray = existing.filter((e) => e?.accountId !== accountId);
      if (desiredEntry) nextArray.push(desiredEntry);

      if (nextArray.length === 0) {
        // Clear the field entirely so the user doc stays tidy rather
        // than carrying an empty array.
        tx.set(
          userRef,
          { inactiveAtAccounts: admin.firestore.FieldValue.delete() },
          { merge: true },
        );
      } else {
        tx.set(userRef, { inactiveAtAccounts: nextArray }, { merge: true });
      }
    });

    logger.info('workforce-inactive-denorm: user updated', {
      tenantId,
      workerId,
      accountId,
      beforeStatus,
      afterStatus,
      desiredEntry: desiredEntry ? 'present' : 'removed',
    });
  },
);
