/**
 * Client-side wrapper for the `createDraftTimesheetEntryCallable`
 * Cloud Function. Provides end-to-end type safety and a single import
 * site for any UI surface that needs to materialize a draft
 * `TimesheetEntryV2`.
 *
 * **Idempotency.** The server-side callable is get-or-create —
 * calling this twice for the same `(assignmentId, workDate)` returns
 * `created: false` on the second call rather than throwing. The UI
 * affordance can fire it without coordinating with itself.
 *
 * **Errors.** Surfaces typed Firebase callable errors. Common cases
 * the caller should handle:
 *   - `permission-denied`: the caller doesn't have sec ≥ 5 on the tenant.
 *   - `not-found`: the assignment doesn't exist.
 *   - `failed-precondition`: workDate isn't scheduled per
 *     `weeklySchedule[dow].enabled`, or the assignment is missing
 *     required fields.
 *
 * @see functions/src/timesheets/createDraftTimesheetEntryCallable.ts
 */

import { httpsCallable } from 'firebase/functions';

import { functions } from '../../firebase';

export interface CreateDraftTimesheetEntryInput {
  tenantId: string;
  assignmentId: string;
  /** YYYY-MM-DD in worksite-local time. */
  workDate: string;
}

export interface CreateDraftTimesheetEntryResult {
  ok: true;
  entryId: string;
  /** `false` if the entry already existed (idempotent return). */
  created: boolean;
}

const callable = httpsCallable<
  CreateDraftTimesheetEntryInput,
  CreateDraftTimesheetEntryResult
>(functions, 'createDraftTimesheetEntryCallable');

/**
 * Materialize a draft `TimesheetEntryV2` for the given
 * `(assignmentId, workDate)` tuple. Returns the resolved entry id
 * (deterministic — `{assignmentId}_{workDate}`) and whether the doc
 * was created on this call vs already existed.
 *
 * On success, callers typically follow up with the
 * `useTimesheetGridRows` hook's `refresh()` to re-resolve the row
 * set so the UI picks up the new entry.
 */
export async function createDraftTimesheetEntry(
  input: CreateDraftTimesheetEntryInput,
): Promise<CreateDraftTimesheetEntryResult> {
  const result = await callable(input);
  return result.data;
}
