/**
 * HRX V1 assignment-centered readiness (flexible warnings; no blocking enforcement in UI).
 * Lives under `src/shared/` so CRA can import it. Cloud Functions esbuild bundles from the same paths.
 */

export type ReadinessRequirementStatus = 'complete' | 'missing' | 'in_progress';

export type ReadinessCategory = 'identity' | 'employment' | 'policies' | 'screening' | 'certification';

export type ReadinessSeverity = 'hard_block' | 'warning';

export interface ReadinessRequirement {
  key: string;
  label: string;
  category: ReadinessCategory;
  severity: ReadinessSeverity;
  status: ReadinessRequirementStatus;
  /** Optional UI hint (e.g. payroll in progress). */
  detail?: string;
}

export type OverallReadinessState = 'READY' | 'READY_WITH_WARNINGS' | 'BLOCKED' | 'PENDING_INITIALIZATION';

export interface AssignmentReadinessUserInput {
  /** True when work authorization is satisfied (e.g. attestation yes). */
  workAuthorization?: boolean | null;
}

export interface AssignmentReadinessEmploymentInput {
  i9Complete?: boolean | null;
  payrollInviteSent?: boolean | null;
  directDepositComplete?: boolean | null;
  taxFormComplete?: boolean | null;
  handbookSigned?: boolean | null;
  policiesSigned?: boolean | null;
}

export interface AssignmentReadinessAssignmentInput {
  id?: string;
  /** Display name / title */
  name?: string | null;
  status?: string | null;
  requiresBackgroundCheck?: boolean | null;
  requiresDrugScreen?: boolean | null;
}

export interface AssignmentReadinessScreeningInput {
  backgroundComplete?: boolean | null;
  backgroundOrdered?: boolean | null;
  drugScreenComplete?: boolean | null;
  drugScreenOrdered?: boolean | null;
}

export interface AssignmentReadinessCertItem {
  key: string;
  label: string;
  complete?: boolean | null;
}

export interface BuildAssignmentReadinessArgs {
  user: AssignmentReadinessUserInput | null | undefined;
  employment: AssignmentReadinessEmploymentInput | null | undefined;
  assignment: AssignmentReadinessAssignmentInput | null | undefined;
  screening: AssignmentReadinessScreeningInput | null | undefined;
  certifications?: AssignmentReadinessCertItem[] | null;
}

export interface BuildAssignmentReadinessResult {
  readiness: OverallReadinessState;
  requirements: ReadinessRequirement[];
  summary: {
    blockers: number;
    warnings: number;
    completed: number;
  };
}

export function buildAssignmentReadiness({
  user,
  employment,
  assignment,
  screening,
  certifications,
}: BuildAssignmentReadinessArgs): BuildAssignmentReadinessResult {
  if (!assignment?.id) {
    return {
      readiness: 'PENDING_INITIALIZATION',
      requirements: [],
      summary: { blockers: 0, warnings: 0, completed: 0 },
    };
  }

  const requirements: ReadinessRequirement[] = [];

  requirements.push({
    key: 'work_authorization',
    label: 'Work Authorization',
    category: 'identity',
    severity: 'hard_block',
    status: user?.workAuthorization ? 'complete' : 'missing',
  });

  requirements.push({
    key: 'i9',
    label: 'I-9 Form',
    category: 'identity',
    severity: 'hard_block',
    status: employment?.i9Complete ? 'complete' : 'missing',
  });

  const payrollInvite = Boolean(employment?.payrollInviteSent);
  const payrollComplete = Boolean(employment?.directDepositComplete);
  let payrollStatus: ReadinessRequirementStatus = 'missing';
  let payrollDetail: string | undefined;
  if (payrollComplete) {
    payrollStatus = 'complete';
  } else if (payrollInvite) {
    payrollStatus = 'in_progress';
    payrollDetail = 'Invite sent, incomplete';
  }
  requirements.push({
    key: 'payroll_setup',
    label: 'Payroll Setup',
    category: 'employment',
    severity: 'warning',
    status: payrollStatus,
    detail: payrollDetail,
  });

  requirements.push({
    key: 'tax_form',
    label: 'Tax Form',
    category: 'employment',
    severity: 'warning',
    status: employment?.taxFormComplete ? 'complete' : 'missing',
  });

  requirements.push({
    key: 'handbook',
    label: 'Handbook Signed',
    category: 'policies',
    severity: 'warning',
    status: employment?.handbookSigned ? 'complete' : 'missing',
  });

  requirements.push({
    key: 'policies',
    label: 'Policies Signed',
    category: 'policies',
    severity: 'warning',
    status: employment?.policiesSigned ? 'complete' : 'missing',
  });

  if (assignment.requiresBackgroundCheck) {
    let status: ReadinessRequirementStatus = 'missing';
    if (screening?.backgroundComplete) status = 'complete';
    else if (screening?.backgroundOrdered) status = 'in_progress';
    requirements.push({
      key: 'background_check',
      label: 'Background Check',
      category: 'screening',
      severity: 'warning',
      status,
    });
  }

  if (assignment.requiresDrugScreen) {
    let status: ReadinessRequirementStatus = 'missing';
    if (screening?.drugScreenComplete) status = 'complete';
    else if (screening?.drugScreenOrdered) status = 'in_progress';
    requirements.push({
      key: 'drug_screen',
      label: 'Drug Screen',
      category: 'screening',
      severity: 'warning',
      status,
    });
  }

  for (const c of certifications ?? []) {
    if (!c?.key || !c?.label) continue;
    requirements.push({
      key: `cert_${c.key}`,
      label: c.label,
      category: 'certification',
      severity: 'warning',
      status: c.complete ? 'complete' : 'missing',
    });
  }

  const hasBlocker = requirements.some((r) => r.severity === 'hard_block' && r.status !== 'complete');
  const hasWarnings = requirements.some((r) => r.severity === 'warning' && r.status !== 'complete');

  let readiness: OverallReadinessState = 'READY';
  if (hasBlocker) readiness = 'BLOCKED';
  else if (hasWarnings) readiness = 'READY_WITH_WARNINGS';

  return {
    readiness,
    requirements,
    summary: {
      blockers: requirements.filter((r) => r.severity === 'hard_block' && r.status !== 'complete').length,
      warnings: requirements.filter((r) => r.severity === 'warning' && r.status !== 'complete').length,
      completed: requirements.filter((r) => r.status === 'complete').length,
    },
  };
}

const CATEGORY_ORDER: ReadinessCategory[] = ['identity', 'employment', 'policies', 'screening', 'certification'];

export const READINESS_CATEGORY_LABEL: Record<ReadinessCategory, string> = {
  identity: 'IDENTITY',
  employment: 'EMPLOYMENT',
  policies: 'POLICIES',
  screening: 'SCREENING',
  certification: 'CERTIFICATION',
};

export function groupRequirementsByCategory(requirements: ReadinessRequirement[]): Map<ReadinessCategory, ReadinessRequirement[]> {
  const map = new Map<ReadinessCategory, ReadinessRequirement[]>();
  for (const cat of CATEGORY_ORDER) {
    map.set(cat, []);
  }
  for (const r of requirements) {
    const list = map.get(r.category) ?? [];
    list.push(r);
    map.set(r.category, list);
  }
  return map;
}
