import { Timestamp } from 'firebase/firestore';

/**
 * Normalize `users/{id}` `dob` / `dateOfBirth` (string, Timestamp, seconds object, Date) to YYYY-MM-DD.
 * Used before HTTPS callables that forward DOB to vendors expecting a parseable string.
 */
export function normalizeUserDocumentDobToYyyyMmDd(v: unknown): string {
  if (v == null || v === '') return '';
  if (typeof v === 'string') {
    const s = v.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) {
      const [mm, dd, yyyy] = s.split('/');
      return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
    }
    const d = new Date(s);
    return !isNaN(d.getTime()) ? d.toISOString().split('T')[0]! : '';
  }
  if (typeof (v as { toDate?: () => Date })?.toDate === 'function') {
    try {
      const d = (v as { toDate: () => Date }).toDate();
      return d instanceof Date && !isNaN(d.getTime()) ? d.toISOString().split('T')[0]! : '';
    } catch {
      return '';
    }
  }
  if (v instanceof Timestamp) {
    const d = v.toDate();
    return !isNaN(d.getTime()) ? d.toISOString().split('T')[0]! : '';
  }
  if (v instanceof Date && !isNaN(v.getTime())) return v.toISOString().split('T')[0]!;
  if (typeof v === 'number' && v > 0) {
    const d = new Date(v);
    return !isNaN(d.getTime()) ? d.toISOString().split('T')[0]! : '';
  }
  const sec =
    typeof v === 'object' && v !== null
      ? (v as { seconds?: number; _seconds?: number }).seconds ??
        (v as { _seconds?: number })._seconds
      : undefined;
  if (typeof sec === 'number') {
    const d = new Date(sec * 1000);
    return !isNaN(d.getTime()) ? d.toISOString().split('T')[0]! : '';
  }
  return '';
}
