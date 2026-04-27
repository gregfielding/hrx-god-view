/**
 * E-Verify REST `i551_number` (Permanent Resident Card **document number**).
 * USCIS validates: min length 13, pattern `/^[a-zA-Z]{3}(\d{10}|\*\d{9})$/`.
 *
 * This is **not** the 9-digit USCIS/Alien Number from the glossary — that is a different value on the card.
 * @see https://www.uscis.gov/glossary-term/50674 (Alien # — 9 digits; use for reference only, not this field)
 */

const EVERIFY_I551_DOCUMENT_NUMBER = /^[A-Za-z]{3}(\d{10}|\*\d{9})$/;

/**
 * E-Verify requires `i551_number` for `FORM_I551`; ICA allows a masked value `LLL*#########`.
 * HRX derives `UNK*#########` from normalized Alien # (`A#########`) when the UI collects one field.
 */
export function deriveEverifyI551MaskFromAlienNumber(alienNormalized: string): string | null {
  const s = String(alienNormalized || '').trim().toUpperCase();
  if (!/^A\d{9}$/.test(s)) return null;
  return `UNK*${s.slice(1)}`;
}

/** Collapse whitespace; uppercase the three letter prefix only. */
export function normalizeI551NumberForEverifyApi(raw: string): string | null {
  const compact = String(raw || '')
    .trim()
    .replace(/\s+/g, '');
  if (!compact) return null;
  const norm = compact.slice(0, 3).toUpperCase() + compact.slice(3);
  return EVERIFY_I551_DOCUMENT_NUMBER.test(norm) ? norm : null;
}

export function isValidI551NumberForEverifyApi(raw: string): boolean {
  return normalizeI551NumberForEverifyApi(raw) !== null;
}
