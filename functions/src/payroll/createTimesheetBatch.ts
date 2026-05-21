/**
 * **TS.1 Phase 4 — `createTimesheetBatch` callable.**
 *
 * Companion to `submitTimesheetBatch`: the orchestrator
 * (`submitTimesheetBatch`) expects an existing batch doc with
 * `status='pending'`. Client-side direct creation is blocked by
 * Firestore rules (`allow create: if false` on `timesheet_batches`,
 * per Slice 4 — only server-side writes), so this callable is the
 * recruiter-facing entrypoint.
 *
 * Flow on the UI side:
 *   1. Recruiter picks entity + period + clicks "Submit X to Everee"
 *   2. Client → createTimesheetBatch(entryIds, scope) → returns
 *      `{ batchId }`
 *   3. Client → submitTimesheetBatch(batchId) → orchestrator fans
 *      out tasks
 *
 * **Per-entry validation** before creating the batch:
 *   - Entry exists at `tenants/{tid}/timesheet_entries/{id}`
 *   - Entry's `hiringEntityId` matches the requested `hiringEntityId`
 *   - Entry's `status === 'approved'`
 *
 * Mixed-status batches are rejected (a recruiter shouldn't be able
 * to submit a draft entry by accident). The orchestrator does its
 * own pre-flight on top of this for defense-in-depth.
 */

import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';

import { canManageEveree } from '../integrations/everee/evereeAccessGate';

if (!admin.apps.length) {
  admin.initializeApp();
}

// ─────────────────────────────────────────────────────────────────────
// Input / output types
// ─────────────────────────────────────────────────────────────────────

/** Scope shape mirrors the recruiter timesheet.ts type union — only
 *  the fields createTimesheetBatch cares about are required here. */
export type CreateTimesheetBatchScope =
  | {
      kind: 'entity_period';
      periodStart: string;
      periodEnd: string;
    }
  | { kind: 'shift'; refId: string }
  | {
      kind: 'jobOrder';
      refId: string;
      periodStart?: string;
      periodEnd?: string;
    }
  | {
      kind: 'account';
      refId: string;
      periodStart?: string;
      periodEnd?: string;
    }
  | {
      kind: 'day';
      date: string;
      hiringEntityId?: string;
    }
  | {
      kind: 'worker';
      workerId: string;
      periodStart: string;
      periodEnd: string;
    }
  | {
      kind: 'manual';
      periodStart?: string;
      periodEnd?: string;
    };

interface CreateTimesheetBatchInput {
  tenantId: string;
  hiringEntityId: string;
  entryIds: string[];
  scope: CreateTimesheetBatchScope;
}

interface CreateTimesheetBatchResult {
  batchId: string;
  /** Echo back the resolved totals so the UI doesn't have to recompute. */
  totals: {
    workerCount: number;
    totalRegularHours: number;
    totalOTHours: number;
    totalGrossPay: number;
    totalGrossBill: number;
  };
}

// ─────────────────────────────────────────────────────────────────────
// Callable
// ─────────────────────────────────────────────────────────────────────

const MAX_ENTRIES_PER_BATCH = 500;

export const createTimesheetBatch = onCall<CreateTimesheetBatchInput>(
  { memory: '512MiB', timeoutSeconds: 120 },
  async (request): Promise<CreateTimesheetBatchResult> => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Must be authenticated.');
    }
    const raw = (request.data ?? {}) as Partial<CreateTimesheetBatchInput>;
    const tenantId = String(raw.tenantId ?? '').trim();
    const hiringEntityId = String(raw.hiringEntityId ?? '').trim();
    const entryIds = Array.isArray(raw.entryIds)
      ? Array.from(new Set(raw.entryIds.map((id) => String(id ?? '').trim()).filter(Boolean)))
      : [];
    const scope = raw.scope;

    if (!tenantId || !hiringEntityId) {
      throw new HttpsError('invalid-argument', 'tenantId and hiringEntityId required.');
    }
    if (!scope || typeof scope !== 'object' || !('kind' in scope)) {
      throw new HttpsError('invalid-argument', 'scope is required.');
    }
    if (entryIds.length === 0) {
      throw new HttpsError('invalid-argument', 'entryIds[] must be non-empty.');
    }
    if (entryIds.length > MAX_ENTRIES_PER_BATCH) {
      throw new HttpsError(
        'invalid-argument',
        `entryIds[] exceeds max (${MAX_ENTRIES_PER_BATCH}). Got ${entryIds.length}.`,
      );
    }
    if (!(await canManageEveree(request.auth as any, tenantId))) {
      throw new HttpsError(
        'permission-denied',
        'Not allowed to submit timesheet batches for this tenant.',
      );
    }

    const db = admin.firestore();

    // Validate each entry: exists, belongs to the right entity, status='approved'.
    // Reads are parallel — pages of 30 to stay under Firestore's get-many limits.
    const entrySnaps: FirebaseFirestore.DocumentSnapshot[] = [];
    for (let i = 0; i < entryIds.length; i += 30) {
      const slice = entryIds.slice(i, i + 30);
      const refs = slice.map((id) => db.doc(`tenants/${tenantId}/timesheet_entries/${id}`));
      const snaps = await Promise.all(refs.map((r) => r.get()));
      entrySnaps.push(...snaps);
    }

    const workerIds = new Set<string>();
    let totalRegularHours = 0;
    let totalOTHours = 0;
    let totalGrossPay = 0;
    let totalGrossBill = 0;
    const validationErrors: string[] = [];

    entrySnaps.forEach((snap, idx) => {
      const id = entryIds[idx];
      if (!snap.exists) {
        validationErrors.push(`Entry ${id} not found.`);
        return;
      }
      const e = snap.data() as Record<string, unknown>;
      if (String(e.hiringEntityId ?? '').trim() !== hiringEntityId) {
        validationErrors.push(
          `Entry ${id} belongs to entity '${e.hiringEntityId}', not '${hiringEntityId}'.`,
        );
        return;
      }
      const status = String(e.status ?? '');
      if (status !== 'approved') {
        validationErrors.push(`Entry ${id} status is '${status}', not 'approved'.`);
        return;
      }
      const wid = String(e.workerId ?? '').trim();
      if (wid) workerIds.add(wid);
      totalRegularHours += Number(e.totalRegularHours ?? 0);
      totalOTHours += Number(e.totalOTHours ?? 0);
      // Gross pay = sum of effective wage hours × rate + tips + bonus + premiums.
      // For batch totals we approximate from the same fields the entry exposes;
      // the orchestrator's per-row composer produces the authoritative wire
      // numbers downstream.
      const payRate = Number(e.payRate ?? 0);
      const reg = Number(e.totalRegularHours ?? 0);
      const ot = Number(e.totalOTHours ?? 0);
      const dt = Number(e.totalDoubleTimeHours ?? 0);
      const meal = Number(e.mealBreakPenaltyHours ?? 0);
      const rest = Number(e.restBreakPenaltyHours ?? 0);
      const tips = Number(e.tips ?? 0);
      const bonus = Number(e.bonusAmount ?? 0);
      totalGrossPay +=
        reg * payRate +
        ot * payRate * 1.5 +
        dt * payRate * 2 +
        meal * payRate +
        rest * payRate +
        tips +
        bonus;
      const billRate = Number(e.billRate ?? 0);
      totalGrossBill += (reg + ot + dt) * billRate;
    });

    if (validationErrors.length > 0) {
      // Surface the first ~3 errors verbatim and a count for the rest.
      const detail = validationErrors.slice(0, 3).join(' ');
      const more = validationErrors.length > 3 ? ` (and ${validationErrors.length - 3} more)` : '';
      throw new HttpsError(
        'failed-precondition',
        `Cannot create batch: ${detail}${more}`,
      );
    }

    // All entries valid — create the batch doc.
    const batchRef = db.collection(`tenants/${tenantId}/timesheet_batches`).doc();
    const batchId = batchRef.id;
    const now = admin.firestore.FieldValue.serverTimestamp();
    await batchRef.set({
      id: batchId,
      tenantId,
      hiringEntityId,
      scope,
      entryIds,
      status: 'pending',
      totals: {
        workerCount: workerIds.size,
        totalRegularHours: round2(totalRegularHours),
        totalOTHours: round2(totalOTHours),
        totalGrossPay: round2(totalGrossPay),
        totalGrossBill: round2(totalGrossBill),
      },
      createdBy: request.auth.uid,
      createdAt: now,
      updatedAt: now,
    });

    logger.info('[createTimesheetBatch] created', {
      tenantId,
      hiringEntityId,
      batchId,
      entryCount: entryIds.length,
      workerCount: workerIds.size,
      scope: scope.kind,
      createdBy: request.auth.uid,
    });

    return {
      batchId,
      totals: {
        workerCount: workerIds.size,
        totalRegularHours: round2(totalRegularHours),
        totalOTHours: round2(totalOTHours),
        totalGrossPay: round2(totalGrossPay),
        totalGrossBill: round2(totalGrossBill),
      },
    };
  },
);

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
