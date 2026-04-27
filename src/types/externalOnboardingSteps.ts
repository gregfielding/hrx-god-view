/**
 * Canonical runtime for TempWorks (and future HRIS) onboarding milestones on
 * tenants/{tenantId}/worker_onboarding/{userId__entityKey}.
 *
 * One object per business stepKey (admin verification is fields on the same object, not a second row).
 * Do not mirror these as primary fields on entity_employments — only derived summaries if the product needs them.
 *
 * Display labels below are the single source for admin path, worker path, narratives, and verification UI.
 */

/** Lifecycle for an external HRIS-driven milestone (TempWorks). */
export type ExternalOnboardingStepStatus =
  | 'not_started'
  | 'invite_sent'
  | 'worker_completed_external'
  | 'pending_admin_verification'
  | 'completed'
  | 'error';

/** Supported external systems writing into this map (extend as integrations land). */
export type ExternalOnboardingSource = 'tempworks';

/** Single business step row (verification is sub-state on this document field). */
export interface ExternalOnboardingStepRecord {
  status: ExternalOnboardingStepStatus;
  externalSource: ExternalOnboardingSource;
  inviteSentAt?: unknown;
  workerMarkedCompleteAt?: unknown;
  verifiedBy?: string;
  verifiedAt?: unknown;
  verificationNote?: string;
  /** Set when admin uses “request correction” — distinguishes returned rows from a fresh invite. */
  correctionRequestedAt?: unknown;
  updatedAt?: unknown;
  updatedBy?: string;
}

/** Which worker classification a step applies to at the business level. */
export type ExternalStepWorkerTypeScope = 'w2' | '1099' | 'both';

export type ExternalOnboardingStepKey =
  | 'payroll_onboarding'
  | 'handbook_acknowledgment'
  | 'pto_acknowledgment'
  | 'independent_contractor_agreement'
  | 'direct_deposit'
  | 'tax_withholding_forms'
  | 'contractor_tax_form_w9'
  | 'i9_employee_section'
  | 'policies_acknowledgment';

export interface ExternalOnboardingStepDefinition {
  stepKey: ExternalOnboardingStepKey;
  /** Single canonical label for admin, worker, narratives, verification UI. */
  displayLabel: string;
  appliesTo: ExternalStepWorkerTypeScope;
  /** Default when this step is in scope and required by policy (path / readiness). */
  defaultBlocking: boolean;
  /** If true, HRX expects an admin verification action after worker completes work in TempWorks. */
  adminVerificationRequired: boolean;
}

/**
 * Final TempWorks / external business step keys (not `worker_onboarding.steps[].id`).
 * Order: payroll → common acknowledgments → contractor → tax → I-9 → policies.
 */
export const EXTERNAL_ONBOARDING_STEP_CATALOG: readonly ExternalOnboardingStepDefinition[] = [
  {
    stepKey: 'payroll_onboarding',
    displayLabel: 'Confirm payroll setup',
    appliesTo: 'both',
    defaultBlocking: true,
    adminVerificationRequired: true,
  },
  {
    stepKey: 'handbook_acknowledgment',
    displayLabel: 'Sign handbook',
    appliesTo: 'w2',
    defaultBlocking: true,
    adminVerificationRequired: true,
  },
  {
    stepKey: 'pto_acknowledgment',
    displayLabel: 'Acknowledge PTO policy',
    appliesTo: 'w2',
    defaultBlocking: false,
    adminVerificationRequired: true,
  },
  {
    stepKey: 'independent_contractor_agreement',
    displayLabel: 'Sign contractor agreement',
    appliesTo: '1099',
    defaultBlocking: true,
    adminVerificationRequired: true,
  },
  {
    stepKey: 'direct_deposit',
    displayLabel: 'Set up direct deposit',
    appliesTo: 'both',
    defaultBlocking: true,
    adminVerificationRequired: true,
  },
  {
    stepKey: 'tax_withholding_forms',
    displayLabel: 'Fill out tax forms',
    appliesTo: 'w2',
    defaultBlocking: true,
    adminVerificationRequired: true,
  },
  {
    stepKey: 'contractor_tax_form_w9',
    displayLabel: 'Complete W-9',
    appliesTo: '1099',
    defaultBlocking: true,
    adminVerificationRequired: true,
  },
  {
    stepKey: 'i9_employee_section',
    displayLabel: 'Complete I-9',
    appliesTo: 'w2',
    defaultBlocking: true,
    adminVerificationRequired: true,
  },
  {
    stepKey: 'policies_acknowledgment',
    displayLabel: 'Sign policies',
    appliesTo: 'both',
    defaultBlocking: true,
    adminVerificationRequired: true,
  },
];

export const EXTERNAL_ONBOARDING_STEP_KEYS: readonly ExternalOnboardingStepKey[] =
  EXTERNAL_ONBOARDING_STEP_CATALOG.map((d) => d.stepKey);

/**
 * First rollout: admin verification controls + copy tuned for these TempWorks-linked steps.
 * (Other catalog keys still sync from integrations; UI verification can be expanded later.)
 */
export const EXTERNAL_ONBOARDING_STEP_VERIFICATION_UI_KEYS: readonly ExternalOnboardingStepKey[] = [
  'payroll_onboarding',
  'direct_deposit',
  'tax_withholding_forms',
  'contractor_tax_form_w9',
  'i9_employee_section',
  'independent_contractor_agreement',
  'handbook_acknowledgment',
  'policies_acknowledgment',
] as const;

export type ExternalOnboardingStepsState = Record<string, ExternalOnboardingStepRecord>;

/** @deprecated Firestore keys — parsed into canonical keys by `parseExternalOnboardingSteps`. */
export const LEGACY_EXTERNAL_ONBOARDING_STEP_KEY_ALIASES: Readonly<Record<string, ExternalOnboardingStepKey>> = {
  policies_procedure_blog: 'policies_acknowledgment',
  payroll_tax_forms: 'tax_withholding_forms',
};

export const EXTERNAL_ONBOARDING_STEP_LABELS: Record<ExternalOnboardingStepKey, string> =
  Object.fromEntries(EXTERNAL_ONBOARDING_STEP_CATALOG.map((d) => [d.stepKey, d.displayLabel])) as Record<
    ExternalOnboardingStepKey,
    string
  >;

export function getExternalOnboardingStepDefinition(
  stepKey: ExternalOnboardingStepKey
): ExternalOnboardingStepDefinition | undefined {
  return EXTERNAL_ONBOARDING_STEP_CATALOG.find((d) => d.stepKey === stepKey);
}

/**
 * Maps entities.onboardingWorkflowSteps checkbox ids → external business stepKey.
 * Steps with no TempWorks mirror (e.g. E-Verify, background) are omitted — those stay on pipeline/subsystems.
 * `pto_acknowledgment` has no Settings checkbox yet; add mapping when workflow catalog gains a PTO step.
 */
export const WORKFLOW_STEP_TO_EXTERNAL_STEP_KEY: Partial<Record<string, ExternalOnboardingStepKey>> = {
  payroll_invite_sent: 'payroll_onboarding',
  payroll_setup_complete: 'payroll_onboarding',
  handbook_sent: 'handbook_acknowledgment',
  handbook_signed: 'handbook_acknowledgment',
  w4_sent: 'tax_withholding_forms',
  w4_completed: 'tax_withholding_forms',
  direct_deposit_contractor: 'direct_deposit',
  direct_deposit_w2: 'direct_deposit',
  policy_acknowledgments: 'policies_acknowledgment',
  i9_sent: 'i9_employee_section',
  i9_completed: 'i9_employee_section',
  ic_agreement_sent: 'independent_contractor_agreement',
  ic_agreement_signed: 'independent_contractor_agreement',
  '1099_sent': 'contractor_tax_form_w9',
  '1099_completed': 'contractor_tax_form_w9',
  w9_received: 'contractor_tax_form_w9',
};
