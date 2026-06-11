/**
 * Callables for the per-job-order Google Sheet roster sync.
 *   - jobOrderSheetEnable    : toggle on → create spreadsheet + initial sync
 *   - jobOrderSheetDisable   : toggle off → unlink (sheet is left in the Shared Drive)
 *   - jobOrderSheetSyncNow   : manual full re-sync
 *   - jobOrderSheetPullFromSheet : place hand-typed rows back into HRX by phone
 */
import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { syncJobOrderToSheet, pullSheetAdditionsToHrx } from './jobOrderSheetSync';
import { isGoogleSheetsConfigured } from './sheetsClient';

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

async function assertCanManage(auth: { uid?: string; token?: Record<string, unknown> } | undefined, tenantId: string) {
  if (!auth?.uid) throw new HttpsError('unauthenticated', 'Authentication required');
  // Claims-based tenant role, or a tenantIds membership on the user doc.
  const roles = (auth.token?.roles as Record<string, { role?: string }> | undefined) || undefined;
  if (roles?.[tenantId]?.role) return;
  const snap = await db.doc(`users/${auth.uid}`).get();
  const tenantIds = (snap.data()?.tenantIds as Record<string, unknown> | undefined) || {};
  if (tenantIds[tenantId]) return;
  throw new HttpsError('permission-denied', 'Not allowed to manage this job order.');
}

function readArgs(data: unknown): { tenantId: string; jobOrderId: string } {
  const d = (data || {}) as Record<string, unknown>;
  const tenantId = String(d.tenantId || '').trim();
  const jobOrderId = String(d.jobOrderId || '').trim();
  if (!tenantId || !jobOrderId) {
    throw new HttpsError('invalid-argument', 'tenantId and jobOrderId are required');
  }
  return { tenantId, jobOrderId };
}

const RUNTIME = { cors: true as const, memory: '512MiB' as const, timeoutSeconds: 120 };

export const jobOrderSheetEnable = onCall(RUNTIME, async (request) => {
  const { tenantId, jobOrderId } = readArgs(request.data);
  await assertCanManage(request.auth, tenantId);
  if (!isGoogleSheetsConfigured()) {
    throw new HttpsError(
      'failed-precondition',
      'Google Sheets sync isn\'t configured yet (Shared Drive id missing). See GOOGLE_SHEETS_SETUP.md.',
    );
  }
  try {
    const res = await syncJobOrderToSheet(tenantId, jobOrderId);
    return { ok: true as const, ...res };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error('[jobOrderSheetEnable] failed', { tenantId, jobOrderId, error: msg });
    throw new HttpsError('internal', `Could not create/sync the sheet: ${msg.slice(0, 300)}`);
  }
});

export const jobOrderSheetSyncNow = onCall(RUNTIME, async (request) => {
  const { tenantId, jobOrderId } = readArgs(request.data);
  await assertCanManage(request.auth, tenantId);
  try {
    const res = await syncJobOrderToSheet(tenantId, jobOrderId);
    return { ok: true as const, ...res };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error('[jobOrderSheetSyncNow] failed', { tenantId, jobOrderId, error: msg });
    throw new HttpsError('internal', `Sync failed: ${msg.slice(0, 300)}`);
  }
});

export const jobOrderSheetPullFromSheet = onCall(RUNTIME, async (request) => {
  const { tenantId, jobOrderId } = readArgs(request.data);
  await assertCanManage(request.auth, tenantId);
  try {
    // Place matched rows, then re-sync so they migrate into the HRX roster and
    // unmatched rows get flagged "Not in HRX".
    const pull = await pullSheetAdditionsToHrx(tenantId, jobOrderId, request.auth!.uid!);
    const sync = await syncJobOrderToSheet(tenantId, jobOrderId);
    return { ok: true as const, ...pull, ...sync };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error('[jobOrderSheetPullFromSheet] failed', { tenantId, jobOrderId, error: msg });
    throw new HttpsError('internal', `Pull from sheet failed: ${msg.slice(0, 300)}`);
  }
});

export const jobOrderSheetDisable = onCall(RUNTIME, async (request) => {
  const { tenantId, jobOrderId } = readArgs(request.data);
  await assertCanManage(request.auth, tenantId);
  // Flip the flag off but keep the spreadsheet id/url so re-enabling reuses
  // the same sheet (and we don't orphan the Drive file).
  await db.doc(`tenants/${tenantId}/job_orders/${jobOrderId}`).set(
    { googleSheetSync: { enabled: false } },
    { merge: true },
  );
  return { ok: true as const };
});
