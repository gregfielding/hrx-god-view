/**
 * US mobile/landline: 10 digits, optional leading country code 1.
 */

export function normalizeUsPhoneDigits(input: string): string {
  const d = String(input || '').replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) return d.slice(1);
  return d;
}

export function isValidUsPhone10(input: string): boolean {
  return normalizeUsPhoneDigits(input).length === 10;
}
