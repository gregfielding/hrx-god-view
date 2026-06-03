/**
 * Client-side wrapper for the `revertTimesheetEntriesToDraftCallable`
 * Cloud Function. The timesheets grid's Status pill calls this when
 * the recruiter clicks an `approved` row — flips it back to `draft`
 * on the server so it falls out of the next Submit-to-Everee batch.
 *
 * Idempotent: calling on an already-draft entry returns it under
 * `skipped` with `reason: 'wrong_status'`, not an error.
 *
 * @see functions/src/timesheets/revertTimesheetEntriesToDraftCallable.ts
 */

import { httpsCallable } from 'firebase/functions';

import { functions } from '../../firebase';

export interface RevertTimesheetEntriesToDraftInput {
  tenantId: string;
  entryIds: string[];
}

export interface RevertTimesheetEntriesToDraftResult {
  ok: true;
  reverted: number;
  skipped: Array<{
    entryId: string;
    reason: 'not_found' | 'wrong_tenant' | 'wrong_status';
    currentStatus?: string;
  }>;
}

const callable = httpsCallable<
  RevertTimesheetEntriesToDraftInput,
  RevertTimesheetEntriesToDraftResult
>(functions, 'revertTimesheetEntriesToDraftCallable');

export async function revertTimesheetEntriesToDraft(
  input: RevertTimesheetEntriesToDraftInput,
): Promise<RevertTimesheetEntriesToDraftResult> {
  const result = await callable(input);
  return result.data;
}
