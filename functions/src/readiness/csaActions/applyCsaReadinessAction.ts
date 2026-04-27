/**
 * **R.3** — shared apply-action machinery for the three CSA readiness
 * callables. Centralises:
 *   - reading the target item from the right collection
 *   - validating the requirement type isn't AccuSource / E-Verify
 *   - computing the status / resolutionMethod transition
 *   - appending the immutable history entry (parallel to AccuSource's
 *     `adjudication.history[]`)
 *   - the idempotency short-circuit (same status + resolutionMethod +
 *     latest history reason → no-op)
 *   - timestamp stamping (`updatedAt`, `completedAt` on `complete_pass`)
 *
 * Single transaction so a parallel write (e.g. a background reconciler
 * flipping `incomplete` → `in_progress`) can't stomp the CSA action
 * mid-flight.
 *
 * @see functions/src/integrations/accusource/setAccusourceLineAdjudication.ts (parallel pattern)
 * @see docs/READINESS_R3_HANDOFF.md
 */
import { HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';

import {
  CsaReadinessActionInput,
  CsaReadinessActionKind,
  CsaReadinessActionResult,
  CsaReadinessActionsField,
  CsaReadinessHistoryEntry,
  CsaReadinessItemCollection,
  CsaReadinessResolutionMethod,
  isCsaReadinessActionExcludedType,
} from './csaActionTypes';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

interface ResolvedTransition {
  kind: CsaReadinessActionKind;
  toStatus: 'complete_pass' | 'complete_fail';
  resolutionMethod: CsaReadinessResolutionMethod;
  /** When `true`, callable contract requires a non-empty note. */
  noteRequired: boolean;
}

const TRANSITIONS: Record<CsaReadinessActionKind, ResolvedTransition> = {
  csa_confirm: {
    kind: 'csa_confirm',
    toStatus: 'complete_pass',
    resolutionMethod: 'csa_confirmed',
    noteRequired: false,
  },
  csa_waive: {
    kind: 'csa_waive',
    toStatus: 'complete_pass',
    resolutionMethod: 'csa_waived',
    noteRequired: true,
  },
  csa_mark_failed: {
    kind: 'csa_mark_failed',
    toStatus: 'complete_fail',
    resolutionMethod: 'csa_confirmed',
    noteRequired: true,
  },
};

function collectionPath(tenantId: string, collection: CsaReadinessItemCollection): string {
  return collection === 'assignment'
    ? `tenants/${tenantId}/assignmentReadinessItems`
    : `tenants/${tenantId}/employeeReadinessItems`;
}

function normaliseNote(value: unknown, required: boolean): string | null {
  const s = typeof value === 'string' ? value.trim() : '';
  if (s.length > 0) return s;
  if (required) {
    throw new HttpsError(
      'invalid-argument',
      'A note is required when waiving or marking an item failed.',
    );
  }
  return null;
}

function validateInput(
  input: CsaReadinessActionInput,
  required: boolean,
): {
  tenantId: string;
  itemId: string;
  collection: CsaReadinessItemCollection;
  note: string | null;
} {
  const tenantId = String(input?.tenantId || '').trim();
  const itemId = String(input?.itemId || '').trim();
  const collection =
    input?.collection === 'assignment' || input?.collection === 'employee'
      ? input.collection
      : null;
  if (!tenantId) throw new HttpsError('invalid-argument', 'tenantId is required.');
  if (!itemId) throw new HttpsError('invalid-argument', 'itemId is required.');
  if (!collection) {
    throw new HttpsError(
      'invalid-argument',
      "collection must be 'assignment' or 'employee'.",
    );
  }
  const note = normaliseNote(input?.note, required);
  return { tenantId, itemId, collection, note };
}

/**
 * Apply a CSA action to a single readiness item. Returns `unchanged: true`
 * when the call was a no-op (target state already matches and the latest
 * history entry's reason matches the supplied note).
 */
export async function applyCsaReadinessAction(
  input: CsaReadinessActionInput,
  actorUid: string,
  kind: CsaReadinessActionKind,
): Promise<CsaReadinessActionResult> {
  const transition = TRANSITIONS[kind];
  if (!transition) {
    throw new HttpsError('internal', `Unknown CSA action kind: ${String(kind)}`);
  }

  const { tenantId, itemId, collection, note } = validateInput(input, transition.noteRequired);
  const ref = db.doc(`${collectionPath(tenantId, collection)}/${itemId}`);

  const result = await db.runTransaction<CsaReadinessActionResult>(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) {
      throw new HttpsError('not-found', 'Readiness item not found.');
    }
    const data = snap.data() as Record<string, unknown>;
    const requirementType = String(data.requirementType || '').trim();
    if (!requirementType) {
      throw new HttpsError(
        'failed-precondition',
        'Readiness item is missing requirementType.',
      );
    }
    if (isCsaReadinessActionExcludedType(requirementType)) {
      const hint =
        requirementType === 'e_verify'
          ? 'Use the dedicated E-Verify callables (everifyMarkContested / everifyRecordWorkerDecision / everifyMarkReferralInitiated / everifyCloseCaseManual).'
          : 'Use setAccusourceLineAdjudication for per-line adjudication, or markAccusourceBackgroundCheckCompleteOutside to mark cleared via a prior check.';
      throw new HttpsError(
        'failed-precondition',
        `Requirement type "${requirementType}" is not supported by generalized CSA actions. ${hint}`,
      );
    }

    const fromStatus = String(data.status || 'incomplete');
    const toStatus = transition.toStatus;
    const fromResolutionMethod =
      typeof data.resolutionMethod === 'string' ? (data.resolutionMethod as string) : null;

    // Idempotency: same status + same resolutionMethod + same latest history
    // reason → no-op. We only inspect the LAST history entry for the reason
    // check because successive identical actions are common (recruiter
    // re-clicking confirm) and we don't want a hidden mismatch on an old
    // entry to trigger a duplicate write.
    const existingHistory = Array.isArray(
      (data.csaActions as CsaReadinessActionsField | undefined)?.history,
    )
      ? ((data.csaActions as CsaReadinessActionsField).history as CsaReadinessHistoryEntry[])
      : [];
    const lastEntry = existingHistory.length > 0 ? existingHistory[existingHistory.length - 1] : null;
    const lastReason = lastEntry?.reason ?? null;
    const lastKind = lastEntry?.kind ?? null;
    if (
      fromStatus === toStatus &&
      fromResolutionMethod === transition.resolutionMethod &&
      lastKind === transition.kind &&
      (lastReason ?? null) === (note ?? null)
    ) {
      return {
        ok: true,
        unchanged: true,
        collection,
        itemId,
        status: toStatus,
        resolutionMethod: transition.resolutionMethod,
      };
    }

    const now = admin.firestore.Timestamp.now();
    const historyEntry: CsaReadinessHistoryEntry = {
      at: now,
      kind: transition.kind,
      fromStatus,
      toStatus,
      by: actorUid,
      reason: note,
    };
    const nextHistory = [...existingHistory, historyEntry];

    const patch: Record<string, unknown> = {
      status: toStatus,
      resolutionMethod: transition.resolutionMethod,
      updatedAt: now.toDate().toISOString(),
      // Mirror the AccuSource shape on the parallel field. We write the
      // whole `csaActions` map as a nested object (not via a dotted-path)
      // so the Admin SDK semantics match what a `set({merge:true})` from
      // any other surface would produce — see the R.0b/R.0c post-mortem.
      csaActions: { history: nextHistory },
    };
    if (toStatus === 'complete_pass' && !data.completedAt) {
      patch.completedAt = now.toDate().toISOString();
    }

    tx.update(ref, patch);
    return {
      ok: true,
      unchanged: false,
      collection,
      itemId,
      status: toStatus,
      resolutionMethod: transition.resolutionMethod,
    };
  });

  if (!result.unchanged) {
    logger.info('applyCsaReadinessAction: status transition', {
      tenantId,
      collection,
      itemId,
      kind,
      toStatus: result.status,
      resolutionMethod: result.resolutionMethod,
      by: actorUid,
      hasNote: note !== null,
    });
  }

  return result;
}
