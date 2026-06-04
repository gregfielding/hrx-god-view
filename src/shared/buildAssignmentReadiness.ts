/**
 * HRX V1 assignment-centered readiness (flexible warnings; no blocking enforcement in UI).
 * Lives under `src/shared/` so CRA can import it. Cloud Functions esbuild bundles from the same paths.
 *
 * **R.4 bridge (2026-04-26):** the result type is extended with an optional
 * `jobReadinessChip` field. When the caller supplies the new
 * `assignmentReadinessItems` / `employeeReadinessItems` / `readinessSeeded`
 * inputs, the function additionally computes the per-(worker × shift) Job
 * Readiness chip via `computeJobReadinessChip`. When those inputs are
 * omitted, the function behaves exactly as before — preserves the
 * persisted `readinessSnapshotV1` wire-shape for `PlacementsTab.tsx` and
 * the Flutter app per Greg's R.4 greenlight ("bridge approach honored —
 * extends `buildAssignmentReadiness` rather than building a parallel
 * aggregator").
 */

import type { AssignmentReadinessItem } from './assignmentReadinessItemV1';
import type { EmployeeReadinessItem } from './employeeReadinessItemV1';
import { computeJobReadinessChip } from './jobReadinessChip/computeJobReadinessChip';
import type { JobReadinessChipData } from './jobReadinessChip/types';

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
  /**
   * **R.4** — Per-shift readiness items (`tenants/{tid}/assignmentReadinessItems`)
   * filtered to this assignment. When provided alongside `employeeReadinessItems`
   * + `readinessSeeded`, the result includes a populated `jobReadinessChip`.
   * Pre-R.4 callers omit these and continue to receive the legacy result
   * unchanged.
   */
  assignmentReadinessItems?: AssignmentReadinessItem[] | null;
  /**
   * **R.4** — Per-(worker × hiring-entity) items
   * (`tenants/{tid}/employeeReadinessItems`) filtered to the worker AND the
   * assignment's hiring entity. The chip helper internally filters this to
   * the JOB-level subset (background_check / drug_screen / e_verify); the
   * remaining types still belong to the Employee Readiness chip per Greg's
   * R.4 spec.
   */
  employeeReadinessItems?: EmployeeReadinessItem[] | null;
  /**
   * **R.4** — `assignment.readinessSeededAt` truthy. Splits the empty-input
   * case between `'computing'` (seeder hasn't run) and orphan-red
   * ("Readiness not yet computed"). See R.4 helper Q4 for the rationale.
   */
  readinessSeeded?: boolean | null;
  /**
   * **R.4.3** — Optional ISO-8601 `assignment.createdAt`. When threaded
   * through, the chip helper returns `'legacy_review'` for empty +
   * unseeded assignments that predate the R.1 deploy
   * (`R1_DEPLOY_DATE_ISO`) instead of an indefinite `'computing'`
   * spinner. Pre-R.4.3 callers can omit this and continue to receive
   * `'computing'` in that case.
   */
  assignmentCreatedAtIso?: string | null;
}

export interface BuildAssignmentReadinessResult {
  readiness: OverallReadinessState;
  requirements: ReadinessRequirement[];
  summary: {
    blockers: number;
    warnings: number;
    completed: number;
  };
  /**
   * **R.4** — Aggregate chip data per Greg's R.4 spec. Optional / additive;
   * pre-R.4 callers won't receive it (preserved back-compat). Computed
   * IFF `assignmentReadinessItems` AND `employeeReadinessItems` are both
   * provided (`null` is a valid empty array; `undefined` is "don't compute").
   */
  jobReadinessChip?: JobReadinessChipData;
}

export function buildAssignmentReadiness({
  user,
  employment,
  assignment,
  screening,
  certifications,
  assignmentReadinessItems,
  employeeReadinessItems,
  readinessSeeded,
  assignmentCreatedAtIso,
}: BuildAssignmentReadinessArgs): BuildAssignmentReadinessResult {
  // R.4 — chip is computed IFF both item arrays are explicitly passed
  // (including `[]`). Pre-R.4 callers (or `undefined`) continue to get the
  // legacy result without `jobReadinessChip`.
  const computeChip =
    assignmentReadinessItems !== undefined && employeeReadinessItems !== undefined;

  // R.4.3 — strip the optional `assignmentCreatedAtIso` arg when it's
  // null/empty so the chip helper falls into its pre-R.4.3 path
  // (passing `undefined` rather than `null` matches the helper's typed
  // contract — `undefined` is "no signal", not "empty signal").
  const createdAtForChip =
    typeof assignmentCreatedAtIso === 'string' && assignmentCreatedAtIso.length > 0
      ? assignmentCreatedAtIso
      : undefined;

  if (!assignment?.id) {
    return {
      readiness: 'PENDING_INITIALIZATION',
      requirements: [],
      summary: { blockers: 0, warnings: 0, completed: 0 },
      ...(computeChip
        ? {
            jobReadinessChip: computeJobReadinessChip({
              assignmentReadinessItems: assignmentReadinessItems ?? [],
              employeeReadinessItems: employeeReadinessItems ?? [],
              readinessSeeded: Boolean(readinessSeeded),
              ...(createdAtForChip ? { assignmentCreatedAtIso: createdAtForChip } : {}),
            }),
          }
        : {}),
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

  // Handbook + Policies signature requirements removed from assignment
  // readiness (2026-06-03 request) — these Everee-managed acknowledgements
  // no longer gate placement readiness, so they're not surfaced as items,
  // don't count toward "need attention", and don't appear in "Next
  // actions". The `employment.handbookSigned` / `policiesSigned` inputs
  // remain available if a future change wants to restore them.
  void employment?.handbookSigned;
  void employment?.policiesSigned;

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
    ...(computeChip
      ? {
          jobReadinessChip: computeJobReadinessChip({
            assignmentReadinessItems: assignmentReadinessItems ?? [],
            employeeReadinessItems: employeeReadinessItems ?? [],
            readinessSeeded: Boolean(readinessSeeded),
            ...(createdAtForChip ? { assignmentCreatedAtIso: createdAtForChip } : {}),
          }),
        }
      : {}),
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
