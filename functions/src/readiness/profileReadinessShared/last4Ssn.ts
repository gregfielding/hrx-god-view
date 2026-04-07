/** Strip non-digits and cap at 4 (last-four SSN input). */
export function normalizeLast4SsnDigits(raw: unknown): string {
  return String(raw ?? '')
    .replace(/\D/g, '')
    .slice(0, 4);
}
