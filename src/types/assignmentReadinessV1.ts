import type {
  AssignmentReadinessSectionRowV1,
  AssignmentReadinessSectionStatusV1,
  AssignmentReadinessStateV1,
} from '../../shared/assignmentReadinessV1';

export type {
  AssignmentReadinessSectionRowV1,
  AssignmentReadinessSectionStatusV1,
  AssignmentReadinessStateV1,
} from '../../shared/assignmentReadinessV1';

export { ASSIGNMENT_READINESS_V1_EVALUATOR_VERSION } from '../../shared/assignmentReadinessV1';

/** Snapshot read from `assignments.{id}.assignmentReadinessV1` (client). */
export type AssignmentReadinessV1Snapshot = {
  assignmentReadinessState: AssignmentReadinessStateV1;
  readinessSummary: string | null;
  assignmentSectionStatuses: AssignmentReadinessSectionRowV1[];
  blockingRequirementIds?: string[];
};
