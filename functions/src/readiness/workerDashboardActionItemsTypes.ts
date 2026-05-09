/**
 * Worker dashboard action items V1 — server-side type definitions.
 *
 * Mirrors `src/shared/workerDashboardActionItemsV1.ts`. We duplicate the
 * shape because functions `tsc` has `rootDir: src` and cannot import outside
 * `functions/src`. The pure model + parity tests in this folder pin both
 * sides.
 */

import * as admin from 'firebase-admin';

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
  titleKey: string;
  descriptionKey: string;
  primaryLabelKey: string;
  primaryKind: WorkerDashboardActionPrimaryKind;
  href?: string;
  secondaryLabelKey?: string;
  secondaryKind?: WorkerDashboardActionSecondaryKind;
  priorityScore: number;
  sourceReason: string;
  qaEvaluatedFields: Record<string, unknown>;
}

/**
 * Persisted shape on disk. Note the model produces a snapshot WITHOUT
 * `updatedAt` (the recompute layer adds the server timestamp on write so
 * the model stays pure for tests).
 */
export interface WorkerDashboardActionItemsSnapshotV1 {
  sourceVersion: 1;
  items: WorkerDashboardActionItemV1[];
  inputsHash: string;
  updatedAt: admin.firestore.Timestamp | admin.firestore.FieldValue;
}

/** Sub-set of `WorkerDashboardActionItemsSnapshotV1` produced by the pure model. */
export interface WorkerDashboardActionItemsSnapshotPayload {
  sourceVersion: 1;
  items: WorkerDashboardActionItemV1[];
  inputsHash: string;
}

/** Contract score table — keep aligned with `src/shared/workerDashboardActionItemsV1.ts`. */
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

export const WORKER_DASHBOARD_ACTION_ITEMS_SOURCE_VERSION = 1 as const;

/** Tiers used during ordering BEFORE global score sort (profile slice only). */
export type WorkerDashboardProfileTierOrder =
  | 'important'
  | 'recommended'
  | 'snoozable';

export const WORKER_PERSONAL_DETAILS_HREF =
  '/c1/workers/profile/personal-details';
export const WORKER_PROFILE_HREF = '/c1/workers/profile';
export const C1_WORKER_AI_PRESCREEN_PATH = '/c1/workers/prescreen';
