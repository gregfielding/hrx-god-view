import { parseCalendarDateLocal } from './dateUtilsCalendar';
import { normalizeLast4SsnDigits } from './last4Ssn';
import { getWorkerSmsAlertsContext } from './workerSmsAlertsContext';

export const WORKER_PERSONAL_DETAILS_HREF = '/c1/workers/profile/personal-details';

export function getWorkerUsPhoneDigits10(userDoc: Record<string, unknown> | null | undefined): string {
  if (!userDoc || typeof userDoc !== 'object') return '';
  let d = String(userDoc.phone ?? '').replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
  return d.length === 10 ? d : '';
}

export function evaluateWorkerDobGate(userDoc: Record<string, unknown> | null | undefined): {
  needsAction: boolean;
  evaluatedFields: Record<string, unknown>;
} {
  if (!userDoc || typeof userDoc !== 'object') {
    return { needsAction: true, evaluatedFields: { userDocPresent: false, reason: 'missing_user' } };
  }
  const raw = userDoc.dob ?? userDoc.dateOfBirth;
  const s = typeof raw === 'string' ? raw.trim() : raw != null && raw !== '' ? String(raw).trim() : '';
  if (!s) {
    return {
      needsAction: true,
      evaluatedFields: { dobRaw: raw ?? null, reason: 'missing' },
    };
  }
  let birth = parseCalendarDateLocal(s);
  if (!birth || Number.isNaN(birth.getTime())) {
    const d = new Date(s);
    birth = Number.isNaN(d.getTime()) ? undefined : d;
  }
  if (!birth || Number.isNaN(birth.getTime())) {
    return { needsAction: true, evaluatedFields: { dobRaw: s, reason: 'invalid' } };
  }
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age -= 1;
  if (age < 18) {
    return { needsAction: true, evaluatedFields: { dobRaw: s, age, reason: 'under18' } };
  }
  return { needsAction: false, evaluatedFields: { dobRaw: s, age, reason: 'ok' } };
}

export function evaluateWorkerPhoneGate(userDoc: Record<string, unknown> | null | undefined): {
  needsAction: boolean;
  hasValidUsPhone10: boolean;
  phoneVerified: boolean;
  evaluatedFields: Record<string, unknown>;
} {
  if (!userDoc || typeof userDoc !== 'object') {
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

export function workerHasTaxIdentityLast4(userDoc: Record<string, unknown> | null | undefined): boolean {
  if (!userDoc || typeof userDoc !== 'object') return false;
  return normalizeLast4SsnDigits(userDoc.last4SSN).length === 4;
}

export function isWorkerHomeAddressComplete(userDoc: Record<string, unknown> | null | undefined): boolean {
  if (!userDoc || typeof userDoc !== 'object') return false;
  const addr = (userDoc.addressInfo as Record<string, unknown>) || {};
  const street = String(addr.streetAddress ?? '').trim();
  const city = String(addr.city ?? userDoc.city ?? '').trim();
  const state = String(addr.state ?? userDoc.state ?? '').trim();
  const zip = String(addr.zip ?? addr.zipCode ?? userDoc.zip ?? '').trim();
  const lat = addr.homeLat;
  const lng = addr.homeLng;
  const hasCoords =
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lng);
  return !!(street && city && state && zip && hasCoords);
}

export function isWorkerEmergencyContactComplete(userDoc: Record<string, unknown> | null | undefined): boolean {
  if (!userDoc || typeof userDoc !== 'object') return false;
  const ec = (userDoc.emergencyContact as Record<string, unknown>) || {};
  const name = String(ec.name ?? '').trim();
  let d = String(ec.phone ?? '').replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
  return name.length > 0 && d.length === 10;
}

export type WorkerSmsProfileSlot = 're_enable_sms_notifications' | 'sms_opt_in' | null;

export function evaluateWorkerSmsProfileSlot(
  userDoc: Record<string, unknown> | null | undefined,
  smsSnoozedUntilMs: number,
  nowMs: number = Date.now()
): { slot: WorkerSmsProfileSlot; evaluatedFields: Record<string, unknown> } {
  const smsCtx = getWorkerSmsAlertsContext(userDoc);
  const smsSnoozedActive = smsSnoozedUntilMs > nowMs;
  const blocked = !!(userDoc && typeof userDoc === 'object' && userDoc.smsBlockedSystem === true);

  const evaluatedFields: Record<string, unknown> = {
    smsSystemAvailable: smsCtx.smsSystemAvailable,
    smsDisabled: smsCtx.smsDisabled,
    hasPhone: smsCtx.hasPhone,
    smsBlockedSystem: userDoc && typeof userDoc === 'object' ? (userDoc.smsBlockedSystem ?? null) : null,
    smsOptIn: userDoc && typeof userDoc === 'object' ? (userDoc.smsOptIn ?? null) : null,
    smsSnoozedUntilMs,
    nowMs,
    smsSnoozedActive,
  };

  if (!smsCtx.smsSystemAvailable || !smsCtx.smsDisabled || !smsCtx.hasPhone) {
    evaluatedFields.outcome = 'hidden_no_slot';
    return { slot: null, evaluatedFields };
  }

  if (blocked) {
    evaluatedFields.outcome = 're_enable_sms_notifications';
    return { slot: 're_enable_sms_notifications', evaluatedFields };
  }

  if (smsSnoozedActive) {
    evaluatedFields.outcome = 'hidden_snoozed_sms_opt_in';
    return { slot: null, evaluatedFields };
  }

  evaluatedFields.outcome = 'sms_opt_in';
  return { slot: 'sms_opt_in', evaluatedFields };
}
