/** Keep in sync with `shared/assignmentReadinessV1.ts`. */

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
