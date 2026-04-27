/** Re-export canonical engine from `src/shared/` (CRA-safe; also bundled into Cloud Functions). */
export {
  buildAssignmentReadiness,
  groupRequirementsByCategory,
  READINESS_CATEGORY_LABEL,
} from '../shared/buildAssignmentReadiness';

export type {
  ReadinessRequirementStatus,
  ReadinessCategory,
  ReadinessSeverity,
  ReadinessRequirement,
  OverallReadinessState,
  AssignmentReadinessUserInput,
  AssignmentReadinessEmploymentInput,
  AssignmentReadinessAssignmentInput,
  AssignmentReadinessScreeningInput,
  AssignmentReadinessCertItem,
  BuildAssignmentReadinessArgs,
  BuildAssignmentReadinessResult,
} from '../shared/buildAssignmentReadiness';
