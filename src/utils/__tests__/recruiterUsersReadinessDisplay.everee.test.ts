/**
 * RD.2 — Integration tests for `getReadinessBreakdownRows` chip-strip
 * output when the Everee `readinessMirror` snapshot is wired through
 * `RecruiterUserEmploymentBreakdownContext.evereeReadinessMirror`.
 *
 * Mirror present → mirror wins for Direct deposit / I-9 / W-4 / 1099 /
 * Handbook / Policies, plus a new "TIN/SSN" row inserted between W-4
 * and E-Verify. Work auth + E-Verify stay HRX-sourced.
 *
 * Mirror absent → legacy 8-row layout (no TIN row, no regression).
 *
 * These tests pin the row order + literal strings the chip-strip
 * surfaces consume — RecruiterUsers, UserProfile header,
 * UserGroupMembersTable, ApplicantsUsersStyleTableCells. Any drift here
 * is a UX-visible change.
 */

import {
  getReadinessBreakdownRows,
  type RecruiterUserBreakdownExtras,
  type RecruiterUserReadinessLike,
} from '../recruiterUsersReadinessDisplay';

// ────────────────────────────────────────────────────────────────────────
// Local-shape stand-ins. The integration path consumes the
// `RecruiterUserEmploymentBreakdownContext` shape but only reads a small
// subset of fields. Constructing locally avoids dragging in
// employment-v2 types (which Babel-Jest can't always parse via
// `import type`) and keeps the contract explicit.
// ────────────────────────────────────────────────────────────────────────

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

interface EeRecord {
  id: string;
  tenantId: string;
  userId: string;
  entityId: string | null;
  entityKey: string;
  entityName: string;
  workerType: string;
  status: string;
  onboardingPipelineId: string;
  everifyRequired?: boolean;
  everifyStatus?: string;
  taxIdentityStatus?: string | null;
  handbookStatus?: string | null;
}

interface CtxLike {
  entityEmployment: EeRecord;
  workerOnboarding: null;
  workerPayrollAccount: null;
  evereeReadinessMirror?: MirrorLike | null;
}

function makeEe(overrides: Partial<EeRecord> = {}): EeRecord {
  return {
    id: 'ee-1',
    tenantId: 'tenant-1',
    userId: 'uid-1',
    entityId: 'entity-1',
    entityKey: 'workforce', // not 'select', so E-Verify reads "Not required"
    entityName: 'C1 Workforce',
    workerType: 'w2',
    status: 'active',
    onboardingPipelineId: 'pipe-1',
    everifyRequired: false,
    ...overrides,
  };
}

function makeCtx(overrides: { ee?: Partial<EeRecord>; mirror?: MirrorLike | null } = {}): CtxLike {
  return {
    entityEmployment: makeEe(overrides.ee ?? {}),
    workerOnboarding: null,
    workerPayrollAccount: null,
    evereeReadinessMirror: overrides.mirror ?? null,
  };
}

function makeUser(): RecruiterUserReadinessLike & RecruiterUserBreakdownExtras {
  return {
    securityLevel: '2',
    workEligibility: true,
    workEligibilityAttestation: { authorizedToWorkUS: true, attestedAt: new Date() },
  };
}

function w2MirrorAllComplete(): MirrorLike {
  const t = new Date();
  return {
    directDepositReady: true,
    i9SignedAt: t,
    i9Applicable: true,
    w4SignedAt: t,
    w4Applicable: true,
    w9SignedAt: null,
    w9Applicable: false,
    handbookSignedAt: t,
    policiesSignedCount: 1,
    tinVerificationStatus: 'VERIFIED',
  };
}

function contractorMirrorAllComplete(): MirrorLike {
  const t = new Date();
  return {
    directDepositReady: true,
    i9SignedAt: null,
    i9Applicable: false,
    w4SignedAt: null,
    w4Applicable: false,
    w9SignedAt: t,
    w9Applicable: true,
    handbookSignedAt: t,
    policiesSignedCount: 2,
    tinVerificationStatus: 'SENT_FOR_VERIFICATION',
  };
}

function w2MirrorAllEmpty(): MirrorLike {
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
  };
}

/** Helper — collapse rows to a `key → text` map for cleaner assertions. */
function rowMap(rows: ReturnType<typeof getReadinessBreakdownRows>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of rows) out[r.key] = r.text;
  return out;
}

describe('getReadinessBreakdownRows with Everee mirror — W-2 worker', () => {
  it('renders 9 rows in the documented order with TIN inserted between w4 and everify', () => {
    const rows = getReadinessBreakdownRows(makeUser(), undefined, {
      employmentBreakdown: makeCtx({ mirror: w2MirrorAllComplete() }) as never,
    });

    expect(rows.map((r) => r.key)).toEqual([
      'direct_deposit',
      'work_auth',
      'i9',
      'w4',
      'tax_1099',
      'tin',
      'everify',
      'handbook',
      'policies',
    ]);
  });

  it('all-complete mirror → all Everee-owned rows show "Complete", 1099 "N/A", TIN "IRS verified"', () => {
    const rows = rowMap(
      getReadinessBreakdownRows(makeUser(), undefined, {
        employmentBreakdown: makeCtx({ mirror: w2MirrorAllComplete() }) as never,
      }),
    );

    expect(rows.direct_deposit).toBe('Direct deposit: Complete');
    expect(rows.i9).toBe('I-9: Complete');
    expect(rows.w4).toBe('W-4: Complete');
    expect(rows.tax_1099).toBe('1099: N/A');
    expect(rows.tin).toBe('TIN/SSN: IRS verified');
    expect(rows.handbook).toBe('Handbook: Complete');
    expect(rows.policies).toBe('Policies: Complete');
    // HRX-sourced — unchanged by mirror.
    expect(rows.work_auth).toBe('Work auth: Authorized');
  });

  it('all-empty mirror → all Everee-owned rows show "Not started", 1099 "N/A", TIN "Not submitted"', () => {
    const rows = rowMap(
      getReadinessBreakdownRows(makeUser(), undefined, {
        employmentBreakdown: makeCtx({ mirror: w2MirrorAllEmpty() }) as never,
      }),
    );

    expect(rows.direct_deposit).toBe('Direct deposit: Not started');
    expect(rows.i9).toBe('I-9: Not started');
    expect(rows.w4).toBe('W-4: Not started');
    expect(rows.tax_1099).toBe('1099: N/A');
    expect(rows.tin).toBe('TIN/SSN: Not submitted');
    expect(rows.handbook).toBe('Handbook: Not started');
    expect(rows.policies).toBe('Policies: Not started');
  });
});

describe('getReadinessBreakdownRows with Everee mirror — 1099 contractor', () => {
  it('all-complete contractor mirror → I-9/W-4 "N/A", 1099 "Complete", TIN "Submitted to IRS"', () => {
    const rows = rowMap(
      getReadinessBreakdownRows(makeUser(), undefined, {
        employmentBreakdown: makeCtx({
          ee: { workerType: '1099' },
          mirror: contractorMirrorAllComplete(),
        }) as never,
      }),
    );

    expect(rows.direct_deposit).toBe('Direct deposit: Complete');
    expect(rows.i9).toBe('I-9: N/A');
    expect(rows.w4).toBe('W-4: N/A');
    expect(rows.tax_1099).toBe('1099: Complete');
    expect(rows.tin).toBe('TIN/SSN: Submitted to IRS');
    expect(rows.handbook).toBe('Handbook: Complete');
    expect(rows.policies).toBe('Policies: Complete');
  });

  it('mirror applicability flags win over entity workerType disagreement', () => {
    // Edge case: legacy `entityEmployment.workerType` says w2, but the
    // mirror says 1099 (contractor was switched in Everee but the HRX
    // record hasn't synced). The chip strip should follow the mirror.
    const rows = rowMap(
      getReadinessBreakdownRows(makeUser(), undefined, {
        employmentBreakdown: makeCtx({
          ee: { workerType: 'w2' }, // disagrees with mirror
          mirror: contractorMirrorAllComplete(),
        }) as never,
      }),
    );

    expect(rows.i9).toBe('I-9: N/A'); // mirror wins
    expect(rows.w4).toBe('W-4: N/A'); // mirror wins
    expect(rows.tax_1099).toBe('1099: Complete'); // mirror wins
  });
});

describe('getReadinessBreakdownRows TIN 4-state matrix in row context', () => {
  function tinRowFor(status: string | null): string {
    const mirror: MirrorLike = { ...w2MirrorAllComplete(), tinVerificationStatus: status };
    const rows = rowMap(
      getReadinessBreakdownRows(makeUser(), undefined, {
        employmentBreakdown: makeCtx({ mirror }) as never,
      }),
    );
    return rows.tin;
  }

  it.each([
    ['VERIFIED', 'TIN/SSN: IRS verified'],
    ['SENT_FOR_VERIFICATION', 'TIN/SSN: Submitted to IRS'],
    ['NEEDS_VERIFICATION', 'TIN/SSN: Not submitted'],
    ['MISMATCH', 'TIN/SSN: IRS rejected'],
  ])('%s → %s', (status, expected) => {
    expect(tinRowFor(status)).toBe(expected);
  });

  it('null TIN status (mirror present, never submitted) → "Not submitted"', () => {
    expect(tinRowFor(null)).toBe('TIN/SSN: Not submitted');
  });
});

describe('getReadinessBreakdownRows fallback when mirror absent (legacy path preserved)', () => {
  it('omits TIN row entirely (no regression for non-Everee tenants)', () => {
    const rows = getReadinessBreakdownRows(makeUser(), undefined, {
      employmentBreakdown: makeCtx({ mirror: null }) as never,
    });

    const keys = rows.map((r) => r.key);
    expect(keys).not.toContain('tin');
    expect(keys).toEqual([
      'direct_deposit',
      'work_auth',
      'i9',
      'w4',
      'tax_1099',
      'everify',
      'handbook',
      'policies',
    ]);
  });

  it('mirror absent + W-2 worker → legacy "Not started" wording for unsourced rows', () => {
    const rows = rowMap(
      getReadinessBreakdownRows(makeUser(), undefined, {
        employmentBreakdown: makeCtx({ mirror: null }) as never,
      }),
    );

    // Legacy path with no externalOnboardingSteps + no entity-section
    // mirror flags falls back to "Not started" for everything except
    // the explicit N/A slots. This is the contract pre-RD.2.
    expect(rows.direct_deposit).toBe('Direct deposit: Not started');
    expect(rows.i9).toBe('I-9: Not started');
    expect(rows.w4).toBe('W-4: Not started');
    expect(rows.tax_1099).toBe('1099: N/A');
    expect(rows.handbook).toBe('Handbook: Not started');
    expect(rows.policies).toBe('Policies: Not started');
  });

  it('mirror absent + 1099 contractor → legacy 1099 path ("W-4: N/A", "1099: Not started")', () => {
    const rows = rowMap(
      getReadinessBreakdownRows(makeUser(), undefined, {
        employmentBreakdown: makeCtx({
          ee: { workerType: '1099' },
          mirror: null,
        }) as never,
      }),
    );

    expect(rows.w4).toBe('W-4: N/A');
    expect(rows.tax_1099).toBe('1099: Not started');
  });

  it('no employmentBreakdown opt at all → legacy fallback path (em-dash placeholders)', () => {
    // This is the fully-legacy path: no breakdown context, just the
    // user shape. Pre-existing behaviour — pinned here to make sure
    // RD.2 didn't accidentally change it.
    const rows = rowMap(getReadinessBreakdownRows(makeUser()));
    expect(rows.direct_deposit).toBe('Direct deposit: —');
    expect(rows.handbook).toBe('Handbook: —');
    expect(rows.policies).toBe('Policies: —');
  });
});

describe('getReadinessBreakdownRows mirror entity scoping', () => {
  it('lookup is per-(worker × entity) — different entity contexts pick different mirrors', () => {
    // Two different entities for the same user. The hook attaches a
    // per-context mirror; here we simulate two calls for two entity
    // contexts and confirm each call uses its own mirror.
    const selectMirror = w2MirrorAllComplete();
    const eventsMirror: MirrorLike = {
      ...contractorMirrorAllComplete(),
      directDepositReady: false,
      handbookSignedAt: null,
    };

    const selectRows = rowMap(
      getReadinessBreakdownRows(makeUser(), undefined, {
        employmentBreakdown: makeCtx({
          ee: { entityId: 'entity-select', entityKey: 'workforce' },
          mirror: selectMirror,
        }) as never,
      }),
    );
    const eventsRows = rowMap(
      getReadinessBreakdownRows(makeUser(), undefined, {
        employmentBreakdown: makeCtx({
          ee: { entityId: 'entity-events', entityKey: 'workforce', workerType: '1099' },
          mirror: eventsMirror,
        }) as never,
      }),
    );

    // Select entity → W-2 path, all complete.
    expect(selectRows.direct_deposit).toBe('Direct deposit: Complete');
    expect(selectRows.handbook).toBe('Handbook: Complete');
    expect(selectRows.tax_1099).toBe('1099: N/A');

    // Events entity → 1099 path with the doctored mirror (DD + handbook unset).
    expect(eventsRows.direct_deposit).toBe('Direct deposit: Not started');
    expect(eventsRows.handbook).toBe('Handbook: Not started');
    expect(eventsRows.tax_1099).toBe('1099: Complete');
    expect(eventsRows.i9).toBe('I-9: N/A');
  });
});
