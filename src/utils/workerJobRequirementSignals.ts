/**
 * Inputs for job-requirement dashboard action items (assignments, TempWorks, compliance flags).
 */

import type { WorkerComplianceSignals } from './workerComplianceActionDerivers';

function tempworksStartedTruthy(at: unknown): boolean {
  if (at == null || at === '') return false;
  if (typeof at === 'string') return at.trim().length > 0;
  if (typeof at === 'number') return Number.isFinite(at);
  if (typeof at === 'object' && at !== null && typeof (at as { toMillis?: () => number }).toMillis === 'function') {
    return true;
  }
  return false;
}

export interface WorkerDashboardJobSignals {
  tenantId: string;
  pendingAssignmentConfirmations: Array<{
    assignmentId: string;
    startAtMs?: number;
    /** Shift end (ms) — used for the "show until 24h after completion" window. */
    endAtMs?: number;
    /** Job posting id so the action item can deep-link to the posting to confirm/decline. */
    jobPostId?: string;
  }>;
  tempworks?: {
    required: boolean;
    recruiterVerified: boolean;
    started: boolean;
    onboardingUrl: string | null;
  };
  /** True when the worker has an Everee employer linkage that isn't fully
   *  onboarded yet (onboardingComplete !== true) — drives the "Complete
   *  payroll setup" dashboard action item. */
  payrollOnboardingIncomplete?: boolean;
  compliance: WorkerComplianceSignals;
}

const ASSIGNMENT_AWAITING_STATUSES = new Set([
  'proposed',
  'pending',
  'offered',
  'pending_confirmation',
]);

export function assignmentDocNeedsWorkerConfirmation(data: Record<string, unknown>): boolean {
  const st = String(data.status || '').toLowerCase();
  if (!ASSIGNMENT_AWAITING_STATUSES.has(st)) return false;
  if (data.confirmedAt || data.declinedAt) return false;
  return true;
}

export function readTempworksOnboardingFromUserDoc(
  userDoc: Record<string, unknown> | null | undefined
): WorkerDashboardJobSignals['tempworks'] | undefined {
  if (!userDoc || typeof userDoc !== 'object') return undefined;
  const ob = (userDoc.onboarding as Record<string, unknown>) || {};
  const required = ob.tempworksOnboardingRequired === true;
  if (!required) return undefined;
  const recruiterVerified = ob.tempworksRecruiterVerified === true || ob.tempworksVerified === true;
  const started = tempworksStartedTruthy(ob.tempworksStartedAt);
  const onboardingUrl =
    typeof ob.tempworksOnboardingUrl === 'string' && ob.tempworksOnboardingUrl.trim()
      ? ob.tempworksOnboardingUrl.trim()
      : null;
  return { required, recruiterVerified, started, onboardingUrl };
}
