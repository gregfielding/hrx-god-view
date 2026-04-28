/**
 * **R.4** — Pure aggregator for the per-(worker × shift) Job Readiness chip.
 *
 * Greg's R.4 spec (from `docs/READINESS_R4_PLACEMENT_CHIP_DESIGN.md` + the
 * 2026-04-26 greenlight):
 *
 *   1. Two-axis classification per item — read both `status` (existing enum)
 *      AND `resolutionMethod` (R.1) AND `severity` (R.1) to decide colour.
 *   2. Aggregate rule: any red → red; else any yellow → yellow with
 *      `pendingCount` suffix; else green.
 *   3. Chip text:
 *        - "Job Ready"                  (green)
 *        - "Job Ready (N pending)"      (yellow)
 *        - "Job Not Ready"              (red)
 *        - "Job Ready (computing…)"     (initial)
 *   4. `csa_waived` resolution → green regardless of status (CSA bypass).
 *   5. Cross-collection: assignment items + JOB-relevant employee items
 *      (BG / drug / e-verify) feed the same aggregate.
 *   6. Sort contributors red → yellow → green; within tier, by sort key on
 *      requirement type (so the popover is stable).
 *
 * Pure function: no firebase, no async, no clock reads. Easy to unit-test.
 *
 * @see ./types.ts                         — input / output shapes
 * @see ./labels.ts                        — display-label table + JOB-level subset
 * @see ../assignmentReadinessItemV1.ts    — assignment-side input items (R.1 fields)
 * @see ../employeeReadinessItemV1.ts      — employee-side input items
 * @see docs/READINESS_R4_PLACEMENT_CHIP_DESIGN.md (planning notes)
 */

import type {
  AssignmentReadinessItem,
  AssignmentReadinessItemStatus,
  AssignmentReadinessRequirementType,
  AssignmentReadinessResolutionMethod,
  AssignmentReadinessSeverity,
} from '../assignmentReadinessItemV1';
import type {
  EmployeeReadinessItem,
  EmployeeReadinessRequirementType,
} from '../employeeReadinessItemV1';
import {
  EMPLOYEE_JOB_LEVEL_REQUIREMENT_TYPES,
  jobReadinessChipLabelFor,
} from './labels';
import type {
  JobReadinessChipContribution,
  JobReadinessChipContributor,
  JobReadinessChipData,
  JobReadinessChipState,
} from './types';

/**
 * **R.4.3** — R.1 deploy-date floor for the `'legacy_review'` defensive
 * branch. Assignments with `createdAt` strictly before this timestamp
 * predate the R.1 readiness rebuild; they have no
 * `assignmentReadinessItems` rows, no `readinessSeededAt`, and no
 * `hiringEntityId`. Without the defensive branch the chip would spin
 * on `'computing'` indefinitely for them.
 *
 * Source: merge commit `ca555054` ("Readiness rebuild: R.0–R.7 + R.3 +
 * post-mortem cleanup") landed 2026-04-26 22:38:46 -0700, which is
 * 2026-04-27T05:38:46Z UTC. The precise commit-derived timestamp is
 * deliberate over a UTC date floor (e.g. `2026-04-27T00:00:00Z`) — a
 * date floor would misclassify any assignment created in the 5h38m
 * gap between midnight UTC and actual deploy as "non-legacy" when
 * it's actually pre-deploy.
 *
 * If R.4.2 ever ships (legacy backfill of pre-R.1 assignments), this
 * constant stays — the defensive branch fires on
 * `contributors.length === 0` regardless, so a backfilled assignment
 * will resolve to a real chip state instead of `'legacy_review'`
 * once items land.
 *
 * @see docs/CLEANUP_R4_R16.2D_HANDOFF.md §L.4.3.1
 */
export const R1_DEPLOY_DATE_ISO = '2026-04-27T05:38:46.000Z';

export interface ComputeJobReadinessChipArgs {
  /**
   * Per-shift items for THIS assignment, loaded from
   * `tenants/{tid}/assignmentReadinessItems` filtered by `assignmentId`.
   */
  assignmentReadinessItems: AssignmentReadinessItem[];
  /**
   * Per-(worker × hiring-entity) items, loaded from
   * `tenants/{tid}/employeeReadinessItems` filtered by `workerUid` AND
   * `hiringEntityId` matching this assignment's hiring entity. The helper
   * itself filters down to the JOB-level subset
   * (`EMPLOYEE_JOB_LEVEL_REQUIREMENT_TYPES`); callers may pass the full list
   * without pre-filtering.
   */
  employeeReadinessItems: EmployeeReadinessItem[];
  /**
   * `true` once the seeder has stamped `assignment.readinessSeededAt`. When
   * `false` AND both collections are empty → `'computing'`. When `true` AND
   * both collections are empty → red orphan ("Readiness not yet computed").
   *
   * Greg's spec uses this exact split — see Q4 in the planning doc.
   */
  readinessSeeded: boolean;
  /**
   * **R.4.3** — Optional ISO-8601 timestamp of the assignment's
   * `createdAt`. When provided AND no contributors exist AND
   * `readinessSeeded === false` AND
   * `assignmentCreatedAtIso < R1_DEPLOY_DATE_ISO`, the helper returns
   * `'legacy_review'` instead of `'computing'`.
   *
   * Lexical ISO comparison is correct (ISO-8601 sorts as text). The
   * helper stays clock-free / pure — caller-side normalization to ISO
   * is the contract. See `hrxReadinessSnapshotLoadContext.ts` for the
   * canonical `Timestamp | string | Date → ISO` conversion.
   *
   * Optional + additive: pre-R.4.3 callers don't pass it and continue
   * to receive `'computing'` for the empty/unseeded case (the
   * pre-R.4.3 behavior is preserved exactly).
   */
  assignmentCreatedAtIso?: string;
}

/**
 * Status values that are "passing" by themselves (independent of severity /
 * resolutionMethod). Anything else flows through the per-item classifier
 * below.
 */
const PASSING_STATUSES: ReadonlySet<AssignmentReadinessItemStatus> = new Set([
  'complete_pass',
  'complete', // legacy
  'not_applicable',
]);

/** Statuses that mean "vendor / matcher returned a failing verdict — terminal". */
const FAILING_STATUSES: ReadonlySet<AssignmentReadinessItemStatus> = new Set([
  'complete_fail',
]);

/** Statuses that mean "system needs a human to look at this". Always yellow. */
const NEEDS_REVIEW_STATUSES: ReadonlySet<AssignmentReadinessItemStatus> = new Set([
  'needs_review',
]);

/** Statuses that mean "previously good, no longer valid". Always red on hard, yellow on soft. */
const EXPIRED_STATUSES: ReadonlySet<AssignmentReadinessItemStatus> = new Set([
  'expired',
]);

/** Statuses that mean "not yet started / in flight". Severity decides the colour. */
const PENDING_STATUSES: ReadonlySet<AssignmentReadinessItemStatus> = new Set([
  'incomplete',
  'in_progress',
  'blocked',
]);

/**
 * Classify a single item into a chip contribution and a popover detail
 * string. Encapsulates the two-axis logic
 * (status × severity × resolutionMethod) so the aggregate function stays a
 * straight reduce.
 */
function classifyContribution(args: {
  status: AssignmentReadinessItemStatus;
  severity: AssignmentReadinessSeverity;
  resolutionMethod: AssignmentReadinessResolutionMethod;
}): { contribution: JobReadinessChipContribution; detail: string } {
  const { status, severity, resolutionMethod } = args;

  // CSA waiver dominates: if a recruiter explicitly waived the requirement,
  // it counts as green regardless of status. The waive note is rendered
  // separately on the popover (caller stitches it from the item itself).
  if (resolutionMethod === 'csa_waived') {
    return { contribution: 'green', detail: 'Waived by recruiter' };
  }

  if (PASSING_STATUSES.has(status)) {
    return { contribution: 'green', detail: 'Satisfied' };
  }

  if (FAILING_STATUSES.has(status)) {
    // Failing on hard = red. On soft, the worker can still do the job
    // (CSA can address later) → yellow.
    return severity === 'hard'
      ? { contribution: 'red', detail: 'Failed' }
      : { contribution: 'yellow', detail: 'Failed (soft requirement)' };
  }

  if (NEEDS_REVIEW_STATUSES.has(status)) {
    // **R.5 update** (Q-R5-4 lock): hard `needs_review` is a placement
    // blocker, not a yellow CSA backlog item. E-Verify TNC and AccuSource
    // DISCREPANCY both fall here — until a CSA adjudicates, the worker
    // genuinely can't be placed (employer compliance risk). Soft items
    // (e.g. ppe_willingness needing review) stay yellow because they don't
    // gate the shift.
    return severity === 'hard'
      ? { contribution: 'red', detail: 'Needs review' }
      : { contribution: 'yellow', detail: 'Needs review (soft requirement)' };
  }

  if (EXPIRED_STATUSES.has(status)) {
    return severity === 'hard'
      ? { contribution: 'red', detail: 'Expired' }
      : { contribution: 'yellow', detail: 'Expired (soft requirement)' };
  }

  if (PENDING_STATUSES.has(status)) {
    // Pending: the conceptual line in the design doc — missing cert /
    // license / screening = genuinely blocking (red). Missing self-attestation
    // or soft match = "we just haven't asked yet" (yellow).
    if (severity === 'hard') {
      const detail =
        status === 'in_progress'
          ? 'In progress'
          : status === 'blocked'
            ? 'Blocked'
            : 'Pending';
      return { contribution: 'red', detail };
    }
    const detail =
      resolutionMethod === 'self_attest'
        ? 'Worker has not answered yet'
        : status === 'in_progress'
          ? 'In progress'
          : 'Pending';
    return { contribution: 'yellow', detail };
  }

  // Defensive: any unrecognised status → yellow (visible signal, not silently green).
  return { contribution: 'yellow', detail: 'Unknown status' };
}

/** Sort priority: red first, yellow next, green last (within source / type stable). */
const CONTRIBUTION_RANK: Record<JobReadinessChipContribution, number> = {
  red: 0,
  yellow: 1,
  green: 2,
};

/** Stable type-sort within each tier so the popover doesn't reshuffle on re-render. */
function typeSortKey(t: AssignmentReadinessRequirementType | EmployeeReadinessRequirementType): string {
  // Lexical works fine — most types are short single words; this keeps things
  // boring and predictable. If a tenant wants a different order, do it in the
  // chip component, not here.
  return String(t);
}

function compareContributors(a: JobReadinessChipContributor, b: JobReadinessChipContributor): number {
  const tierDelta = CONTRIBUTION_RANK[a.contribution] - CONTRIBUTION_RANK[b.contribution];
  if (tierDelta !== 0) return tierDelta;
  const typeDelta = typeSortKey(a.requirementType).localeCompare(typeSortKey(b.requirementType));
  if (typeDelta !== 0) return typeDelta;
  return a.itemId.localeCompare(b.itemId);
}

/**
 * Map a single assignment item to a contributor. Returns `null` when the
 * item should be skipped (e.g. `not_applicable` items are usually
 * already-passing and don't need a popover row, but we DO want them green
 * so they're counted; we keep them and let the sort handle ordering).
 *
 * Currently no item type is dropped — everything that exists in the input
 * arrays contributes. Filtering is a caller concern (the trigger that
 * loads items can pre-filter to "active for this assignment").
 */
function fromAssignmentItem(item: AssignmentReadinessItem): JobReadinessChipContributor {
  const severity: AssignmentReadinessSeverity = item.severity ?? 'soft';
  const resolutionMethod: AssignmentReadinessResolutionMethod = item.resolutionMethod ?? null;
  const { contribution, detail } = classifyContribution({
    status: item.status,
    severity,
    resolutionMethod,
  });
  return {
    source: 'assignment',
    itemId: item.id,
    workerUid: item.workerUid,
    requirementType: item.requirementType,
    requirementLabel: jobReadinessChipLabelFor('assignment', item.requirementType, item.requirementLabel),
    contribution,
    status: item.status,
    resolutionMethod,
    severity,
    detail,
  };
}

/**
 * Map a single employee item to a contributor. Returns `null` when the
 * item is not in the JOB-level subset (i.e. it belongs to the Employee
 * Readiness chip).
 *
 * `EmployeeReadinessItem` does NOT carry `severity` or `resolutionMethod`
 * (R.1 added those only to the assignment-side schema). The helper's
 * type-level fallback table assigns `'hard'` to all three job-level types
 * (BG / drug / e-verify) since failing any of them genuinely blocks the
 * worker. `resolutionMethod` is treated as `null` — until R.3 extends
 * employee items, no `csa_waived` shortcut is available on the employee
 * side.
 */
function fromEmployeeItem(item: EmployeeReadinessItem): JobReadinessChipContributor | null {
  if (!EMPLOYEE_JOB_LEVEL_REQUIREMENT_TYPES.has(item.requirementType)) return null;
  const severity: AssignmentReadinessSeverity = 'hard';
  const resolutionMethod: AssignmentReadinessResolutionMethod = null;
  // R.5 E-Verify-specific overrides (Q-R5-4 lock):
  //   - `in_progress` (covers `submitted`, `pending`, `dhs_verification_in_process`
  //     once mapped to readiness status) → yellow, NOT red. USCIS verification
  //     window is a regulated grace period during which placement is allowed.
  //     Once the worker contests a TNC and the case moves to DHS-in-process,
  //     the chip should reflect "clock running" rather than "blocked".
  //   - `needs_review` keeps the default classifier — that path returns red
  //     for hard items, which is what TNC / FAR should be.
  // Other employee item types (BG, drug screen) keep the strict default
  // (`hard + in_progress` → red) until a dedicated decision is made for
  // them. Those vendor flows have different placement-window rules.
  let contribution: JobReadinessChipContribution;
  let detail: string;
  if (item.requirementType === 'e_verify' && item.status === 'in_progress') {
    contribution = 'yellow';
    detail = 'USCIS verifying';
  } else {
    const cls = classifyContribution({
      status: item.status as AssignmentReadinessItemStatus,
      severity,
      resolutionMethod,
    });
    contribution = cls.contribution;
    detail = cls.detail;
  }
  // R.5 + R.6: surface `externalRef` as `caseId` so the popover can
  // deep-link straight into the per-case drawer.
  //   - `e_verify` (R.5):       externalRef = `everify_cases/{caseId}` doc id
  //                             (Phase A bridge in `onEverifyCaseWriteUpdateReadiness`)
  //   - `background_check` /
  //     `drug_screen` (R.6):    externalRef = `backgroundChecks/{checkId}` doc id
  //                             (writer in `onBackgroundCheckWriteUpdateReadiness`)
  // The drawer the popover opens looks up the right collection from
  // `requirementType`, so we keep a single generic `caseId` field on the
  // contributor rather than parallel `caseId` / `checkId` slots. Other
  // employee item types reuse `externalRef` for their own vendor refs and
  // are not yet drawer-backed — we only surface it when the consumer
  // knows what to do with it.
  const requirementTypeCarriesCaseId =
    item.requirementType === 'e_verify' ||
    item.requirementType === 'background_check' ||
    item.requirementType === 'drug_screen';
  const caseId =
    requirementTypeCarriesCaseId &&
    typeof item.externalRef === 'string' &&
    item.externalRef.length > 0
      ? item.externalRef
      : undefined;
  return {
    source: 'employee',
    itemId: item.id,
    workerUid: item.workerUid,
    requirementType: item.requirementType,
    requirementLabel: jobReadinessChipLabelFor('employee', item.requirementType, item.requirementLabel),
    contribution,
    status: item.status as AssignmentReadinessItemStatus,
    resolutionMethod,
    severity,
    detail,
    ...(caseId ? { caseId } : {}),
  };
}

function buildText(state: JobReadinessChipState, pendingCount: number): string {
  switch (state) {
    case 'computing':
      return 'Job Ready (computing\u2026)';
    case 'legacy_review':
      // R.4.3 — distinct copy from `'computing'` so operators can tell at a
      // glance that this is a pre-R.1 assignment (action: backfill or
      // contact ops), not an in-flight seeder run.
      return 'Legacy \u2014 needs review';
    case 'red':
      return 'Job Not Ready';
    case 'yellow':
      return pendingCount > 0 ? `Job Ready (${pendingCount} pending)` : 'Job Ready';
    case 'green':
    default:
      return 'Job Ready';
  }
}

/**
 * Aggregate items into the chip data shape. Pure function — input / output
 * only, no side effects.
 */
export function computeJobReadinessChip(args: ComputeJobReadinessChipArgs): JobReadinessChipData {
  const contributors: JobReadinessChipContributor[] = [];

  for (const item of args.assignmentReadinessItems) {
    contributors.push(fromAssignmentItem(item));
  }
  for (const item of args.employeeReadinessItems) {
    const c = fromEmployeeItem(item);
    if (c) contributors.push(c);
  }

  // Greg's spec splits the empty case into two outcomes:
  //   - readinessSeeded === false  → 'computing' (don't accidentally show green)
  //   - readinessSeeded === true   → red orphan ("Readiness not yet computed")
  // This is the only path where an empty-input array produces a non-green
  // result — every other empty case (e.g. all 'not_applicable') resolves
  // green naturally because no contributor is red or yellow.
  //
  // **R.4.3 (defensive branch):** before falling into `'computing'`, check
  // whether the assignment predates the R.1 deploy. If so, the seeder
  // *can never* run for it without a R.4.2-style backfill — surfacing a
  // distinct `'legacy_review'` state instead of an indefinite spinner.
  // Strict-less-than against the floor: assignments AT the boundary
  // belong to the post-R.1 era (the const is the deploy timestamp itself,
  // not the moment after).
  if (contributors.length === 0) {
    if (!args.readinessSeeded) {
      if (
        typeof args.assignmentCreatedAtIso === 'string' &&
        args.assignmentCreatedAtIso < R1_DEPLOY_DATE_ISO
      ) {
        return {
          state: 'legacy_review',
          text: buildText('legacy_review', 0),
          pendingCount: 0,
          blockerCount: 0,
          contributors: [],
        };
      }
      return {
        state: 'computing',
        text: buildText('computing', 0),
        pendingCount: 0,
        blockerCount: 0,
        contributors: [],
      };
    }
    return {
      state: 'red',
      text: buildText('red', 0),
      pendingCount: 0,
      blockerCount: 0,
      contributors: [],
    };
  }

  let blockerCount = 0;
  let pendingCount = 0;
  for (const c of contributors) {
    if (c.contribution === 'red') blockerCount += 1;
    else if (c.contribution === 'yellow') pendingCount += 1;
  }

  contributors.sort(compareContributors);

  let state: JobReadinessChipState;
  if (blockerCount > 0) state = 'red';
  else if (pendingCount > 0) state = 'yellow';
  else state = 'green';

  return {
    state,
    text: buildText(state, pendingCount),
    pendingCount,
    blockerCount,
    contributors,
  };
}
