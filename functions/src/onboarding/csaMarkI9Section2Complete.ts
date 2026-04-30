/**
 * **E.7** — `csaMarkI9Section2Complete` callable.
 *
 * CSA stamps the employer-portion (Section 2) attestation on
 * `tenants/{tid}/entity_employments/{eid}` after physically inspecting
 * the worker's identity + work-authorization documents. Federal law
 * requires this within 3 business days of hire — Everee cannot do it
 * for us, so it stays HRX-owned per the E.3 addendum split.
 *
 * Side effects (via existing trigger
 * `onEntityEmploymentI9Section2WriteUpdateReadiness`):
 *   - flips the `i9_section_2` employee-readiness item to `complete_pass`
 *   - removes the row from the unified CSA action queue (E.7) on next
 *     listener tick
 *
 * Inputs:
 *   - `tenantId`, `entityId`, `userId` — locator (composite filter on
 *     `entity_employments` since doc id format isn't enforced).
 *   - `documentTypes: string[]` — at minimum one List A doc OR one each
 *     of List B + List C. Caller (UI) is responsible for validating the
 *     legal combination; the server records what was inspected.
 *   - `notes?: string` — optional free-form CSA note.
 *
 * Permissions:
 *   - `canManageOnboarding(auth, tenantId, uid)` — same gate used by
 *     every E-Verify callable. CSA / recruiter / manager / admin / HRX.
 *
 * Idempotency:
 *   - Calling twice for the same (worker × entity) returns
 *     `{ ok: true, alreadyComplete: true }` on the second call. The
 *     stored timestamp / by / docs / notes from the FIRST call are
 *     preserved — re-attestation requires a separate (future) "amend"
 *     callable so the audit trail isn't silently rewritten.
 *
 * Refuses (with explicit errors):
 *   - Missing required fields → `invalid-argument`
 *   - Empty `documentTypes` → `invalid-argument`
 *   - No matching entity_employment → `not-found`
 *   - Non-W-2 worker → `failed-precondition` (1099 contractors don't
 *     sign I-9; CSAs shouldn't be mass-stamping these by accident)
 *   - Non-CSA caller → `permission-denied`
 *
 * @see ../readiness/entityEmploymentI9Section2Plan.ts (cascading trigger)
 * @see employmentV2Types.EntityEmploymentRecord — `i9Section2*` fields
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { canManageOnboarding } from './workerOnboardingPipeline';

export interface CsaMarkI9Section2CompleteInput {
  tenantId: string;
  entityId: string;
  userId: string;
  documentTypes: string[];
  notes?: string | null;
}

export interface CsaMarkI9Section2CompleteResult {
  ok: true;
  /** True when the second+ call fires — the existing stamp is preserved. */
  alreadyComplete: boolean;
  /** Doc id of the updated entity_employment (useful for clients to refresh). */
  entityEmploymentId: string;
}

function pickString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function pickStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => (typeof v === 'string' ? v.trim() : ''))
    .filter((v) => v.length > 0);
}

function normalizeWorkerType(raw: unknown): 'w2' | '1099' | null {
  if (typeof raw !== 'string') return null;
  const v = raw.trim().toLowerCase().replace(/[-_\s]/g, '');
  if (v === 'w2' || v === 'employee') return 'w2';
  if (v === '1099' || v === 'contractor') return '1099';
  return null;
}

/**
 * Pure-ish core. Exposed for tests via `__test__csaMarkI9Section2Complete`.
 * The onCall wrapper below handles auth-presence gating + delegates the
 * permission check via `canManageOnboarding`. Tests inject auth + call
 * the helper directly with stubbed Firestore handles, mirroring the
 * `__test__mirrorEvereeOnboardingCompleteToEmployments` pattern.
 */
async function csaMarkI9Section2CompleteCore(
  rawData: unknown,
  auth: { uid: string; token?: unknown } | null,
): Promise<CsaMarkI9Section2CompleteResult> {
  if (!auth?.uid) {
    throw new HttpsError('unauthenticated', 'Authentication required.');
  }

  const data = (rawData || {}) as Partial<CsaMarkI9Section2CompleteInput>;
  const tenantId = pickString(data.tenantId);
  const entityId = pickString(data.entityId);
  const userId = pickString(data.userId);
  const documentTypes = pickStringArray(data.documentTypes);
  const notes =
    typeof data.notes === 'string' && data.notes.trim().length > 0
      ? data.notes.trim()
      : null;

  if (!tenantId || !entityId || !userId) {
    throw new HttpsError(
      'invalid-argument',
      'tenantId, entityId, and userId are required.',
    );
  }
  if (documentTypes.length === 0) {
    throw new HttpsError(
      'invalid-argument',
      'At least one document type must be selected.',
    );
  }

  const callerUid = auth.uid;
  if (!(await canManageOnboarding(auth as never, tenantId, callerUid))) {
    throw new HttpsError(
      'permission-denied',
      'You do not have permission to attest I-9 Section 2 for this tenant.',
    );
  }

  // Locate the (worker × entity) row. We use a composite filter rather
  // than a deterministic doc id because the entity_employments doc id
  // format isn't strictly enforced — different writers (org migration,
  // start-on-call, manual seed) have used different patterns.
  const empSnap = await admin
    .firestore()
    .collection(`tenants/${tenantId}/entity_employments`)
    .where('userId', '==', userId)
    .where('entityId', '==', entityId)
    .limit(1)
    .get();

  if (empSnap.empty) {
    throw new HttpsError(
      'not-found',
      `No entity_employment row found for user ${userId} in entity ${entityId}.`,
    );
  }

  const empDoc = empSnap.docs[0];
  const empData = empDoc.data();
  const workerType = normalizeWorkerType(empData?.workerType);
  if (workerType !== 'w2') {
    // 1099 contractors don't sign I-9 — federal compliance reality. The
    // queue should never show these in the I-9 Section 2 band, but defend
    // server-side too so a stale client can't slip a contractor through.
    throw new HttpsError(
      'failed-precondition',
      `I-9 Section 2 is only applicable to W-2 employees. This worker is "${empData?.workerType ?? 'unknown'}".`,
    );
  }

  // Idempotency: if Section 2 is already stamped, don't overwrite the
  // original audit trail. Returning ok with `alreadyComplete: true` lets
  // the client treat the duplicate click as a no-op success rather than
  // bubbling a confusing error.
  if (empData?.i9Section2CompletedAt != null) {
    return {
      ok: true,
      alreadyComplete: true,
      entityEmploymentId: empDoc.id,
    };
  }

  await empDoc.ref.update({
    i9Section2CompletedAt: admin.firestore.FieldValue.serverTimestamp(),
    i9Section2CompletedBy: callerUid,
    i9Section2DocumentTypes: documentTypes,
    i9Section2Notes: notes,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return {
    ok: true,
    alreadyComplete: false,
    entityEmploymentId: empDoc.id,
  };
}

export const csaMarkI9Section2Complete = onCall<CsaMarkI9Section2CompleteInput>(
  async (request) =>
    csaMarkI9Section2CompleteCore(
      request.data,
      request.auth ? { uid: request.auth.uid, token: request.auth.token } : null,
    ),
);

/** @internal — exported solely for unit tests. Do not import in production code. */
export const __test__csaMarkI9Section2CompleteCore = csaMarkI9Section2CompleteCore;
