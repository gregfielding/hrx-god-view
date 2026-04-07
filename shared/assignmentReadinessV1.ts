/**
 * Canonical assignment-level readiness persisted on `tenants/{tid}/assignments/{id}.assignmentReadinessV1`.
 */

export type AssignmentReadinessStateV1 =
  | 'not_applicable'
  | 'pending_confirmation'
  | 'requirements_incomplete'
  | 'ready'
  | 'active'
  | 'blocked'
  | 'completed'
  | 'canceled';

export type AssignmentReadinessSectionStatusV1 =
  | 'complete'
  | 'incomplete'
  | 'blocked'
  | 'not_applicable';

export type AssignmentReadinessSectionRowV1 = {
  sectionId: string;
  status: AssignmentReadinessSectionStatusV1;
};

/** Increment when derivation or persisted fields change. */
export const ASSIGNMENT_READINESS_V1_EVALUATOR_VERSION = 1;
