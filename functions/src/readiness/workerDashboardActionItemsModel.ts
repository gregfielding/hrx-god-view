/**
 * Worker dashboard action items V1 — PURE model.
 *
 * Takes a structured input bag and returns the snapshot. No I/O, no SDK
 * calls. The loader (`workerDashboardActionItemsLoadContext.ts`) builds the
 * input bag from Firestore; the recompute helper composes loader + this
 * model + a Firestore write.
 *
 * Logic ported from the web client:
 *   - `src/utils/workerDashboardActionItems.ts` (orchestrator)
 *   - `src/utils/workerProfileActionItemFacts.ts` (DOB / phone / address /
 *     last4 / emergency contact / SMS predicates)
 *   - `src/utils/workerComplianceActionDerivers.ts` (background / drug /
 *     e-verify) — derived in the loader before reaching the model.
 *   - `src/utils/workerJobRequirementSignals.ts` (TempWorks signals,
 *     `assignmentDocNeedsWorkerConfirmation`).
 *   - `src/utils/workerAiPrescreenDashboardActions.ts` (AI prescreen
 *     dashboard cards).
 *
 * Unit tests in
 * `functions/src/__tests__/readiness/workerDashboardActionItemsModel.test.ts`
 * pin parity case-by-case against the web builder.
 *
 * NOTE: SMS snooze (the localStorage `worker_sms_warning_dismiss_until_{uid}`
 * value) is intentionally NOT part of the snapshot — that's per-device state
 * and stays on each client. Clients filter `sms_opt_in` out of the
 * server-emitted list when their local snooze is active.
 */

import {
  C1_WORKER_AI_PRESCREEN_PATH,
  WORKER_DASHBOARD_ACTION_ITEMS_SOURCE_VERSION,
  WORKER_DASHBOARD_ACTION_ITEM_PRIORITY_SCORES,
  WORKER_PERSONAL_DETAILS_HREF,
  WORKER_PROFILE_HREF,
  type WorkerDashboardActionItemId,
  type WorkerDashboardActionItemV1,
  type WorkerDashboardActionItemsSnapshotPayload,
  type WorkerDashboardProfileTierOrder,
} from './workerDashboardActionItemsTypes';

// ---------------------------------------------------------------------------
// Input bag
// ---------------------------------------------------------------------------

export interface WorkerDashboardComplianceSignals {
  backgroundApplicantAction: boolean;
  backgroundIssueAction: boolean;
  drugScheduleRequired: boolean;
  drugRescheduleRequired: boolean;
  everifyWorkerAction: boolean;
}

export interface WorkerDashboardTempworksSignals {
  required: boolean;
  recruiterVerified: boolean;
  started: boolean;
  /** `null` is permitted; the model treats null/empty/missing the same. */
  onboardingUrl?: string | null;
}

export interface WorkerDashboardPendingAssignment {
  assignmentId: string;
  /** Epoch ms; `0` is treated as "no start date known" and sorted last. */
  startAtMs: number;
}

/**
 * Pre-derived AI prescreen surface, computed by the loader.
 *
 * The loader applies the same logic as `useWorkerAiPrescreenSurfaceSignals`
 * + `buildWorkerAiPrescreenDashboardActions`, including:
 *   - 30-day fresh-interview suppression
 *   - oldest-reminder tie-break
 *   - filter applications whose container (job_order or group) doesn't
 *     have prescreen required
 *
 * Empty array if no prescreen card should show.
 */
export interface WorkerDashboardPrescreenSignals {
  /** 0 or 1 entry today (matches the web "v1 surfaces one card" rule). */
  items: WorkerDashboardActionItemV1[];
}

export interface WorkerDashboardActionItemsModelInput {
  /** `users/{uid}` document data (admin SDK shape — plain JSON map). */
  userDoc: Record<string, unknown> | null;

  /**
   * Pending assignments awaiting worker accept/decline. Earliest-start
   * assignment wins if multiple. `[]` means none.
   */
  pendingAssignments: WorkerDashboardPendingAssignment[];

  /** Pre-derived TempWorks signals. `undefined` when not required. */
  tempworks?: WorkerDashboardTempworksSignals;

  /** Pre-derived background / drug / E-Verify flags. */
  compliance: WorkerDashboardComplianceSignals;

  /** Pre-derived AI prescreen card (zero or one). */
  prescreen: WorkerDashboardPrescreenSignals;

  /**
   * Auth avatar URL fallback for the photo predicate. Pass `null` if the
   * user has no Auth photo URL (server should pull from
   * `admin.auth().getUser(uid).photoURL` only if needed; the predicate will
   * still pass when the photo is on `users/{uid}.workerProfile.photoUrl` or
   * `users/{uid}.avatar`).
   */
  authAvatarUrl?: string | null;

  /**
   * Tenant the snapshot is being computed for. Used to populate
   * `qaEvaluatedFields.tenantId` on assignment items so recruiter QA can
   * trace items back to the source tenant; not used for dedupe.
   */
  tenantId: string;
}

// ---------------------------------------------------------------------------
// Predicate ports — server SDK-shape friendly. Web equivalents in the files
// referenced at the top of this module.
// ---------------------------------------------------------------------------

function asObj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function trimStr(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function normalizeLast4SsnDigits(raw: unknown): string {
  return String(raw ?? '')
    .replace(/\D/g, '')
    .slice(0, 4);
}

function getWorkerUsPhoneDigits10(userDoc: Record<string, unknown> | null): string {
  if (!userDoc) return '';
  let d = String(userDoc.phone ?? '').replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
  return d.length === 10 ? d : '';
}

/** Match `parseCalendarDateLocal` from `src/utils/dateUtils.ts` for YYYY-MM-DD strings. */
function parseDobToCalendarDate(raw: unknown): Date | null {
  if (raw == null) return null;
  let s = '';
  if (typeof raw === 'string') {
    s = raw.trim();
    const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
    if (m) {
      const [y, mo, d] = m[1].split('-').map(Number);
      const dt = new Date(y, mo - 1, d);
      return Number.isNaN(dt.getTime()) ? null : dt;
    }
  } else if (raw instanceof Date) {
    return Number.isNaN(raw.getTime()) ? null : raw;
  } else if (typeof (raw as { toDate?: () => Date }).toDate === 'function') {
    try {
      const d = (raw as { toDate: () => Date }).toDate();
      return Number.isNaN(d.getTime()) ? null : d;
    } catch {
      return null;
    }
  } else {
    s = String(raw).trim();
  }
  if (!s) return null;
  const dt = new Date(s);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

interface DobGateEval {
  needsAction: boolean;
  evaluatedFields: Record<string, unknown>;
}

function evaluateWorkerDobGate(userDoc: Record<string, unknown> | null): DobGateEval {
  if (!userDoc) {
    return { needsAction: true, evaluatedFields: { userDocPresent: false, reason: 'missing_user' } };
  }
  const raw = userDoc.dob ?? userDoc.dateOfBirth;
  const original = typeof raw === 'string' ? raw.trim() : raw;
  const present =
    raw != null && raw !== '' && (typeof raw !== 'string' || raw.trim().length > 0);
  if (!present) {
    return { needsAction: true, evaluatedFields: { dobRaw: raw ?? null, reason: 'missing' } };
  }
  const birth = parseDobToCalendarDate(raw);
  if (!birth) {
    return { needsAction: true, evaluatedFields: { dobRaw: original, reason: 'invalid' } };
  }
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age -= 1;
  if (age < 18) {
    return { needsAction: true, evaluatedFields: { dobRaw: original, age, reason: 'under18' } };
  }
  return { needsAction: false, evaluatedFields: { dobRaw: original, age, reason: 'ok' } };
}

interface PhoneGateEval {
  needsAction: boolean;
  hasValidUsPhone10: boolean;
  phoneVerified: boolean;
  evaluatedFields: Record<string, unknown>;
}

function evaluateWorkerPhoneGate(userDoc: Record<string, unknown> | null): PhoneGateEval {
  if (!userDoc) {
    return {
      needsAction: true,
      hasValidUsPhone10: false,
      phoneVerified: false,
      evaluatedFields: { userDocPresent: false },
    };
  }
  const d10 = getWorkerUsPhoneDigits10(userDoc);
  const hasValidUsPhone10 = d10.length === 10;
  const phoneVerified = userDoc.phoneVerified === true;
  const needsAction = !hasValidUsPhone10 || !phoneVerified;
  return {
    needsAction,
    hasValidUsPhone10,
    phoneVerified,
    evaluatedFields: {
      phoneDigitsLen: d10.length,
      phoneVerified: userDoc.phoneVerified ?? null,
      hasValidUsPhone10,
      needsAction,
    },
  };
}

function workerHasTaxIdentityLast4(userDoc: Record<string, unknown> | null): boolean {
  if (!userDoc) return false;
  return normalizeLast4SsnDigits(userDoc.last4SSN).length === 4;
}

function isWorkerHomeAddressComplete(userDoc: Record<string, unknown> | null): boolean {
  if (!userDoc) return false;
  const addr = asObj(userDoc.addressInfo) || {};
  const street = trimStr(addr.streetAddress);
  const city = trimStr(addr.city ?? userDoc.city);
  const state = trimStr(addr.state ?? userDoc.state);
  const zip = trimStr(addr.zip ?? addr.zipCode ?? userDoc.zip);
  const lat = addr.homeLat;
  const lng = addr.homeLng;
  const hasCoords =
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lng);
  return Boolean(street && city && state && zip && hasCoords);
}

function isWorkerEmergencyContactComplete(userDoc: Record<string, unknown> | null): boolean {
  if (!userDoc) return false;
  const ec = asObj(userDoc.emergencyContact) || {};
  const name = trimStr(ec.name);
  let d = String(ec.phone ?? '').replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
  return name.length > 0 && d.length === 10;
}

function userDocHasProfilePhoto(
  userDoc: Record<string, unknown> | null,
  authAvatarUrl: string | null | undefined,
): boolean {
  const wp = asObj(userDoc?.workerProfile) || {};
  const photo = String(wp.photoUrl || userDoc?.avatar || authAvatarUrl || '').trim();
  return photo.length > 0;
}

function readDismissedWorkerDashboardActionIds(
  userDoc: Record<string, unknown> | null,
): Set<string> {
  const out = new Set<string>();
  if (!userDoc) return out;
  const dashboard = asObj(asObj(userDoc.workerProfile)?.dashboard);
  const dismissed = asObj(dashboard?.dismissedActionItems) || {};
  for (const [k, v] of Object.entries(dismissed)) {
    if (v === true || v === 'true') out.add(k);
  }
  return out;
}

interface WorkerSmsAlertsContext {
  smsSystemAvailable: boolean;
  smsDisabled: boolean;
  hasPhone: boolean;
}

function getWorkerSmsAlertsContext(userDoc: Record<string, unknown> | null): WorkerSmsAlertsContext {
  if (!userDoc) {
    return { smsSystemAvailable: true, smsDisabled: true, hasPhone: false };
  }
  const notifications = asObj(userDoc.notificationSettings) || {};
  const phone = String(userDoc.phone || '').trim();
  const unavailable =
    userDoc.smsSystemUnavailable === true || notifications.smsUnavailable === true;
  const optedOut = userDoc.smsOptIn === false;
  const blocked = userDoc.smsBlockedSystem === true;
  const enabled = !optedOut && !blocked;
  return {
    smsSystemAvailable: !unavailable,
    smsDisabled: !enabled,
    hasPhone: phone.length > 0,
  };
}

type WorkerSmsProfileSlot =
  | 're_enable_sms_notifications'
  | 'sms_opt_in'
  | null;

interface SmsSlotEval {
  slot: WorkerSmsProfileSlot;
  evaluatedFields: Record<string, unknown>;
}

function evaluateWorkerSmsProfileSlot(userDoc: Record<string, unknown> | null): SmsSlotEval {
  const ctx = getWorkerSmsAlertsContext(userDoc);
  const blocked = Boolean(userDoc && userDoc.smsBlockedSystem === true);

  const evaluatedFields: Record<string, unknown> = {
    smsSystemAvailable: ctx.smsSystemAvailable,
    smsDisabled: ctx.smsDisabled,
    hasPhone: ctx.hasPhone,
    smsBlockedSystem: userDoc ? userDoc.smsBlockedSystem ?? null : null,
    smsOptIn: userDoc ? userDoc.smsOptIn ?? null : null,
  };

  if (!ctx.smsSystemAvailable || !ctx.smsDisabled || !ctx.hasPhone) {
    evaluatedFields.outcome = 'hidden_no_slot';
    return { slot: null, evaluatedFields };
  }
  if (blocked) {
    evaluatedFields.outcome = 're_enable_sms_notifications';
    return { slot: 're_enable_sms_notifications', evaluatedFields };
  }
  evaluatedFields.outcome = 'sms_opt_in';
  return { slot: 'sms_opt_in', evaluatedFields };
}

// ---------------------------------------------------------------------------
// Item builders — these emit the V1 shape with `priorityScore` already filled.
// Tier metadata is captured for profile pre-sort; the global merge re-sorts
// the full list by score regardless of tier.
// ---------------------------------------------------------------------------

interface InternalItem extends WorkerDashboardActionItemV1 {
  /** Pre-merge ordering hint for the profile slice only (Rule 3). */
  _profileTier?: WorkerDashboardProfileTierOrder;
}

function scoreForId(id: WorkerDashboardActionItemId): number {
  return WORKER_DASHBOARD_ACTION_ITEM_PRIORITY_SCORES[id];
}

function buildJobItems(input: WorkerDashboardActionItemsModelInput): InternalItem[] {
  const out: InternalItem[] = [];

  const sortedAssignments = [...input.pendingAssignments].sort((a, b) => {
    const aMs = a.startAtMs > 0 ? a.startAtMs : Number.POSITIVE_INFINITY;
    const bMs = b.startAtMs > 0 ? b.startAtMs : Number.POSITIVE_INFINITY;
    return aMs - bMs;
  });
  const firstAssignment = sortedAssignments[0];
  if (firstAssignment) {
    out.push({
      id: 'assignment_confirmation_required',
      category: 'blocking',
      titleKey: 'dashboard.actionItems.assignmentConfirmTitle',
      descriptionKey: 'dashboard.actionItems.assignmentConfirmDescription',
      primaryLabelKey: 'dashboard.actionItems.assignmentConfirmPrimary',
      primaryKind: 'assignment_accept',
      secondaryLabelKey: 'dashboard.actionItems.assignmentDeclinePrimary',
      secondaryKind: 'assignment_decline',
      priorityScore: scoreForId('assignment_confirmation_required'),
      sourceReason: 'Assignment awaiting worker response',
      qaEvaluatedFields: {
        tenantId: input.tenantId,
        assignmentId: firstAssignment.assignmentId,
      },
    });
  }

  const c = input.compliance;
  if (c.everifyWorkerAction) {
    out.push({
      id: 'everify_action_required',
      category: 'blocking',
      titleKey: 'dashboard.actionItems.everifyActionTitle',
      descriptionKey: 'dashboard.actionItems.everifyActionDescription',
      primaryLabelKey: 'dashboard.actionItems.everifyActionPrimary',
      primaryKind: 'navigate',
      href: WORKER_PROFILE_HREF,
      priorityScore: scoreForId('everify_action_required'),
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
      primaryLabelKey: 'dashboard.actionItems.drugReschedulePrimary',
      primaryKind: 'navigate',
      href: WORKER_PROFILE_HREF,
      priorityScore: scoreForId('drug_screen_reschedule_required'),
      sourceReason: 'Drug screening reschedule required',
      qaEvaluatedFields: {},
    });
  } else if (c.drugScheduleRequired) {
    out.push({
      id: 'drug_screen_schedule_required',
      category: 'important',
      titleKey: 'dashboard.actionItems.drugScheduleTitle',
      descriptionKey: 'dashboard.actionItems.drugScheduleDescription',
      primaryLabelKey: 'dashboard.actionItems.drugSchedulePrimary',
      primaryKind: 'navigate',
      href: WORKER_PROFILE_HREF,
      priorityScore: scoreForId('drug_screen_schedule_required'),
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
      primaryLabelKey: 'dashboard.actionItems.backgroundIssuePrimary',
      primaryKind: 'navigate',
      href: WORKER_PROFILE_HREF,
      priorityScore: scoreForId('background_check_issue_requires_action'),
      sourceReason: 'Background check error — review issue',
      qaEvaluatedFields: {},
    });
  } else if (c.backgroundApplicantAction) {
    out.push({
      id: 'background_check_action_required',
      category: 'important',
      titleKey: 'dashboard.actionItems.backgroundApplicantTitle',
      descriptionKey: 'dashboard.actionItems.backgroundApplicantDescription',
      primaryLabelKey: 'dashboard.actionItems.backgroundApplicantPrimary',
      primaryKind: 'navigate',
      href: WORKER_PROFILE_HREF,
      priorityScore: scoreForId('background_check_action_required'),
      sourceReason: 'Background check awaiting applicant',
      qaEvaluatedFields: {},
    });
  }

  const tw = input.tempworks;
  if (tw && tw.required && !tw.recruiterVerified) {
    const submitted = tw.started;
    const onboardingUrl = trimStr(tw.onboardingUrl);
    out.push({
      id: 'complete_tempworks_onboarding',
      category: 'important',
      titleKey: submitted
        ? 'dashboard.actionItems.tempworksSubmittedTitle'
        : 'dashboard.actionItems.tempworksStartTitle',
      descriptionKey: submitted
        ? 'dashboard.actionItems.tempworksSubmittedDescription'
        : 'dashboard.actionItems.tempworksStartDescription',
      primaryLabelKey: submitted
        ? 'dashboard.actionItems.tempworksReopenPrimary'
        : 'dashboard.actionItems.tempworksStartPrimary',
      primaryKind: 'tempworks_open',
      href: onboardingUrl || undefined,
      priorityScore: scoreForId('complete_tempworks_onboarding'),
      sourceReason: submitted
        ? 'TempWorks submitted — recruiter verification pending'
        : 'TempWorks not started',
      qaEvaluatedFields: { submitted, hasUrl: Boolean(onboardingUrl) },
    });
  }

  // Re-emit prescreen items with the score table applied (web V1 used a
  // separate sortOrder; we normalise to `priorityScore` here so all
  // downstream sorting is uniform).
  for (const it of input.prescreen.items) {
    out.push({
      ...it,
      priorityScore:
        WORKER_DASHBOARD_ACTION_ITEM_PRIORITY_SCORES[it.id] ?? it.priorityScore ?? 0,
    });
  }

  return out;
}

function buildProfileItems(input: WorkerDashboardActionItemsModelInput): InternalItem[] {
  const { userDoc, authAvatarUrl } = input;
  const dismissed = readDismissedWorkerDashboardActionIds(userDoc);

  // Section 1 gates — single-item early returns.
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
        primaryLabelKey: isUnder18
          ? 'dashboard.actionItems.dobUnder18Primary'
          : 'dashboard.actionItems.dobPrimary',
        primaryKind: 'navigate',
        href: WORKER_PERSONAL_DETAILS_HREF,
        priorityScore: scoreForId('confirm_date_of_birth'),
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
    const href = needsVerify
      ? `${WORKER_PERSONAL_DETAILS_HREF}?verify=phone`
      : WORKER_PERSONAL_DETAILS_HREF;
    return [
      {
        id: 'verify_phone_number',
        category: 'blocking',
        titleKey,
        descriptionKey,
        primaryLabelKey,
        primaryKind: 'navigate',
        href,
        priorityScore: scoreForId('verify_phone_number'),
        sourceReason: 'Rule 2 (Phone gate): suppress other profile items only',
        qaEvaluatedFields: { gate: 'phone', ...phoneEval.evaluatedFields },
      },
    ];
  }

  const out: InternalItem[] = [];

  if (!workerHasTaxIdentityLast4(userDoc)) {
    out.push({
      id: 'add_tax_identity_last4',
      category: 'important',
      _profileTier: 'important',
      titleKey: 'dashboard.actionItems.taxLast4Title',
      descriptionKey: 'dashboard.actionItems.taxLast4Description',
      primaryLabelKey: 'dashboard.actionItems.taxLast4Primary',
      primaryKind: 'navigate',
      href: WORKER_PERSONAL_DETAILS_HREF,
      priorityScore: scoreForId('add_tax_identity_last4'),
      sourceReason: 'Important: last 4 SSN/ITIN missing',
      qaEvaluatedFields: {
        last4SSN: userDoc ? normalizeLast4SsnDigits(userDoc.last4SSN) : '',
        hasLast4: false,
      },
    });
  }

  if (!isWorkerHomeAddressComplete(userDoc)) {
    out.push({
      id: 'confirm_home_address',
      category: 'important',
      _profileTier: 'important',
      titleKey: 'dashboard.actionItems.homeAddressTitle',
      descriptionKey: 'dashboard.actionItems.homeAddressDescription',
      primaryLabelKey: 'dashboard.actionItems.homeAddressPrimary',
      primaryKind: 'navigate',
      href: WORKER_PERSONAL_DETAILS_HREF,
      priorityScore: scoreForId('confirm_home_address'),
      sourceReason: 'Important: address incomplete / not validated',
      qaEvaluatedFields: { addressComplete: false },
    });
  }

  if (!userDocHasProfilePhoto(userDoc, authAvatarUrl) && !dismissed.has('add_profile_photo')) {
    out.push({
      id: 'add_profile_photo',
      category: 'recommended',
      _profileTier: 'recommended',
      titleKey: 'dashboard.actionItems.photoTitle',
      descriptionKey: 'dashboard.actionItems.photoDescription',
      primaryLabelKey: 'dashboard.actionItems.photoPrimary',
      primaryKind: 'navigate',
      href: WORKER_PERSONAL_DETAILS_HREF,
      secondaryLabelKey: 'dashboard.actionItems.dismiss',
      secondaryKind: 'dismiss_firestore',
      priorityScore: scoreForId('add_profile_photo'),
      sourceReason: 'Recommended: profile photo',
      qaEvaluatedFields: {},
    });
  }

  if (!isWorkerEmergencyContactComplete(userDoc) && !dismissed.has('add_emergency_contact')) {
    out.push({
      id: 'add_emergency_contact',
      category: 'recommended',
      _profileTier: 'recommended',
      titleKey: 'dashboard.actionItems.emergencyContactTitle',
      descriptionKey: 'dashboard.actionItems.emergencyContactDescription',
      primaryLabelKey: 'dashboard.actionItems.emergencyContactPrimary',
      primaryKind: 'navigate',
      href: WORKER_PERSONAL_DETAILS_HREF,
      secondaryLabelKey: 'dashboard.actionItems.dismiss',
      secondaryKind: 'dismiss_firestore',
      priorityScore: scoreForId('add_emergency_contact'),
      sourceReason: 'Recommended: emergency contact',
      qaEvaluatedFields: {},
    });
  }

  const smsEval = evaluateWorkerSmsProfileSlot(userDoc);
  if (smsEval.slot === 're_enable_sms_notifications') {
    out.push({
      id: 're_enable_sms_notifications',
      category: 'important',
      _profileTier: 'important',
      titleKey: 'dashboard.actionItems.reEnableSmsTitle',
      descriptionKey: 'dashboard.actionItems.reEnableSmsDescription',
      primaryLabelKey: 'dashboard.actionItems.reEnableSmsPrimary',
      primaryKind: 'enable_sms',
      priorityScore: scoreForId('re_enable_sms_notifications'),
      sourceReason: 'SMS blocked — re-enable',
      qaEvaluatedFields: smsEval.evaluatedFields,
    });
  } else if (smsEval.slot === 'sms_opt_in') {
    out.push({
      id: 'sms_opt_in',
      category: 'snoozable',
      _profileTier: 'snoozable',
      titleKey: 'dashboard.actionItems.smsTitle',
      descriptionKey: 'dashboard.actionItems.smsDescription',
      primaryLabelKey: 'dashboard.actionItems.smsPrimary',
      primaryKind: 'enable_sms',
      secondaryLabelKey: 'dashboard.actionItems.notNow',
      secondaryKind: 'snooze_sms',
      priorityScore: scoreForId('sms_opt_in'),
      sourceReason: 'SMS opt-in',
      qaEvaluatedFields: smsEval.evaluatedFields,
    });
  }

  return out;
}

const TIER_ORDER: Record<WorkerDashboardProfileTierOrder, number> = {
  important: 0,
  recommended: 1,
  snoozable: 2,
};

/**
 * Build the full sorted list. `items` is the FULL contract list (no 3-cap);
 * clients slice 3 for the home dashboard.
 *
 * Sort key: `priorityScore` descending. Within ties (rare given the contract
 * table), profile-tier order then `id` provide a stable tiebreak so two
 * snapshots with the same input bag always serialise to the same hash.
 */
export function buildWorkerDashboardActionItemsSnapshot(
  input: WorkerDashboardActionItemsModelInput,
): WorkerDashboardActionItemsSnapshotPayload {
  const profileItems = buildProfileItems(input);
  const jobItems = buildJobItems(input);
  const all: InternalItem[] = [...jobItems, ...profileItems];

  all.sort((a, b) => {
    const scoreDiff = b.priorityScore - a.priorityScore;
    if (scoreDiff !== 0) return scoreDiff;
    const aTier = a._profileTier ? TIER_ORDER[a._profileTier] : -1;
    const bTier = b._profileTier ? TIER_ORDER[b._profileTier] : -1;
    if (aTier !== bTier) return aTier - bTier;
    return a.id.localeCompare(b.id);
  });

  const items: WorkerDashboardActionItemV1[] = all.map((it) => {
    const { _profileTier: _t, ...rest } = it;
    return rest;
  });

  return {
    sourceVersion: WORKER_DASHBOARD_ACTION_ITEMS_SOURCE_VERSION,
    items,
    inputsHash: stableInputsHash(input),
  };
}

// ---------------------------------------------------------------------------
// Inputs hash — stable JSON of just the fields the model actually consumes.
// Used by the recompute layer to skip Firestore writes when nothing changed.
// Excludes timestamps and nondeterministic fields by definition.
// ---------------------------------------------------------------------------

function pickUserDocFingerprint(userDoc: Record<string, unknown> | null): Record<string, unknown> {
  if (!userDoc) return {};
  const wp = asObj(userDoc.workerProfile) || {};
  const dashboard = asObj(wp.dashboard) || {};
  const dismissed = asObj(dashboard.dismissedActionItems) || {};
  const addressInfo = asObj(userDoc.addressInfo) || {};
  const emergencyContact = asObj(userDoc.emergencyContact) || {};
  const onboarding = asObj(userDoc.onboarding) || {};
  const notifications = asObj(userDoc.notificationSettings) || {};
  const eligibility = asObj(userDoc.workEligibilityAttestation) || {};
  return {
    dob: userDoc.dob ?? userDoc.dateOfBirth ?? null,
    phone: userDoc.phone ?? null,
    phoneVerified: userDoc.phoneVerified ?? null,
    last4SSN: userDoc.last4SSN ?? null,
    addressInfo: {
      streetAddress: addressInfo.streetAddress ?? null,
      city: addressInfo.city ?? userDoc.city ?? null,
      state: addressInfo.state ?? userDoc.state ?? null,
      zip: addressInfo.zip ?? addressInfo.zipCode ?? userDoc.zip ?? null,
      homeLat: addressInfo.homeLat ?? null,
      homeLng: addressInfo.homeLng ?? null,
    },
    photoUrl: wp.photoUrl ?? null,
    avatar: userDoc.avatar ?? null,
    emergencyContact: {
      name: emergencyContact.name ?? null,
      phone: emergencyContact.phone ?? null,
    },
    smsOptIn: userDoc.smsOptIn ?? null,
    smsBlockedSystem: userDoc.smsBlockedSystem ?? null,
    smsSystemUnavailable: userDoc.smsSystemUnavailable ?? null,
    notifications: { smsUnavailable: notifications.smsUnavailable ?? null },
    eligibility: {
      authorizedToWorkUS: eligibility.authorizedToWorkUS ?? null,
      requireSponsorship: eligibility.requireSponsorship ?? null,
      workEligibility: userDoc.workEligibility ?? null,
      requireSponsorshipTopLevel: userDoc.requireSponsorship ?? null,
    },
    onboarding: {
      tempworksOnboardingRequired: onboarding.tempworksOnboardingRequired ?? null,
      tempworksRecruiterVerified: onboarding.tempworksRecruiterVerified ?? null,
      tempworksVerified: onboarding.tempworksVerified ?? null,
      tempworksStartedAtPresent: tempworksStartedFingerprint(onboarding.tempworksStartedAt),
      tempworksOnboardingUrl: onboarding.tempworksOnboardingUrl ?? null,
    },
    dismissed: Object.keys(dismissed)
      .filter((k) => dismissed[k] === true || dismissed[k] === 'true')
      .sort(),
  };
}

function tempworksStartedFingerprint(at: unknown): string | null {
  if (at == null || at === '') return null;
  if (typeof at === 'string') return at.trim() || null;
  if (typeof at === 'number') return Number.isFinite(at) ? `n${at}` : null;
  if (typeof at === 'object' && typeof (at as { toMillis?: () => number }).toMillis === 'function') {
    try {
      return `t${(at as { toMillis: () => number }).toMillis()}`;
    } catch {
      return 'tx';
    }
  }
  return null;
}

function pickItemsFingerprint(items: WorkerDashboardActionItemV1[]): Array<Record<string, unknown>> {
  return items.map((it) => ({
    id: it.id,
    href: it.href ?? null,
    score: it.priorityScore,
    qa: it.qaEvaluatedFields,
  }));
}

function stableInputsHash(input: WorkerDashboardActionItemsModelInput): string {
  const fp = {
    user: pickUserDocFingerprint(input.userDoc),
    pendingAssignments: [...input.pendingAssignments]
      .sort((a, b) => a.assignmentId.localeCompare(b.assignmentId))
      .map((a) => ({ id: a.assignmentId, startAtMs: a.startAtMs })),
    tempworks: input.tempworks
      ? {
          required: input.tempworks.required,
          recruiterVerified: input.tempworks.recruiterVerified,
          started: input.tempworks.started,
          onboardingUrl: input.tempworks.onboardingUrl ?? null,
        }
      : null,
    compliance: {
      backgroundApplicantAction: input.compliance.backgroundApplicantAction,
      backgroundIssueAction: input.compliance.backgroundIssueAction,
      drugScheduleRequired: input.compliance.drugScheduleRequired,
      drugRescheduleRequired: input.compliance.drugRescheduleRequired,
      everifyWorkerAction: input.compliance.everifyWorkerAction,
    },
    prescreen: pickItemsFingerprint(input.prescreen.items),
    authAvatarUrlPresent: Boolean(input.authAvatarUrl && input.authAvatarUrl.trim()),
    tenantId: input.tenantId,
    sourceVersion: WORKER_DASHBOARD_ACTION_ITEMS_SOURCE_VERSION,
  };
  return djb2Hash(canonicalJsonStringify(fp));
}

/** Recursively sorts object keys so two structurally-equal inputs serialise identically. */
function canonicalJsonStringify(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalJsonStringify).join(',') + ']';
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    const parts = keys.map(
      (k) => JSON.stringify(k) + ':' + canonicalJsonStringify((value as Record<string, unknown>)[k]),
    );
    return '{' + parts.join(',') + '}';
  }
  return 'null';
}

/** Tiny deterministic string hash — small, no deps, good enough for change detection. */
function djb2Hash(s: string): string {
  let hash = 5381;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) + hash + s.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

// Re-export the AI prescreen path so the loader stays in lockstep with the
// model's expectation of the prescreen `href` shape.
export { C1_WORKER_AI_PRESCREEN_PATH };
