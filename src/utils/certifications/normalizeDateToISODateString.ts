/**
 * Single entry point for calendar date normalization (spec v1.3 + implementation discipline §7).
 * Returns YYYY-MM-DD in UTC for comparisons, or null if unparseable / empty.
 */
export function normalizeDateToISODateString(input: unknown): string | null {
  if (input === null || input === undefined) return null;
  if (typeof input === 'string' && input.trim() === '') return null;

  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) return null;
    return utcDatePartsToIso(input.getUTCFullYear(), input.getUTCMonth() + 1, input.getUTCDate());
  }

  if (typeof input === 'object' && input !== null && 'toDate' in input && typeof (input as { toDate: () => Date }).toDate === 'function') {
    const d = (input as { toDate: () => Date }).toDate();
    if (Number.isNaN(d.getTime())) return null;
    return utcDatePartsToIso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }

  if (typeof input !== 'string') return null;

  const s = input.trim();
  // Already YYYY-MM-DD (compare dates only, strip time if concatenated by mistake)
  const isoDay = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (isoDay) {
    const y = Number(isoDay[1]);
    const m = Number(isoDay[2]);
    const day = Number(isoDay[3]);
    return validateYmd(y, m, day);
  }

  const t = Date.parse(s);
  if (Number.isNaN(t)) return null;
  const d = new Date(t);
  return utcDatePartsToIso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

function utcDatePartsToIso(y: number, m1: number, d: number): string {
  const mm = m1 < 10 ? `0${m1}` : String(m1);
  const dd = d < 10 ? `0${d}` : String(d);
  return `${y}-${mm}-${dd}`;
}

function validateYmd(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== m - 1 ||
    dt.getUTCDate() !== d
  ) {
    return null;
  }
  return utcDatePartsToIso(y, m, d);
}
