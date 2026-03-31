/**
 * Hourly pay helpers for jobs board, apply flow, and worker UIs.
 * Always use two decimal places so stored values like 18.81 render as $18.81/hr and 22 as $22.00/hr.
 */

function toFiniteHourlyNumber(payRate: unknown): number | null {
  if (payRate == null) return null;
  if (typeof payRate === 'number') return Number.isFinite(payRate) ? payRate : null;
  if (typeof payRate === 'string') {
    const n = parseFloat(payRate.trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Amount only, for i18n strings like "${amount}/hr" (no currency symbol). */
export function formatHourlyPayAmountForI18n(payRate: unknown): string {
  const n = toFiniteHourlyNumber(payRate);
  return n == null ? '' : n.toFixed(2);
}

/** US dollar amount with two decimals, e.g. "$18.81". Null if missing or invalid. */
export function formatUsdTwoDecimals(value: unknown): string | null {
  const n = toFiniteHourlyNumber(value);
  return n == null ? null : `$${n.toFixed(2)}`;
}

/** Full label e.g. "$18.81/hr". Returns null if missing or invalid. */
export function formatHourlyPayRateForDisplay(payRate: unknown): string | null {
  const dollars = formatUsdTwoDecimals(payRate);
  return dollars == null ? null : `${dollars}/hr`;
}

/** Same as hourly label but uses "/hour" (recruiter copy). */
export function formatHourlyPayPerHourLong(payRate: unknown): string | null {
  const dollars = formatUsdTwoDecimals(payRate);
  return dollars == null ? null : `${dollars}/hour`;
}
