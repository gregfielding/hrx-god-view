/**
 * Keep in sync with repo root `shared/workforceStateV1.ts` (functions tsc rootDir cannot import ../shared).
 */

export type EmploymentStateV1 =
  | "onboarding"
  | "active"
  | "inactive"
  | "terminated"
  | "blocked";

export type EntityEmploymentLegacyStatus = EmploymentStateV1;

export type WorkerState =
  | "applicant"
  | "profile_incomplete"
  | "onboarding_in_progress"
  | "ready_for_placement"
  | "active"
  | "blocked"
  | "inactive"
  | "terminated";

/** @deprecated Prefer `WorkerState`. */
export type OverallWorkerStateV1 = WorkerState;

export type AssignmentReadinessStateV1 =
  | "unknown"
  | "not_applicable"
  | "pending"
  | "ready"
  | "on_assignment"
  | "ended";
