/**
 * Field snapshots for worker dashboard Priority Stack — QA / parity logging only.
 * Boolean outcomes must stay aligned with `workerProfilePrerequisites` and `workerSmsAlertsContext`.
 */

import {
  userDocHasCompleteWorkAuthorization,
  userDocHasProfilePhoto,
  userDocHasStoredResume,
} from './workerProfilePrerequisites';
import { getWorkerSmsAlertsContext } from './workerSmsAlertsContext';

export function evaluateResumeForPriorityStack(userDoc: Record<string, unknown> | null | undefined): {
  hasStoredResume: boolean;
  evaluatedFields: Record<string, unknown>;
} {
  if (!userDoc || typeof userDoc !== 'object') {
    return {
      hasStoredResume: false,
      evaluatedFields: { userDocPresent: false },
    };
  }
  const resumeObj = (userDoc.resume || {}) as Record<string, unknown>;
  const evaluatedFields: Record<string, unknown> = {
    'resume.downloadUrl': resumeObj.downloadUrl ?? null,
    'resume.fileName': resumeObj.fileName ?? null,
    'resume.storagePath': resumeObj.storagePath ?? null,
    'resume.fileUrl': resumeObj.fileUrl ?? null,
    resumeStoragePath: userDoc.resumeStoragePath ?? null,
    resumeUrl: userDoc.resumeUrl ?? null,
  };
  return {
    hasStoredResume: userDocHasStoredResume(userDoc),
    evaluatedFields,
  };
}

export function evaluateProfilePhotoForPriorityStack(
  userDoc: Record<string, unknown> | null | undefined,
  authAvatarUrl?: string | null
): { hasProfilePhoto: boolean; evaluatedFields: Record<string, unknown> } {
  const wpPhoto = (userDoc?.workerProfile as Record<string, unknown> | undefined)?.photoUrl;
  const avatar = userDoc?.avatar;
  const coalesced = String((wpPhoto ?? avatar ?? authAvatarUrl ?? '') as string).trim();
  const evaluatedFields: Record<string, unknown> = {
    'workerProfile.photoUrl': wpPhoto ?? null,
    avatar: avatar ?? null,
    authAvatarUrl: authAvatarUrl ?? null,
    coalescedTrimmedLength: coalesced.length,
  };
  return {
    hasProfilePhoto: userDocHasProfilePhoto(userDoc, authAvatarUrl),
    evaluatedFields,
  };
}

export function evaluateWorkAuthorizationForPriorityStack(
  userDoc: Record<string, unknown> | null | undefined
): { complete: boolean; evaluatedFields: Record<string, unknown> } {
  if (!userDoc || typeof userDoc !== 'object') {
    return {
      complete: false,
      evaluatedFields: { userDocPresent: false },
    };
  }
  const att = (userDoc.workEligibilityAttestation || {}) as Record<string, unknown>;
  const hasAuthLeg =
    typeof att.authorizedToWorkUS === 'boolean' || typeof userDoc.workEligibility === 'boolean';
  const hasSponsorshipLeg =
    typeof att.requireSponsorship === 'boolean' || typeof userDoc.requireSponsorship === 'boolean';
  const evaluatedFields: Record<string, unknown> = {
    'workEligibilityAttestation.authorizedToWorkUS': att.authorizedToWorkUS ?? null,
    workEligibility: userDoc.workEligibility ?? null,
    derivedHasAuthorizedToWorkAnswer: hasAuthLeg,
    'workEligibilityAttestation.requireSponsorship': att.requireSponsorship ?? null,
    requireSponsorship: userDoc.requireSponsorship ?? null,
    derivedHasSponsorshipAnswer: hasSponsorshipLeg,
  };
  return {
    complete: userDocHasCompleteWorkAuthorization(userDoc),
    evaluatedFields,
  };
}

export function evaluateSmsOptInForPriorityStack(
  userDoc: Record<string, unknown> | null | undefined,
  smsSnoozedUntilMs: number,
  nowMs: number = Date.now()
): {
  showSmsCard: boolean;
  smsCtx: ReturnType<typeof getWorkerSmsAlertsContext>;
  smsSnoozed: boolean;
  evaluatedFields: Record<string, unknown>;
} {
  const smsCtx = getWorkerSmsAlertsContext(userDoc);
  const smsSnoozed = smsSnoozedUntilMs > nowMs;
  const notifications = (userDoc && typeof userDoc === 'object'
    ? (userDoc.notificationSettings || {})
    : {}) as Record<string, unknown>;
  const phone = userDoc && typeof userDoc === 'object' ? String(userDoc.phone || '').trim() : '';
  const showSmsCard = smsCtx.smsSystemAvailable && smsCtx.smsDisabled && !smsSnoozed;
  const evaluatedFields: Record<string, unknown> = {
    smsOptIn: userDoc && typeof userDoc === 'object' ? (userDoc.smsOptIn ?? null) : null,
    smsBlockedSystem: userDoc && typeof userDoc === 'object' ? (userDoc.smsBlockedSystem ?? null) : null,
    smsSystemUnavailable: userDoc && typeof userDoc === 'object' ? (userDoc.smsSystemUnavailable ?? null) : null,
    'notificationSettings.smsUnavailable': notifications.smsUnavailable ?? null,
    phoneTrimmedLength: phone.length,
    smsSystemAvailable: smsCtx.smsSystemAvailable,
    smsDisabled: smsCtx.smsDisabled,
    hasPhone: smsCtx.hasPhone,
    smsSnoozedUntilMs,
    nowMs,
    smsSnoozedActive: smsSnoozed,
    showSmsCard,
  };
  return { showSmsCard, smsCtx, smsSnoozed, evaluatedFields };
}
