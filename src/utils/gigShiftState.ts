import { appliedOnDay, getAppliedDays, isIsoDay } from './applicationDays';

type UnknownRecord = Record<string, unknown>;

export function getApplicationShiftIds(applicationData: UnknownRecord | null | undefined): string[] {
  if (!applicationData) return [];
  const ids = new Set<string>();

  if (typeof applicationData.shiftId === 'string' && applicationData.shiftId) {
    ids.add(applicationData.shiftId);
  }

  if (Array.isArray(applicationData.shiftIds)) {
    applicationData.shiftIds.forEach((id) => {
      if (typeof id === 'string' && id) ids.add(id);
    });
  }

  if (Array.isArray(applicationData.selectedShifts)) {
    applicationData.selectedShifts.forEach((entry) => {
      if (typeof entry === 'string' && entry) {
        ids.add(entry);
        return;
      }
      if (!entry || typeof entry !== 'object') return;
      const row = entry as Record<string, unknown>;
      const candidate = typeof row.shiftId === 'string' ? row.shiftId : typeof row.id === 'string' ? row.id : '';
      if (candidate) ids.add(candidate);
    });
  }

  return Array.from(ids);
}

export function applicationHasShiftMetadata(applicationData: UnknownRecord | null | undefined): boolean {
  return getApplicationShiftIds(applicationData).length > 0;
}

export function applicationMatchesShift(applicationData: UnknownRecord | null | undefined, shiftId: string): boolean {
  if (!shiftId) return false;
  return getApplicationShiftIds(applicationData).includes(shiftId);
}

export function applicationMatchesAnyShift(
  applicationData: UnknownRecord | null | undefined,
  shiftIds: string[],
): boolean {
  if (!Array.isArray(shiftIds) || shiftIds.length === 0) return false;
  const appShiftIds = getApplicationShiftIds(applicationData);
  return appShiftIds.some((id) => shiftIds.includes(id));
}

export function applicationMatchesSelectedDay(applicationData: UnknownRecord | null | undefined, selectedDay: string): boolean {
  return appliedOnDay(applicationData, selectedDay);
}

export function getApplicationAppliedDays(applicationData: UnknownRecord | null | undefined): string[] {
  return getAppliedDays(applicationData);
}

export function isIsoGigDay(value: unknown): value is string {
  return isIsoDay(value);
}

export function isGigMultiDayShift(shift: UnknownRecord | null | undefined): boolean {
  if (!shift) return false;
  return Boolean(shift.dateSchedule && shift.endDate && shift.endDate !== shift.shiftDate);
}

/**
 * Build UI applied keys for a single application:
 * - day-specific rows: `shiftId__YYYY-MM-DD`
 * - shift-level row: `shiftId` only when app is not day-specific,
 *   or when shift is not multi-day.
 */
export function buildAppliedKeysForApplication(
  applicationData: UnknownRecord,
  multiDayShiftIds: Set<string>,
): string[] {
  const shiftIds = getApplicationShiftIds(applicationData);
  if (shiftIds.length === 0) return [];

  const days = getAppliedDays(applicationData);
  const keys = new Set<string>();

  if (days.length > 0) {
    shiftIds.forEach((shiftId) => {
      days.forEach((day) => keys.add(`${shiftId}__${day}`));
      if (!multiDayShiftIds.has(String(shiftId))) keys.add(shiftId);
    });
    return Array.from(keys);
  }

  shiftIds.forEach((shiftId) => keys.add(shiftId));
  return Array.from(keys);
}

export function hasDaySpecificKeyForShift(keys: string[], shiftId: string): boolean {
  return keys.some((key) => key.startsWith(`${shiftId}__`));
}

export interface AssignmentDayLike {
  startDate?: string;
}

export function assignmentMatchesSelectedDay(
  assignment: AssignmentDayLike,
  selectedDay: string,
  isGigMultiDay: boolean,
): boolean {
  if (!isGigMultiDay || !selectedDay) return true;
  return assignment.startDate === selectedDay;
}
