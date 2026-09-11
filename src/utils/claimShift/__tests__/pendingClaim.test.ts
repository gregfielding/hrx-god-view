import {
  PENDING_CLAIM_TTL_MS,
  buildClaimReturnPath,
  clearPendingClaim,
  isPendingClaimValid,
  loadPendingClaim,
  savePendingClaim,
} from '../pendingClaim';

const base = { tenantId: 't1', postId: 'p1', path: '/c1/jobs-board/p1', shiftId: 's1', date: '2026-09-20', entityId: 'c1_events_llc' };

describe('pendingClaim', () => {
  beforeEach(() => window.localStorage.clear());

  it('round-trips and clears', () => {
    savePendingClaim(base, 1000);
    expect(loadPendingClaim(2000)).toEqual({ ...base, savedAt: 1000 });
    clearPendingClaim();
    expect(loadPendingClaim(2000)).toBeNull();
  });

  it('expires after 24 hours', () => {
    savePendingClaim(base, 1000);
    expect(loadPendingClaim(1000 + PENDING_CLAIM_TTL_MS)).not.toBeNull();
    expect(loadPendingClaim(1001 + PENDING_CLAIM_TTL_MS)).toBeNull();
  });

  it('rejects malformed or foreign paths', () => {
    expect(isPendingClaimValid({ ...base, savedAt: 1, path: 'https://evil.example' }, 2)).toBe(false);
    expect(isPendingClaimValid({ ...base, savedAt: 1, shiftId: '' }, 2)).toBe(false);
    expect(isPendingClaimValid('nope', 2)).toBe(false);
  });

  it('builds the return path with claim + date', () => {
    expect(buildClaimReturnPath(base)).toBe('/c1/jobs-board/p1?claim=s1&date=2026-09-20');
    expect(buildClaimReturnPath({ ...base, date: null })).toBe('/c1/jobs-board/p1?claim=s1');
  });
});
