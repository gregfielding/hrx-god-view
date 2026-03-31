/**
 * Canonical Employment V2 blocker → primary action mapping.
 * Use with `isOnboardingPathRowBlocker` from `employmentOnboardingPath.ts` so only true blockers get actions.
 *
 * Owner vocabulary matches `EmploymentBlockerItem.owner` and path row `owner` (`EmploymentOnboardingPathRowOwner`).
 */

import type {
  EmploymentBlockerItem,
  EmploymentOnboardingRow,
} from '../pages/UserProfile/components/employment-v2/employmentV2Types';
import { isOnboardingPathRowBlocker } from './employmentOnboardingPath';

/** Richer than legacy `EmploymentBlockerItem.actionKind`; map via `legacyActionKind`. */
export type EmploymentV2ActionKind =
  | 'navigate'
  | 'callable'
  | 'open_url'
  | 'compose_message'
  | 'review_panel'
  | 'none';

export type EmploymentV2ActionOwner = EmploymentBlockerItem['owner'];

export interface EmploymentV2ActionTarget {
  /** React Router pattern; replace `:assignmentId`, `:employmentId`, `:uid`, `:tenantSlug`. */
  routeTemplate?: string;
  /** Firebase callable id (see `httpsCallable(functions, id)` in app). */
  callableId?: string;
  /** Context field that supplies the URL (e.g. payroll portal from `EmploymentPayrollSummary.portalUrl`). */
  urlContextKey?: 'payrollPortalUrl';
  /** Human-readable navigation target when there is no stable deep link yet. */
  componentHint?: string;
}

export interface EmploymentV2BlockerAction {
  actionKey: string;
  actionLabel: string;
  actionKind: EmploymentV2ActionKind;
  /** Bridge to existing blocker card / chips. */
  legacyActionKind?: EmploymentBlockerItem['actionKind'];
  owner: EmploymentV2ActionOwner;
  target: EmploymentV2ActionTarget;
  /** Scope notes (Select-only, recruiter UI, etc.). */
  notes?: string;
}

/** One row per blocker scenario you asked to cover; stable keys for analytics and tests. */
export const EMPLOYMENT_V2_BLOCKER_ACTION_SCENARIOS: readonly EmploymentV2BlockerAction[] = [
  {
    actionKey: 'i9.worker_complete',
    actionLabel: 'Open work authorization',
    actionKind: 'navigate',
    legacyActionKind: 'open_system',
    owner: 'worker',
    target: {
      routeTemplate: '/c1/workers/my-employment/:employmentId',
      componentHint: 'C1WorkerMyEmploymentDetail — I-9 section',
    },
    notes: 'Requires `entityEmploymentFirestoreId` (or list position) in context. Select / workforce entities.',
  },
  {
    actionKey: 'i9.recruiter_send',
    actionLabel: 'Review I-9 workflow',
    actionKind: 'review_panel',
    legacyActionKind: 'review',
    owner: 'recruiter',
    target: {
      routeTemplate: '/users/:uid',
      componentHint: 'UserProfile → Employment tab (pipeline / entity context)',
    },
    notes: 'No dedicated “send I-9” callable in web app yet; operational action may be out-of-band or future messaging.',
  },
  {
    actionKey: 'everify.select.check_eligibility',
    actionLabel: 'Check E-Verify eligibility',
    actionKind: 'callable',
    legacyActionKind: 'start_everify',
    owner: 'recruiter',
    target: { callableId: 'everifyCheckEligibility', componentHint: 'EverifyComplianceCard' },
    notes: 'C1 Select entity only; gated by `canManageEverifyFromClaims`.',
  },
  {
    actionKey: 'everify.select.create_case',
    actionLabel: 'Create E-Verify case',
    actionKind: 'callable',
    legacyActionKind: 'start_everify',
    owner: 'recruiter',
    target: { callableId: 'everifyCreateCase', componentHint: 'EverifyComplianceCard' },
    notes: 'After eligibility OK. Same gates as check.',
  },
  {
    actionKey: 'everify.select.in_progress',
    actionLabel: 'Open E-Verify status',
    actionKind: 'review_panel',
    legacyActionKind: 'review',
    owner: 'recruiter',
    target: {
      routeTemplate: '/users/:uid',
      componentHint: 'UserProfile → Employment or Backgrounds (E-Verify card)',
    },
    notes: 'Polling is system-owned; UI is review-only until worker/I-9 prerequisites clear.',
  },
  {
    actionKey: 'everify.select.error_retry',
    actionLabel: 'Retry E-Verify case',
    actionKind: 'callable',
    legacyActionKind: 'start_everify',
    owner: 'recruiter',
    target: { callableId: 'everifyRetryCase', componentHint: 'EverifyComplianceCard' },
    notes: 'Select only; depends on case id from `everify_cases_public`.',
  },
  {
    actionKey: 'payroll.worker_open_portal',
    actionLabel: 'Open payroll setup',
    actionKind: 'open_url',
    legacyActionKind: 'open_system',
    owner: 'worker',
    target: { urlContextKey: 'payrollPortalUrl', componentHint: 'Everee / payroll provider portal' },
    notes: 'Uses `WorkerPayrollAccount` / summary `portalUrl` when present.',
  },
  {
    actionKey: 'payroll.worker_fallback_employment',
    actionLabel: 'Open My Employment',
    actionKind: 'navigate',
    legacyActionKind: 'open_system',
    owner: 'worker',
    target: { routeTemplate: '/c1/workers/my-employment/:employmentId' },
    notes: 'When portal URL missing; still shows payroll status in employment detail.',
  },
  {
    actionKey: 'payroll.recruiter_review',
    actionLabel: 'Review payroll setup',
    actionKind: 'review_panel',
    legacyActionKind: 'review',
    owner: 'recruiter',
    target: { routeTemplate: '/users/:uid', componentHint: 'UserProfile → Employment tab' },
    notes: 'Invite/send flows may be external or future `send_reminder` integration.',
  },
  {
    actionKey: 'background.recruiter_order',
    actionLabel: 'Order background check',
    actionKind: 'callable',
    legacyActionKind: 'order_screening',
    owner: 'recruiter',
    target: {
      callableId: 'createAccusourceBackgroundCheck',
      routeTemplate: '/users/:uid',
      componentHint: 'BackgroundsComplianceTab',
    },
    notes: 'Callable + package selection UI exists on Backgrounds tab; needs tenant AccuSource config and claims.',
  },
  {
    actionKey: 'background.vendor_in_progress',
    actionLabel: 'View screening status',
    actionKind: 'review_panel',
    legacyActionKind: 'review',
    owner: 'recruiter',
    target: { routeTemplate: '/users/:uid', componentHint: 'UserProfile → Backgrounds tab' },
    notes: 'Vendor executes the check; primary CTA is recruiter review in-app (operational owner: vendor).',
  },
  {
    actionKey: 'background.error_recruiter',
    actionLabel: 'Review screening error',
    actionKind: 'review_panel',
    legacyActionKind: 'review',
    owner: 'recruiter',
    target: { routeTemplate: '/users/:uid', componentHint: 'BackgroundsComplianceTab' },
    notes: 'Retry/support policy TBD; PDF via `getAccusourceBackgroundCheckPdf` where applicable.',
  },
  {
    actionKey: 'assignment.open_worker_package',
    actionLabel: 'Open assignment onboarding',
    actionKind: 'navigate',
    legacyActionKind: 'open_assignment',
    owner: 'worker',
    target: { routeTemplate: '/c1/workers/assignments/:assignmentId', componentHint: 'AssignmentDetails' },
    notes: 'Uses `sourceRef.assignmentId` from path row.',
  },
  {
    actionKey: 'assignment.recruiter_open',
    actionLabel: 'Open assignment',
    actionKind: 'navigate',
    legacyActionKind: 'open_assignment',
    owner: 'recruiter',
    target: {
      routeTemplate: '/:tenantSlug/assignments/:assignmentId',
      componentHint: 'AssignmentDetails (tenant-scoped)',
    },
    notes: 'Requires `tenantSlug` in context for pretty URLs; else use internal assignments UX.',
  },
  {
    actionKey: 'internal.recruiter_task_queue',
    actionLabel: 'Open tasks',
    actionKind: 'navigate',
    legacyActionKind: 'review',
    owner: 'recruiter',
    target: { routeTemplate: '/tasks', componentHint: 'Global tasks list (security level 5)' },
    notes: 'Pipeline task rows do not yet embed deep links to a single task; `/tasks` is best-effort.',
  },
  {
    actionKey: 'internal.worker_task',
    actionLabel: 'Open My Employment',
    actionKind: 'navigate',
    legacyActionKind: 'open_system',
    owner: 'worker',
    target: { routeTemplate: '/c1/workers/my-employment/:employmentId' },
    notes: 'Worker-owned internal tasks are rare; align with employment hub.',
  },
  {
    actionKey: 'path.worker_fallback_my_employment',
    actionLabel: 'Open My Employment',
    actionKind: 'navigate',
    legacyActionKind: 'open_system',
    owner: 'worker',
    target: { routeTemplate: '/c1/workers/my-employment/:employmentId', componentHint: 'C1WorkerMyEmploymentDetail' },
    notes: 'Last-resort CTA when no finer-grained blocker mapping exists.',
  },
  {
    actionKey: 'path.recruiter_fallback_profile',
    actionLabel: 'Review onboarding in profile',
    actionKind: 'review_panel',
    legacyActionKind: 'review',
    owner: 'recruiter',
    target: { routeTemplate: '/users/:uid', componentHint: 'UserProfile → Employment tab' },
    notes: 'Last-resort CTA for blocking rows without a dedicated scenario.',
  },
];

export interface EmploymentV2ActionResolutionContext {
  userId: string;
  tenantId: string;
  tenantSlug?: string;
  /**
   * UserProfile / worker context: assignment rows use worker vs recruiter routes.
   * Employment V2 on the admin profile should pass `recruiter`.
   */
  viewer: 'recruiter' | 'worker';
  /**
   * Admin profile: profile user’s name for third-person copy (e.g. “Who is handling this: Gregory Fielding”).
   * Omit on worker-facing surfaces; falls back to “The worker”.
   */
  workerDisplayName?: string | null;
  /**
   * Hiring entity shown on this tab (`overview.headerEntityName`). Used for recruiter-owned rows in admin UI.
   */
  entityDisplayName?: string | null;
  /** `entity_employments` document id for C1 my-employment detail route. */
  entityEmploymentFirestoreId?: string | null;
  payrollPortalUrl?: string | null;
  /** C1 Select E-Verify check/create: optional assignment link (mirrors EverifyComplianceCard). */
  everifyAssignmentId?: string | null;
}

/** Map path row owner to blocker action owner; tolerate legacy `'admin'` if present at runtime. */
function ownerFromRow(row: EmploymentOnboardingRow): EmploymentV2ActionOwner {
  const o = row.owner as EmploymentV2ActionOwner | 'admin';
  return o === 'admin' ? 'recruiter' : o;
}

const PATH_REQ_E_VERIFY = 'e_verify';
const PATH_REQ_BACKGROUND_CHECK = 'background_check';

function pathRowRequirementKey(row: EmploymentOnboardingRow): string | undefined {
  const k = row.sourceRef?.requirementKey;
  return typeof k === 'string' && k.length > 0 ? k : undefined;
}

function pathRowExternalBusinessKey(row: EmploymentOnboardingRow): string | undefined {
  const k = row.sourceRef?.externalStepKey;
  return typeof k === 'string' && k.length > 0 ? k : undefined;
}

function pathRowMergedFromKeys(row: EmploymentOnboardingRow): string[] | undefined {
  return row.sourceRef?.mergedFromStepKeys;
}

/** Select entity E-Verify path row — uses `requirementKey` / merged Settings keys, not only representative `stepKey`. */
function isSelectEverifyPathRow(row: EmploymentOnboardingRow): boolean {
  if (row.entityKey !== 'select') return false;
  if (pathRowRequirementKey(row) === PATH_REQ_E_VERIFY) return true;
  if (row.stepKey.startsWith('everify_')) return true;
  return Boolean(pathRowMergedFromKeys(row)?.some((k) => k.startsWith('everify_')));
}

/** Background screening path row (merged or single milestone). */
function isBackgroundScreeningsPathRow(row: EmploymentOnboardingRow): boolean {
  if (row.groupId !== 'screenings') return false;
  if (pathRowRequirementKey(row) === PATH_REQ_BACKGROUND_CHECK) return true;
  if (row.sourceType === 'background_check') return true;
  if (row.stepKey.startsWith('background_')) return true;
  return Boolean(pathRowMergedFromKeys(row)?.some((k) => k.startsWith('background_')));
}

/** Payroll invite + setup (same external business key when mapped). */
function isPayrollOnboardingPathRow(row: EmploymentOnboardingRow): boolean {
  if (row.groupId !== 'payroll') return false;
  const req = pathRowRequirementKey(row);
  const ext = pathRowExternalBusinessKey(row);
  return (
    req === 'payroll_onboarding' ||
    ext === 'payroll_onboarding' ||
    row.stepKey === 'payroll_invite_sent' ||
    row.stepKey === 'payroll_setup_complete'
  );
}

/**
 * Scenario-specific mapping only (no last-resort fallbacks). For diagnostics / gap detection.
 */
function resolveEmploymentV2DedicatedPrimaryAction(
  row: EmploymentOnboardingRow,
  ctx: EmploymentV2ActionResolutionContext
): EmploymentV2BlockerAction | null {
  const owner = ownerFromRow(row);
  const { status, groupId, stepKey } = row;
  const assignmentId = row.sourceRef?.assignmentId;

  if (groupId === 'assignment_requirements' && assignmentId) {
    if (ctx.viewer === 'worker') {
      return {
        actionKey: 'assignment.open_worker_package',
        actionLabel: 'Open assignment onboarding',
        actionKind: 'navigate',
        legacyActionKind: 'open_assignment',
        owner: 'worker',
        target: {
          routeTemplate: '/c1/workers/assignments/:assignmentId',
          componentHint: 'AssignmentDetails',
        },
      };
    }
    return {
      actionKey: 'assignment.recruiter_open',
      actionLabel: 'Open assignment',
      actionKind: 'navigate',
      legacyActionKind: 'open_assignment',
      owner: 'recruiter',
      target: {
        routeTemplate: ctx.tenantSlug
          ? '/:tenantSlug/assignments/:assignmentId'
          : '/c1/workers/assignments/:assignmentId',
        componentHint: 'AssignmentDetails',
      },
    };
  }

  if (groupId === 'internal_readiness') {
    if (owner === 'recruiter') {
      return {
        actionKey: 'internal.recruiter_task_queue',
        actionLabel: 'Open tasks',
        actionKind: 'navigate',
        legacyActionKind: 'review',
        owner: 'recruiter',
        target: { routeTemplate: '/tasks', componentHint: 'Global tasks list (security level 5)' },
      };
    }
    return {
      actionKey: 'internal.worker_task',
      actionLabel: 'Open My Employment',
      actionKind: 'navigate',
      legacyActionKind: 'open_system',
      owner: 'worker',
      target: { routeTemplate: '/c1/workers/my-employment/:employmentId' },
    };
  }

  if (groupId === 'work_authorization') {
    if (stepKey === 'i9_sent' && owner === 'recruiter') {
      return {
        actionKey: 'i9.recruiter_send',
        actionLabel: 'Review I-9 workflow',
        actionKind: 'review_panel',
        legacyActionKind: 'review',
        owner: 'recruiter',
        target: {
          routeTemplate: '/users/:uid',
          componentHint: 'UserProfile → Employment tab',
        },
      };
    }
    if (stepKey.startsWith('i9_') && owner === 'worker') {
      return {
        actionKey: 'i9.worker_complete',
        actionLabel: 'Open work authorization',
        actionKind: 'navigate',
        legacyActionKind: 'open_system',
        owner: 'worker',
        target: {
          routeTemplate: '/c1/workers/my-employment/:employmentId',
          componentHint: 'C1WorkerMyEmploymentDetail',
        },
      };
    }
    if (isSelectEverifyPathRow(row)) {
      if (status === 'error') {
        return {
          actionKey: 'everify.select.error_retry',
          actionLabel: 'Retry E-Verify case',
          actionKind: 'callable',
          legacyActionKind: 'start_everify',
          owner: 'recruiter',
          target: { callableId: 'everifyRetryCase', componentHint: 'EverifyComplianceCard' },
        };
      }
      if (status === 'not_started') {
        return {
          actionKey: 'everify.select.check_eligibility',
          actionLabel: 'Check E-Verify eligibility',
          actionKind: 'callable',
          legacyActionKind: 'start_everify',
          owner: 'recruiter',
          target: { callableId: 'everifyCheckEligibility', componentHint: 'EverifyComplianceCard' },
        };
      }
      if (status === 'in_progress') {
        return {
          actionKey: 'everify.select.in_progress',
          actionLabel: 'Open E-Verify status',
          actionKind: 'review_panel',
          legacyActionKind: 'review',
          owner: 'recruiter',
          target: {
            routeTemplate: '/users/:uid',
            componentHint: 'UserProfile → Employment / E-Verify card',
          },
        };
      }
    }
  }

  if (groupId === 'payroll') {
    if (
      ctx.viewer === 'worker' &&
      owner === 'worker' &&
      (stepKey === 'payroll_setup_complete' || stepKey.startsWith('direct_deposit'))
    ) {
      if (ctx.payrollPortalUrl) {
        return {
          actionKey: 'payroll.worker_open_portal',
          actionLabel: 'Open payroll setup',
          actionKind: 'open_url',
          legacyActionKind: 'open_system',
          owner: 'worker',
          target: { urlContextKey: 'payrollPortalUrl' },
        };
      }
      return {
        actionKey: 'payroll.worker_fallback_employment',
        actionLabel: 'Open My Employment',
        actionKind: 'navigate',
        legacyActionKind: 'open_system',
        owner: 'worker',
        target: { routeTemplate: '/c1/workers/my-employment/:employmentId' },
      };
    }
    if (ctx.viewer === 'recruiter' && isPayrollOnboardingPathRow(row)) {
      return {
        actionKey: 'payroll.recruiter_review',
        actionLabel: 'Review payroll setup',
        actionKind: 'review_panel',
        legacyActionKind: 'review',
        owner: 'recruiter',
        target: { routeTemplate: '/users/:uid', componentHint: 'UserProfile → Employment tab' },
      };
    }
  }

  if (isBackgroundScreeningsPathRow(row)) {
    if (status === 'error') {
      return {
        actionKey: 'background.error_recruiter',
        actionLabel: 'Review screening error',
        actionKind: 'review_panel',
        legacyActionKind: 'review',
        owner: 'recruiter',
        target: { routeTemplate: '/users/:uid', componentHint: 'BackgroundsComplianceTab' },
      };
    }
    if (status === 'in_progress') {
      return {
        actionKey: 'background.vendor_in_progress',
        actionLabel: 'View screening status',
        actionKind: 'review_panel',
        legacyActionKind: 'review',
        owner: 'recruiter',
        target: { routeTemplate: '/users/:uid', componentHint: 'UserProfile → Backgrounds tab' },
      };
    }
    if (status === 'not_started') {
      return {
        actionKey: 'background.recruiter_order',
        actionLabel: 'Order background check',
        actionKind: 'callable',
        legacyActionKind: 'order_screening',
        owner: 'recruiter',
        target: {
          callableId: 'createAccusourceBackgroundCheck',
          routeTemplate: '/users/:uid',
          componentHint: 'BackgroundsComplianceTab',
        },
      };
    }
  }

  return null;
}

/**
 * Primary action for a path row when it is a blocker; otherwise `null`.
 * Heuristics use `stepKey`, `groupId`, `status`, `entityKey`, and `sourceRef.requirementKey` / `externalStepKey`.
 * Last-resort fallbacks ensure every blocking row still has a navigable CTA.
 */
export function resolveEmploymentV2PrimaryAction(
  row: EmploymentOnboardingRow,
  ctx: EmploymentV2ActionResolutionContext
): EmploymentV2BlockerAction | null {
  if (!isOnboardingPathRowBlocker(row)) return null;
  const dedicated = resolveEmploymentV2DedicatedPrimaryAction(row, ctx);
  if (dedicated) return dedicated;
  if (ctx.viewer === 'worker') {
    return {
      actionKey: 'path.worker_fallback_my_employment',
      actionLabel: 'Open My Employment',
      actionKind: 'navigate',
      legacyActionKind: 'open_system',
      owner: 'worker',
      target: {
        routeTemplate: '/c1/workers/my-employment/:employmentId',
        componentHint: 'C1WorkerMyEmploymentDetail',
      },
    };
  }
  return {
    actionKey: 'path.recruiter_fallback_profile',
    actionLabel: 'Review onboarding in profile',
    actionKind: 'review_panel',
    legacyActionKind: 'review',
    owner: 'recruiter',
    target: { routeTemplate: '/users/:uid', componentHint: 'UserProfile → Employment tab' },
  };
}

/** Blocking rows with no dedicated scenario mapping (still receive fallback CTAs). Dev diagnostics. */
export function findBlockingRowsMissingDedicatedAction(
  rows: EmploymentOnboardingRow[],
  ctx: EmploymentV2ActionResolutionContext
): EmploymentOnboardingRow[] {
  return rows.filter(
    (r) => isOnboardingPathRowBlocker(r) && resolveEmploymentV2DedicatedPrimaryAction(r, ctx) == null
  );
}

export function warnBlockingPathRowsMissingDedicatedActions(
  rows: EmploymentOnboardingRow[],
  ctx: EmploymentV2ActionResolutionContext,
  contextLabel?: string
): void {
  if (process.env.NODE_ENV === 'production') return;
  const missing = findBlockingRowsMissingDedicatedAction(rows, ctx);
  if (missing.length === 0) return;
  const sigs = missing.map((r) => `${r.groupId}/${r.sourceType}/${r.stepKey}`);
  console.warn(
    `[Employment V2] Blocking path rows using fallback primary action (${contextLabel ?? 'path'}):`,
    sigs
  );
}

/**
 * Fill `routeTemplate` placeholders. Unknown params are left as `:name` for callers to handle.
 */
export function interpolateEmploymentV2Route(
  template: string,
  params: { uid?: string; assignmentId?: string; employmentId?: string; tenantSlug?: string }
): string {
  let out = template;
  if (params.tenantSlug) out = out.replace(':tenantSlug', encodeURIComponent(params.tenantSlug));
  if (params.uid) out = out.replace(':uid', encodeURIComponent(params.uid));
  if (params.assignmentId) out = out.replace(':assignmentId', encodeURIComponent(params.assignmentId));
  if (params.employmentId) out = out.replace(':employmentId', encodeURIComponent(params.employmentId));
  return out;
}
