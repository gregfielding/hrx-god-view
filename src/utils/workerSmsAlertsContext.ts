/**
 * Worker SMS / text alert eligibility — shared by dashboard action items and SmsWarningBanner.
 * Keep in sync with `shared/workerSmsAlertsContext.ts` (CRA bundle cannot import outside `src/`).
 */

export function isWorkerSmsEffectivelyEnabled(data: Record<string, unknown>): boolean {
  const smsOptIn = data.smsOptIn;
  const blocked = data.smsBlockedSystem === true;
  return smsOptIn !== false && !blocked;
}

export function getWorkerSmsAlertsContext(data: Record<string, unknown> | null | undefined): {
  smsSystemAvailable: boolean;
  smsDisabled: boolean;
  hasPhone: boolean;
} {
  if (!data || typeof data !== 'object') {
    return { smsSystemAvailable: true, smsDisabled: true, hasPhone: false };
  }
  const notifications = (data.notificationSettings || {}) as Record<string, unknown>;
  const phone = String(data.phone || '').trim();
  const unavailable =
    data.smsSystemUnavailable === true || notifications.smsUnavailable === true;
  return {
    smsSystemAvailable: !unavailable,
    smsDisabled: !isWorkerSmsEffectivelyEnabled(data),
    hasPhone: phone.length > 0,
  };
}
