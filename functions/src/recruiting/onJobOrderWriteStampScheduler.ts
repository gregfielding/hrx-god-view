/**
 * Trigger — stamp `jobOrder.schedulerUid` from the owning account's
 * `roles.schedulerIds` whenever a job order is written.
 *
 * Phase 4c of `docs/RECRUITING_ROLE_MODEL.md`. Fires on every job order
 * write but short-circuits unless either:
 *   - the doc just landed (create), or
 *   - `recruiterAccountId` changed (rare, but re-stamp is cheap), or
 *   - `schedulerUid` is missing despite an account being linked.
 *
 * Does NOT re-stamp when only unrelated fields change (title, status,
 * shifts, etc.). That keeps per-JO write amplification low.
 *
 * The companion trigger
 * `onAccountRolesChangeRestampSchedulers.ts` handles the other
 * direction: when an account's `roles.schedulerIds` changes, it walks
 * every job order for that account and re-stamps. Together they keep
 * `jobOrder.schedulerUid` as a reliable denormalized cache for the
 * Scheduler chip on the JO header.
 */

import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions/v2';
import * as admin from 'firebase-admin';

import { resolveRole } from '../shared/resolveRole';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

function pickString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const t = value.trim();
  return t === '' ? null : t;
}

export const onJobOrderWriteStampScheduler = onDocumentWritten(
  {
    document: 'tenants/{tenantId}/job_orders/{jobOrderId}',
    region: 'us-central1',
    maxInstances: 5,
    retry: false,
  },
  async (event) => {
    const tenantId = String(event.params.tenantId);
    const jobOrderId = String(event.params.jobOrderId);

    const beforeData = event.data?.before?.exists
      ? ((event.data.before.data() ?? {}) as Record<string, unknown>)
      : null;
    const afterData = event.data?.after?.exists
      ? ((event.data.after.data() ?? {}) as Record<string, unknown>)
      : null;

    // Deletion — nothing to maintain.
    if (!afterData) return;

    const accountId = pickString(afterData.recruiterAccountId);
    if (!accountId) return; // Legacy / unlinked JO — nothing to stamp.

    const priorAccountId = pickString(beforeData?.recruiterAccountId);
    const priorSchedulerUid = pickString(beforeData?.schedulerUid);
    const currentSchedulerUid = pickString(afterData.schedulerUid);

    // Decide whether to re-run the resolver. Skip when nothing meaningful
    // to do — the trigger fires on every JO write so short-circuiting
    // here is important for write amplification on large tenants.
    const justCreated = beforeData === null;
    const accountChanged = priorAccountId !== accountId;
    const missingScheduler = currentSchedulerUid === null;

    if (!justCreated && !accountChanged && !missingScheduler) return;

    // Resolve Scheduler from account + tenant defaults.
    let accountSchedulerIds: string[] = [];
    try {
      const accountSnap = await db.doc(`tenants/${tenantId}/accounts/${accountId}`).get();
      if (accountSnap.exists) {
        const data = accountSnap.data() as Record<string, unknown>;
        const roles = (data.roles || {}) as { schedulerIds?: unknown };
        if (Array.isArray(roles?.schedulerIds)) {
          accountSchedulerIds = roles.schedulerIds.filter(
            (x): x is string => typeof x === 'string' && x.trim() !== '',
          );
        }
      }
    } catch (err) {
      logger.warn('onJobOrderWriteStampScheduler: account read failed', {
        tenantId,
        jobOrderId,
        accountId,
        err: (err as Error).message,
      });
    }

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
    } catch (err) {
      logger.warn('onJobOrderWriteStampScheduler: tenant defaults read failed', {
        tenantId,
        jobOrderId,
        err: (err as Error).message,
      });
    }

    const resolved = resolveRole({
      role: 'scheduler',
      account: { id: accountId, schedulerIds: accountSchedulerIds },
      tenantDefaults: { schedulerFallbackIds: tenantFallback },
    });

    // Write the stamp only when it would actually change. Empty-string
    // parity: treat null/undefined the same as "unset."
    const nextSchedulerUid = resolved.primaryUid;
    if (nextSchedulerUid === currentSchedulerUid) return;

    const patch: Record<string, unknown> = { updatedAt: admin.firestore.FieldValue.serverTimestamp() };
    if (nextSchedulerUid === null) {
      patch.schedulerUid = admin.firestore.FieldValue.delete();
    } else {
      patch.schedulerUid = nextSchedulerUid;
    }

    try {
      await db.doc(`tenants/${tenantId}/job_orders/${jobOrderId}`).set(patch, { merge: true });
      logger.info('onJobOrderWriteStampScheduler: stamped schedulerUid', {
        tenantId,
        jobOrderId,
        accountId,
        schedulerUid: nextSchedulerUid,
        source: resolved.source,
      });
    } catch (err) {
      logger.error('onJobOrderWriteStampScheduler: write failed', {
        tenantId,
        jobOrderId,
        err: (err as Error).message,
      });
    }
  },
);
