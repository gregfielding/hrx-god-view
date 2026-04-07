/** Keep in sync with `shared/last4Ssn.ts` (CRA bundle cannot import outside `src/`). */

/** Strip non-digits and cap at 4 (last-four SSN input). */
export function normalizeLast4SsnDigits(raw: unknown): string {
  return String(raw ?? '')
    .replace(/\D/g, '')
    .slice(0, 4);
}

/** Empty is valid; otherwise must be exactly four digits. */
export function isEmptyOrValidLast4Ssn(raw: unknown): boolean {
  const d = normalizeLast4SsnDigits(raw);
  return d.length === 0 || d.length === 4;
}
