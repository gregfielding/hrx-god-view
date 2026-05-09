/**
 * Worker dashboard action items V1 — server-written snapshot shape.
 *
 * Persisted at `users/{uid}.workerDashboardActionItemsV1` by the readiness
 * triggers in `functions/src/readiness/workerDashboardActionItemsTriggers.ts`.
 * Both web (this file) and Flutter (`c1_app/lib/.../worker_dashboard_action_items_v1.dart`)
 * consume the same shape.
 *
 * IMPORTANT: keep in lockstep with
 * `functions/src/readiness/workerDashboardActionItemsTypes.ts`. The functions
 * `tsc` build cannot import from outside `functions/src` (rootDir is `src`),
 * so we mirror the types instead of importing them. CI parity test in
 * `functions/src/__tests__/readiness/workerDashboardActionItemsModel.test.ts`
 * pins the shape on the server side.
 */

export type WorkerDashboardActionItemId =
  | 'confirm_date_of_birth'
  | 'verify_phone_number'
  | 'add_tax_identity_last4'
  | 'confirm_home_address'
  | 'add_profile_photo'
  | 'add_emergency_contact'
  | 'sms_opt_in'
  | 're_enable_sms_notifications'
  | 'assignment_confirmation_required'
  | 'complete_tempworks_onboarding'
  | 'background_check_action_required'
  | 'background_check_issue_requires_action'
  | 'drug_screen_schedule_required'
  | 'drug_screen_reschedule_required'
  | 'everify_action_required'
  | 'worker_ai_prescreen_interview'
  | 'worker_ai_prescreen_complete_profile';

export type WorkerDashboardPriorityTier =
  | 'blocking'
  | 'important'
  | 'recommended'
  | 'snoozable';

export type WorkerDashboardActionPrimaryKind =
  | 'navigate'
  | 'enable_sms'
  | 'assignment_accept'
  | 'tempworks_open';

export type WorkerDashboardActionSecondaryKind =
  | 'dismiss_firestore'
  | 'snooze_sms'
  | 'assignment_decline';

export interface WorkerDashboardActionItemV1 {
  id: WorkerDashboardActionItemId;
  category: WorkerDashboardPriorityTier;
  /** i18n keys, NOT pre-translated strings — clients localize. */
  titleKey: string;
  descriptionKey: string;
  primaryLabelKey: string;
  primaryKind: WorkerDashboardActionPrimaryKind;
  /** Web route. Flutter maps this to its equivalent via `app_routes.dart`. */
  href?: string;
  secondaryLabelKey?: string;
  secondaryKind?: WorkerDashboardActionSecondaryKind;
  /**
   * Higher wins after dedupe. Server applies the contract score table and
   * writes the resulting score numerically here so clients can re-sort if
   * they ever need to (today they can just trust the server's order).
   */
  priorityScore: number;
  /** Diagnostics — recruiter-only / debug; never shown in worker UI. */
  sourceReason: string;
  qaEvaluatedFields: Record<string, unknown>;
}

/**
 * Snapshot at `users/{uid}.workerDashboardActionItemsV1`.
 *
 * `items` is the FULL contract list (sorted by `priorityScore` desc — highest first).
 * The 3-cap is a presentation rule on each client; persisting the full list
 * lets a future "View all" page render without an extra read.
 */
export interface WorkerDashboardActionItemsSnapshotV1 {
  /** Bump if the shape or semantics change. */
  sourceVersion: 1;
  items: WorkerDashboardActionItemV1[];
  /** Inputs the snapshot was computed from. Used for change detection / debugging. */
  inputsHash: string;
  /** Server timestamp on every write. Web reads via `.toDate()`. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  updatedAt: any;
}

/**
 * Contract score table (higher wins). Single source of truth for both web
 * and server. The server writes `priorityScore` already populated from this
 * table; clients can use this constant as a fallback for unrecognised IDs
 * during a phased rollout.
 */
export const WORKER_DASHBOARD_ACTION_ITEM_PRIORITY_SCORES: Readonly<
  Record<WorkerDashboardActionItemId, number>
> = Object.freeze({
  assignment_confirmation_required: 920,
  everify_action_required: 900,
  drug_screen_reschedule_required: 880,
  background_check_issue_requires_action: 860,
  complete_tempworks_onboarding: 800,
  background_check_action_required: 720,
  drug_screen_schedule_required: 700,
  confirm_date_of_birth: 650,
  verify_phone_number: 640,
  add_tax_identity_last4: 610,
  confirm_home_address: 600,
  re_enable_sms_notifications: 590,
  worker_ai_prescreen_interview: 550,
  worker_ai_prescreen_complete_profile: 545,
  add_profile_photo: 400,
  add_emergency_contact: 390,
  sms_opt_in: 100,
});

/** Cap for the home dashboard. Web/Flutter both slice 3 from `items`. */
export const WORKER_DASHBOARD_ACTION_ITEMS_HOME_CAP = 3;

/** Bump alongside `sourceVersion`. */
export const WORKER_DASHBOARD_ACTION_ITEMS_SOURCE_VERSION = 1 as const;
