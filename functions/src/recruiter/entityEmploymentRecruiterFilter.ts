/**
 * Recruiter users table — entity filter on `tenants/{tid}/entity_employments`.
 * Aligns with client chip logic in `src/utils/userListEntityEmploymentStatus.ts`: include rows
 * where a real lifecycle exists (not empty / not_started / none).
 */

const NON_STATUSES = new Set(['', 'not_started', 'none']);

/**
 * True if this entity employment row should count for "has status for this entity" filtering.
 */
export function entityEmploymentDocHasQualifyingStatus(d: Record<string, unknown>): boolean {
  if (d.terminatedAt != null && String(d.terminatedAt).trim() !== '') {
    return true;
  }
  if (d.doNotReturn === true) {
    return true;
  }
  const es = String(d.employmentState || '').trim().toLowerCase();
  const leg = String(d.status || '').trim().toLowerCase();
  const s = es || leg;
  if (!s || NON_STATUSES.has(s)) {
    return false;
  }
  return true;
}

const ALLOWED = new Set(['select', 'workforce', 'events']);

export function normalizeRecruiterEntityKey(raw: string): string | null {
  const k = raw.trim().toLowerCase();
  if (!k || k === 'all') return null;
  return ALLOWED.has(k) ? k : null;
}
