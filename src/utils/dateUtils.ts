/**
 * Date and Timezone Utilities
 * Handles consistent date formatting and timezone conversion across the app
 */

/**
 * Get the user's current timezone
 */
export const getUserTimezone = (): string => {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
};

/**
 * Convert a local date string (YYYY-MM-DD) to a Date object in user's timezone
 */
export const localDateToDate = (dateString: string): Date => {
  if (!dateString) return new Date();
  
  const [year, month, day] = dateString.split('-').map(Number);
  return new Date(year, month - 1, day); // month is 0-indexed
};

/**
 * Convert a local datetime string (YYYY-MM-DDTHH:mm) to UTC ISO string for Google Calendar
 */
export const localDateTimeToUTC = (dateTimeString: string): string => {
  if (!dateTimeString) return '';
  
  try {
    const localDateTime = new Date(dateTimeString);
    if (isNaN(localDateTime.getTime())) {
      console.warn('Invalid datetime string:', dateTimeString);
      return '';
    }
    
    return localDateTime.toISOString();
  } catch (error) {
    console.warn('Error converting datetime to UTC:', error);
    return '';
  }
};

/**
 * Convert a UTC ISO string back to local datetime string for display
 */
export const utcToLocalDateTime = (utcString: string): string => {
  if (!utcString) return '';
  
  try {
    const utcDate = new Date(utcString);
    if (isNaN(utcDate.getTime())) {
      console.warn('Invalid UTC string:', utcString);
      return '';
    }
    
    const year = utcDate.getFullYear();
    const month = String(utcDate.getMonth() + 1).padStart(2, '0');
    const day = String(utcDate.getDate()).padStart(2, '0');
    const hours = String(utcDate.getHours()).padStart(2, '0');
    const minutes = String(utcDate.getMinutes()).padStart(2, '0');
    
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  } catch (error) {
    console.warn('Error converting UTC to local datetime:', error);
    return '';
  }
};

/**
 * Get current date in user's local timezone as YYYY-MM-DD
 */
export const getCurrentLocalDate = (): string => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

/**
 * Get current datetime in user's local timezone as YYYY-MM-DDTHH:mm
 */
export const getCurrentLocalDateTime = (): string => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
};

/**
 * Format a date for display in user's local timezone
 */
export const formatDateForDisplay = (dateString: string): string => {
  if (!dateString) return '';
  
  try {
    let date: Date;
    
    if (dateString.includes('T')) {
      // ISO date string (e.g., "2025-08-17T00:00:00.000Z")
      date = new Date(dateString);
    } else {
      // Date-only string (e.g., "2025-08-17") - treat as local date
      const [year, month, day] = dateString.split('-').map(Number);
      date = new Date(year, month - 1, day); // month is 0-indexed
    }
    
    if (isNaN(date.getTime())) {
      console.warn('Invalid date:', dateString);
      return '';
    }
    
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  } catch (error) {
    console.warn('Error formatting date:', dateString, error);
    return '';
  }
};

/**
 * Calculate end time based on start time and duration in minutes
 */
export const calculateEndTime = (startTime: string, durationMinutes: number): string => {
  if (!startTime || !durationMinutes) return '';
  
  try {
    const startDate = new Date(startTime);
    const endDate = new Date(startDate.getTime() + durationMinutes * 60000);
    return endDate.toISOString();
  } catch (error) {
    console.warn('Error calculating end time:', error);
    return '';
  }
};
