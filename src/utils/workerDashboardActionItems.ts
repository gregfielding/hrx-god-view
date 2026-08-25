/**
 * Worker dashboard action item — UI-facing shape.
 *
 * TYPES ONLY since 2026-08-24: the in-browser builder that used to live here
 * was deleted once the server snapshot pipeline
 * (`users/{uid}.workerDashboardActionItemsV1`, written by the
 * syncWorkerDashboardActionItems* functions) reached parity — see
 * `functions/src/readiness/workerDashboardActionItemsModel.ts` for the one
 * true item builder and `useWorkerDashboardActionItemsV1` for the client
 * reader/converter that produces this shape.
 */

export type WorkerDashboardActionId =
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
  | 'complete_payroll_setup'
  | 'background_check_action_required'
  | 'background_check_issue_requires_action'
  | 'drug_screen_schedule_required'
  | 'drug_screen_reschedule_required'
  | 'everify_action_required'
  | 'worker_ai_prescreen_interview'
  | 'worker_ai_prescreen_complete_profile';

export type WorkerDashboardPriorityTier = 'blocking' | 'important' | 'recommended' | 'snoozable';

export type WorkerDashboardActionPrimaryKind =
  | 'navigate'
  | 'enable_sms'
  | 'assignment_accept'
  | 'tempworks_open'
  // Opens `href` in a new tab (external vendor portal, e.g. the AccuSource
  // applicant setup URL). Same window.open semantics as tempworks_open.
  | 'external_open';

export type WorkerDashboardActionSecondaryKind =
  | 'dismiss_firestore'
  | 'snooze_sms'
  | 'assignment_decline';

export interface WorkerDashboardActionItem {
  id: WorkerDashboardActionId;
  category: WorkerDashboardPriorityTier;
  titleKey: string;
  descriptionKey: string;
  sortOrder: number;
  primaryLabelKey: string;
  primaryKind: WorkerDashboardActionPrimaryKind;
  href?: string;
  secondaryLabelKey?: string;
  secondaryKind?: WorkerDashboardActionSecondaryKind;
  sourceReason: string;
  qaEvaluatedFields: Record<string, unknown>;
}
