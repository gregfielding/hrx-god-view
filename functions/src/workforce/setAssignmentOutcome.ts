/**
 * Callable — set, change, or undo an assignment outcome.
 *
 * Phase 4 of `docs/WORKFORCE_DOMAIN_MODEL.md`. Writes outcome fields on
 * `tenants/{tid}/assignments/{id}` atomically and appends to the
 * assignment's `outcomeHistory` audit array.
 *
 * The AccountWorkforce counter rollup lives in the
 * `onAssignmentWriteMaintainAccountWorkforce` trigger — this callable
 * just flips status; the trigger keeps `totalShifts`, `completedShifts`,
 * `lastShiftAt` in sync (including decrementing on undo).
 *
 * Permission: HRX or tenant security level 5/6/7 — same gate as
 * `setAccountWorkforceStatus`.
 *
 * Payload semantics:
 *   - `outcomeStatus: 'completed' | 'no_show' | 'left_early' |
 *     'cancelled_business' | 'cancelled_worker'` → set / change the outcome.
 *   - `outcomeStatus: null` → undo. Assignment reverts to `confirmed`,
 *     outcome fields are cleared, and the trigger decrements any counter
 *     bumps that landed with the original outcome.
 *   - `notes` is optional in both modes; the UI can require per-reason.
 *
 * @see docs/WORKFORCE_DOMAIN_MODEL.md §2.1, §2.2, Phase 4
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import * as admin from 'firebase-admin';

import {
  type AssignmentOutcomeHistoryEntry,
  type AssignmentOutcomeStatus,
  type SetAssignmentOutcomeInput,
  type SetAssignmentOutcomeResult,
} from '../shared/assignmentOutcome';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

const VALID_OUTCOME_STATUSES: readonly AssignmentOutcomeStatus[] = [
  'completed',
  'no_show',
  'left_early',
  'cancelled_business',
  'cancelled_worker',
] as const;

/**
 * Resolve the caller's effective security level for `tenantId` — same
 * pattern as `setAccountWorkforceStatus`. Prefer nested
 * `tenantIds[tenantId].securityLevel`, fall back to top-level
 * `securityLevel`, HRX auto-qualifies.
 */
async function resolveCallerSecurityLevel(
  uid: string,
  authToken: Record<string, unknown> | undefined,
  tenantId: string,
): Promise<{ securityLevel: number; isHrx: boolean }> {
  const isHrx = authToken?.hrx === true;
  const userSnap = await db.collection('users').doc(uid).get();
  if (!userSnap.exists) {
    return { securityLevel: 0, isHrx };
  }
  const data = userSnap.data() as Record<string, unknown>;
  const tenantIds = data.tenantIds as Record<string, Record<string, unknown>> | undefined;
  const nested = tenantIds?.[tenantId];
  const raw =
    nested && nested.securityLevel != null && String(nested.securityLevel).trim() !== ''
      ? nested.securityLevel
      : data.securityLevel;
  const parsed = Number.parseInt(String(raw ?? '0'), 10);
  return { securityLevel: Number.isNaN(parsed) ? 0 : parsed, isHrx };
}

async function assertWorkforceAdmin(
  uid: string,
  authToken: Record<string, unknown> | undefined,
  tenantId: string,
): Promise<void> {
  const { securityLevel, isHrx } = await resolveCallerSecurityLevel(uid, authToken, tenantId);
  if (isHrx) return;
  if (securityLevel >= 5 && securityLevel <= 7) return;
  throw new HttpsError(
    'permission-denied',
    'Marking assignment outcomes requires tenant security level 5, 6, or 7.',
  );
}

function normalizeInput(raw: unknown): SetAssignmentOutcomeInput {
  const d = (raw || {}) as Record<string, unknown>;
  const tenantId = String(d.tenantId || '').trim();
  const assignmentId = String(d.assignmentId || '').trim();
  if (!tenantId || !assignmentId) {
    throw new HttpsError(
      'invalid-argument',
      'tenantId and assignmentId are required.',
    );
  }

  let outcomeStatus: AssignmentOutcomeStatus | null;
  if (d.outcomeStatus === null) {
    outcomeStatus = null;
  } else {
    const candidate = String(d.outcomeStatus || '').trim().toLowerCase();
    if (!(VALID_OUTCOME_STATUSES as readonly string[]).includes(candidate)) {
      throw new HttpsError(
        'invalid-argument',
        `outcomeStatus must be one of: ${VALID_OUTCOME_STATUSES.join(', ')}, or null to undo.`,
      );
    }
    outcomeStatus = candidate as AssignmentOutcomeStatus;
  }

  const notes = typeof d.notes === 'string' ? d.notes.trim() : '';
  return {
    tenantId,
    assignmentId,
    outcomeStatus,
    notes: notes || undefined,
  };
}

export const setAssignmentOutcome = onCall(
  { cors: true, memory: '256MiB', timeoutSeconds: 30 },
  async (request): Promise<SetAssignmentOutcomeResult> => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Authentication required.');
    }
    const actorUid = request.auth.uid;
    const input = normalizeInput(request.data);
    await assertWorkforceAdmin(
      actorUid,
      request.auth.token as Record<string, unknown>,
      input.tenantId,
    );

    const ref = db.doc(`tenants/${input.tenantId}/assignments/${input.assignmentId}`);
    const now = admin.firestore.Timestamp.now();
    const nowIso = now.toDate().toISOString();

    const finalStatus = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) {
        throw new HttpsError('not-found', 'Assignment not found.');
      }
      const current = snap.data() as Record<string, unknown>;
      const currentStatus = String(current.status || '').toLowerCase();
      const currentOutcomeStatus = String(
        (current as any).outcomeStatus || '',
      ).toLowerCase();

      // --- UNDO branch ---
      if (input.outcomeStatus === null) {
        if (!(VALID_OUTCOME_STATUSES as readonly string[]).includes(currentStatus)) {
          throw new HttpsError(
            'failed-precondition',
            "Nothing to undo — the assignment isn't on an outcome status.",
          );
        }
        const historyEntry: AssignmentOutcomeHistoryEntry = {
          at: nowIso,
          actorUid,
          action: 'undone',
          fromStatus: currentStatus,
          toStatus: 'confirmed',
          ...(input.notes ? { notes: input.notes } : {}),
        };
        tx.set(
          ref,
          {
            status: 'confirmed',
            outcomeStatus: admin.firestore.FieldValue.delete(),
            outcomeAt: admin.firestore.FieldValue.delete(),
            outcomeBy: admin.firestore.FieldValue.delete(),
            outcomeNotes: admin.firestore.FieldValue.delete(),
            outcomeHistory: admin.firestore.FieldValue.arrayUnion(historyEntry),
            updatedAt: now,
            updatedBy: actorUid,
          },
          { merge: true },
        );
        return 'confirmed';
      }

      // --- SET / CHANGE branch ---
      // Guard: only `confirmed` (or already-outcomed, for change-of-mind) can receive an outcome.
      const acceptablePrior = new Set([
        'confirmed',
        'active',
        ...VALID_OUTCOME_STATUSES,
      ]);
      if (!acceptablePrior.has(currentStatus)) {
        throw new HttpsError(
          'failed-precondition',
          `Cannot set outcome on an assignment with status '${currentStatus}'. Worker must have confirmed first.`,
        );
      }
      const action: AssignmentOutcomeHistoryEntry['action'] = (
        VALID_OUTCOME_STATUSES as readonly string[]
      ).includes(currentOutcomeStatus)
        ? 'changed'
        : 'set';
      const historyEntry: AssignmentOutcomeHistoryEntry = {
        at: nowIso,
        actorUid,
        action,
        fromStatus: currentStatus,
        toStatus: input.outcomeStatus,
        ...(input.notes ? { notes: input.notes } : {}),
      };

      tx.set(
        ref,
        {
          status: input.outcomeStatus,
          outcomeStatus: input.outcomeStatus,
          outcomeAt: now,
          outcomeBy: actorUid,
          outcomeNotes: input.notes || admin.firestore.FieldValue.delete(),
          outcomeHistory: admin.firestore.FieldValue.arrayUnion(historyEntry),
          updatedAt: now,
          updatedBy: actorUid,
        },
        { merge: true },
      );
      return input.outcomeStatus;
    });

    logger.info('setAssignmentOutcome: applied', {
      tenantId: input.tenantId,
      assignmentId: input.assignmentId,
      actorUid,
      finalStatus,
    });

    return {
      ok: true as const,
      assignmentId: input.assignmentId,
      status: finalStatus,
    };
  },
);
