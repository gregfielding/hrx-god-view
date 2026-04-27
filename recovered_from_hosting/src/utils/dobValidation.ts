import { parse, isValid, isFuture, differenceInYears, format } from 'date-fns';

export interface DOBValidationResult {
  ok: boolean;
  error?: string;
  iso?: string; // YYYY-MM-DD format for Firestore
}

/**
 * Validates a date of birth input
 * @param inputMMDDYYYY - Date string in MM/DD/YYYY format
 * @param minAge - Minimum age requirement (default: 18)
 * @param maxAge - Maximum age sanity check (default: 100)
 * @returns Validation result with ISO formatted date if valid
 */
export function validateDob(
  inputMMDDYYYY: string,
  minAge = 18,
  maxAge = 100
): DOBValidationResult {
  // Check if input is provided
  if (!inputMMDDYYYY || inputMMDDYYYY.trim() === '') {
    return { ok: false, error: 'Date of birth is required.' };
  }

  // Parse the date with strict mode
  const parsedDate = parse(inputMMDDYYYY, 'MM/dd/yyyy', new Date());

  // Check if date is valid
  if (!isValid(parsedDate)) {
    return { ok: false, error: 'Enter a valid date.' };
  }

  // Check if date is in the future
  if (isFuture(parsedDate)) {
    return { ok: false, error: 'Date can\'t be in the future.' };
  }

  // Calculate age
  const age = differenceInYears(new Date(), parsedDate);

  // Check minimum age
  if (age < minAge) {
    return { ok: false, error: `You must be at least ${minAge} years old.` };
  }

  // Check maximum age (sanity check)
  if (age > maxAge) {
    return { ok: false, error: 'Please enter a valid birth date.' };
  }

  // Return success with ISO format
  return {
    ok: true,
    iso: format(parsedDate, 'yyyy-MM-dd')
  };
}

/**
 * Formats a YYYY-MM-DD date to MM/DD/YYYY for display
 * @param isoDate - Date string in YYYY-MM-DD format
 * @returns Date string in MM/DD/YYYY format
 */
export function formatDobForDisplay(isoDate: string): string {
  const parsed = parse(isoDate, 'yyyy-MM-dd', new Date());
  if (!isValid(parsed)) return '';
  return format(parsed, 'MM/dd/yyyy');
}

/**
 * Calculates age from a date of birth
 * @param isoDate - Date string in YYYY-MM-DD format
 * @returns Age in years
 */
export function calculateAge(isoDate: string): number {
  const parsed = parse(isoDate, 'yyyy-MM-dd', new Date());
  if (!isValid(parsed)) return 0;
  return differenceInYears(new Date(), parsed);
}
