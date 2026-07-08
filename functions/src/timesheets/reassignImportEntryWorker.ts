/**
 * reassignImportEntryWorker — re-point a CSV-import timesheet entry to a
 * different HRX worker, from the Timesheet Grid's worker-edit pencil.
 *
 * The auto-match (or a prior manual pick) bound the row to the wrong person —
 * classically a same-name collision (two "Marquis Dennis", only one onboarded
 * to Everee). The recruiter searches HRX, picks the right worker, and this
 * callable rewrites the entry:
 *
 *   - The synthetic doc id encodes the worker (`import__{customer}__{userId}__
 *     {date}`), so changing the worker MOVES the doc. We write the new id and
 *     delete the old one in a single batch (no orphan, no duplicate).
 *   - Everee linkage + block reason are recomputed for the new worker via the
 *     shared `resolveImportWorkerLinkage` (same logic + message as the match
 *     callable) — this is what clears the "needs onboarding" block when the
 *     newly-picked worker IS linked.
 *   - Pay / WC / worksite follow the WORK, not the worker, so they carry over
 *     from the existing entry untouched. matchStatus is re-derived.
 *
 * Refuses to touch a row already live in Everee (submitted/paid) — void it
 * first. Same sec 5–7 (or HRX) gate as saveImportTimesheetRows.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

import { getEvereeConfigForEntity } from '../integrations/everee/evereeConfig';
import { importEntryDocId } from './importEntryKeys';
import { resolveImportWorkerLinkage } from './importWorkerLinkage';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

type ImportMatchStatus = 'ready' | 'needs_rate' | 'needs_wc' | 'blocked';

async function assertTimesheetEditor(
  uid: string,
  token: Record<string, unknown> | undefined,
  tenantId: string,
): Promise<void> {
  if (token?.hrx === true) return;
  const userSnap = await db.collection('users').doc(uid).get();
  const data = (userSnap.data() || {}) as Record<string, any>;
  const nested = data.tenantIds?.[tenantId]?.securityLevel;
  const level = Number.parseInt(String(nested ?? data.securityLevel ?? '0'), 10) || 0;
  if (level >= 5 && level <= 7) return;
  throw new HttpsError('permission-denied', 'Editing timesheets requires tenant security level 5–7.');
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export const reassignImportEntryWorker = onCall(
  { cors: true, memory: '512MiB', timeoutSeconds: 60 },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Authentication required');
    }
    const { tenantId, hiringEntityId, entryId, newUserId } = (request.data || {}) as {
      tenantId?: string;
      hiringEntityId?: string;
      entryId?: string;
      newUserId?: string;
    };
    if (!tenantId || !hiringEntityId || !entryId || !newUserId) {
      throw new HttpsError(
        'invalid-argument',
        'tenantId, hiringEntityId, entryId, and newUserId are required',
      );
    }
    await assertTimesheetEditor(request.auth.uid, request.auth.token as Record<string, unknown>, tenantId);
    const uid = request.auth.uid;

    const entryRef = db.doc(`tenants/${tenantId}/timesheet_entries/${entryId}`);
    const entrySnap = await entryRef.get();
    if (!entrySnap.exists) throw new HttpsError('not-found', `Entry ${entryId} not found`);
    const entry = entrySnap.data() as Record<string, any>;
    if (entry.source !== 'csv_import') {
      throw new HttpsError('failed-precondition', 'Only CSV-import rows can be reassigned here.');
    }
    const imp = (entry.import || {}) as Record<string, any>;
    const liveStatus =
      entry.status === 'sent_to_everee' ||
      entry.status === 'paid' ||
      imp.matchStatus === 'submitted' ||
      imp.matchStatus === 'paid';
    if (liveStatus) {
      throw new HttpsError(
        'failed-precondition',
        'This row is live in Everee — void it first, then reassign the worker.',
      );
    }

    const workDate = String(entry.workDate || '').trim();
    if (!workDate) throw new HttpsError('failed-precondition', 'Entry is missing a work date.');
    const customer = String(imp.customer || 'import').trim();

    // New worker identity.
    const userSnap = await db.collection('users').doc(newUserId).get();
    if (!userSnap.exists) throw new HttpsError('not-found', 'Selected HRX worker no longer exists.');
    const u = userSnap.data() as Record<string, any>;
    const displayName =
      [u.firstName, u.lastName].filter(Boolean).join(' ').trim() ||
      String(u.displayName || '').trim() ||
      'This worker';

    // Entity context — Everee config (for linkage) + workerType (drives whether
    // WC is required for "ready") + a human label for the block reason.
    const cfg = await getEvereeConfigForEntity(tenantId, hiringEntityId);
    const evereeTenantId = cfg?.evereeTenantId ?? null;
    const entitySnap = await db.doc(`tenants/${tenantId}/entities/${hiringEntityId}`).get();
    const entityData = (entitySnap.data() || {}) as Record<string, any>;
    const workerType = String(entityData.workerType || '').trim();
    const is1099 = workerType === '1099';
    const entityLabel =
      String(entityData.name || entityData.displayName || entityData.legalName || '').trim() ||
      'this entity';

    const linkage = await resolveImportWorkerLinkage(db, {
      tenantId,
      hiringEntityId,
      entityLabel,
      evereeTenantId,
      userId: newUserId,
      displayName,
    });

    // Carry the WORK context over unchanged — only identity + linkage change.
    const hours = num(entry.actualHoursOverride ?? entry.totalRegularHours);
    const payRate = num(entry.payRate);
    const wcCode =
      (typeof entry.workersCompCode === 'string' && entry.workersCompCode.trim()) ||
      (typeof imp.workersCompCode === 'string' && imp.workersCompCode.trim()) ||
      '';

    const matchStatus: ImportMatchStatus = linkage.blockReason
      ? 'blocked'
      : !(payRate > 0)
        ? 'needs_rate'
        : !is1099 && !wcCode
          ? 'needs_wc'
          : 'ready';

    const newDocId = importEntryDocId({ customer, userId: newUserId, workDate });
    const newRef = db.doc(`tenants/${tenantId}/timesheet_entries/${newDocId}`);

    // Guard a collision: the picked worker may already have a row for this
    // day. A live one must not be clobbered; a draft one sums hours (same
    // convention as saveImportTimesheetRows' duplicate handling).
    let mergedHours = hours;
    let createdAt = entry.createdAt ?? admin.firestore.FieldValue.serverTimestamp();
    let createdBy = entry.createdBy ?? uid;
    if (newDocId !== entryId) {
      const targetSnap = await newRef.get();
      if (targetSnap.exists) {
        const t = targetSnap.data() as Record<string, any>;
        const tLive =
          t.status === 'sent_to_everee' ||
          t.status === 'paid' ||
          (t.import || {}).matchStatus === 'submitted' ||
          (t.import || {}).matchStatus === 'paid';
        if (tLive) {
          throw new HttpsError(
            'failed-precondition',
            `${displayName} already has a submitted row for ${workDate}. Reassign to a different worker or void the existing row first.`,
          );
        }
        mergedHours = hours + num(t.actualHoursOverride ?? t.totalRegularHours);
        createdAt = t.createdAt ?? createdAt;
        createdBy = t.createdBy ?? createdBy;
      }
    }

    const importSidecar: Record<string, unknown> = {
      ...imp,
      customer,
      matchStatus,
      forcedUserId: newUserId,
      matchedManual: true,
      matchedByName: false,
      // The grid shows this over csvWorkerName — without it a reassign is
      // invisible (the row keeps rendering the CSV's name for the OLD
      // person and the swap "doesn't seem to work").
      matchedWorkerName: displayName,
      ambiguous: false,
      evereeWorkerId: linkage.evereeWorkerId,
      evereeLinked: linkage.evereeLinked,
      blockReason: linkage.blockReason,
    };

    const newDoc: Record<string, unknown> = {
      ...entry,
      id: newDocId,
      tenantId,
      source: 'csv_import',
      hiringEntityId,
      workerId: newUserId,
      workDate,
      actualHoursOverride: mergedHours,
      totalRegularHours: mergedHours,
      status: 'draft',
      sentToEvereeAt: admin.firestore.FieldValue.delete(),
      everee: admin.firestore.FieldValue.delete(),
      import: importSidecar,
      createdAt,
      createdBy,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: uid,
    };

    const batch = db.batch();
    batch.set(newRef, newDoc, { merge: true });
    if (newDocId !== entryId) batch.delete(entryRef);
    await batch.commit();

    return {
      ok: true,
      oldEntryId: entryId,
      newEntryId: newDocId,
      matchStatus,
      evereeLinked: linkage.evereeLinked,
      blockReason: linkage.blockReason,
      displayName,
    };
  },
);
