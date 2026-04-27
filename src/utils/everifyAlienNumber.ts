/**
 * E-Verify REST `alien_number`: must match `/^A\\d{9}$/` (10 characters: capital A + 9 digits).
 * Users may type 9 digits only or A + 9 digits; we normalize to the API form.
 * @see https://www.uscis.gov/glossary-term/50674 (9-digit USCIS # on the card)
 */
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

export function isValidAlienNumber(raw: string): boolean {
  return normalizeAlienNumberForApi(raw) !== null;
}
