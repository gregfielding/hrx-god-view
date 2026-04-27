/**
 * **R.11** — Callable: `acknowledgeBackgroundCheckPackageDriftCallable`.
 *
 * CSA action — "Keep current check". Marks a stamped `packageDrift` as
 * acknowledged and clears the denormalized `hasPendingPackageDrift` flag
 * so the matrix banner / drawer warning surfaces stop showing.
 *
 * Idempotent: re-acknowledging an already-acknowledged drift is a
 * no-op (returns `alreadyAcknowledged: true`). Safe to call from a
 * double-clicking CSA's UI.
 *
 * Permission: same band as the rest of AccuSource case management
 * (`ensureAccusourceAdmin` — admin / super_admin / manager OR L≥5).
 *
 * Audit: stamps `acknowledgedAt` (server timestamp), `acknowledgedBy`
 * (caller uid), and optional `acknowledgmentNote`. Prior fields in
 * `packageDrift` (jobOrderId, detectedAt, driftKind, expectedServiceIds)
 * are preserved for the audit trail. Also written to `accusourceLog` for
 * structured log search.
 *
 * **Reorder action ("reorder with new package") is intentionally NOT
 * implemented in V1.** Per L4.R11, that path requires AccuSource cancel-order
 * API integration plus screening-automation extension (cancel→re-order
 * audit pair). Deferred to R.11.1; the R.6 drawer surfaces a disabled
 * button + tooltip pointing here.
 *
 * @see functions/src/readiness/onJobOrderWriteDetectScreeningPackageDrift.ts
 * @see docs/READINESS_R11_HANDOFF.md L4.R11
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

import { ensureAccusourceAdmin } from './accusourceAdminGate';
import { accusourceLog } from './accusourceLogger';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

const MAX_NOTE_LENGTH = 2000;

interface AcknowledgePayload {
  /** BG check doc id (top-level `backgroundChecks/{id}`). Required. */
  checkId?: string;
  /** Optional CSA note; trimmed and capped at 2,000 chars. */
  note?: string;
}

interface AcknowledgeResult {
  ok: true;
  checkId: string;
  /** True iff the call was a no-op because drift was already acknowledged. */
  alreadyAcknowledged: boolean;
  /** True iff the call was a no-op because the doc has no pending drift to acknowledge. */
  noDriftToAcknowledge: boolean;
}

export const acknowledgeBackgroundCheckPackageDriftCallable = onCall(
  { cors: true, memory: '256MiB', timeoutSeconds: 30 },
  async (request): Promise<AcknowledgeResult> => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Authentication required.');
    }
    const uid = request.auth.uid;
    const data = (request.data || {}) as AcknowledgePayload;

    const checkId = typeof data.checkId === 'string' ? data.checkId.trim() : '';
    if (!checkId) {
      throw new HttpsError('invalid-argument', 'checkId is required.');
    }

    const ref = db.collection('backgroundChecks').doc(checkId);
    const snap = await ref.get();
    if (!snap.exists) {
      throw new HttpsError('not-found', `backgroundChecks/${checkId} not found.`);
    }

    const docData = snap.data() as Record<string, unknown>;
    const tenantId = typeof docData.tenantId === 'string' ? docData.tenantId : null;

    // Permission: same gate as the rest of AccuSource case management.
    // Pass tenantId so per-tenant security level is honored when the
    // admin claim isn't a top-level "admin" role.
    await ensureAccusourceAdmin(uid, tenantId);

    const drift = docData.packageDrift as Record<string, unknown> | undefined;

    if (!drift || typeof drift !== 'object') {
      // No-op: nothing to acknowledge. Don't error — the UI may have
      // raced with a separate trigger that cleared it (or never had drift
      // to begin with).
      return { ok: true, checkId, alreadyAcknowledged: false, noDriftToAcknowledge: true };
    }

    if (drift.acknowledgedAt) {
      // Already acknowledged — no-op. Idempotent for double-click safety.
      return { ok: true, checkId, alreadyAcknowledged: true, noDriftToAcknowledge: false };
    }

    const noteRaw = typeof data.note === 'string' ? data.note.trim() : '';
    const note = noteRaw.length > MAX_NOTE_LENGTH ? noteRaw.slice(0, MAX_NOTE_LENGTH) : noteRaw;

    // Field-by-field update — preserves jobOrderId, detectedAt, driftKind,
    // expectedPackageId/Name/ServiceIds for audit. `dot.path` syntax in
    // an update() call only replaces the addressed leaf fields.
    await ref.update({
      'packageDrift.acknowledgedAt': admin.firestore.FieldValue.serverTimestamp(),
      'packageDrift.acknowledgedBy': uid,
      'packageDrift.acknowledgmentNote': note || null,
      hasPendingPackageDrift: false,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    accusourceLog('info', 'packageDriftAck', 'CSA acknowledged background-check package drift', {
      checkId,
      tenantId,
      actorUid: uid,
      driftKind: drift.driftKind,
      driftJobOrderId: drift.jobOrderId,
      hasNote: note.length > 0,
    });

    return { ok: true, checkId, alreadyAcknowledged: false, noDriftToAcknowledge: false };
  },
);
