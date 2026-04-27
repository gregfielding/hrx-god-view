/**
 * **R.8** — Canonical category column definitions for the CSA cross-worker
 * readiness matrix.
 *
 * Each entry maps one matrix column → which underlying readiness item
 * `requirementType` values feed into the cell's aggregated chip, plus
 * which source collection the items live in (per the R.4 split — vendor /
 * cross-shift items live on `employeeReadinessItems`, per-shift items on
 * `assignmentReadinessItems`).
 *
 * **Why fine-grained:** Greg's R.8 greenlight calls out
 * "Confirm uniform for selected workers" / "Waive PPE for selected
 * workers" as separate batch actions — collapsing willingness into one
 * column would force CSAs to do per-cell triage on a column that bulk-
 * action UX wants to drive directly. We pay 4 columns of width to keep
 * each willingness type independently bulk-actionable.
 *
 * **Dynamic rendering:** the matrix view only renders columns where at
 * least one cell across the visible page has data — see
 * `aggregateByCategory.ts`. Empty categories are skipped entirely.
 *
 * **Vendor flag:** drives the per-cell action menu routing (D5.R8). Vendor
 * cells open the R.5 / R.6 drawers; non-vendor cells open the R.3
 * confirm/waive/markFailed callable dialog.
 *
 * Keep this list aligned with `EMPLOYEE_JOB_LEVEL_REQUIREMENT_TYPES` in
 * `shared/jobReadinessChip/labels.ts` — those three types cross between
 * collections (vendor case ON the employee side, screening package match
 * shadow on the assignment side) and BOTH places must agree which side
 * the matrix reads from.
 *
 * @see ./aggregateByCategory.ts (per-cell aggregator that consumes this list)
 * @see ../../shared/csaReadinessActionTypes.ts (`CSA_READINESS_ACTION_EXCLUDED_TYPES`)
 */

import type {
  AssignmentReadinessRequirementType,
} from '../../shared/assignmentReadinessItemV1';
import type {
  EmployeeReadinessRequirementType,
} from '../../shared/employeeReadinessItemV1';

export type MatrixCategoryKey =
  | 'background_check'
  | 'drug_screen'
  | 'e_verify'
  | 'screening_package_match'
  | 'cert_match'
  | 'license_match'
  | 'skill_match'
  | 'education_match'
  | 'language_match'
  | 'orientation'
  | 'safety_briefing'
  | 'ppe_acknowledgement'
  | 'physical_willingness'
  | 'uniform_willingness'
  | 'ppe_willingness'
  | 'language_willingness'
  | 'shift_confirmation';

export interface MatrixCategoryDef {
  /** Stable key used in selection sets, action menus, telemetry. */
  key: MatrixCategoryKey;
  /** Column header label. Short — long names break the matrix density. */
  label: string;
  /** Tooltip on the column header for ambiguity (e.g. "PPE OK" vs "PPE ack"). */
  description: string;
  /**
   * Which collection this column reads from. The aggregator filters items
   * to ONLY the matching source — even if a `requirementType` happens to
   * appear on the other side (e.g. `e_verify` exists on both — but the
   * matrix authoritatively reads from `employee`, matching the R.4
   * cross-collection assembly).
   */
  source: 'assignment' | 'employee';
  /**
   * Requirement types that fold into this column. Most categories map
   * 1:1, but a few aggregate (e.g. `cert_match` includes the legacy
   * `required_certification` so cutover-era data still chips correctly).
   */
  requirementTypes: ReadonlyArray<
    AssignmentReadinessRequirementType | EmployeeReadinessRequirementType
  >;
  /**
   * `true` when this category is in `CSA_READINESS_ACTION_EXCLUDED_TYPES`
   * — the per-cell action menu opens a vendor drawer instead of the R.3
   * confirm/waive/markFailed dialog. Bulk action selection is also
   * disabled for vendor cells (per D5.R8 — mixing vendor + non-vendor in
   * a batch is incoherent).
   */
  vendorBacked: boolean;
}

/**
 * Render order — left-to-right column order in the matrix. Front-loaded
 * with the highest-stakes vendor checks (BG / drug / E-Verify), then
 * the per-shift `*_match` columns, then orientation/willingness, with
 * `shift_confirmation` last as the most CSA-day-of-shift column.
 *
 * Tenants without certain categories (e.g. tenants that don't drug-test)
 * simply won't have items there — the matrix dynamically hides empty
 * columns, so the order remains stable across tenants.
 */
export const MATRIX_CATEGORIES: ReadonlyArray<MatrixCategoryDef> = [
  {
    key: 'background_check',
    label: 'BG check',
    description: 'Background check (per worker × entity)',
    source: 'employee',
    requirementTypes: ['background_check'],
    vendorBacked: true,
  },
  {
    key: 'drug_screen',
    label: 'Drug',
    description: 'Drug screen (per worker × entity)',
    source: 'employee',
    requirementTypes: ['drug_screen'],
    vendorBacked: true,
  },
  {
    key: 'e_verify',
    label: 'E-Verify',
    description: 'E-Verify case (per worker × entity)',
    source: 'employee',
    requirementTypes: ['e_verify'],
    vendorBacked: true,
  },
  {
    key: 'screening_package_match',
    label: 'Pkg match',
    description: 'Screening-package match (per shift)',
    source: 'assignment',
    requirementTypes: ['screening_package_match'],
    vendorBacked: true,
  },
  {
    key: 'cert_match',
    label: 'Certs',
    description: 'Required certifications (per shift). Includes legacy required_certification rollups.',
    source: 'assignment',
    // R.0 callout: we keep `required_certification` mapped here so any
    // remaining legacy data classifies into the same column as the new
    // per-cert `cert_match` items. Once the legacy rollup is fully
    // retired the second entry can drop.
    requirementTypes: ['cert_match', 'required_certification'],
    vendorBacked: false,
  },
  {
    key: 'license_match',
    label: 'Licenses',
    description: 'Required licenses (per shift)',
    source: 'assignment',
    requirementTypes: ['license_match'],
    vendorBacked: false,
  },
  {
    key: 'skill_match',
    label: 'Skills',
    description: 'Required skills (per shift)',
    source: 'assignment',
    requirementTypes: ['skill_match'],
    vendorBacked: false,
  },
  {
    key: 'education_match',
    label: 'Education',
    description: 'Education match (per shift)',
    source: 'assignment',
    requirementTypes: ['education_match'],
    vendorBacked: false,
  },
  {
    key: 'language_match',
    label: 'Languages',
    description: 'Language proficiency match (per shift)',
    source: 'assignment',
    requirementTypes: ['language_match'],
    vendorBacked: false,
  },
  {
    key: 'orientation',
    label: 'Orientation',
    description: 'Site / client orientation (per shift)',
    source: 'assignment',
    requirementTypes: ['orientation'],
    vendorBacked: false,
  },
  {
    key: 'safety_briefing',
    label: 'Safety',
    description: 'Safety briefing acknowledgement (per shift)',
    source: 'assignment',
    requirementTypes: ['safety_briefing'],
    vendorBacked: false,
  },
  {
    key: 'ppe_acknowledgement',
    label: 'PPE ack',
    description: 'Per-shift PPE acknowledgement (hard requirement — distinct from PPE willingness)',
    source: 'assignment',
    requirementTypes: ['ppe_acknowledgement'],
    vendorBacked: false,
  },
  {
    key: 'physical_willingness',
    label: 'Physical',
    description: 'Worker self-attestation: physical-requirement willingness (soft)',
    source: 'assignment',
    requirementTypes: ['physical_willingness'],
    vendorBacked: false,
  },
  {
    key: 'uniform_willingness',
    label: 'Uniform',
    description: 'Worker self-attestation: uniform willingness (soft)',
    source: 'assignment',
    requirementTypes: ['uniform_willingness'],
    vendorBacked: false,
  },
  {
    key: 'ppe_willingness',
    label: 'PPE OK',
    description: 'Worker self-attestation: PPE willingness (soft — distinct from PPE ack)',
    source: 'assignment',
    requirementTypes: ['ppe_willingness'],
    vendorBacked: false,
  },
  {
    key: 'language_willingness',
    label: 'Lang OK',
    description: 'Worker self-attestation: working-language willingness (soft)',
    source: 'assignment',
    requirementTypes: ['language_willingness'],
    vendorBacked: false,
  },
  {
    key: 'shift_confirmation',
    label: 'Shift conf',
    description: 'Shift confirmation (per shift). Soft-hidden when the worker has no live shifts under the entity.',
    source: 'assignment',
    requirementTypes: ['shift_confirmation'],
    vendorBacked: false,
  },
];

/**
 * Index lookup — map by key with O(1) access for the cell-render path.
 * Frozen so the column order is the definition list above.
 */
export const MATRIX_CATEGORY_BY_KEY: ReadonlyMap<MatrixCategoryKey, MatrixCategoryDef> =
  new Map(MATRIX_CATEGORIES.map((c) => [c.key, c]));
