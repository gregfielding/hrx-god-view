/**
 * **R.4** — Job Readiness chip data shapes.
 *
 * Pure value types — no firebase imports. Lives under `shared/` so the chip
 * helper, the bridge in `buildAssignmentReadiness`, the persisted snapshot
 * (`readinessSnapshotV1.jobReadinessChip`), and the React component all
 * consume the same contract.
 *
 * Cross-collection note: the chip aggregates over BOTH per-shift items
 * (`assignmentReadinessItems` — cert / license / skill / willingness / etc.)
 * AND per-(worker × hiring-entity) items
 * (`employeeReadinessItems` — but only the JOB-relevant subset:
 * `background_check`, `drug_screen`, `e_verify` — the rest belong to the
 * Employee Readiness chip, not Job Readiness).
 *
 * @see ./computeJobReadinessChip.ts (the pure aggregator)
 * @see ../buildAssignmentReadiness.ts (bridge entry point per R.4 design)
 * @see ../readinessSnapshotV1.ts (persisted Firestore shape)
 */

import type {
  AssignmentReadinessItemStatus,
  AssignmentReadinessRequirementType,
  AssignmentReadinessResolutionMethod,
  AssignmentReadinessSeverity,
} from '../assignmentReadinessItemV1';
import type {
  EmployeeReadinessRequirementType,
} from '../employeeReadinessItemV1';

/** Source collection a chip contributor was read from. Drives drill-in routing. */
export type JobReadinessChipSource = 'assignment' | 'employee';

/** Color tier the contributor adds to the aggregate. */
export type JobReadinessChipContribution = 'green' | 'yellow' | 'red';

/**
 * Aggregate chip state.
 *
 * - `'green'` / `'yellow'` / `'red'` — normal classifier output.
 * - `'computing'` — initial-render sentinel; no items loaded yet AND
 *   the seeder hasn't run.
 * - `'legacy_review'` — **R.4.3** — defensive branch: no items AND
 *   seeder hasn't run AND the assignment predates the R.1 deploy
 *   (`R1_DEPLOY_DATE_ISO`). Distinct from `'computing'` so the UI can
 *   surface "this assignment predates the readiness rebuild" instead
 *   of an indefinite spinner.
 */
export type JobReadinessChipState =
  | JobReadinessChipContribution
  | 'computing'
  | 'legacy_review';

/**
 * One item's contribution to the aggregate, plus the rendering metadata the
 * popover needs (label, drill-in target, human detail).
 *
 * `status` and `resolutionMethod` are kept on the contributor (not collapsed
 * to `contribution`) so the popover can show "needs CSA adjudication" vs
 * "pending self-attestation" while the aggregate has already collapsed both
 * to yellow.
 */
export interface JobReadinessChipContributor {
  /** Source collection the item was read from. Different drill-in routes per source. */
  source: JobReadinessChipSource;
  /** Firestore doc id of the underlying readiness item. */
  itemId: string;
  /** Worker uid the item concerns — same for every contributor on a given chip. */
  workerUid: string;
  /**
   * Requirement type — string-typed because the union is the disjoint sum of
   * `AssignmentReadinessRequirementType` and the JOB-relevant subset of
   * `EmployeeReadinessRequirementType`. Consumers can narrow via `source`.
   */
  requirementType: AssignmentReadinessRequirementType | EmployeeReadinessRequirementType;
  /** Display string for the popover. Resolved at compute time so callers don't need a label table. */
  requirementLabel: string;
  /** Color contribution. */
  contribution: JobReadinessChipContribution;
  /** Underlying status as it was on the source item. Used for popover detail. */
  status: AssignmentReadinessItemStatus;
  /** Resolution method when known (assignment items always; employee items always `null` pre-R.3). */
  resolutionMethod: AssignmentReadinessResolutionMethod;
  /** Effective severity used by the aggregator. */
  severity: AssignmentReadinessSeverity;
  /** Human-readable popover detail (e.g. "needs CSA adjudication"). */
  detail: string;
  /**
   * **R.5 + R.6** — Optional case id when the contributor is sourced from
   * a vendor case. Lets the popover deep-link the recruiter directly into
   * the matching per-case drawer instead of forcing the Worker Profile to
   * re-resolve the case from worker × entity.
   *
   * Currently populated for these `requirementType`s:
   *   - `e_verify`             (R.5) → `everify_cases/{caseId}` doc id
   *   - `background_check` /
   *     `drug_screen`          (R.6) → `backgroundChecks/{checkId}` doc id
   *
   * The drill-in URL shape is `?tab=readiness&type=<rtype>&caseId=…` for
   * both — the consumer (`ProfileReadinessTabContent`) routes to the
   * right drawer by `type`. We deliberately keep a single generic
   * `caseId` field rather than parallel `caseId` / `checkId` slots so
   * adding new vendor-backed item types stays additive.
   *
   * Optional — only set when the source item knows the id.
   */
  caseId?: string;
}

/**
 * The aggregate chip data — what gets persisted onto
 * `assignments.readinessSnapshotV1.jobReadinessChip` and consumed by the
 * `JobReadinessChip` component.
 */
export interface JobReadinessChipData {
  /** Aggregate state. `'computing'` ONLY when no items are loaded yet. */
  state: JobReadinessChipState;
  /** Pre-formatted display string. */
  text: string;
  /** Yellow-contributor count (used for the `(N pending)` suffix). */
  pendingCount: number;
  /** Red-contributor count (used by some surfaces; chip text doesn't include it). */
  blockerCount: number;
  /** All contributors, sorted red → yellow → green within `contributors`. */
  contributors: JobReadinessChipContributor[];
}
