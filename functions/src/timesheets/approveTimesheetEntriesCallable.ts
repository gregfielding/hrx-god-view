/**
 * approveTimesheetEntries — flip one or more TimesheetEntryV2 rows
 * from `draft` (or `submitted`) → `approved`.
 *
 * Why server-side: the Firestore rule's `affectedKeys().hasOnly([...])`
 * allowlist on `timesheet_entries` deliberately excludes the `status`
 * field — clients can edit actuals/breaks/tips/etc. via the inline
 * grid, but state transitions go through a callable so we can stamp
 * the audit fields (`approvedBy` / `approvedAt`) atomically and gate
 * on permission server-side.
 *
 * **Contract:**
 *   - Input: `{ tenantId, entryIds: string[] }`. Cap of 200 ids per
 *     call to bound the Firestore batch.
 *   - Output: `{ ok: true; approved: number; skipped: Array<{entryId, reason}> }`.
 *     Skip reasons:
 *       - `not_found`        — doc id doesn't exist
 *       - `wrong_tenant`     — doc's tenantId field doesn't match input
 *       - `wrong_status`     — current status is `sent_to_everee` /
 *                              `paid` / `error` (terminal) or already
 *                              `approved` (idempotent skip, not an error)
 *
 * **Permission gate**: sec ≥ 5 on the active tenant (or HRX). Matches
 * the `/timesheets` route gate exactly.
 *
 * **Idempotency**: calling twice on the same already-approved entry is
 * safe — the second call lists the entry under `skipped` with
 * `reason: 'wrong_status'` (already approved). Clients can fire this
 * without coordinating.
 *
 * **Batch atomicity**: all writes for one invocation go through a
 * single Firestore batch. If any individual write would fail the
 * batch fails — but skipped entries are filtered BEFORE the batch
 * write, so partial failures don't happen in practice.
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

export interface ApproveTimesheetEntriesInput {
  tenantId: string;
  entryIds: string[];
}

export interface ApproveTimesheetEntriesResult {
  ok: true;
  /** Number of entries newly transitioned to `approved`. */
  approved: number;
  /** Per-entry skip reasons. */
  skipped: Skipped[];
}

function normalize(raw: unknown): ApproveTimesheetEntriesInput {
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
 * Permission gate mirrors `createDraftTimesheetEntryCallable.assertTimesheetEditor`:
 * sec ≥ 5 on the active tenant, or HRX claim. Caller has already been
 * authenticated by the outer onCall harness.
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
  // Firestore fallback (per-tenant role doc) so users whose claim hasn't
  // synced still get through — same fallback the gridResolver respects.
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

/**
 * Statuses that can be flipped → 'approved' via this callable.
 *
 *   - draft / submitted — fresh entries that have never reached Everee.
 *   - error             — Everee or the pre-flight stamped the entry
 *                         after a failed submit. Once the recruiter
 *                         fixes the underlying data (WC code, worker
 *                         linkage, etc.), clicking the status pill
 *                         re-approves so the next batch can pick it up.
 *
 * `sent_to_everee` / `paid` deliberately excluded — those represent
 * money already in flight; recovering from those requires the
 * adjustment path, not a status flip.
 */
const APPROVABLE_STATUSES = new Set(['draft', 'submitted', 'error']);

export const approveTimesheetEntriesCallable = onCall(
  { cors: true, timeoutSeconds: 30 },
  async (request): Promise<ApproveTimesheetEntriesResult> => {
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

    // Read all referenced docs in parallel. The cap of 200 keeps this
    // bounded — even 200 sequential reads would be ~2s; parallel is ~200ms.
    const refs = input.entryIds.map((id) =>
      db().doc(`tenants/${input.tenantId}/timesheet_entries/${id}`),
    );
    const snaps = await db().getAll(...refs);

    const skipped: Skipped[] = [];
    const toApprove: FirebaseFirestore.DocumentReference[] = [];

    for (let i = 0; i < snaps.length; i++) {
      const snap = snaps[i];
      const entryId = input.entryIds[i];
      if (!snap.exists) {
        skipped.push({ entryId, reason: 'not_found' });
        continue;
      }
      const data = snap.data() ?? {};
      // Defense in depth — the path already scopes by tenant, but
      // if a malicious doc id pointed cross-tenant we'd want to reject.
      if (data.tenantId !== input.tenantId) {
        skipped.push({ entryId, reason: 'wrong_tenant' });
        continue;
      }
      const status = typeof data.status === 'string' ? data.status : '';
      if (!APPROVABLE_STATUSES.has(status)) {
        skipped.push({ entryId, reason: 'wrong_status', currentStatus: status });
        continue;
      }
      toApprove.push(refs[i]);
    }

    if (toApprove.length === 0) {
      return { ok: true, approved: 0, skipped };
    }

    // Single batch — atomic across the approval set. The recompute
    // trigger doesn't fire on status changes (status isn't in
    // COMPUTE_INPUT_FIELDS), so we don't have to worry about a
    // post-write cascade.
    const batch = db().batch();
    const now = admin.firestore.FieldValue.serverTimestamp();
    for (const ref of toApprove) {
      batch.update(ref, {
        status: 'approved',
        approvedBy: actorUid,
        approvedAt: now,
        updatedAt: now,
        updatedBy: actorUid,
      });
    }
    await batch.commit();

    logger.info('[approveTimesheetEntries] approved', {
      tenantId: input.tenantId,
      actorUid,
      approvedCount: toApprove.length,
      skippedCount: skipped.length,
    });

    return { ok: true, approved: toApprove.length, skipped };
  },
);
