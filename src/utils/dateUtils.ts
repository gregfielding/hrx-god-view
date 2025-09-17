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
 * @param dateOpened - Date object or FieldValue
 * @returns Number of days since the date
 */
export const getJobOrderAge = (dateOpened: Date | FieldValue | any): number => {
  const date = safeToDate(dateOpened);
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