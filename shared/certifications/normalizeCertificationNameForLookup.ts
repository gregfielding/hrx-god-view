/**
 * Frozen lookup key normalization for catalog resolution (Phase 1A).
 *
 * Applied in order:
 * 1. trim
 * 2. lowercase
 * 3. replace `&` with ` and `
 * 4. replace punctuation and symbols with spaces (.,-/() etc.; letters and digits kept)
 * 5. collapse internal whitespace to a single space
 */
export function normalizeCertificationNameForLookup(raw: string): string {
  let s = raw.trim().toLowerCase();
  s = s.replace(/&/g, ' and ');
  // Non letter-number (Unicode) → space; then collapse whitespace
  s = s.replace(/[^\p{L}\p{N}]+/gu, ' ');
  s = s.replace(/\s+/g, ' ');
  return s.trim();
}
