/**
 * Client-side wrapper for the `approveTimesheetEntriesCallable` Cloud
 * Function. The timesheets grid's Status pill calls this when the
 * recruiter clicks a `draft` row — flips it to `approved` on the
 * server (the Firestore rule blocks direct client status writes).
 *
 * Idempotent: calling on an already-approved entry returns it under
 * `skipped` with `reason: 'wrong_status'`, not an error.
 *
 * @see functions/src/timesheets/approveTimesheetEntriesCallable.ts
 */

import { httpsCallable } from 'firebase/functions';

import { functions } from '../../firebase';

export interface ApproveTimesheetEntriesInput {
  tenantId: string;
  entryIds: string[];
}

export interface ApproveTimesheetEntriesResult {
  ok: true;
  approved: number;
  skipped: Array<{
    entryId: string;
    reason: 'not_found' | 'wrong_tenant' | 'wrong_status';
    currentStatus?: string;
  }>;
}

const callable = httpsCallable<ApproveTimesheetEntriesInput, ApproveTimesheetEntriesResult>(
  functions,
  'approveTimesheetEntriesCallable',
);

export async function approveTimesheetEntries(
  input: ApproveTimesheetEntriesInput,
): Promise<ApproveTimesheetEntriesResult> {
  const result = await callable(input);
  return result.data;
}
