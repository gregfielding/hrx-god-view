/**
 * Trigger — when an account's `roles.schedulerIds` changes, walk every
 * job order linked to that account and re-stamp `jobOrder.schedulerUid`.
 *
 * Phase 4c of `docs/RECRUITING_ROLE_MODEL.md`. Companion to
 * `onJobOrderWriteStampScheduler`:
 *   - JO-side trigger stamps on JO writes.
 *   - Account-side trigger (this one) re-stamps existing JOs when the
 *     account's roster changes.
 *
 * Short-circuits unless `roles.schedulerIds` actually shifted — every
 * account doc write fires this trigger and we don't want a name-edit
 * or pricing-update to rewrite every JO.
 *
 * Processes JOs in batches of 400 (well below Firestore's 500-op batch
 * limit). For an account with thousands of historical JOs this could
 * take a bit; that's acceptable — role roster changes are rare.
 */

import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions/v2';
import * as admin from 'firebase-admin';

import { resolveRole } from '../shared/resolveRole';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

function readSchedulerIds(data: Record<string, unknown> | null | undefined): string[] {
  if (!data) return [];
  const roles = (data.roles || {}) as { schedulerIds?: unknown };
  if (!Array.isArray(roles?.schedulerIds)) return [];
  return roles.schedulerIds.filter(
    (x): x is string => typeof x === 'string' && x.trim() !== '',
  );
}

function stringArraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const aSet = new Set(a);
  for (const v of b) if (!aSet.has(v)) return false;
  return true;
}

export const onAccountRolesChangeRestampSchedulers = onDocumentWritten(
  {
    document: 'tenants/{tenantId}/accounts/{accountId}',
    region: 'us-central1',
    maxInstances: 2,
    retry: false,
  },
  async (event) => {
    const tenantId = String(event.params.tenantId);
    const accountId = String(event.params.accountId);

    const beforeData = event.data?.before?.exists
      ? ((event.data.before.data() ?? {}) as Record<string, unknown>)
      : null;
    const afterData = event.data?.after?.exists
      ? ((event.data.after.data() ?? {}) as Record<string, unknown>)
      : null;

    // Account deleted — leave existing JO stamps alone. Historical
    // data stays as a record; a future cleanup pass can wipe them.
    if (!afterData) return;

    const beforeSchedulers = readSchedulerIds(beforeData);
    const afterSchedulers = readSchedulerIds(afterData);
    if (stringArraysEqual(beforeSchedulers, afterSchedulers)) return;

    // Need the tenant fallback for JOs whose account roster is now empty.
    let tenantFallback: string[] = [];
    try {
      const defaultsSnap = await db.doc(`tenants/${tenantId}/settings/roleDefaults`).get();
      if (defaultsSnap.exists) {
        const data = defaultsSnap.data() as Record<string, unknown>;
        if (Array.isArray(data.schedulerFallbackIds)) {
          tenantFallback = data.schedulerFallbackIds.filter(
            (x): x is string => typeof x === 'string' && x.trim() !== '',
          );
        }
      }
    } catch {
      /* non-fatal — fall through with empty fallback */
    }

    const resolved = resolveRole({
      role: 'scheduler',
      account: { id: accountId, schedulerIds: afterSchedulers },
      tenantDefaults: { schedulerFallbackIds: tenantFallback },
    });
    const nextSchedulerUid = resolved.primaryUid;

    // Walk JOs for this account. There's no composite index assumption —
    // a straight equality query on `recruiterAccountId` is already indexed.
    let writtenCount = 0;
    try {
      const snap = await db
        .collection(`tenants/${tenantId}/job_orders`)
        .where('recruiterAccountId', '==', accountId)
        .get();
      if (snap.empty) {
        logger.info('onAccountRolesChangeRestampSchedulers: no JOs to re-stamp', {
          tenantId,
          accountId,
          nextSchedulerUid,
        });
        return;
      }

      const CHUNK = 400;
      const now = admin.firestore.FieldValue.serverTimestamp();
      for (let i = 0; i < snap.docs.length; i += CHUNK) {
        const slice = snap.docs.slice(i, i + CHUNK);
        const batch = db.batch();
        for (const d of slice) {
          const currentSchedulerUid =
            typeof d.data().schedulerUid === 'string' && (d.data().schedulerUid as string).trim() !== ''
              ? (d.data().schedulerUid as string).trim()
              : null;
          if (currentSchedulerUid === nextSchedulerUid) continue; // idempotent

          const patch: Record<string, unknown> = { updatedAt: now };
          if (nextSchedulerUid === null) {
            patch.schedulerUid = admin.firestore.FieldValue.delete();
          } else {
            patch.schedulerUid = nextSchedulerUid;
          }
          batch.set(d.ref, patch, { merge: true });
          writtenCount += 1;
        }
        await batch.commit();
      }
    } catch (err) {
      logger.error('onAccountRolesChangeRestampSchedulers: walk failed', {
        tenantId,
        accountId,
        err: (err as Error).message,
      });
      return;
    }

    logger.info('onAccountRolesChangeRestampSchedulers: re-stamped JO schedulerUid', {
      tenantId,
      accountId,
      nextSchedulerUid,
      writtenCount,
    });
  },
);
