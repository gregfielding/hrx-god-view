/**
 * RD.2 — Pure tests for the mirror→chip-strip-string translators.
 *
 * Each helper is a single-input/single-output mapping; tests cover
 * every branch (state matrix). The vocabulary checks here are the
 * contract the chip-strip integration relies on — if any string here
 * changes, every consumer page (RecruiterUsers, UserProfile header,
 * UserGroupMembersTable, ApplicantsUsersStyleTableCells, etc.)
 * silently changes its display copy. Treat label drift as a breaking
 * UX change.
 */

import {
  mirror1099Line,
  mirrorDirectDepositLine,
  mirrorHandbookLine,
  mirrorI9Line,
  mirrorPoliciesLine,
  mirrorTinLine,
  mirrorW4Line,
} from '../recruiterUsersReadinessChipMirrorLines';

// Local mirror shape — Babel/CRA preset trips on TS-only `import type` for
// the canonical `EvereeReadinessMirrorLike`. The translator only reads
// shape, so a plain interface here is structurally compatible.
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

/**
 * Default fully-applicable W-2 mirror with everything *not* completed.
 * Per-test overrides flip exactly the field(s) under test.
 */
function w2MirrorEmpty(overrides: Partial<MirrorLike> = {}): MirrorLike {
  return {
    directDepositReady: false,
    i9SignedAt: null,
    i9Applicable: true,
    w4SignedAt: null,
    w4Applicable: true,
    w9SignedAt: null,
    w9Applicable: false,
    handbookSignedAt: null,
    policiesSignedCount: 0,
    tinVerificationStatus: null,
    ...overrides,
  };
}

/** 1099 contractor mirror — I-9/W-4 N/A, W-9 applicable. */
function contractorMirrorEmpty(overrides: Partial<MirrorLike> = {}): MirrorLike {
  return {
    directDepositReady: false,
    i9SignedAt: null,
    i9Applicable: false,
    w4SignedAt: null,
    w4Applicable: false,
    w9SignedAt: null,
    w9Applicable: true,
    handbookSignedAt: null,
    policiesSignedCount: 0,
    tinVerificationStatus: null,
    ...overrides,
  };
}

describe('mirrorDirectDepositLine', () => {
  it('returns "Complete" when directDepositReady is true', () => {
    expect(mirrorDirectDepositLine(w2MirrorEmpty({ directDepositReady: true }))).toBe(
      'Direct deposit: Complete',
    );
  });

  it('returns "Not started" when directDepositReady is false', () => {
    expect(mirrorDirectDepositLine(w2MirrorEmpty({ directDepositReady: false }))).toBe(
      'Direct deposit: Not started',
    );
  });
});

describe('mirrorI9Line', () => {
  it('returns "N/A" when not applicable (1099 contractor)', () => {
    expect(mirrorI9Line(contractorMirrorEmpty())).toBe('I-9: N/A');
  });

  it('returns "Complete" when applicable + signed', () => {
    expect(mirrorI9Line(w2MirrorEmpty({ i9SignedAt: new Date() }))).toBe('I-9: Complete');
  });

  it('returns "Not started" when applicable + unsigned', () => {
    expect(mirrorI9Line(w2MirrorEmpty({ i9SignedAt: null }))).toBe('I-9: Not started');
  });

  it('treats truthy non-Date timestamp shapes (Timestamp-like objects, ISO strings) as signed', () => {
    expect(mirrorI9Line(w2MirrorEmpty({ i9SignedAt: { seconds: 1, nanoseconds: 0 } }))).toBe(
      'I-9: Complete',
    );
    expect(mirrorI9Line(w2MirrorEmpty({ i9SignedAt: '2026-04-01T00:00:00Z' }))).toBe(
      'I-9: Complete',
    );
  });
});

describe('mirrorW4Line', () => {
  it('returns "N/A" when not applicable (1099 contractor)', () => {
    expect(mirrorW4Line(contractorMirrorEmpty())).toBe('W-4: N/A');
  });

  it('returns "Complete" when applicable + signed', () => {
    expect(mirrorW4Line(w2MirrorEmpty({ w4SignedAt: new Date() }))).toBe('W-4: Complete');
  });

  it('returns "Not started" when applicable + unsigned', () => {
    expect(mirrorW4Line(w2MirrorEmpty())).toBe('W-4: Not started');
  });
});

describe('mirror1099Line', () => {
  it('returns "N/A" when not applicable (W-2 worker)', () => {
    expect(mirror1099Line(w2MirrorEmpty())).toBe('1099: N/A');
  });

  it('returns "Complete" when applicable + signed', () => {
    expect(mirror1099Line(contractorMirrorEmpty({ w9SignedAt: new Date() }))).toBe('1099: Complete');
  });

  it('returns "Not started" when applicable + unsigned', () => {
    expect(mirror1099Line(contractorMirrorEmpty())).toBe('1099: Not started');
  });
});

describe('mirrorHandbookLine', () => {
  it('returns "Complete" when signed', () => {
    expect(mirrorHandbookLine(w2MirrorEmpty({ handbookSignedAt: new Date() }))).toBe(
      'Handbook: Complete',
    );
  });

  it('returns "Not started" when unsigned', () => {
    expect(mirrorHandbookLine(w2MirrorEmpty())).toBe('Handbook: Not started');
  });
});

describe('mirrorPoliciesLine', () => {
  it('returns "Complete" when policiesSignedCount > 0', () => {
    expect(mirrorPoliciesLine(w2MirrorEmpty({ policiesSignedCount: 1 }))).toBe('Policies: Complete');
    expect(mirrorPoliciesLine(w2MirrorEmpty({ policiesSignedCount: 5 }))).toBe('Policies: Complete');
  });

  it('returns "Not started" when policiesSignedCount is 0', () => {
    expect(mirrorPoliciesLine(w2MirrorEmpty({ policiesSignedCount: 0 }))).toBe(
      'Policies: Not started',
    );
  });
});

describe('mirrorTinLine — 4-state matrix + safe defaults', () => {
  it('VERIFIED → "IRS verified"', () => {
    expect(mirrorTinLine(w2MirrorEmpty({ tinVerificationStatus: 'VERIFIED' }))).toBe(
      'TIN/SSN: IRS verified',
    );
  });

  it('SENT_FOR_VERIFICATION → "Submitted to IRS"', () => {
    expect(mirrorTinLine(w2MirrorEmpty({ tinVerificationStatus: 'SENT_FOR_VERIFICATION' }))).toBe(
      'TIN/SSN: Submitted to IRS',
    );
  });

  it('NEEDS_VERIFICATION → "Not submitted"', () => {
    expect(mirrorTinLine(w2MirrorEmpty({ tinVerificationStatus: 'NEEDS_VERIFICATION' }))).toBe(
      'TIN/SSN: Not submitted',
    );
  });

  it('MISMATCH → "IRS rejected"', () => {
    expect(mirrorTinLine(w2MirrorEmpty({ tinVerificationStatus: 'MISMATCH' }))).toBe(
      'TIN/SSN: IRS rejected',
    );
  });

  it('null → "Not submitted" (safe default for never-submitted)', () => {
    expect(mirrorTinLine(w2MirrorEmpty({ tinVerificationStatus: null }))).toBe(
      'TIN/SSN: Not submitted',
    );
  });

  it('unknown future Everee value → "Not submitted" (no raw enum leak to CSA)', () => {
    expect(
      mirrorTinLine(w2MirrorEmpty({ tinVerificationStatus: 'SOME_NEW_EVEREE_STATE' })),
    ).toBe('TIN/SSN: Not submitted');
  });
});
