const ISO_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDay(value: unknown): value is string {
  return typeof value === 'string' && ISO_DAY_RE.test(value);
}

function toIsoDayList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isIsoDay);
}

/**
 * Extract explicit day selections for an application.
 * Priority: applyDates/applyDate, then legacy shiftDates/shiftDate.
 */
export function getAppliedDays(applicationData: Record<string, unknown> | null | undefined): string[] {
  if (!applicationData) return [];

  const applyDates = toIsoDayList(applicationData.applyDates);
  if (applyDates.length > 0) return applyDates;

  if (isIsoDay(applicationData.applyDate)) return [applicationData.applyDate];

  const shiftDates = toIsoDayList(applicationData.shiftDates);
  if (shiftDates.length > 0) return shiftDates;

  if (isIsoDay(applicationData.shiftDate)) return [applicationData.shiftDate];

  return [];
}

export function appliedOnDay(applicationData: Record<string, unknown> | null | undefined, day: string): boolean {
  if (!isIsoDay(day)) return false;
  return getAppliedDays(applicationData).includes(day);
}
