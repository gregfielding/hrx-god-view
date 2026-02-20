import { FieldValue } from 'firebase/firestore';

/**
 * Safely convert a Date or FieldValue to a Date object
 * @param value - Date object or FieldValue (serverTimestamp)
 * @returns Date object or current date if value is FieldValue
 */
export const safeToDate = (value: Date | FieldValue | any): Date => {
  // If it's already a Date object
  if (value instanceof Date) {
    return value;
  }
  
  // If it's a Firestore Timestamp (from toDate())
  if (value && typeof value.toDate === 'function') {
    return value.toDate();
  }
  
  // If it's a FieldValue (serverTimestamp), return current date
  if (value && typeof value === 'object' && value._methodName === 'serverTimestamp') {
    return new Date();
  }
  
  // If it's a string or number, try to parse it
  if (typeof value === 'string' || typeof value === 'number') {
    return new Date(value);
  }
  
  // Fallback to current date
  return new Date();
};

/**
 * Get job order age in days, handling both Date and FieldValue
 * @param createdAt - Date object or FieldValue
 * @returns Number of days since the date
 */
export const getJobOrderAge = (createdAt: Date | FieldValue | any): number => {
  const date = safeToDate(createdAt);
  const now = new Date();
  const diffTime = Math.abs(now.getTime() - date.getTime());
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays;
};

/**
 * Get current local date as ISO string (date only)
 * @returns ISO string of current date
 */
export const getCurrentLocalDate = (): string => {
  const date = new Date();
  return date.toISOString().split('T')[0];
};

/**
 * Get current local date and time as ISO string
 * @returns ISO string of current date/time
 */
export const getCurrentLocalDateTime = (): string => {
  return new Date().toISOString();
};

/**
 * Convert local date time to UTC
 * @param localDateTime - Local date time string
 * @returns UTC date time string
 */
export const localDateTimeToUTC = (localDateTime: string): string => {
  const date = new Date(localDateTime);
  return date.toISOString();
};

/**
 * Get user's timezone
 * @returns User's timezone string
 */
export const getUserTimezone = (): string => {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
};

/**
 * Format date for display
 * @param dateString - Date string to format
 * @returns Formatted date string
 */
export const formatDateForDisplay = (dateString: string): string => {
  const date = new Date(dateString);
  return date.toLocaleDateString();
};

/**
 * Format a calendar date for display without timezone shift.
 * Use for dates that represent "a day" (e.g. job start date) rather than "a moment in time".
 * When Firestore stores 2026-04-10T00:00:00.000Z, toLocaleDateString() shows 4/9 in US zones.
 * This uses UTC date components so 4/10 displays correctly.
 */
export const formatCalendarDate = (dateValue: Date | { toDate: () => Date } | string | null | undefined): string => {
  if (!dateValue) return '';
  try {
    let date: Date;
    if (typeof dateValue === 'string') {
      date = new Date(dateValue);
    } else if (dateValue && typeof (dateValue as { toDate?: () => Date }).toDate === 'function') {
      date = (dateValue as { toDate: () => Date }).toDate();
    } else if (dateValue instanceof Date) {
      date = dateValue;
    } else {
      date = new Date(dateValue as unknown as string | number | Date);
    }
    if (isNaN(date.getTime())) return '';
    const m = date.getUTCMonth() + 1;
    const d = date.getUTCDate();
    const y = date.getUTCFullYear();
    return `${m}/${d}/${y}`;
  } catch {
    return '';
  }
};

/**
 * Return the calendar day (YYYY-MM-DD) for a shift date in the user's local timezone.
 * Use for "same day" comparisons (e.g. double-book checks) so that a shift at 11 PM Saturday
 * and a shift at 1 AM Sunday are not considered the same day when the user is in a timezone
 * where Saturday 11 PM is still Saturday.
 * - Plain date-only strings (YYYY-MM-DD) are returned as-is (no timezone applied).
 * - Timestamps and date-time strings are interpreted as a moment and converted to the
 *   local calendar day (getFullYear/getMonth/getDate).
 */
export const getCalendarDayLocal = (shiftDate: string | Date | { toDate: () => Date } | null | undefined): string => {
  if (shiftDate == null || shiftDate === '') return '';
  if (typeof shiftDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(shiftDate)) return shiftDate;
  try {
    let date: Date;
    if (typeof shiftDate === 'string') {
      date = new Date(shiftDate);
    } else if (shiftDate && typeof (shiftDate as { toDate?: () => Date }).toDate === 'function') {
      date = (shiftDate as { toDate: () => Date }).toDate();
    } else if (shiftDate instanceof Date) {
      date = shiftDate;
    } else {
      return '';
    }
    if (isNaN(date.getTime())) return '';
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  } catch {
    return '';
  }
};