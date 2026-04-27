/**
 * **R.4** — Display-label table for chip contributors.
 *
 * Single-source-of-truth for human-readable strings on the popover. Keeps the
 * chip helper pure (no React-side `t()` calls) and gives a single audit point
 * if labels need to change.
 *
 * Custom-typed items (`requirementType: 'custom'` from either collection) fall
 * back to the item's own `requirementLabel` field — that's the convention for
 * tenant-extension requirements.
 */

import type {
  AssignmentReadinessRequirementType,
} from '../assignmentReadinessItemV1';
import type {
  EmployeeReadinessRequirementType,
} from '../employeeReadinessItemV1';

/** Per-shift requirement labels (assignment side). */
const ASSIGNMENT_LABELS: Record<AssignmentReadinessRequirementType, string> = {
  background_check: 'Background check',
  drug_screen: 'Drug screen',
  e_verify: 'E-Verify',
  required_certification: 'Required certification',
  cert_match: 'Certification',
  license_match: 'License',
  skill_match: 'Skill',
  education_match: 'Education',
  language_match: 'Language',
  screening_package_match: 'Screening package',
  orientation: 'Orientation',
  ppe_acknowledgement: 'PPE acknowledgement',
  safety_briefing: 'Safety briefing',
  shift_confirmation: 'Shift confirmation',
  physical_willingness: 'Physical requirements',
  uniform_willingness: 'Uniform requirements',
  ppe_willingness: 'Required PPE',
  language_willingness: 'Working language',
  custom: 'Requirement',
};

/**
 * Per-(worker × entity) requirement labels (employee side) — only the
 * JOB-relevant subset is laid out here. Items not in this table do not
 * contribute to the Job Readiness chip; the chip helper enforces the gate.
 */
const EMPLOYEE_JOB_LEVEL_LABELS: Partial<Record<EmployeeReadinessRequirementType, string>> = {
  background_check: 'Background check',
  drug_screen: 'Drug screen',
  e_verify: 'E-Verify',
};

/**
 * Resolve a chip contributor's display label. Prefers a per-item override
 * (`requirementLabel`) when present — important for `'custom'` items and the
 * occasional pretty-printed override an admin set in the seeder spec.
 */
export function jobReadinessChipLabelFor(
  source: 'assignment' | 'employee',
  requirementType: AssignmentReadinessRequirementType | EmployeeReadinessRequirementType,
  override?: string | null,
): string {
  const cleaned = (override ?? '').trim();
  if (cleaned.length > 0) return cleaned;
  if (source === 'assignment') {
    return ASSIGNMENT_LABELS[requirementType as AssignmentReadinessRequirementType] ?? 'Requirement';
  }
  return EMPLOYEE_JOB_LEVEL_LABELS[requirementType as EmployeeReadinessRequirementType] ?? 'Requirement';
}

/**
 * Job-level subset of `EmployeeReadinessRequirementType`. Items NOT in this
 * set live on the Employee Readiness chip, not the Job Readiness chip
 * (i.e. I-9, handbook, tax, payroll → Employee chip; BG / drug / e-verify →
 * both chips, but the JOB-readiness chip is the authoritative aggregator
 * for "can this worker do this shift").
 *
 * Severity is hard-coded here because `EmployeeReadinessItem` doesn't carry
 * a `severity` field (R.1 added it only to `AssignmentReadinessItem`); we
 * may want to lift it to the schema in a follow-up if more types qualify.
 */
export const EMPLOYEE_JOB_LEVEL_REQUIREMENT_TYPES: ReadonlySet<EmployeeReadinessRequirementType> = new Set([
  'background_check',
  'drug_screen',
  'e_verify',
]);
