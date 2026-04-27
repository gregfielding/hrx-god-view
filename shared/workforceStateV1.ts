/**
 * v1 workforce operating-model types (migration step).
 * `WorkerState` is persisted at `users.{uid}.workerReadinessV1.overallWorkerState`.
 * Assignment readiness remains a future persistence step.
 */

/** Mirrors legacy `entity_employments.status` for this migration (no separate "ready" write path yet). */
export type EmploymentStateV1 =
  | "onboarding"
  | "active"
  | "inactive"
  | "terminated"
  | "blocked";

/** Same literals as today’s primary employment row status field. */
export type EntityEmploymentLegacyStatus = EmploymentStateV1;

/**
 * Canonical worker-level lifecycle persisted at `users.{uid}.workerReadinessV1.overallWorkerState`.
 */
export type WorkerState =
  | "applicant"
  | "profile_incomplete"
  | "onboarding_in_progress"
  | "ready_for_placement"
  | "active"
  | "blocked"
  | "inactive"
  | "terminated";

/** @deprecated Prefer `WorkerState` for persisted overall worker state. */
export type OverallWorkerStateV1 = WorkerState;

/** Reserved for assignment-level readiness (not persisted in this pass). */
export type AssignmentReadinessStateV1 =
  | "unknown"
  | "not_applicable"
  | "pending"
  | "ready"
  | "on_assignment"
  | "ended";
