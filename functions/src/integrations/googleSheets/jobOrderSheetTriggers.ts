/**
 * Phase 2 — live, debounced auto-sync of the per-JO roster sheet.
 *
 * Pattern (avoids collection-group indexes + Sheets-API hammering):
 *   1. Writes to placements / assignments flag the JO "dirty" by upserting a
 *      doc in the top-level `googleSheetSyncQueue/{tenantId}__{jobOrderId}`
 *      collection — but ONLY when that JO has `googleSheetSync.enabled`.
 *   2. A 1-minute cron (`flushJobOrderSheetSyncQueue`) drains the queue and
 *      runs one full `syncJobOrderToSheet` per dirty JO. A minute of churn
 *      collapses into a single sync, so FIFA-scale placement edits don't
 *      blow the Sheets write quota.
 *
 * Loop-safe: the sync writes to `job_orders` (lastSyncedAt) and the Sheet —
 * never to placements/assignments or the queue — so it can't re-trigger.
 */
import * as admin from 'firebase-admin';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import { DEFAULT_FIRESTORE_TRIGGER_MEMORY } from '../../utils/functionRuntimeDefaults';
import { syncJobOrderToSheet } from './jobOrderSheetSync';
import { isGoogleSheetsConfigured } from './sheetsClient';

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const REGION = 'us-central1' as const;
const QUEUE = 'googleSheetSyncQueue';
const MAX_ATTEMPTS = 5;

/** Flag a JO dirty for the next flush — only if its sheet sync is enabled. */
async function queueIfEnabled(tenantId: string, jobOrderId: string): Promise<void> {
  if (!tenantId || !jobOrderId || !isGoogleSheetsConfigured()) return;
  const joSnap = await db.doc(`tenants/${tenantId}/job_orders/${jobOrderId}`).get();
  const gss = (joSnap.data() as { googleSheetSync?: { enabled?: boolean } } | undefined)?.googleSheetSync;
  if (gss?.enabled !== true) return;
  await db.doc(`${QUEUE}/${tenantId}__${jobOrderId}`).set(
    { tenantId, jobOrderId, dirtyAt: admin.firestore.FieldValue.serverTimestamp() },
    { merge: true },
  );
}

function jobOrderIdFrom(event: {
  data?: { before?: FirebaseFirestore.DocumentSnapshot; after?: FirebaseFirestore.DocumentSnapshot };
}): string {
  const after = event.data?.after?.data() as Record<string, unknown> | undefined;
  const before = event.data?.before?.data() as Record<string, unknown> | undefined;
  return String((after?.jobOrderId ?? before?.jobOrderId) || '').trim();
}

const triggerOpts = {
  region: REGION,
  retry: false,
  memory: DEFAULT_FIRESTORE_TRIGGER_MEMORY,
  maxInstances: 10,
};

export const onPlacementWriteQueueSheetSync = onDocumentWritten(
  { ...triggerOpts, document: 'tenants/{tenantId}/placements/{placementId}' },
  async (event) => {
    const tenantId = event.params.tenantId as string;
    const jobOrderId = jobOrderIdFrom(event);
    try {
      await queueIfEnabled(tenantId, jobOrderId);
    } catch (err) {
      logger.warn('[sheetSync] placement queue failed', { tenantId, jobOrderId, error: String(err) });
    }
  },
);

export const onAssignmentWriteQueueSheetSync = onDocumentWritten(
  { ...triggerOpts, document: 'tenants/{tenantId}/assignments/{assignmentId}' },
  async (event) => {
    const tenantId = event.params.tenantId as string;
    const jobOrderId = jobOrderIdFrom(event);
    try {
      await queueIfEnabled(tenantId, jobOrderId);
    } catch (err) {
      logger.warn('[sheetSync] assignment queue failed', { tenantId, jobOrderId, error: String(err) });
    }
  },
);

export const flushJobOrderSheetSyncQueue = onSchedule(
  {
    schedule: 'every 1 minutes',
    timeZone: 'UTC',
    region: REGION,
    memory: '512MiB',
    timeoutSeconds: 300,
  },
  async () => {
    if (!isGoogleSheetsConfigured()) return; // feature not set up yet
    const snap = await db.collection(QUEUE).orderBy('dirtyAt', 'asc').limit(50).get();
    if (snap.empty) return;

    let synced = 0;
    let failed = 0;
    for (const doc of snap.docs) {
      const d = doc.data() as { tenantId?: string; jobOrderId?: string; dirtyAt?: FirebaseFirestore.Timestamp; attempts?: number };
      const tenantId = String(d.tenantId || '');
      const jobOrderId = String(d.jobOrderId || '');
      const capturedDirtyMs = d.dirtyAt?.toMillis?.() ?? 0;
      if (!tenantId || !jobOrderId) {
        await doc.ref.delete().catch(() => undefined);
        continue;
      }
      try {
        await syncJobOrderToSheet(tenantId, jobOrderId);
        synced += 1;
        // Delete only if no new change landed during the sync; otherwise leave
        // it for the next run so we don't drop edits made mid-sync.
        await db.runTransaction(async (tx) => {
          const cur = await tx.get(doc.ref);
          const curMs = (cur.data()?.dirtyAt as FirebaseFirestore.Timestamp | undefined)?.toMillis?.() ?? 0;
          if (!cur.exists || curMs <= capturedDirtyMs) tx.delete(doc.ref);
        });
      } catch (err) {
        failed += 1;
        const attempts = (d.attempts ?? 0) + 1;
        logger.warn('[sheetSync] flush sync failed', {
          tenantId,
          jobOrderId,
          attempts,
          error: err instanceof Error ? err.message : String(err),
        });
        if (attempts >= MAX_ATTEMPTS) {
          logger.error('[sheetSync] giving up after max attempts', { tenantId, jobOrderId });
          await doc.ref.delete().catch(() => undefined);
        } else {
          await doc.ref.set({ attempts }, { merge: true }).catch(() => undefined);
        }
      }
    }
    if (synced || failed) logger.info('[sheetSync] flush done', { synced, failed });
  },
);
