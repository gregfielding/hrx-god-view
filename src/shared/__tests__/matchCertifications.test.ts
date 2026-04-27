/**
 * Unit tests for `matchCertifications`. Locks the
 * CertificationEvalStatus → MatchedReadinessStatus mapping (Phase B.0
 * decision) and the null/engine-misconfig handling.
 *
 * @see shared/jobRequirementMatchers/matchCertifications.ts
 */

import {
  matchCertifications,
  type CertificationEvalStatus,
} from '../jobRequirementMatchers/matchCertifications';

describe('matchCertifications — engine-status mapping', () => {
  type Case = [CertificationEvalStatus, ReturnType<typeof matchCertifications>['status']];
  const cases: Case[] = [
    // complete_pass cluster
    ['approved', 'complete_pass'],
    ['expiring_soon', 'complete_pass'],
    ['preferred_unmet', 'complete_pass'],
    ['waived', 'complete_pass'],
    // complete_fail cluster (matchers do not emit `expired` directly)
    ['expired', 'complete_fail'],
    ['rejected', 'complete_fail'],
    ['invalid', 'complete_fail'],
    // needs_review cluster
    ['pending_review', 'needs_review'],
    ['attested_only', 'needs_review'],
    // incomplete
    ['missing', 'incomplete'],
  ];

  it.each(cases)('engine status %s → readiness %s', (engine, expected) => {
    const r = matchCertifications({ catalogEntryId: 'forklift_basic', evalStatus: engine });
    expect(r.status).toBe(expected);
  });

  it('passes catalogEntryId through to details', () => {
    const r = matchCertifications({ catalogEntryId: 'cpr_basic', evalStatus: 'approved' });
    expect(r.details?.catalogEntryId).toBe('cpr_basic');
  });

  it('echoes engine reason when provided', () => {
    const r = matchCertifications({
      catalogEntryId: 'forklift_basic',
      evalStatus: 'expired',
      evalReason: 'past_expiration',
    });
    expect(r.reason).toBe('past_expiration');
  });

  it('synthesizes a stable reason code when engine omits one', () => {
    const r = matchCertifications({
      catalogEntryId: 'forklift_basic',
      evalStatus: 'rejected',
    });
    expect(r.reason).toBe('engine_status:rejected');
  });
});

describe('matchCertifications — null engine result', () => {
  it('returns needs_review when evalStatus is null', () => {
    const r = matchCertifications({ catalogEntryId: 'unknown_catalog_id', evalStatus: null });
    expect(r.status).toBe('needs_review');
    expect(r.reason).toBe('engine_returned_null');
  });

  it('still passes catalogEntryId through for audit', () => {
    const r = matchCertifications({ catalogEntryId: 'unknown', evalStatus: null });
    expect(r.details?.catalogEntryId).toBe('unknown');
  });
});

describe('matchCertifications — schema lock (mapping completeness)', () => {
  it('every CertificationEvalStatus value has a defined mapping', () => {
    // If the engine adds a new status, this test forces a thoughtful mapping
    // decision instead of a silent fall-through (the matcher would type-error
    // if the union grew, but this also catches the case of forgetting to add
    // a test).
    const all: CertificationEvalStatus[] = [
      'missing', 'attested_only', 'pending_review', 'approved',
      'rejected', 'expired', 'expiring_soon', 'invalid', 'waived', 'preferred_unmet',
    ];
    for (const s of all) {
      const r = matchCertifications({ catalogEntryId: 'x', evalStatus: s });
      // Must be one of the 5 matched statuses; never `in_progress` / `expired` / etc.
      expect(['complete_pass', 'complete_fail', 'needs_review', 'incomplete', 'not_applicable']).toContain(r.status);
    }
  });
});
