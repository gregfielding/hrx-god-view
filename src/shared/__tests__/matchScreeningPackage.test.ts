/**
 * Unit tests for `matchScreeningPackage`. The matcher is a pure mapper from
 * `ScreeningEvalResult` → readiness status; tests cover every status branch.
 *
 * @see shared/jobRequirementMatchers/matchScreeningPackage.ts
 */

import {
  matchScreeningPackage,
  type ScreeningEvalResult,
} from '../jobRequirementMatchers/matchScreeningPackage';

const NOW = Date.UTC(2026, 3, 25); // 2026-04-25
const HOUR = 3_600_000;

const evalSatisfied = (overrides: Partial<ScreeningEvalResult> = {}): ScreeningEvalResult => ({
  satisfied: true,
  equivalencyKey: 'id:CORT_PLUS',
  expiresAtMs: NOW + 30 * 24 * HOUR,
  decisionDetail: 'Satisfied: package matches and within validity window.',
  ...overrides,
});

const evalNotSatisfied = (overrides: Partial<ScreeningEvalResult> = {}): ScreeningEvalResult => ({
  satisfied: false,
  equivalencyKey: 'id:CORT_BASIC',
  expiresAtMs: null,
  decisionDetail: 'Not satisfied: package equivalency mismatch.',
  ...overrides,
});

describe('matchScreeningPackage — not_applicable', () => {
  it('returns not_applicable when JO has no requiredPackageId', () => {
    const r = matchScreeningPackage({ requiredPackageId: undefined, evalResult: null, nowMs: NOW });
    expect(r.status).toBe('not_applicable');
    expect(r.reason).toBe('no_package_required');
  });

  it("treats whitespace requiredPackageId as none", () => {
    const r = matchScreeningPackage({ requiredPackageId: '   ', evalResult: null, nowMs: NOW });
    expect(r.status).toBe('not_applicable');
  });
});

describe('matchScreeningPackage — incomplete', () => {
  it('returns incomplete when worker has no existing record (evalResult null)', () => {
    const r = matchScreeningPackage({
      requiredPackageId: 'CORT_PLUS',
      evalResult: null,
      nowMs: NOW,
    });
    expect(r.status).toBe('incomplete');
    expect(r.reason).toBe('no_existing_record');
  });
});

describe('matchScreeningPackage — complete_pass', () => {
  it('passes when eval satisfied and not expired', () => {
    const r = matchScreeningPackage({
      requiredPackageId: 'CORT_PLUS',
      evalResult: evalSatisfied(),
      nowMs: NOW,
    });
    expect(r.status).toBe('complete_pass');
    expect(r.reason).toBe('eval_satisfied');
  });

  it('passes when expiresAtMs is null (no validity window enforcement)', () => {
    const r = matchScreeningPackage({
      requiredPackageId: 'CORT_PLUS',
      evalResult: evalSatisfied({ expiresAtMs: null }),
      nowMs: NOW,
    });
    expect(r.status).toBe('complete_pass');
  });
});

describe('matchScreeningPackage — complete_fail', () => {
  it('fails when eval satisfied but expired since', () => {
    const r = matchScreeningPackage({
      requiredPackageId: 'CORT_PLUS',
      evalResult: evalSatisfied({ expiresAtMs: NOW - HOUR }),
      nowMs: NOW,
    });
    expect(r.status).toBe('complete_fail');
    expect(r.reason).toBe('eval_satisfied_but_expired');
    expect(r.details?.expiredSinceEval).toBe(true);
  });

  it('fails when eval not satisfied (wrong package)', () => {
    const r = matchScreeningPackage({
      requiredPackageId: 'CORT_PLUS',
      evalResult: evalNotSatisfied(),
      nowMs: NOW,
    });
    expect(r.status).toBe('complete_fail');
    expect(r.reason).toBe('eval_not_satisfied');
  });

  it('fails when eval not satisfied AND expired (eval_not_satisfied wins)', () => {
    const r = matchScreeningPackage({
      requiredPackageId: 'CORT_PLUS',
      evalResult: evalNotSatisfied({ expiresAtMs: NOW - HOUR }),
      nowMs: NOW,
    });
    expect(r.status).toBe('complete_fail');
    // satisfied=false branch is checked AFTER expiration on satisfied=true,
    // so an unsatisfied result reports the underlying problem.
    expect(r.reason).toBe('eval_not_satisfied');
  });
});

describe('matchScreeningPackage — boundaries', () => {
  it('exact equality (nowMs === expiresAtMs) is still considered valid', () => {
    const r = matchScreeningPackage({
      requiredPackageId: 'CORT_PLUS',
      evalResult: evalSatisfied({ expiresAtMs: NOW }),
      nowMs: NOW,
    });
    expect(r.status).toBe('complete_pass');
  });

  it('one ms past expiration → fail', () => {
    const r = matchScreeningPackage({
      requiredPackageId: 'CORT_PLUS',
      evalResult: evalSatisfied({ expiresAtMs: NOW - 1 }),
      nowMs: NOW,
    });
    expect(r.status).toBe('complete_fail');
  });
});
