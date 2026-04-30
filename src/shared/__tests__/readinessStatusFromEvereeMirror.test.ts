/**
 * Unit tests for the E.3 mirror translator. Covers every per-item
 * mapper × every state distinction, plus the aggregate
 * `evereeMirrorToReadinessStatuses`.
 *
 * Pure-function tests: no Firestore, no admin, no I/O.
 *
 * @see ../readinessStatusFromEvereeMirror.ts
 * @see docs E.3 spec — `tin_verification`, applicability flags, status mapping.
 */

import {
  EVEREE_MIRROR_OWNED_ITEM_TYPES,
  evereeMirrorToReadinessStatuses,
  mapDirectDepositStatus,
  mapHandbookStatus,
  mapI9WorkerStatus,
  mapPoliciesStatus,
  mapTinVerificationStatus,
  mapW4Status,
  mapW9Status,
} from '../readinessStatusFromEvereeMirror';

// Local interface mirror — Babel/CRA preset trips on TS-only `import type`,
// and the translator's `EvereeReadinessMirrorLike` is shape-only anyway.
interface MirrorLike {
  directDepositReady: boolean;
  i9SignedAt: unknown | null;
  i9Applicable: boolean;
  w4SignedAt: unknown | null;
  w4Applicable: boolean;
  w9SignedAt: unknown | null;
  w9Applicable: boolean;
  handbookSignedAt: unknown | null;
  policiesSignedCount: number;
  tinVerificationStatus: string | null;
}

const MIRROR_DEFAULTS: MirrorLike = {
  directDepositReady: false,
  i9SignedAt: null,
  i9Applicable: false,
  w4SignedAt: null,
  w4Applicable: false,
  w9SignedAt: null,
  w9Applicable: false,
  handbookSignedAt: null,
  policiesSignedCount: 0,
  tinVerificationStatus: null,
};

const PLACEHOLDER_TIMESTAMP = { _kind: 'placeholder' } as unknown;

function mirror(overrides: Partial<MirrorLike> = {}): MirrorLike {
  return { ...MIRROR_DEFAULTS, ...overrides };
}

describe('mapDirectDepositStatus', () => {
  it('directDepositReady=true → complete_pass', () => {
    expect(mapDirectDepositStatus(mirror({ directDepositReady: true }))).toBe('complete_pass');
  });

  it('directDepositReady=false → incomplete', () => {
    expect(mapDirectDepositStatus(mirror({ directDepositReady: false }))).toBe('incomplete');
  });

  it('always applicable (ignores i9/w4/w9 flags)', () => {
    expect(
      mapDirectDepositStatus(
        mirror({
          directDepositReady: true,
          i9Applicable: false,
          w4Applicable: false,
          w9Applicable: false,
        }),
      ),
    ).toBe('complete_pass');
  });
});

describe('mapI9WorkerStatus', () => {
  it('not applicable → not_applicable regardless of signedAt', () => {
    expect(
      mapI9WorkerStatus(mirror({ i9Applicable: false, i9SignedAt: PLACEHOLDER_TIMESTAMP })),
    ).toBe('not_applicable');
  });

  it('applicable + signed → complete_pass', () => {
    expect(
      mapI9WorkerStatus(mirror({ i9Applicable: true, i9SignedAt: PLACEHOLDER_TIMESTAMP })),
    ).toBe('complete_pass');
  });

  it('applicable + not signed → incomplete', () => {
    expect(mapI9WorkerStatus(mirror({ i9Applicable: true, i9SignedAt: null }))).toBe('incomplete');
  });
});

describe('mapW4Status', () => {
  it('not applicable → not_applicable', () => {
    expect(mapW4Status(mirror({ w4Applicable: false }))).toBe('not_applicable');
  });

  it('applicable + signed → complete_pass', () => {
    expect(
      mapW4Status(mirror({ w4Applicable: true, w4SignedAt: PLACEHOLDER_TIMESTAMP })),
    ).toBe('complete_pass');
  });

  it('applicable + not signed → incomplete', () => {
    expect(mapW4Status(mirror({ w4Applicable: true, w4SignedAt: null }))).toBe('incomplete');
  });
});

describe('mapW9Status', () => {
  it('not applicable → not_applicable', () => {
    expect(mapW9Status(mirror({ w9Applicable: false }))).toBe('not_applicable');
  });

  it('applicable + signed → complete_pass', () => {
    expect(
      mapW9Status(mirror({ w9Applicable: true, w9SignedAt: PLACEHOLDER_TIMESTAMP })),
    ).toBe('complete_pass');
  });

  it('applicable + not signed → incomplete', () => {
    expect(mapW9Status(mirror({ w9Applicable: true, w9SignedAt: null }))).toBe('incomplete');
  });
});

describe('mapHandbookStatus', () => {
  it('signed → complete_pass', () => {
    expect(mapHandbookStatus(mirror({ handbookSignedAt: PLACEHOLDER_TIMESTAMP }))).toBe('complete_pass');
  });

  it('not signed → incomplete', () => {
    expect(mapHandbookStatus(mirror({ handbookSignedAt: null }))).toBe('incomplete');
  });

  it('always applicable (no applicability gate)', () => {
    // Handbook applies to every Everee-managed worker — there is no
    // `handbookApplicable` flag in the mirror.
    expect(mapHandbookStatus(mirror({ handbookSignedAt: PLACEHOLDER_TIMESTAMP }))).toBe('complete_pass');
  });
});

describe('mapPoliciesStatus', () => {
  it('count > 0 → complete_pass', () => {
    expect(mapPoliciesStatus(mirror({ policiesSignedCount: 1 }))).toBe('complete_pass');
    expect(mapPoliciesStatus(mirror({ policiesSignedCount: 5 }))).toBe('complete_pass');
  });

  it('count === 0 → incomplete', () => {
    expect(mapPoliciesStatus(mirror({ policiesSignedCount: 0 }))).toBe('incomplete');
  });
});

describe('mapTinVerificationStatus', () => {
  it('VERIFIED → complete_pass', () => {
    expect(mapTinVerificationStatus(mirror({ tinVerificationStatus: 'VERIFIED' }))).toBe('complete_pass');
  });

  it('SENT_FOR_VERIFICATION → in_progress', () => {
    expect(mapTinVerificationStatus(mirror({ tinVerificationStatus: 'SENT_FOR_VERIFICATION' }))).toBe(
      'in_progress',
    );
  });

  it('NEEDS_VERIFICATION → incomplete', () => {
    expect(mapTinVerificationStatus(mirror({ tinVerificationStatus: 'NEEDS_VERIFICATION' }))).toBe(
      'incomplete',
    );
  });

  it('MISMATCH → blocked (hard-block per spec)', () => {
    expect(mapTinVerificationStatus(mirror({ tinVerificationStatus: 'MISMATCH' }))).toBe('blocked');
  });

  it('null → incomplete (Everee hasn\'t reported a TIN status yet)', () => {
    expect(mapTinVerificationStatus(mirror({ tinVerificationStatus: null }))).toBe('incomplete');
  });

  it('unknown future Everee value → incomplete (defensive default)', () => {
    expect(
      mapTinVerificationStatus(mirror({ tinVerificationStatus: 'SOME_NEW_STATE_EVEREE_ADDED' })),
    ).toBe('incomplete');
  });
});

describe('evereeMirrorToReadinessStatuses (aggregate)', () => {
  it('returns one entry per Everee-owned item type', () => {
    const statuses = evereeMirrorToReadinessStatuses(mirror());
    expect(Object.keys(statuses).sort()).toEqual([...EVEREE_MIRROR_OWNED_ITEM_TYPES].sort());
  });

  it('W-2 worker, fully complete → all complete_pass except W-9 (N/A)', () => {
    const w2Complete = mirror({
      directDepositReady: true,
      i9Applicable: true,
      i9SignedAt: PLACEHOLDER_TIMESTAMP,
      w4Applicable: true,
      w4SignedAt: PLACEHOLDER_TIMESTAMP,
      w9Applicable: false,
      w9SignedAt: null,
      handbookSignedAt: PLACEHOLDER_TIMESTAMP,
      policiesSignedCount: 3,
      tinVerificationStatus: 'VERIFIED',
    });
    const statuses = evereeMirrorToReadinessStatuses(w2Complete);
    expect(statuses).toEqual({
      direct_deposit: 'complete_pass',
      i9_section_1: 'complete_pass',
      tax_w4: 'complete_pass',
      tax_w9: 'not_applicable',
      handbook_acknowledgement: 'complete_pass',
      policy_acknowledgement: 'complete_pass',
      tin_verification: 'complete_pass',
    });
  });

  it('1099 contractor, fully complete → W-9 complete, I-9/W-4 N/A', () => {
    const contractorComplete = mirror({
      directDepositReady: true,
      i9Applicable: false,
      i9SignedAt: null,
      w4Applicable: false,
      w4SignedAt: null,
      w9Applicable: true,
      w9SignedAt: PLACEHOLDER_TIMESTAMP,
      handbookSignedAt: PLACEHOLDER_TIMESTAMP,
      policiesSignedCount: 1,
      tinVerificationStatus: 'VERIFIED',
    });
    const statuses = evereeMirrorToReadinessStatuses(contractorComplete);
    expect(statuses).toEqual({
      direct_deposit: 'complete_pass',
      i9_section_1: 'not_applicable',
      tax_w4: 'not_applicable',
      tax_w9: 'complete_pass',
      handbook_acknowledgement: 'complete_pass',
      policy_acknowledgement: 'complete_pass',
      tin_verification: 'complete_pass',
    });
  });

  it('W-2 worker, mid-onboarding (DD verified only)', () => {
    const midFlight = mirror({
      directDepositReady: true,
      i9Applicable: true,
      i9SignedAt: null,
      w4Applicable: true,
      w4SignedAt: null,
      w9Applicable: false,
      handbookSignedAt: null,
      policiesSignedCount: 0,
      tinVerificationStatus: 'SENT_FOR_VERIFICATION',
    });
    expect(evereeMirrorToReadinessStatuses(midFlight)).toEqual({
      direct_deposit: 'complete_pass',
      i9_section_1: 'incomplete',
      tax_w4: 'incomplete',
      tax_w9: 'not_applicable',
      handbook_acknowledgement: 'incomplete',
      policy_acknowledgement: 'incomplete',
      tin_verification: 'in_progress',
    });
  });

  it('TIN MISMATCH → blocked surfaces in aggregate', () => {
    const mismatched = mirror({
      directDepositReady: true,
      i9Applicable: true,
      i9SignedAt: PLACEHOLDER_TIMESTAMP,
      w4Applicable: true,
      w4SignedAt: PLACEHOLDER_TIMESTAMP,
      handbookSignedAt: PLACEHOLDER_TIMESTAMP,
      policiesSignedCount: 1,
      tinVerificationStatus: 'MISMATCH',
    });
    expect(evereeMirrorToReadinessStatuses(mismatched).tin_verification).toBe('blocked');
  });

  it('greenfield mirror (all defaults) → everything incomplete or not_applicable', () => {
    const statuses = evereeMirrorToReadinessStatuses(mirror());
    expect(statuses).toEqual({
      direct_deposit: 'incomplete',
      i9_section_1: 'not_applicable',
      tax_w4: 'not_applicable',
      tax_w9: 'not_applicable',
      handbook_acknowledgement: 'incomplete',
      policy_acknowledgement: 'incomplete',
      tin_verification: 'incomplete',
    });
  });

  it('determinism — identical input → identical output (idempotency precondition)', () => {
    const input = mirror({
      directDepositReady: true,
      i9Applicable: true,
      i9SignedAt: PLACEHOLDER_TIMESTAMP,
      w4Applicable: true,
      w4SignedAt: PLACEHOLDER_TIMESTAMP,
      handbookSignedAt: PLACEHOLDER_TIMESTAMP,
      policiesSignedCount: 2,
      tinVerificationStatus: 'VERIFIED',
    });
    const a = evereeMirrorToReadinessStatuses(input);
    const b = evereeMirrorToReadinessStatuses(input);
    expect(a).toEqual(b);
  });
});

describe('EVEREE_MIRROR_OWNED_ITEM_TYPES', () => {
  it('exposes the 7 item types E.3 owns', () => {
    expect(EVEREE_MIRROR_OWNED_ITEM_TYPES).toEqual([
      'direct_deposit',
      'i9_section_1',
      'tax_w4',
      'tax_w9',
      'handbook_acknowledgement',
      'policy_acknowledgement',
      'tin_verification',
    ]);
  });
});
