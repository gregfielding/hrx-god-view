/**
 * Canonical Employment V2 blocker → primary action mapping.
 * Use with `isOnboardingPathRowBlocker` from `employmentOnboardingPath.ts` so only true blockers get actions.
 *
 * Owner vocabulary matches `EmploymentBlockerItem.owner` (`recruiter` includes onboarding-path `admin`).
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
    actionLabel: 'View E-Verify status',
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
    actionLabel: 'Review payroll invite',
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
];

export interface EmploymentV2ActionResolutionContext {
  userId: string;
  tenantSlug?: string;
  /** `entity_employments` document id for C1 my-employment detail route. */
  entityEmploymentFirestoreId?: string | null;
  payrollPortalUrl?: string | null;
}

function ownerFromRow(row: EmploymentOnboardingRow): EmploymentV2ActionOwner {
  return row.owner === 'admin' ? 'recruiter' : row.owner;
}

/**
 * Primary action for a path row when it is a blocker; otherwise `null`.
 * Heuristics use `stepKey`, `groupId`, `sourceType`, `status`, and `entityKey`.
 */
export function resolveEmploymentV2PrimaryAction(
  row: EmploymentOnboardingRow,
  ctx: EmploymentV2ActionResolutionContext
): EmploymentV2BlockerAction | null {
  if (!isOnboardingPathRowBlocker(row)) return null;

  const owner = ownerFromRow(row);
  const { status, entityKey, groupId, stepKey, sourceType } = row;
  const assignmentId = row.sourceRef?.assignmentId;

  if (groupId === 'assignment_requirements' && assignmentId) {
    if (owner === 'worker') {
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
    if (entityKey === 'select' && stepKey.startsWith('everify_')) {
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
          actionLabel: 'View E-Verify status',
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
    if (owner === 'worker' && (stepKey === 'payroll_setup_complete' || stepKey.startsWith('direct_deposit'))) {
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
    if (owner === 'recruiter' && stepKey === 'payroll_invite_sent') {
      return {
        actionKey: 'payroll.recruiter_review',
        actionLabel: 'Review payroll invite',
        actionKind: 'review_panel',
        legacyActionKind: 'review',
        owner: 'recruiter',
        target: { routeTemplate: '/users/:uid', componentHint: 'UserProfile → Employment tab' },
      };
    }
  }

  if (groupId === 'screenings' && (sourceType === 'background_check' || stepKey.startsWith('background_'))) {
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
    /** No orders yet surfaces on `background_completed` (blocking milestone), not `background_initiated`. */
    if (stepKey === 'background_completed' && status === 'not_started') {
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
    if (
      (stepKey === 'background_completed' || stepKey === 'background_initiated') &&
      status === 'in_progress'
    ) {
      return {
        actionKey: 'background.vendor_in_progress',
        actionLabel: 'View screening status',
        actionKind: 'review_panel',
        legacyActionKind: 'review',
        owner: 'recruiter',
        target: { routeTemplate: '/users/:uid', componentHint: 'UserProfile → Backgrounds tab' },
      };
    }
  }

  return null;
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
