/**
 * Wrapper for the `addRetroactiveWorker` callable — admin-only flow to
 * create per-day assignment docs for a worker after the fact, so the
 * recruiter can enter their timesheet.
 *
 * Notification triggers (cadence seed, shift reminders) gate on the
 * `retroactive: true` flag the callable stamps onto every doc.
 */
import { httpsCallable, type Functions } from 'firebase/functions';

export type AddRetroactiveWorkerInput = {
  tenantId: string;
  jobOrderId: string;
  shiftId: string;
  userId: string;
};

export type AddRetroactiveWorkerResult = {
  ok: true;
  assignmentsCreated: number;
  sampleAssignmentId: string | null;
  dates: string[];
};

export function callAddRetroactiveWorker(functions: Functions, payload: AddRetroactiveWorkerInput) {
  return httpsCallable<AddRetroactiveWorkerInput, AddRetroactiveWorkerResult>(
    functions,
    'addRetroactiveWorker',
  )(payload);
}
