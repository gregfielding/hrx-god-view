/** Keep in sync with `src/utils/everifyAlienNumber.ts`. E-Verify `alien_number`: /^A\\d{9}$/ (A + 9 digits). */

export function normalizeAlienNumberForApi(raw: string): string | null {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return null;
  let rest = trimmed.replace(/\s+/g, '');
  if (rest.toUpperCase().startsWith('A')) {
    rest = rest.slice(1).replace(/\s+/g, '');
  }
  const digits = rest.replace(/\D/g, '');
  if (digits.length !== 9 || !/^\d{9}$/.test(digits)) return null;
  return `A${digits}`;
}
