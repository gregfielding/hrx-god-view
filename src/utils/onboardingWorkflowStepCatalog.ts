/**
 * Canonical catalog for tenants/{tid}/entities.onboardingWorkflowSteps (checkbox keys).
 * Source of truth for labels/categories; Settings UI (EntitiesPage) imports this list.
 */

export type OnboardingStepCategory = '1099' | 'W2' | 'both';

export interface OnboardingWorkflowStepDef {
  id: string;
  label: string;
  category: OnboardingStepCategory;
}

/** Stored on entity: stepId -> enabled */
export type OnboardingWorkflowStepsConfig = Record<string, boolean>;

export const ONBOARDING_WORKFLOW_STEPS: OnboardingWorkflowStepDef[] = [
  { id: 'ic_agreement_sent', label: 'Independent Contractor Agreement Sent', category: '1099' },
  { id: 'ic_agreement_signed', label: 'Independent Contractor Agreement Signed', category: '1099' },
  { id: '1099_sent', label: '1099 / W-9 Sent', category: '1099' },
  { id: '1099_completed', label: '1099 / W-9 Completed', category: '1099' },
  { id: 'payroll_invite_sent', label: 'Payroll Invite Sent', category: '1099' },
  { id: 'payroll_setup_complete', label: 'Payroll Setup Complete', category: '1099' },
  { id: 'w9_received', label: 'W-9 Received', category: '1099' },
  { id: 'direct_deposit_contractor', label: 'Direct Deposit / Banking Info (Contractor)', category: '1099' },
  { id: 'handbook_sent', label: 'Handbook Sent', category: 'W2' },
  { id: 'handbook_signed', label: 'Handbook Signed', category: 'W2' },
  { id: 'i9_sent', label: 'I-9 Sent', category: 'W2' },
  { id: 'i9_completed', label: 'I-9 Completed', category: 'W2' },
  { id: 'everify_sent', label: 'E-Verify Sent', category: 'W2' },
  { id: 'everify_completed', label: 'E-Verify Completed', category: 'W2' },
  { id: 'w4_sent', label: 'W-4 Sent', category: 'W2' },
  { id: 'w4_completed', label: 'W-4 Completed', category: 'W2' },
  { id: 'direct_deposit_w2', label: 'Direct Deposit Setup', category: 'W2' },
  {
    id: 'policy_acknowledgments',
    label: 'Policy Acknowledgments (e.g. harassment, confidentiality)',
    /** Aligns with `EXTERNAL_ONBOARDING_STEP_CATALOG.policies_acknowledgment` (`appliesTo: 'both'`). */
    category: 'both',
  },
  { id: 'background_initiated', label: 'Background Check Initiated', category: 'W2' },
  { id: 'background_completed', label: 'Background Check Completed', category: 'W2' },
];

export type WorkflowUiGroupId =
  | 'work_authorization'
  | 'forms_and_policies'
  | 'payroll'
  | 'screenings'
  | 'assignment_requirements'
  | 'internal_readiness';

const WORK_AUTH_IDS = new Set(['i9_sent', 'i9_completed', 'everify_sent', 'everify_completed']);
const FORMS_IDS = new Set([
  'handbook_sent',
  'handbook_signed',
  'w4_sent',
  'w4_completed',
  'policy_acknowledgments',
  'ic_agreement_sent',
  'ic_agreement_signed',
  '1099_sent',
  '1099_completed',
  'w9_received',
]);
const PAYROLL_IDS = new Set(['payroll_invite_sent', 'payroll_setup_complete', 'direct_deposit_contractor', 'direct_deposit_w2']);
const SCREENING_IDS = new Set(['background_initiated', 'background_completed']);

/** Maps Settings checkbox id → UI group (assignment/internal are not in Settings). */
export function workflowStepUiGroup(workflowStepId: string): WorkflowUiGroupId {
  if (WORK_AUTH_IDS.has(workflowStepId)) return 'work_authorization';
  if (FORMS_IDS.has(workflowStepId)) return 'forms_and_policies';
  if (PAYROLL_IDS.has(workflowStepId)) return 'payroll';
  if (SCREENING_IDS.has(workflowStepId)) return 'screenings';
  return 'forms_and_policies';
}

/**
 * Maps Settings checkbox → coarse worker_onboarding.steps[].id for runtime status.
 * Multiple checkboxes share one pipeline step (same status shown for each).
 */
export function workflowStepToPipelineStepId(workflowStepId: string): string | null {
  if (WORK_AUTH_IDS.has(workflowStepId)) {
    if (workflowStepId.startsWith('everify_')) return 'e_verify';
    return 'i9';
  }
  if (FORMS_IDS.has(workflowStepId) || PAYROLL_IDS.has(workflowStepId)) {
    if (PAYROLL_IDS.has(workflowStepId)) return 'everee';
    return 'onboarding_forms';
  }
  if (SCREENING_IDS.has(workflowStepId)) return 'background_check';
  return null;
}

export type CatalogStepOwner = 'worker' | 'recruiter' | 'system' | 'vendor';

export function defaultOwnerForWorkflowStep(workflowStepId: string): CatalogStepOwner {
  if (workflowStepId.startsWith('everify_')) return 'system';
  if (workflowStepId.startsWith('background_')) return 'vendor';
  if (
    workflowStepId === 'handbook_sent' ||
    workflowStepId === 'w4_sent' ||
    workflowStepId === 'i9_sent' ||
    workflowStepId === 'payroll_invite_sent' ||
    workflowStepId === 'ic_agreement_sent' ||
    workflowStepId === '1099_sent'
  ) {
    return 'recruiter';
  }
  return 'worker';
}

/**
 * Heuristic only — not tenant policy. Marks Settings keys whose rows default to `blocking: true`
 * in Employment V2 (until per-step policy exists). Sent / initiated steps are typically non-blocking;
 * completed / signed milestones are blocking for path blockers when still undone.
 */
export function isWorkflowStepBlocking(workflowStepId: string): boolean {
  return (
    workflowStepId === 'i9_completed' ||
    workflowStepId === 'everify_completed' ||
    workflowStepId === 'background_completed' ||
    workflowStepId === 'payroll_setup_complete' ||
    workflowStepId === 'w4_completed' ||
    workflowStepId === 'handbook_signed' ||
    workflowStepId === 'ic_agreement_signed' ||
    workflowStepId === '1099_completed'
  );
}

export function catalogStepAppliesToEntityWorkerType(
  def: OnboardingWorkflowStepDef,
  entityWorkerType: string | undefined
): boolean {
  const wt = String(entityWorkerType || 'W2').toUpperCase().replace(/-/g, '');
  if (wt === 'BOTH') return true;
  if (wt === 'W2') return def.category === 'W2' || def.category === 'both';
  if (wt === '1099') return def.category === '1099' || def.category === 'both';
  return true;
}

const EVERIFY_WORKFLOW_IDS = new Set(['everify_sent', 'everify_completed']);
const I9_WORKFLOW_IDS = new Set(['i9_sent', 'i9_completed']);

/** Entity tab rules: Select I-9+E-Verify, Workforce I-9 only, Events no work auth group. */
export function workflowStepVisibleForEntityTab(workflowStepId: string, entityKey: 'select' | 'workforce' | 'events'): boolean {
  if (entityKey === 'events') {
    if (WORK_AUTH_IDS.has(workflowStepId)) return false;
  }
  if (entityKey === 'workforce' && EVERIFY_WORKFLOW_IDS.has(workflowStepId)) return false;
  return true;
}

export const WORKFLOW_UI_GROUP_ORDER: WorkflowUiGroupId[] = [
  'work_authorization',
  'forms_and_policies',
  'payroll',
  'screenings',
  'assignment_requirements',
  'internal_readiness',
];

export const WORKFLOW_UI_GROUP_TITLES: Record<WorkflowUiGroupId, string> = {
  work_authorization: 'Work Authorization',
  forms_and_policies: 'Forms & Policies',
  payroll: 'Payroll',
  screenings: 'Screenings',
  assignment_requirements: 'Assignment Requirements',
  internal_readiness: 'Internal verification',
};
