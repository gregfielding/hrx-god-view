/**
 * Worker home dashboard — Profile + job-requirement action items (architecture PDF + production addendum).
 * Profile Section 1 gates; assignment confirmation is never blocked by profile gates.
 * Global merge by priority score, max 3 visible.
 */

import { userDocHasProfilePhoto } from './workerProfilePrerequisites';
import { readDismissedWorkerDashboardActionIds } from './workerDashboardDismissals';
import {
  WORKER_PERSONAL_DETAILS_HREF,
  evaluateWorkerDobGate,
  evaluateWorkerPhoneGate,
  evaluateWorkerSmsProfileSlot,
  isWorkerEmergencyContactComplete,
  isWorkerHomeAddressComplete,
  workerHasTaxIdentityLast4,
} from './workerProfileActionItemFacts';
import { normalizeLast4SsnDigits } from './last4Ssn';
import type { WorkerDashboardJobSignals } from './workerJobRequirementSignals';

/** Profile + job-requirement + communication IDs. */
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
  | 'tempworks_open';

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

export interface BuildWorkerDashboardActionItemsInput {
  userDoc: Record<string, unknown> | null;
  authAvatarUrl?: string | null;
  smsSnoozedUntilMs: number;
  /** When omitted, only profile items are considered. */
  jobSignals?: WorkerDashboardJobSignals | null;
  /** Post–SMS AI pre-screen follow-ups (eligible interview vs profile nudge). */
  workerAiPrescreenItems?: WorkerDashboardActionItem[];
}

export type { WorkerDashboardJobSignals } from './workerJobRequirementSignals';

const MAX_VISIBLE_ACTION_ITEMS = 3;

type InternalCandidate = WorkerDashboardActionItem & { _tier: WorkerDashboardPriorityTier };

function logProfileActionItemsBuild(items: WorkerDashboardActionItem[]): void {
  if (typeof process === 'undefined' || process.env.NODE_ENV === 'production') return;
  console.debug('[WorkerDashboardActionItems]', {
    itemCount: items.length,
    items: items.map((i) => ({
      id: i.id,
      category: i.category,
      sortOrder: i.sortOrder,
      sourceReason: i.sourceReason,
    })),
  });
}

function globalPriorityScore(item: WorkerDashboardActionItem): number {
  const j: Partial<Record<WorkerDashboardActionId, number>> = {
    assignment_confirmation_required: 920,
    everify_action_required: 900,
    drug_screen_reschedule_required: 880,
    background_check_issue_requires_action: 860,
    complete_tempworks_onboarding: 800,
    background_check_action_required: 720,
    drug_screen_schedule_required: 700,
    worker_ai_prescreen_interview: 550,
    worker_ai_prescreen_complete_profile: 545,
    confirm_date_of_birth: 650,
    verify_phone_number: 640,
    add_tax_identity_last4: 610,
    confirm_home_address: 600,
    re_enable_sms_notifications: 590,
    add_profile_photo: 400,
    add_emergency_contact: 390,
    sms_opt_in: 100,
  };
  if (j[item.id] != null) return j[item.id]!;
  return item.sortOrder;
}

function mergeByGlobalPriority(
  jobItems: WorkerDashboardActionItem[],
  profileItems: WorkerDashboardActionItem[]
): WorkerDashboardActionItem[] {
  const all = [...jobItems, ...profileItems];
  all.sort((a, b) => globalPriorityScore(b) - globalPriorityScore(a));
  return all.slice(0, MAX_VISIBLE_ACTION_ITEMS);
}

function orderProfileCandidatesFull(candidatesInDocOrder: InternalCandidate[]): WorkerDashboardActionItem[] {
  const important = candidatesInDocOrder.filter((c) => c._tier === 'important');
  const recommended = candidatesInDocOrder.filter((c) => c._tier === 'recommended');
  const snoozable = candidatesInDocOrder.filter((c) => c._tier === 'snoozable');
  const out: WorkerDashboardActionItem[] = [];
  for (const c of [...important, ...recommended, ...snoozable]) {
    const { _tier: _t, ...rest } = c;
    out.push(rest);
  }
  return out;
}

function buildWorkerJobRequirementActionItems(signals: WorkerDashboardJobSignals | null | undefined): WorkerDashboardActionItem[] {
  if (!signals?.tenantId) return [];
  const out: WorkerDashboardActionItem[] = [];

  const sortedAssignments = [...signals.pendingAssignmentConfirmations].sort(
    (a, b) => (a.startAtMs ?? 0) - (b.startAtMs ?? 0)
  );
  const firstAssignment = sortedAssignments[0];
  if (firstAssignment) {
    out.push({
      id: 'assignment_confirmation_required',
      category: 'blocking',
      titleKey: 'dashboard.actionItems.assignmentConfirmTitle',
      descriptionKey: 'dashboard.actionItems.assignmentConfirmDescription',
      sortOrder: 5,
      primaryLabelKey: 'dashboard.actionItems.assignmentConfirmPrimary',
      primaryKind: 'assignment_accept',
      secondaryLabelKey: 'dashboard.actionItems.assignmentDeclinePrimary',
      secondaryKind: 'assignment_decline',
      sourceReason: 'Assignment awaiting worker response',
      qaEvaluatedFields: {
        tenantId: signals.tenantId,
        assignmentId: firstAssignment.assignmentId,
      },
    });
  }

  const c = signals.compliance;
  if (c.everifyWorkerAction) {
    out.push({
      id: 'everify_action_required',
      category: 'blocking',
      titleKey: 'dashboard.actionItems.everifyActionTitle',
      descriptionKey: 'dashboard.actionItems.everifyActionDescription',
      sortOrder: 15,
      primaryLabelKey: 'dashboard.actionItems.everifyActionPrimary',
      primaryKind: 'navigate',
      href: '/c1/workers/profile',
      sourceReason: 'E-Verify TNC or further_action_required',
      qaEvaluatedFields: {},
    });
  }
  if (c.drugRescheduleRequired) {
    out.push({
      id: 'drug_screen_reschedule_required',
      category: 'blocking',
      titleKey: 'dashboard.actionItems.drugRescheduleTitle',
      descriptionKey: 'dashboard.actionItems.drugRescheduleDescription',
      sortOrder: 16,
      primaryLabelKey: 'dashboard.actionItems.drugReschedulePrimary',
      primaryKind: 'navigate',
      href: '/c1/workers/profile',
      sourceReason: 'Drug screening reschedule required',
      qaEvaluatedFields: {},
    });
  } else if (c.drugScheduleRequired) {
    out.push({
      id: 'drug_screen_schedule_required',
      category: 'important',
      titleKey: 'dashboard.actionItems.drugScheduleTitle',
      descriptionKey: 'dashboard.actionItems.drugScheduleDescription',
      sortOrder: 20,
      primaryLabelKey: 'dashboard.actionItems.drugSchedulePrimary',
      primaryKind: 'navigate',
      href: '/c1/workers/profile',
      sourceReason: 'Drug screening schedule required',
      qaEvaluatedFields: {},
    });
  }
  if (c.backgroundIssueAction) {
    out.push({
      id: 'background_check_issue_requires_action',
      category: 'blocking',
      titleKey: 'dashboard.actionItems.backgroundIssueTitle',
      descriptionKey: 'dashboard.actionItems.backgroundIssueDescription',
      sortOrder: 17,
      primaryLabelKey: 'dashboard.actionItems.backgroundIssuePrimary',
      primaryKind: 'navigate',
      href: '/c1/workers/profile',
      sourceReason: 'Background check error — review issue',
      qaEvaluatedFields: {},
    });
  } else if (c.backgroundApplicantAction) {
    out.push({
      id: 'background_check_action_required',
      category: 'important',
      titleKey: 'dashboard.actionItems.backgroundApplicantTitle',
      descriptionKey: 'dashboard.actionItems.backgroundApplicantDescription',
      sortOrder: 19,
      primaryLabelKey: 'dashboard.actionItems.backgroundApplicantPrimary',
      primaryKind: 'navigate',
      href: '/c1/workers/profile',
      sourceReason: 'Background check awaiting applicant',
      qaEvaluatedFields: {},
    });
  }

  const tw = signals.tempworks;
  if (tw && tw.required && !tw.recruiterVerified) {
    const submitted = tw.started;
    out.push({
      id: 'complete_tempworks_onboarding',
      category: 'important',
      titleKey: submitted
        ? 'dashboard.actionItems.tempworksSubmittedTitle'
        : 'dashboard.actionItems.tempworksStartTitle',
      descriptionKey: submitted
        ? 'dashboard.actionItems.tempworksSubmittedDescription'
        : 'dashboard.actionItems.tempworksStartDescription',
      sortOrder: 18,
      primaryLabelKey: submitted
        ? 'dashboard.actionItems.tempworksReopenPrimary'
        : 'dashboard.actionItems.tempworksStartPrimary',
      primaryKind: 'tempworks_open',
      href: tw.onboardingUrl || undefined,
      sourceReason: submitted ? 'TempWorks submitted — recruiter verification pending' : 'TempWorks not started',
      qaEvaluatedFields: { submitted, hasUrl: Boolean(tw.onboardingUrl) },
    });
  }

  return out;
}

/**
 * Profile-only stack (Section 1 gates; Rule 3 returns full tier-ordered list — no cap here).
 */
function buildWorkerProfileStackItems(input: BuildWorkerDashboardActionItemsInput): WorkerDashboardActionItem[] {
  const { userDoc, authAvatarUrl, smsSnoozedUntilMs } = input;
  const dismissed = readDismissedWorkerDashboardActionIds(userDoc);

  const dobEval = evaluateWorkerDobGate(userDoc);
  if (dobEval.needsAction) {
    const dobReason = dobEval.evaluatedFields.reason;
    const isUnder18 = dobReason === 'under18';
    return [
      {
        id: 'confirm_date_of_birth',
        category: 'blocking',
        titleKey: isUnder18
          ? 'dashboard.actionItems.dobUnder18Title'
          : 'dashboard.actionItems.dobTitle',
        descriptionKey: isUnder18
          ? 'dashboard.actionItems.dobUnder18Description'
          : 'dashboard.actionItems.dobDescription',
        sortOrder: 10,
        primaryLabelKey: isUnder18
          ? 'dashboard.actionItems.dobUnder18Primary'
          : 'dashboard.actionItems.dobPrimary',
        primaryKind: 'navigate',
        href: WORKER_PERSONAL_DETAILS_HREF,
        sourceReason:
          'Rule 1 (DOB gate): missing, invalid, or under-18 DOB — suppress other profile items only',
        qaEvaluatedFields: { gate: 'dob', ...dobEval.evaluatedFields },
      },
    ];
  }

  const phoneEval = evaluateWorkerPhoneGate(userDoc);
  if (phoneEval.needsAction) {
    const needsVerify = phoneEval.hasValidUsPhone10 && !phoneEval.phoneVerified;
    const primaryLabelKey = needsVerify
      ? 'dashboard.actionItems.verifyPhonePrimaryVerify'
      : 'dashboard.actionItems.verifyPhonePrimaryAdd';
    const titleKey = needsVerify
      ? 'dashboard.actionItems.verifyPhoneTitleVerify'
      : 'dashboard.actionItems.verifyPhoneTitleAdd';
    const descriptionKey = needsVerify
      ? 'dashboard.actionItems.verifyPhoneDescriptionVerify'
      : 'dashboard.actionItems.verifyPhoneDescriptionAdd';
    // When the worker has a valid US phone but it's not yet verified, route
    // directly to the Personal Details page with `?verify=phone` so the page
    // auto-opens the Twilio verification modal (sends OTP + collects the code)
    // instead of just landing on the edit form with no call to action.
    const href = needsVerify
      ? `${WORKER_PERSONAL_DETAILS_HREF}?verify=phone`
      : WORKER_PERSONAL_DETAILS_HREF;
    return [
      {
        id: 'verify_phone_number',
        category: 'blocking',
        titleKey,
        descriptionKey,
        sortOrder: 20,
        primaryLabelKey,
        primaryKind: 'navigate',
        href,
        sourceReason: 'Rule 2 (Phone gate): suppress other profile items only',
        qaEvaluatedFields: { gate: 'phone', ...phoneEval.evaluatedFields },
      },
    ];
  }

  const candidates: InternalCandidate[] = [];

  if (!workerHasTaxIdentityLast4(userDoc)) {
    candidates.push({
      id: 'add_tax_identity_last4',
      category: 'important',
      _tier: 'important',
      titleKey: 'dashboard.actionItems.taxLast4Title',
      descriptionKey: 'dashboard.actionItems.taxLast4Description',
      sortOrder: 30,
      primaryLabelKey: 'dashboard.actionItems.taxLast4Primary',
      primaryKind: 'navigate',
      href: WORKER_PERSONAL_DETAILS_HREF,
      sourceReason: 'Important: last 4 SSN/ITIN missing',
      qaEvaluatedFields: {
        last4SSN: userDoc ? normalizeLast4SsnDigits(userDoc.last4SSN) : '',
        hasLast4: false,
      },
    });
  }

  if (!isWorkerHomeAddressComplete(userDoc)) {
    candidates.push({
      id: 'confirm_home_address',
      category: 'important',
      _tier: 'important',
      titleKey: 'dashboard.actionItems.homeAddressTitle',
      descriptionKey: 'dashboard.actionItems.homeAddressDescription',
      sortOrder: 40,
      primaryLabelKey: 'dashboard.actionItems.homeAddressPrimary',
      primaryKind: 'navigate',
      href: WORKER_PERSONAL_DETAILS_HREF,
      sourceReason: 'Important: address incomplete / not validated',
      qaEvaluatedFields: { addressComplete: false },
    });
  }

  if (!userDocHasProfilePhoto(userDoc, authAvatarUrl) && !dismissed.has('add_profile_photo')) {
    candidates.push({
      id: 'add_profile_photo',
      category: 'recommended',
      _tier: 'recommended',
      titleKey: 'dashboard.actionItems.photoTitle',
      descriptionKey: 'dashboard.actionItems.photoDescription',
      sortOrder: 50,
      primaryLabelKey: 'dashboard.actionItems.photoPrimary',
      primaryKind: 'navigate',
      href: WORKER_PERSONAL_DETAILS_HREF,
      secondaryLabelKey: 'dashboard.actionItems.dismiss',
      secondaryKind: 'dismiss_firestore',
      sourceReason: 'Recommended: profile photo',
      qaEvaluatedFields: {},
    });
  }

  if (!isWorkerEmergencyContactComplete(userDoc) && !dismissed.has('add_emergency_contact')) {
    candidates.push({
      id: 'add_emergency_contact',
      category: 'recommended',
      _tier: 'recommended',
      titleKey: 'dashboard.actionItems.emergencyContactTitle',
      descriptionKey: 'dashboard.actionItems.emergencyContactDescription',
      sortOrder: 60,
      primaryLabelKey: 'dashboard.actionItems.emergencyContactPrimary',
      primaryKind: 'navigate',
      href: WORKER_PERSONAL_DETAILS_HREF,
      secondaryLabelKey: 'dashboard.actionItems.dismiss',
      secondaryKind: 'dismiss_firestore',
      sourceReason: 'Recommended: emergency contact',
      qaEvaluatedFields: {},
    });
  }

  const smsEval = evaluateWorkerSmsProfileSlot(userDoc, smsSnoozedUntilMs);
  if (smsEval.slot === 're_enable_sms_notifications') {
    candidates.push({
      id: 're_enable_sms_notifications',
      category: 'important',
      _tier: 'important',
      titleKey: 'dashboard.actionItems.reEnableSmsTitle',
      descriptionKey: 'dashboard.actionItems.reEnableSmsDescription',
      sortOrder: 70,
      primaryLabelKey: 'dashboard.actionItems.reEnableSmsPrimary',
      primaryKind: 'enable_sms',
      sourceReason: 'SMS blocked — re-enable',
      qaEvaluatedFields: smsEval.evaluatedFields,
    });
  } else if (smsEval.slot === 'sms_opt_in') {
    candidates.push({
      id: 'sms_opt_in',
      category: 'snoozable',
      _tier: 'snoozable',
      titleKey: 'dashboard.actionItems.smsTitle',
      descriptionKey: 'dashboard.actionItems.smsDescription',
      sortOrder: 80,
      primaryLabelKey: 'dashboard.actionItems.smsPrimary',
      primaryKind: 'enable_sms',
      secondaryLabelKey: 'dashboard.actionItems.notNow',
      secondaryKind: 'snooze_sms',
      sourceReason: 'SMS opt-in',
      qaEvaluatedFields: smsEval.evaluatedFields,
    });
  }

  return orderProfileCandidatesFull(candidates);
}

export function buildWorkerDashboardActionItems(input: BuildWorkerDashboardActionItemsInput): WorkerDashboardActionItem[] {
  const jobItems = [
    ...buildWorkerJobRequirementActionItems(input.jobSignals ?? null),
    ...(input.workerAiPrescreenItems ?? []),
  ];
  const profileItems = buildWorkerProfileStackItems(input);
  const merged = mergeByGlobalPriority(jobItems, profileItems);
  logProfileActionItemsBuild(merged);
  return merged;
}
