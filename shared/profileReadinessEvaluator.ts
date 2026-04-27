/**
 * Canonical profile readiness summary for persistence (`users.{uid}.workerReadinessV1`).
 * Uses the same fact gates and ordering as dashboard profile action items (Section 1).
 *
 * Server note: `smsSnoozedUntilMs` is typically 0 — client local snooze is not visible here, so
 * `sms_opt_in` may appear when the worker app would hide it until snooze expires.
 *
 * @see shared/workerProfileActionItemFacts.ts
 * @see shared/workerProfilePrerequisites.ts
 * @see shared/workerSmsAlertsContext.ts
 */

import { normalizeLast4SsnDigits } from './last4Ssn';
import { readDismissedWorkerDashboardActionIds } from './workerDashboardDismissalsRead';
import { userDocHasProfilePhoto } from './workerProfilePrerequisites';
import {
  evaluateWorkerDobGate,
  evaluateWorkerPhoneGate,
  evaluateWorkerSmsProfileSlot,
  isWorkerEmergencyContactComplete,
  isWorkerHomeAddressComplete,
  workerHasTaxIdentityLast4,
} from './workerProfileActionItemFacts';

export {
  WORKER_READINESS_V1_EVALUATOR_VERSION,
  WORKER_READINESS_V1_EVALUATOR_VERSION as PROFILE_READINESS_EVALUATOR_VERSION,
} from './workerReadinessV1Version';

export type ProfileReadinessStatusV1 = 'ready' | 'action_required' | 'blocked';

export type ProfileReadinessSectionStateV1 = 'complete' | 'incomplete' | 'gated';

export type ProfileReadinessSectionV1 = {
  id:
    | 'dob'
    | 'phone'
    | 'tax_identity'
    | 'home_address'
    | 'profile_photo'
    | 'emergency_contact'
    | 'sms_alerts';
  state: ProfileReadinessSectionStateV1;
};

/** Structured summary persisted at `workerReadinessV1.profileReadiness` (no card payloads). */
export type WorkerProfileReadinessV1 = {
  status: ProfileReadinessStatusV1;
  completionPercent: number;
  sections: ProfileReadinessSectionV1[];
  blockingItemIds: string[];
  importantItemIds: string[];
  recommendedItemIds: string[];
};

export type BuildProfileReadinessV1Input = {
  userDoc: Record<string, unknown> | null | undefined;
  /** Optional Auth avatar URL; omitted on Cloud Functions. */
  authAvatarUrl?: string | null;
  /**
   * Client SMS snooze (localStorage). Backend defaults to 0 — see module doc.
   */
  smsSnoozedUntilMs?: number;
};

function clampPercent(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/**
 * Same profile stack as `buildWorkerProfileStackItems` (tier + ids), without i18n / card fields.
 */
export function buildProfileReadinessActionItemIds(input: BuildProfileReadinessV1Input): {
  blockingItemIds: string[];
  importantItemIds: string[];
  recommendedItemIds: string[];
} {
  const { userDoc, authAvatarUrl, smsSnoozedUntilMs = 0 } = input;
  const dismissed = readDismissedWorkerDashboardActionIds(userDoc);

  const dobEval = evaluateWorkerDobGate(userDoc);
  if (dobEval.needsAction) {
    return { blockingItemIds: ['confirm_date_of_birth'], importantItemIds: [], recommendedItemIds: [] };
  }

  const phoneEval = evaluateWorkerPhoneGate(userDoc);
  if (phoneEval.needsAction) {
    return { blockingItemIds: ['verify_phone_number'], importantItemIds: [], recommendedItemIds: [] };
  }

  const importantItemIds: string[] = [];
  const recommendedItemIds: string[] = [];

  if (!workerHasTaxIdentityLast4(userDoc)) {
    importantItemIds.push('add_tax_identity_last4');
  }
  if (!isWorkerHomeAddressComplete(userDoc)) {
    importantItemIds.push('confirm_home_address');
  }
  if (!userDocHasProfilePhoto(userDoc, authAvatarUrl) && !dismissed.has('add_profile_photo')) {
    recommendedItemIds.push('add_profile_photo');
  }
  if (!isWorkerEmergencyContactComplete(userDoc) && !dismissed.has('add_emergency_contact')) {
    recommendedItemIds.push('add_emergency_contact');
  }

  const smsEval = evaluateWorkerSmsProfileSlot(userDoc, smsSnoozedUntilMs);
  if (smsEval.slot === 're_enable_sms_notifications') {
    importantItemIds.push('re_enable_sms_notifications');
  } else if (smsEval.slot === 'sms_opt_in') {
    recommendedItemIds.push('sms_opt_in');
  }

  return { blockingItemIds: [], importantItemIds, recommendedItemIds };
}

export function buildWorkerProfileReadinessV1(input: BuildProfileReadinessV1Input): WorkerProfileReadinessV1 {
  const { userDoc, authAvatarUrl, smsSnoozedUntilMs = 0 } = input;
  const ids = buildProfileReadinessActionItemIds(input);

  const dobEval = evaluateWorkerDobGate(userDoc);
  const dobComplete = !dobEval.needsAction;
  const phoneEval = evaluateWorkerPhoneGate(userDoc);
  const phoneComplete = !phoneEval.needsAction;
  const pastDob = dobComplete;
  const pastPhone = pastDob && phoneComplete;

  const under18 = dobEval.evaluatedFields.reason === 'under18';

  const sections: ProfileReadinessSectionV1[] = [
    {
      id: 'dob',
      state: dobComplete ? 'complete' : 'incomplete',
    },
    {
      id: 'phone',
      state: !pastDob ? 'gated' : phoneComplete ? 'complete' : 'incomplete',
    },
    {
      id: 'tax_identity',
      state: !pastPhone ? 'gated' : workerHasTaxIdentityLast4(userDoc) ? 'complete' : 'incomplete',
    },
    {
      id: 'home_address',
      state: !pastPhone ? 'gated' : isWorkerHomeAddressComplete(userDoc) ? 'complete' : 'incomplete',
    },
    {
      id: 'profile_photo',
      state: !pastPhone
        ? 'gated'
        : userDocHasProfilePhoto(userDoc, authAvatarUrl) ||
            readDismissedWorkerDashboardActionIds(userDoc).has('add_profile_photo')
          ? 'complete'
          : 'incomplete',
    },
    {
      id: 'emergency_contact',
      state: !pastPhone
        ? 'gated'
        : isWorkerEmergencyContactComplete(userDoc) ||
            readDismissedWorkerDashboardActionIds(userDoc).has('add_emergency_contact')
          ? 'complete'
          : 'incomplete',
    },
    {
      id: 'sms_alerts',
      state: !pastPhone
        ? 'gated'
        : (() => {
            const smsEval = evaluateWorkerSmsProfileSlot(userDoc, smsSnoozedUntilMs);
            if (smsEval.slot == null) return 'complete';
            return 'incomplete';
          })(),
    },
  ];

  const counted = sections.filter((s) => s.state !== 'gated');
  const completeN = counted.filter((s) => s.state === 'complete').length;
  const completionPercent = counted.length > 0 ? clampPercent((completeN / counted.length) * 100) : 0;

  const hasAnyOpen =
    ids.blockingItemIds.length > 0 || ids.importantItemIds.length > 0 || ids.recommendedItemIds.length > 0;

  let status: ProfileReadinessStatusV1;
  if (under18) {
    status = 'blocked';
  } else if (!hasAnyOpen) {
    status = 'ready';
  } else {
    status = 'action_required';
  }

  return {
    status,
    completionPercent,
    sections,
    blockingItemIds: [...ids.blockingItemIds],
    importantItemIds: [...ids.importantItemIds],
    recommendedItemIds: [...ids.recommendedItemIds],
  };
}

/**
 * Stable JSON-relevant inputs for change detection (excludes workerReadinessV1 echoes).
 */
export function extractProfileReadinessSourceSignals(userDoc: Record<string, unknown> | null | undefined): unknown {
  if (!userDoc || typeof userDoc !== 'object') return null;
  const wp = (userDoc.workerProfile || {}) as Record<string, unknown>;
  const dashboard = (wp.dashboard || {}) as Record<string, unknown>;
  const addr = (userDoc.addressInfo || {}) as Record<string, unknown>;
  const ec = (userDoc.emergencyContact || {}) as Record<string, unknown>;
  const att = (userDoc.workEligibilityAttestation || {}) as Record<string, unknown>;
  const notifications = (userDoc.notificationSettings || {}) as Record<string, unknown>;
  const resume = (userDoc.resume || {}) as Record<string, unknown>;
  return {
    dob: userDoc.dob ?? userDoc.dateOfBirth ?? null,
    phone: userDoc.phone ?? null,
    phoneVerified: userDoc.phoneVerified ?? null,
    last4SSN: normalizeLast4SsnDigits(userDoc.last4SSN),
    avatar: userDoc.avatar ?? null,
    photoUrl: wp.photoUrl ?? null,
    smsOptIn: userDoc.smsOptIn ?? null,
    smsBlockedSystem: userDoc.smsBlockedSystem ?? null,
    smsSystemUnavailable: userDoc.smsSystemUnavailable ?? null,
    notificationSmsUnavailable: notifications.smsUnavailable ?? null,
    dismissed: dashboard.dismissedActionItems ?? null,
    address: {
      street: addr.streetAddress ?? null,
      city: addr.city ?? userDoc.city ?? null,
      state: addr.state ?? userDoc.state ?? null,
      zip: addr.zip ?? addr.zipCode ?? userDoc.zip ?? null,
      homeLat: addr.homeLat ?? null,
      homeLng: addr.homeLng ?? null,
    },
    emergency: { name: ec.name ?? null, phone: ec.phone ?? null },
    workAuth: {
      authorizedToWorkUS: att.authorizedToWorkUS ?? null,
      requireSponsorship: att.requireSponsorship ?? null,
      workEligibility: userDoc.workEligibility ?? null,
      requireSponsorshipTop: userDoc.requireSponsorship ?? null,
    },
    resume: {
      downloadUrl: resume.downloadUrl ?? null,
      fileName: resume.fileName ?? null,
      storagePath: resume.storagePath ?? null,
      fileUrl: resume.fileUrl ?? null,
      resumeUrl: userDoc.resumeUrl ?? null,
      resumeStoragePath: userDoc.resumeStoragePath ?? null,
    },
  };
}
