/**
 * Pending claim (step 5, 2026-09-11): the shift a worker was about to claim
 * when "Finish setup to claim" sent them to payroll setup. The payroll page
 * reads it to offer "Back to your shift" once setup is done. Browser-local,
 * 24h. Flutter twin keeps the same shape.
 */
export interface PendingClaim {
  tenantId: string;
  postId: string;
  /** Posting page path to return to (no query string). */
  path: string;
  shiftId: string;
  date: string | null;
  entityId: string;
  savedAt: number;
}

const KEY = 'c1.pendingClaim.v1';
export const PENDING_CLAIM_TTL_MS = 24 * 60 * 60 * 1000;

export function isPendingClaimValid(p: unknown, nowMs: number = Date.now()): p is PendingClaim {
  if (!p || typeof p !== 'object') return false;
  const c = p as Partial<PendingClaim>;
  return (
    typeof c.path === 'string' &&
    c.path.startsWith('/') &&
    typeof c.shiftId === 'string' &&
    c.shiftId.length > 0 &&
    typeof c.entityId === 'string' &&
    typeof c.tenantId === 'string' &&
    typeof c.savedAt === 'number' &&
    nowMs - c.savedAt >= 0 &&
    nowMs - c.savedAt <= PENDING_CLAIM_TTL_MS
  );
}

export function savePendingClaim(p: Omit<PendingClaim, 'savedAt'>, nowMs: number = Date.now()): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ ...p, savedAt: nowMs }));
  } catch {
    /* storage unavailable — the claim just won't be remembered */
  }
}

export function loadPendingClaim(nowMs: number = Date.now()): PendingClaim | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return isPendingClaimValid(parsed, nowMs) ? parsed : null;
  } catch {
    return null;
  }
}

export function clearPendingClaim(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/** Posting URL that reopens the claim sheet for this shift (`?claim=&date=`). */
export function buildClaimReturnPath(p: Pick<PendingClaim, 'path' | 'shiftId' | 'date'>): string {
  const params = new URLSearchParams({ claim: p.shiftId });
  if (p.date) params.set('date', p.date);
  return `${p.path}?${params.toString()}`;
}
