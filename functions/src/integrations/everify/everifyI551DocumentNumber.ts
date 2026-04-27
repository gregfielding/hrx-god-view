/**
 * Keep in sync with `src/utils/everifyI551DocumentNumber.ts`.
 * E-Verify `i551_number`: 3 letters + 10 digits OR 3 letters + * + 9 digits (length 13).
 */

const EVERIFY_I551_DOCUMENT_NUMBER = /^[A-Za-z]{3}(\d{10}|\*\d{9})$/;

/**
 * @see `src/utils/everifyI551DocumentNumber.ts` — derive ICA-mask `i551_number` from Alien # for FORM_I551.
 */
export function deriveEverifyI551MaskFromAlienNumber(alienNormalized: string): string | null {
  const s = String(alienNormalized || '').trim().toUpperCase();
  if (!/^A\d{9}$/.test(s)) return null;
  return `UNK*${s.slice(1)}`;
}

export function normalizeI551NumberForEverifyApi(raw: string): string | null {
  const compact = String(raw || '')
    .trim()
    .replace(/\s+/g, '');
  if (!compact) return null;
  const norm = compact.slice(0, 3).toUpperCase() + compact.slice(3);
  return EVERIFY_I551_DOCUMENT_NUMBER.test(norm) ? norm : null;
}
