/**
 * DUPLICATE of `shared/overallWorkerStateDerive.ts` — keep in sync.
 */

import type { WorkerProfileReadinessV1 } from './profileReadinessShared/profileReadinessEvaluator';
import type { WorkerState } from '../types/workforceStateV1';

export type AssignmentStatusCanonical = 'pending' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled';

const LEGACY_TO_CANONICAL: Record<string, AssignmentStatusCanonical> = {
  proposed: 'pending',
  pending: 'pending',
  offered: 'pending',
  pending_confirmation: 'pending',
  pendingconfirmation: 'pending',
  confirmed: 'confirmed',
  hired: 'confirmed',
  active: 'in_progress',
  in_progress: 'in_progress',
  completed: 'completed',
  ended: 'completed',
  declined: 'cancelled',
  canceled: 'cancelled',
  cancelled: 'cancelled',
};

export function normalizeAssignmentStatusForWorkerState(raw: string | null | undefined): AssignmentStatusCanonical {
  const k = String(raw || '')
    .trim()
    .toLowerCase();
  return LEGACY_TO_CANONICAL[k] ?? 'pending';
}

export type EntityEmploymentSignal = {
  statusLower: string;
  employmentStateLower: string;
};

export type AssignmentSignal = {
  statusRaw: string;
};

function employmentTerminated(e: EntityEmploymentSignal): boolean {
  return e.statusLower === 'terminated' || e.employmentStateLower === 'terminated';
}

function employmentBlocked(e: EntityEmploymentSignal): boolean {
  return e.statusLower === 'blocked' || e.employmentStateLower === 'blocked';
}

function employmentInactive(e: EntityEmploymentSignal): boolean {
  return e.statusLower === 'inactive' || e.employmentStateLower === 'inactive';
}

function employmentActiveReady(e: EntityEmploymentSignal): boolean {
  return e.statusLower === 'active' || e.employmentStateLower === 'active';
}

function employmentOnboarding(e: EntityEmploymentSignal): boolean {
  return e.statusLower === 'onboarding' || e.employmentStateLower === 'onboarding';
}

function assignmentCountsAsActiveWorker(a: AssignmentSignal): boolean {
  const n = normalizeAssignmentStatusForWorkerState(a.statusRaw);
  return n === 'confirmed' || n === 'in_progress';
}

export function deriveOverallWorkerState(args: {
  profileReadiness: WorkerProfileReadinessV1;
  employments: EntityEmploymentSignal[];
  assignments: AssignmentSignal[];
}): WorkerState {
  const { profileReadiness, employments, assignments } = args;

  if (employments.some(employmentTerminated)) {
    return 'terminated';
  }

  if (profileReadiness.status === 'blocked' || employments.some(employmentBlocked)) {
    return 'blocked';
  }

  if (employments.some(employmentInactive)) {
    return 'inactive';
  }

  if (assignments.some(assignmentCountsAsActiveWorker)) {
    return 'active';
  }

  if (employments.some(employmentActiveReady)) {
    return 'ready_for_placement';
  }

  if (employments.some(employmentOnboarding)) {
    return 'onboarding_in_progress';
  }

  if (profileReadiness.status !== 'ready') {
    return 'profile_incomplete';
  }

  return 'applicant';
}
