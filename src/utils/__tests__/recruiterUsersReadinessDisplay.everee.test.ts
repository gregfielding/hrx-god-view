/**
 * Integration tests for `getReadinessBreakdownRows` chip-strip output
 * when the Everee `readinessMirror` snapshot is wired through
 * `RecruiterUserEmploymentBreakdownContext.evereeReadinessMirror`.
 *
 * **May 2026 — second pass.** The Readiness column was slimmed down
 * from 8 rows to 2:
 *
 *   1. `direct_deposit` — Everee mirror tells us Pay setup is done.
 *   2. `employer_i9`    — Section 2 (employer portion) is the only
 *                          I-9 step HRX still owns. Section 1 is on
 *                          Everee.
 *
 * Removed rows (worker-side onboarding HRX doesn't actually own
 * anymore — Everee took over): Work auth, worker I-9 Section 1, W-4,
 * 1099, TIN/SSN, Handbook, Policies, plus E-Verify (which has its own
 * column on the user header anyway).
 *
 * Indeed Flex / Fieldglass live as separate checkboxes in the column
 * container, not as breakdown rows.
 *
 * These tests pin the row order + literal strings the chip-strip
 * surfaces consume — RecruiterUsers, UserProfile header,
 * UserGroupMembersTable, ApplicantsUsersStyleTableCells. Any drift
 * here is a UX-visible change.
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
  /**
   * Employer-side I-9 (Section 2) completion stamp. Set by the
   * Onboarding Specialist queue when the employer attests that
   * Section 2 documents have been inspected. Drives the new
   * "Employer I-9: …" row in the Readiness column.
   */
  i9Section2CompletedAt?: { toDate: () => Date } | null;
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
  // Row count dropped from 8 → 2 in May 2026 (second pass): every
  // worker-side onboarding row HRX doesn't actually own (Work auth,
  // worker I-9 Section 1, W-4, 1099, TIN/SSN, Handbook, Policies, plus
  // E-Verify which has its own column) was removed because Everee owns
  // those steps. Two rows survive: `direct_deposit` (Everee mirror)
  // and `employer_i9` (Section 2 — only HRX-owned I-9 step). Indeed
  // Flex / Fieldglass live as separate checkboxes in the column
  // container, not as breakdown rows.
  it('renders 2 rows in the documented order: direct_deposit, employer_i9', () => {
    const rows = getReadinessBreakdownRows(makeUser(), undefined, {
      employmentBreakdown: makeCtx({ mirror: w2MirrorAllComplete() }) as never,
    });

    expect(rows.map((r) => r.key)).toEqual(['direct_deposit', 'employer_i9']);
  });

  it('all-complete mirror + no Section 2 stamp → "Direct deposit: Complete", "Employer I-9: Action needed"', () => {
    // Worker has signed Section 1 in Everee but the employer (CSA)
    // hasn't physically inspected docs yet → action needed.
    const rows = rowMap(
      getReadinessBreakdownRows(makeUser(), undefined, {
        employmentBreakdown: makeCtx({ mirror: w2MirrorAllComplete() }) as never,
      }),
    );

    expect(rows.direct_deposit).toBe('Direct deposit: Complete');
    expect(rows.employer_i9).toBe('Employer I-9: Action needed');
    // All previously-tracked rows are gone. Pin the absence so a
    // future PR doesn't quietly re-add one without updating this
    // contract.
    expect(rows.work_auth).toBeUndefined();
    expect(rows.i9).toBeUndefined();
    expect(rows.w4).toBeUndefined();
    expect(rows.tax_1099).toBeUndefined();
    expect(rows.tin).toBeUndefined();
    expect(rows.everify).toBeUndefined();
    expect(rows.handbook).toBeUndefined();
    expect(rows.policies).toBeUndefined();
  });

  it('all-complete mirror + Section 2 stamp set → "Employer I-9: Complete"', () => {
    const rows = rowMap(
      getReadinessBreakdownRows(makeUser(), undefined, {
        employmentBreakdown: makeCtx({
          ee: { i9Section2CompletedAt: { toDate: () => new Date() } },
          mirror: w2MirrorAllComplete(),
        }) as never,
      }),
    );

    expect(rows.employer_i9).toBe('Employer I-9: Complete');
  });

  it('all-empty mirror → "Direct deposit: Not started", "Employer I-9: Waiting on worker"', () => {
    // Worker hasn't signed Section 1 yet → no employer action is
    // possible. Make this state visually distinct from "Action
    // needed" so the CSA queue knows where the ball is.
    const rows = rowMap(
      getReadinessBreakdownRows(makeUser(), undefined, {
        employmentBreakdown: makeCtx({ mirror: w2MirrorAllEmpty() }) as never,
      }),
    );

    expect(rows.direct_deposit).toBe('Direct deposit: Not started');
    expect(rows.employer_i9).toBe('Employer I-9: Waiting on worker');
  });
});

describe('getReadinessBreakdownRows with Everee mirror — 1099 contractor', () => {
  it('contractor mirror → "Direct deposit: Complete", "Employer I-9: N/A"', () => {
    // 1099 contractors don't sign I-9 (W-9 instead), so Section 2 is
    // permanently `N/A` for them.
    const rows = rowMap(
      getReadinessBreakdownRows(makeUser(), undefined, {
        employmentBreakdown: makeCtx({
          ee: { workerType: '1099' },
          mirror: contractorMirrorAllComplete(),
        }) as never,
      }),
    );

    expect(rows.direct_deposit).toBe('Direct deposit: Complete');
    expect(rows.employer_i9).toBe('Employer I-9: N/A');
  });

  it('mirror i9Applicable=false wins over entity workerType disagreement', () => {
    // Edge case: legacy `entityEmployment.workerType` says w2, but the
    // mirror says contractor (i9Applicable=false). The Employer I-9
    // line should follow the mirror — Everee is the source of truth
    // for the worker's classification.
    const rows = rowMap(
      getReadinessBreakdownRows(makeUser(), undefined, {
        employmentBreakdown: makeCtx({
          ee: { workerType: 'w2' }, // disagrees with mirror
          mirror: contractorMirrorAllComplete(),
        }) as never,
      }),
    );

    expect(rows.employer_i9).toBe('Employer I-9: N/A'); // mirror wins
  });
});

describe('getReadinessBreakdownRows fallback when mirror absent (legacy path preserved)', () => {
  it('mirror absent → still 2 rows (direct_deposit, employer_i9), em-dash for direct_deposit, "Waiting on worker" for I-9', () => {
    // Without an Everee mirror we don't know if Section 1 was signed,
    // so the breakdown path falls back to "Waiting on worker" until
    // the mirror catches up. Direct deposit is em-dash because the
    // checklist model produces no completion signal without the
    // mirror.
    const rows = getReadinessBreakdownRows(makeUser(), undefined, {
      employmentBreakdown: makeCtx({ mirror: null }) as never,
    });

    const keys = rows.map((r) => r.key);
    expect(keys).toEqual(['direct_deposit', 'employer_i9']);

    const map = rowMap(rows);
    expect(map.direct_deposit).toBe('Direct deposit: Not started');
    expect(map.employer_i9).toBe('Employer I-9: Waiting on worker');
  });

  it('mirror absent + 1099 entity → "Employer I-9: N/A"', () => {
    const rows = rowMap(
      getReadinessBreakdownRows(makeUser(), undefined, {
        employmentBreakdown: makeCtx({
          ee: { workerType: '1099' },
          mirror: null,
        }) as never,
      }),
    );

    expect(rows.employer_i9).toBe('Employer I-9: N/A');
  });

  it('no employmentBreakdown opt at all → legacy em-dash fallback (2 rows)', () => {
    // Fully-legacy path: no breakdown context, just the user shape.
    // Without context we can't compute Section 2 status, so the
    // employer I-9 row shows an em-dash. Direct deposit stays em-dash
    // (legacy never had a completion source).
    const rows = rowMap(getReadinessBreakdownRows(makeUser()));
    expect(rows.direct_deposit).toBe('Direct deposit: —');
    expect(rows.employer_i9).toBe('Employer I-9: —');
    expect(rows.handbook).toBeUndefined();
    expect(rows.policies).toBeUndefined();
    expect(rows.i9).toBeUndefined();
  });

  it('no employmentBreakdown opt + 1099 onboarding type → "Employer I-9: N/A"', () => {
    const rows = rowMap(
      getReadinessBreakdownRows({ ...makeUser(), onboardingType: '1099' }),
    );
    expect(rows.employer_i9).toBe('Employer I-9: N/A');
  });
});

describe('getReadinessBreakdownRows mirror entity scoping', () => {
  it('lookup is per-(worker × entity) — different entity contexts pick different mirrors', () => {
    // Two different entities for the same user. The hook attaches a
    // per-context mirror; here we simulate two calls for two entity
    // contexts and confirm each call uses its own mirror. The
    // surviving rows are direct_deposit + employer_i9.
    const selectMirror = w2MirrorAllComplete();
    const eventsMirror: MirrorLike = {
      ...contractorMirrorAllComplete(),
      directDepositReady: false,
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

    // Select entity → W-2 path, DD complete, employer I-9 needs CSA action.
    expect(selectRows.direct_deposit).toBe('Direct deposit: Complete');
    expect(selectRows.employer_i9).toBe('Employer I-9: Action needed');

    // Events entity → 1099, DD not ready, employer I-9 always N/A for 1099.
    expect(eventsRows.direct_deposit).toBe('Direct deposit: Not started');
    expect(eventsRows.employer_i9).toBe('Employer I-9: N/A');
  });
});
