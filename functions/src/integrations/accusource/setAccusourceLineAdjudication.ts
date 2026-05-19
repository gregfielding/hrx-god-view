/**
 * Callable: set / clear a manual adjudication verdict on a single AccuSource
 * service line inside `backgroundChecks/{id}.providerServiceOrderStatus.{serviceKey}`.
 *
 *   - Admin-gated via `ensureAccusourceAdmin` (role admin/super_admin/manager or
 *     security level >= 5 for the active tenant — matches the rest of AccuSource).
 *   - Writes the override on the nested line and appends an immutable history entry.
 *   - Pass `verdict: null` to clear the override (revert to system autoVerdict).
 *
 * The classifier still runs on every webhook merge; this callable does NOT touch
 * `autoVerdict` — recruiter overrides live alongside the auto verdict and win at read time.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { ensureAccusourceAdmin } from './accusourceAdminGate';
import { accusourceLog } from './accusourceLogger';
import type {
  AccusourceAdjudicationHistoryEntry,
  AccusourceLineAdjudication,
  AccusourceManualVerdict,
} from './accusourceAdjudication';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

const ALLOWED_MANUAL_VERDICTS: ReadonlyArray<NonNullable<AccusourceManualVerdict>> = [
  'PASSED',
  'FAILED',
  'NEEDS_REVIEW',
];

function normalizeVerdict(value: unknown): AccusourceManualVerdict {
  if (value === null) return null;
  const s = String(value ?? '').trim().toUpperCase();
  if (!s) return null;
  if (ALLOWED_MANUAL_VERDICTS.includes(s as NonNullable<AccusourceManualVerdict>)) {
    return s as NonNullable<AccusourceManualVerdict>;
  }
  return undefined as unknown as AccusourceManualVerdict;
}

export interface SetAccusourceLineAdjudicationInput {
  backgroundCheckId: string;
  serviceKey: string;
  /** null = clear override (revert to auto verdict). */
  verdict: AccusourceManualVerdict;
  reason?: string | null;
}

export const setAccusourceLineAdjudication = onCall(
  { cors: true },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Authentication required.');
    }
    await ensureAccusourceAdmin(request.auth.uid);

    const data = (request.data || {}) as SetAccusourceLineAdjudicationInput;
    const backgroundCheckId = String(data.backgroundCheckId || '').trim();
    const serviceKey = String(data.serviceKey || '').trim();
    const reason =
      typeof data.reason === 'string' && data.reason.trim() !== '' ? data.reason.trim() : null;

    if (!backgroundCheckId) {
      throw new HttpsError('invalid-argument', 'backgroundCheckId is required.');
    }
    if (!serviceKey) {
      throw new HttpsError('invalid-argument', 'serviceKey is required.');
    }

    const nextVerdict = normalizeVerdict(data.verdict);
    if (nextVerdict === (undefined as unknown as AccusourceManualVerdict)) {
      throw new HttpsError(
        'invalid-argument',
        `verdict must be one of ${ALLOWED_MANUAL_VERDICTS.join(', ')} or null (to clear).`,
      );
    }

    // Resolve the backgroundCheck doc. In this codebase `backgroundChecks` is
    // a *top-level* collection (see createBackgroundCheckInternal +
    // accusourceWebhooks), so the document id alone is enough. An earlier
    // version of this function tried a `collectionGroup('backgroundChecks')`
    // + `where('__name__', '==', backgroundCheckId)` fallback, but
    // Firestore validates that filter synchronously and requires a *full
    // document path* (even number of segments) — passing a single id throws
    // before `.get()` is awaited, surfacing as INTERNAL 500 in the client.
    // The catch was a no-op for that synchronous throw. We do the
    // top-level lookup directly; if a future migration nests
    // `backgroundChecks` under a parent we'll add a proper
    // `parentTenantId`/`parentEntityId` hint to the callable input instead.
    const topLevel = await db.collection('backgroundChecks').doc(backgroundCheckId).get();
    const snap: admin.firestore.DocumentSnapshot | null = topLevel.exists ? topLevel : null;
    if (!snap || !snap.exists) {
      throw new HttpsError('not-found', 'Background check not found.');
    }

    const docRef = snap.ref;
    const root = snap.data() as Record<string, unknown>;
    const lines =
      (root.providerServiceOrderStatus as Record<string, Record<string, unknown>> | undefined) ?? {};
    const line = lines[serviceKey];
    if (!line || typeof line !== 'object') {
      throw new HttpsError(
        'not-found',
        `Service line ${serviceKey} not present on this background check.`,
      );
    }

    const existing = (line.adjudication as AccusourceLineAdjudication | undefined) ?? null;
    const prev = existing?.verdict ?? null;

    // Idempotency: same verdict + same reason → no-op, no history noise.
    if (prev === nextVerdict && reason === (existing?.overrideReason ?? null)) {
      return {
        ok: true,
        unchanged: true,
        backgroundCheckId,
        serviceKey,
        verdict: nextVerdict,
      };
    }

    const now = admin.firestore.Timestamp.now();
    const historyEntry: AccusourceAdjudicationHistoryEntry =
      nextVerdict === null
        ? {
            at: now,
            kind: 'manual_override_cleared',
            verdict: existing?.autoVerdict ?? 'PENDING',
            fromVerdict: prev,
            by: request.auth.uid,
            reason,
          }
        : {
            at: now,
            kind: 'manual_override_set',
            verdict: nextVerdict,
            fromVerdict: prev,
            by: request.auth.uid,
            reason,
          };

    const history = Array.isArray(existing?.history) ? [...(existing!.history ?? [])] : [];
    history.push(historyEntry);

    const nextAdjudication: AccusourceLineAdjudication = {
      autoVerdict: existing?.autoVerdict ?? 'PENDING',
      autoVerdictReason: existing?.autoVerdictReason ?? '',
      autoVerdictAt: existing?.autoVerdictAt ?? now,
      verdict: nextVerdict,
      overriddenBy: nextVerdict === null ? null : request.auth.uid,
      overriddenAt: nextVerdict === null ? null : now,
      overrideReason: nextVerdict === null ? null : reason,
      history,
    };

    // Build a fresh nested update so Firestore doesn't treat dots as field paths.
    const updatedLine = { ...line, adjudication: nextAdjudication };
    const updatedLines = { ...lines, [serviceKey]: updatedLine };

    await docRef.set(
      {
        providerServiceOrderStatus: updatedLines,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    accusourceLog(
      'info',
      'adjudication',
      nextVerdict === null
        ? 'Cleared AccuSource line adjudication override'
        : 'Set AccuSource line adjudication override',
      {
        backgroundCheckId,
        serviceKey,
        verdict: nextVerdict,
        priorVerdict: prev,
        by: request.auth.uid,
        reason,
      },
    );

    return {
      ok: true,
      unchanged: false,
      backgroundCheckId,
      serviceKey,
      verdict: nextVerdict,
      autoVerdict: nextAdjudication.autoVerdict,
    };
  },
);
