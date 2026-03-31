/**
 * ## Canonical UX model (Employment V2 header)
 *
 * **`EmploymentV2HeaderState` is the preferred chip + headline state** for:
 * - Admin: `EmploymentEntityHeaderCard` (`overview.employmentHeaderState`, `headerReadinessExplanation`)
 * - Worker: My Employment list/detail primary status chip
 *
 * Source: `buildEmploymentEntityOverview` merges pipeline blockers + path blockers (only when
 * `computeHasOpenOnboardingDemand` is true), derives actionable party, then calls `deriveEmploymentHeaderState` +
 * `employmentHeaderStateExplanation`.
 *
 * ## Temporary compatibility bridges (legacy Firestore / older UX)
 *
 * | Signal | Bridge behavior |
 * |--------|-----------------|
 * | `entity_employments.status === 'active'` | Maps to **`on_assignment`** (employment “active” ≈ placed worker; not the same as assignment `confirmed` alone). |
 * | Assignment normalized `in_progress` | **`on_assignment`** (live assignment / on-the-job). |
 * | `entity_employments.status === 'onboarding'` | Treated as in-flight onboarding when phase unknown → **`in_progress`**. |
 * | `entity_employments.status === 'blocked'` | **`action_required`** vs **`waiting_on_company`** from dominant actionable. |
 * | `terminated` / `inactive` | Header state **`terminated`** / **`inactive`** (canonical chip labels; no raw status in header UI). |
 * | `headerEmploymentStatus`, `lifecycleStatus`, `readinessChip` | Legacy summary-card fields; **`lifecycleStatus` is derived only from `employmentHeaderState`** in `buildEmploymentEntityOverview`. Prefer `employmentHeaderState` for any header/chip UX. |
 *
 * ## Convergence roadmap (single mental model)
 *
 * 1. **Header:** only `EmploymentV2HeaderState` + explanations (primary headers done).
 * 2. **`lifecycleStatus`:** deprecated overview field; derived from `employmentHeaderState` only (see `lifecycleStatusFromEmploymentHeaderState`).
 * 3. **`readinessChip`:** derive from shared inputs with header, or one `deriveEmploymentSurfaceState` for admin summary + worker.
 * 4. **`getWorkerReadiness`:** optionally accept per-entity `EmploymentV2HeaderState` (or shared derive inputs) so banners and chips agree; keep compliance + payroll hard gates here.
 * 5. **Assignment confirm → pipeline:** `ensureWorkerOnboardingPipelineForAssignmentConfirmed` from `workerOnboardingPipeline.ts` (Firestore trigger path; `triggerSource: "assignment_confirmed"`).
 *
 * ---
 *
 * ## Staged convergence: `lifecycleStatus`, `readinessChip`, `getWorkerReadiness`
 *
 * **Stage 1 (current):** Headers and primary chips use `EmploymentV2HeaderState` only; legacy fields remain on
 * `EmploymentEntityOverview` for summary cards and banners.
 *
 * **Stage 2 (done):** `lifecycleStatus` on `EmploymentEntityOverview` is a derived alias of `employmentHeaderState`
 * via `lifecycleStatusFromEmploymentHeaderState` — not an independent semantic.
 *
 * **Stage 3:** Collapse `readinessChip` into the same derivation (or drive it from header state + compliance
 * flags) so admin “summary” row chips do not contradict headers.
 *
 * **Stage 4:** Extend `getWorkerReadiness` inputs with optional per-entity `EmploymentV2HeaderState` (or shared
 * `DeriveEmploymentHeaderStateArgs`) so worker banners align with chips; keep compliance + payroll hard gates
 * exclusively in `workerReadiness.ts`.
 *
 * **Stage 5:** Remove `HeaderEmploymentStatus` and duplicate lifecycle strings once no consumers remain.
 */

import type {
  EmploymentAssignmentSummary,
  EmploymentBlockerItem,
  EmploymentLifecycleStatus,
  EmploymentOnboardingRow,
  EmploymentOnboardingRowActionableBy,
  EmploymentV2HeaderState,
  HeaderEmploymentStatus,
} from '../pages/UserProfile/components/employment-v2/employmentV2Types';
import { isOnboardingPathRowBlocker } from './employmentOnboardingPath';
import {
  isAssignmentTerminalNormalized,
  normalizeAssignmentStatus,
  type AssignmentStatusCanonical,
} from './assignmentStatusNormalize';

export interface DeriveEmploymentHeaderStateArgs {
  /** From `entity_employments.onboardingPhase` (or legacy inference). */
  onboardingPhase?: string | null;
  /** Pipeline tasks + path-derived synthetic blockers (merged by caller). */
  blockers: EmploymentBlockerItem[];
  /**
   * Dominant party for open gates — usually from blocking path rows; `none` if caller derives from pipeline only.
   */
  actionableBy: EmploymentOnboardingRowActionableBy | 'mixed' | 'none';
  /** Use best “current” assignment for this entity (see `primaryAssignmentStatusForHeader`). */
  assignmentStatus?: string | null;
  /** Raw `entity_employments.status` — `active` ≠ assignment `confirmed` during onboarding. */
  entityEmploymentStatus?: string | null;
  /**
   * When false, stale pipeline/path/phase must not read as active onboarding (no live assignment demand).
   * Set from `computeHasOpenOnboardingDemand`.
   */
  hasOpenOnboardingDemand: boolean;
  /** From `entity_employments.employmentEntryMode` — drives on-call pool header when `status === active` without assignments. */
  employmentEntryMode?: 'assignment_based' | 'on_call_pool' | string | null;
  /** True when there is at least one non-terminal assignment for this entity (pending / confirmed / in_progress). */
  hasNonTerminalAssignment?: boolean;
}

function normalizeOnboardingPhase(raw: string | null | undefined): 'not_started' | 'in_progress' | 'complete' | 'unknown' {
  const s = String(raw || '')
    .trim()
    .toLowerCase();
  if (!s) return 'unknown';
  if (s === 'not_started' || s === 'none') return 'not_started';
  if (s === 'in_progress' || s === 'onboarding') return 'in_progress';
  if (s === 'complete' || s === 'completed' || s === 'done') return 'complete';
  return 'unknown';
}

/** Prefer the most advanced non-terminal assignment for header semantics. */
export function primaryAssignmentRowForHeader(
  assignments: EmploymentAssignmentSummary[] | undefined
): EmploymentAssignmentSummary | null {
  if (!assignments?.length) return null;
  const live = assignments.filter((a) => !isAssignmentTerminalNormalized(a.status));
  if (live.length === 0) return null;
  const rank: Record<AssignmentStatusCanonical, number> = {
    in_progress: 3,
    confirmed: 2,
    pending: 1,
    completed: 0,
    cancelled: 0,
  };
  let best: EmploymentAssignmentSummary | null = null;
  let score = -1;
  for (const a of live) {
    const n = normalizeAssignmentStatus(a.status);
    const r = rank[n] ?? 0;
    if (r > score) {
      score = r;
      best = a;
    }
  }
  return best;
}

export function primaryAssignmentStatusForHeader(
  assignments: Pick<EmploymentAssignmentSummary, 'status'>[] | undefined
): AssignmentStatusCanonical | null {
  const row = primaryAssignmentRowForHeader(assignments as EmploymentAssignmentSummary[]);
  return row ? normalizeAssignmentStatus(row.status) : null;
}

/**
 * Whether current UX should treat onboarding as **actively demanded** (vs historical pipeline/path only).
 *
 * **true** when:
 * - `entity_employments.status` is **`active`** or **`blocked`**, or
 * - `entity_employments.status` is **`onboarding`** and `employmentEntryMode === 'on_call_pool'` (labor pool / pre-assignment hire), or
 * - `assignments` is a non-empty array with at least one **non-terminal** row (`pending` / `confirmed` / `in_progress`).
 *
 * **false** when assignments are missing, empty, or all terminal — unless employment is `active`/`blocked` or on-call onboarding.
 * (`assignments === undefined` → no live-assignment proof → **false** for that leg unless on-call onboarding.)
 */
export function computeHasOpenOnboardingDemand(args: {
  assignments: EmploymentAssignmentSummary[] | undefined;
  entityEmploymentStatus?: string | null;
  /** Pre-assignment / on-call pool hire — relationship onboarding without a live assignment. */
  employmentEntryMode?: 'assignment_based' | 'on_call_pool' | string | null;
}): boolean {
  const ee = String(args.entityEmploymentStatus || '')
    .trim()
    .toLowerCase();
  const list = args.assignments;
  const hasLiveAssignment = list?.length ? primaryAssignmentRowForHeader(list) != null : false;
  const mode = String(args.employmentEntryMode || '').trim().toLowerCase();

  if (ee === 'active' || ee === 'blocked') {
    // Labor pool: `active` without a live assignment means ready in pool, not assignment-driven onboarding demand.
    if (ee === 'active' && mode === 'on_call_pool' && !hasLiveAssignment) {
      return false;
    }
    return true;
  }
  if (ee === 'onboarding' && mode === 'on_call_pool') return true;
  if (!list?.length) return false;
  return hasLiveAssignment;
}

export function employmentBlockerItemFromPathRow(row: EmploymentOnboardingRow): EmploymentBlockerItem {
  const st = String(row.status || '').toLowerCase();
  const status: EmploymentBlockerItem['status'] =
    st === 'error' ? 'error' : st === 'blocked' ? 'blocked' : 'action_needed';
  return {
    id: `path__${row.rowId}`,
    groupId: row.groupId,
    title: row.label,
    owner: row.owner,
    status,
  };
}

/**
 * Dominant accountable party for header messaging when path blockers exist; else from pipeline blockers’ owners.
 */
export function deriveDominantActionableForHeader(
  pathBlockingRows: EmploymentOnboardingRow[],
  pipelineBlockers: EmploymentBlockerItem[]
): EmploymentOnboardingRowActionableBy | 'mixed' | 'none' {
  const blockers = pathBlockingRows.filter(isOnboardingPathRowBlocker);
  if (blockers.length > 0) {
    const ab = new Set(blockers.map((r) => r.actionableBy));
    if (ab.has('either')) return 'mixed';
    if (ab.has('worker') && ab.has('recruiter')) return 'mixed';
    if (ab.has('worker')) return 'worker';
    if (ab.has('recruiter')) return 'recruiter';
    if (ab.has('none')) return 'none';
  }
  const owners = new Set(pipelineBlockers.map((b) => b.owner));
  if (owners.has('worker') && owners.has('recruiter')) return 'mixed';
  if (owners.has('recruiter')) return 'recruiter';
  if (owners.has('worker')) return 'worker';
  if (owners.has('system') || owners.has('vendor')) return 'recruiter';
  return 'none';
}

export function deriveEmploymentHeaderState(args: DeriveEmploymentHeaderStateArgs): EmploymentV2HeaderState {
  const phase = normalizeOnboardingPhase(args.onboardingPhase);
  const ee = String(args.entityEmploymentStatus || '')
    .trim()
    .toLowerCase();
  const assign = args.assignmentStatus != null ? normalizeAssignmentStatus(args.assignmentStatus) : null;
  const demand = args.hasOpenOnboardingDemand;

  const hasBlockers = args.blockers.length > 0;
  const actionable = args.actionableBy;

  if (ee === 'terminated') {
    return 'terminated';
  }
  if (ee === 'inactive') {
    return 'inactive';
  }

  if (ee === 'blocked') {
    if (actionable === 'worker' || actionable === 'either') return 'action_required';
    return 'waiting_on_company';
  }

  // Bridge: legacy employment row "active" → header "on_assignment" (distinct from assignment `confirmed`).
  // On-call pool: `active` with no live assignment means ready in the labor pool, not on a job.
  if (ee === 'active') {
    const mode = String(args.employmentEntryMode || '').trim().toLowerCase();
    if (mode === 'on_call_pool' && !args.hasNonTerminalAssignment) {
      return 'ready';
    }
    return 'on_assignment';
  }

  if (assign === 'in_progress') {
    return 'on_assignment';
  }

  if (!demand) {
    return 'not_started';
  }

  if (hasBlockers) {
    if (actionable === 'worker' || actionable === 'either') return 'action_required';
    if (actionable === 'recruiter' || actionable === 'mixed') return 'waiting_on_company';
    return 'waiting_on_company';
  }

  if (phase === 'complete') {
    return 'ready';
  }

  if (phase === 'in_progress') {
    return 'in_progress';
  }

  if (assign === 'confirmed') {
    return 'in_progress';
  }

  if (assign === 'pending' && !hasBlockers && phase === 'not_started') {
    return 'not_started';
  }

  if (ee === 'onboarding' || phase === 'unknown') {
    return 'in_progress';
  }

  return 'not_started';
}

/** Maps canonical header → legacy `EmploymentLifecycleStatus` for `EmploymentEntityOverview.lifecycleStatus` only. */
export function lifecycleStatusFromEmploymentHeaderState(header: EmploymentV2HeaderState): EmploymentLifecycleStatus {
  switch (header) {
    case 'not_started':
      return 'not_started';
    case 'in_progress':
    case 'waiting_on_company':
      return 'onboarding';
    case 'action_required':
      return 'blocked';
    case 'ready':
      return 'ready';
    case 'on_assignment':
      return 'active';
    case 'terminated':
      return 'terminated';
    case 'inactive':
      return 'inactive';
    default:
      return 'not_started';
  }
}

/** Maps canonical header → legacy `HeaderEmploymentStatus` for overview compatibility. */
export function headerEmploymentStatusFromEmploymentHeaderState(
  header: EmploymentV2HeaderState
): HeaderEmploymentStatus {
  switch (header) {
    case 'not_started':
      return 'none';
    case 'in_progress':
    case 'waiting_on_company':
      return 'onboarding';
    case 'action_required':
      return 'blocked';
    case 'ready':
      return 'ready';
    case 'on_assignment':
      return 'active';
    case 'terminated':
      return 'terminated';
    case 'inactive':
      return 'inactive';
    default:
      return 'none';
  }
}

export function employmentHeaderStateLabel(state: EmploymentV2HeaderState): string {
  const labels: Record<EmploymentV2HeaderState, string> = {
    not_started: 'Not started',
    in_progress: 'In progress',
    action_required: 'Action required',
    waiting_on_company: 'Waiting on company',
    ready: 'Ready',
    on_assignment: 'On assignment',
    terminated: 'Terminated',
    inactive: 'Inactive',
  };
  return labels[state];
}

export function employmentHeaderStateExplanation(
  state: EmploymentV2HeaderState,
  opts: {
    pathBlockerCount: number;
    pathRowCount: number;
    pathDoneCount: number;
    pipelineBlockerCount: number;
  },
  meta?: {
    noOpenOnboardingDemand?: boolean;
    /**
     * When true, omit numeric blocker / open-step tallies — UI shows categorized blocker chips instead.
     */
    suppressBlockerCountsInCopy?: boolean;
  }
): string {
  const { pathBlockerCount, pathRowCount, pathDoneCount, pipelineBlockerCount } = opts;
  const openPathSteps = Math.max(0, pathRowCount - pathDoneCount);
  const shortCounts = meta?.suppressBlockerCountsInCopy === true;

  switch (state) {
    case 'not_started':
      if (meta?.noOpenOnboardingDemand) {
        return 'No current assignment onboarding for this entity. Historical onboarding data may still appear below.';
      }
      return 'Onboarding has not started for this entity yet.';
    case 'on_assignment':
      return 'You are active on a live assignment for this entity.';
    case 'ready':
      return 'Relationship onboarding requirements are satisfied — ready for next steps.';
    case 'action_required':
      if (pathBlockerCount > 0) {
        if (shortCounts) {
          return 'Something on the onboarding path needs attention — use the checklist below.';
        }
        return `${pathBlockerCount} blocking item${pathBlockerCount === 1 ? '' : 's'} need your attention on the onboarding path.`;
      }
      return 'Complete your open onboarding tasks to continue.';
    case 'waiting_on_company':
      if (pathBlockerCount > 0) {
        if (shortCounts) {
          return 'Some blocking items are waiting on your hiring team or a partner.';
        }
        return `${pathBlockerCount} blocking item${pathBlockerCount === 1 ? '' : 's'} are waiting on your hiring team or a partner.`;
      }
      if (pipelineBlockerCount > 0) {
        return 'Waiting on your hiring team or a partner to finish internal onboarding steps.';
      }
      return 'Waiting on your hiring team for the next onboarding step.';
    case 'in_progress':
      if (pathBlockerCount > 0) {
        if (shortCounts) {
          return 'Onboarding in progress.';
        }
        return `${pathBlockerCount} blocking item${pathBlockerCount === 1 ? '' : 's'} remain on the onboarding path.`;
      }
      if (openPathSteps > 0) {
        if (shortCounts) {
          return 'Onboarding in progress.';
        }
        return `Onboarding in progress (${openPathSteps} open path step${openPathSteps === 1 ? '' : 's'}).`;
      }
      return 'Onboarding in progress.';
    case 'terminated':
      return 'This employment relationship is terminated.';
    case 'inactive':
      return 'This employment is inactive.';
    default:
      return '';
  }
}

/** @internal For tests / worker list when entity tab context is unavailable. */
export function deriveEmploymentHeaderStateWorkerListFallback(args: {
  onboardingPhase?: string | null;
  entityEmploymentStatus?: string | null;
  /** True when pipeline has any incomplete applicable step (client-side hint). */
  pipelineIncomplete?: boolean;
  /**
   * When false, ignore phase/pipeline incomplete for active-looking chips (e.g. all assignments terminal).
   * When omitted, treated as true.
   */
  hasOpenOnboardingDemand?: boolean;
  employmentEntryMode?: string | null;
  /** When false and `employmentEntryMode === on_call_pool`, `active` maps to ready (labor pool), not on a job. */
  hasNonTerminalAssignment?: boolean;
}): EmploymentV2HeaderState {
  const phase = normalizeOnboardingPhase(args.onboardingPhase);
  const ee = String(args.entityEmploymentStatus || '')
    .trim()
    .toLowerCase();
  const demand = args.hasOpenOnboardingDemand !== false;

  if (ee === 'terminated') return 'terminated';
  if (ee === 'inactive') return 'inactive';
  if (ee === 'active') {
    const mode = String(args.employmentEntryMode || '').toLowerCase();
    if (mode === 'on_call_pool' && args.hasNonTerminalAssignment === false) return 'ready';
    return 'on_assignment';
  }
  if (demand && phase === 'complete' && !args.pipelineIncomplete) return 'ready';
  if (demand && (phase === 'in_progress' || ee === 'onboarding' || args.pipelineIncomplete)) return 'in_progress';
  return 'not_started';
}
