/**
 * revertTimesheetEntriesToDraft — flip one or more `approved`
 * TimesheetEntryV2 rows back to `draft`.
 *
 * Why: recruiters approve in bulk via the totals-header "Approve N"
 * button, then notice rows with 0 hours (no-show, cancelled, etc.) that
 * shouldn't ship to Everee. They need a one-click way to pull a row
 * back out of the approved queue.
 *
 * Mirror of approveTimesheetEntriesCallable but in reverse:
 *
 *   - Only `approved` → `draft` allowed. `sent_to_everee` / `paid` are
 *     terminal money-in-flight states; recovering from those is the
 *     adjustment path, not a status flip.
 *   - `submitted` / `draft` / `error` are skipped (`wrong_status`) —
 *     the recruiter clicking on a pill that isn't approved means
 *     they're trying to flip something that isn't there.
 *   - Clears `approvedBy` / `approvedAt`. Stamps `revertedBy` /
 *     `revertedAt` so we have an audit trail for "why did this row
 *     go back to draft?"
 *
 * Permission gate: sec ≥ 5 on the active tenant (or HRX) — same gate
 * as the approve callable. Reuses the same Firestore-doc fallback so
 * users whose JWT claim hasn't synced still pass.
 *
 * Idempotency: calling twice on an already-draft entry is safe — the
 * second call lists it under `skipped` with `reason: 'wrong_status'`.
 */

import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';

const db = () => admin.firestore();

const MAX_ENTRIES_PER_CALL = 200;

type Skipped = {
  entryId: string;
  reason: 'not_found' | 'wrong_tenant' | 'wrong_status';
  currentStatus?: string;
};

export interface RevertTimesheetEntriesToDraftInput {
  tenantId: string;
  entryIds: string[];
}

export interface RevertTimesheetEntriesToDraftResult {
  ok: true;
  /** Number of entries newly transitioned approved → draft. */
  reverted: number;
  /** Per-entry skip reasons. */
  skipped: Skipped[];
}

function normalize(raw: unknown): RevertTimesheetEntriesToDraftInput {
  if (!raw || typeof raw !== 'object') {
    throw new HttpsError('invalid-argument', 'Input must be an object.');
  }
  const data = raw as Record<string, unknown>;
  const tenantId = typeof data.tenantId === 'string' ? data.tenantId.trim() : '';
  if (!tenantId) {
    throw new HttpsError('invalid-argument', 'tenantId required.');
  }
  if (!Array.isArray(data.entryIds)) {
    throw new HttpsError('invalid-argument', 'entryIds must be an array.');
  }
  const entryIds = (data.entryIds as unknown[])
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .map((v) => v.trim());
  if (entryIds.length === 0) {
    throw new HttpsError('invalid-argument', 'entryIds must be non-empty.');
  }
  if (entryIds.length > MAX_ENTRIES_PER_CALL) {
    throw new HttpsError(
      'invalid-argument',
      `Max ${MAX_ENTRIES_PER_CALL} entryIds per call (got ${entryIds.length}).`,
    );
  }
  return { tenantId, entryIds };
}

/**
 * Same permission gate as the approve callable — sec ≥ 5 on tenant or
 * HRX. Approve and revert are symmetric operations; anyone allowed to
 * approve should be allowed to undo their own (or their team's) approval.
 */
async function assertTimesheetEditor(
  actorUid: string,
  token: Record<string, unknown>,
  tenantId: string,
): Promise<void> {
  if (token.hrx === true || token.role === 'HRX') return;
  const tenantClaims = token.tenants as Record<string, unknown> | undefined;
  const claim = tenantClaims?.[tenantId] as Record<string, unknown> | undefined;
  const claimLevel = Number.parseInt(String(claim?.securityLevel ?? '0').trim(), 10);
  if (Number.isFinite(claimLevel) && claimLevel >= 5) return;
  const userDoc = await db().doc(`users/${actorUid}`).get();
  const ud = (userDoc.data() ?? {}) as Record<string, unknown>;
  const top = Number.parseInt(String(ud.securityLevel ?? '0').trim(), 10);
  if (Number.isFinite(top) && top >= 5) return;
  const perTenant = ud.tenants as Record<string, unknown> | undefined;
  const tenantEntry = perTenant?.[tenantId] as Record<string, unknown> | undefined;
  const perTenantLevel = Number.parseInt(
    String(tenantEntry?.securityLevel ?? '0').trim(),
    10,
  );
  if (Number.isFinite(perTenantLevel) && perTenantLevel >= 5) return;
  throw new HttpsError('permission-denied', 'Recruiter access required.');
}

export const revertTimesheetEntriesToDraftCallable = onCall(
  { cors: true, timeoutSeconds: 30 },
  async (request): Promise<RevertTimesheetEntriesToDraftResult> => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Authentication required.');
    }
    const actorUid = request.auth.uid;
    const input = normalize(request.data);

    await assertTimesheetEditor(
      actorUid,
      request.auth.token as Record<string, unknown>,
      input.tenantId,
    );

    const refs = input.entryIds.map((id) =>
      db().doc(`tenants/${input.tenantId}/timesheet_entries/${id}`),
    );
    const snaps = await db().getAll(...refs);

    const skipped: Skipped[] = [];
    const toRevert: FirebaseFirestore.DocumentReference[] = [];

    for (let i = 0; i < snaps.length; i++) {
      const snap = snaps[i];
      const entryId = input.entryIds[i];
      if (!snap.exists) {
        skipped.push({ entryId, reason: 'not_found' });
        continue;
      }
      const data = snap.data() ?? {};
      if (data.tenantId !== input.tenantId) {
        skipped.push({ entryId, reason: 'wrong_tenant' });
        continue;
      }
      const status = typeof data.status === 'string' ? data.status : '';
      // ONLY `approved` can be reverted — terminal/in-flight states need
      // the adjustment path. Pre-approve states (draft/submitted/error)
      // have nothing to revert.
      if (status !== 'approved') {
        skipped.push({ entryId, reason: 'wrong_status', currentStatus: status });
        continue;
      }
      toRevert.push(refs[i]);
    }

    if (toRevert.length === 0) {
      return { ok: true, reverted: 0, skipped };
    }

    const batch = db().batch();
    const now = admin.firestore.FieldValue.serverTimestamp();
    for (const ref of toRevert) {
      batch.update(ref, {
        status: 'draft',
        // Clear approval audit fields — the next approve will repopulate
        // these. Using FieldValue.delete() so the audit-trail trigger
        // (loggingTriggerMap) sees the absence rather than a stale name.
        approvedBy: admin.firestore.FieldValue.delete(),
        approvedAt: admin.firestore.FieldValue.delete(),
        revertedBy: actorUid,
        revertedAt: now,
        updatedAt: now,
        updatedBy: actorUid,
      });
    }
    await batch.commit();

    logger.info('[revertTimesheetEntriesToDraft] reverted', {
      tenantId: input.tenantId,
      actorUid,
      revertedCount: toRevert.length,
      skippedCount: skipped.length,
    });

    return { ok: true, reverted: toRevert.length, skipped };
  },
);
