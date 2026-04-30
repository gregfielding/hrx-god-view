/**
 * E.1 + E.2 — Pure-function tests for `computeEvereeReadinessMirror`
 * and its helpers.
 *
 * The pure function is the heart of the readiness snapshot — every
 * misclassified field here would silently mislead the aggregator (E.3),
 * the chip (E.4), and downstream readiness queries. Each test
 * intentionally pins a single rule so a future field-shape change in
 * Everee's API can't drift past us silently.
 *
 * Coverage map (matches the spec's Step 6 list):
 *
 *   1. Happy-path W-2 worker — all readiness items green.
 *   2. Happy-path 1099 contractor — W-9 + bank, no I-9/W-4.
 *   3. Mid-onboarding W-2 — bank ready, I-9 / W-4 pending.
 *   4. TIN verification states — all four flow through correctly.
 *   5. Files endpoint failure — handbook + I-9 fall back to null.
 *   6. I-9 filename matching — variations on the official name.
 *   7. Handbook filename matching — variations on the friendly name.
 *   8. Empty bank accounts — direct-deposit-not-ready.
 *   9. Pay period cadence derivation — all four cadence bands.
 *
 * The reconcile callable + cron use the same pure function; we cover
 * the *decision* helpers (`derivePayPeriodCadence`, alias picker,
 * status coercers) directly here so the integration tests can stay
 * thin.
 */

import { expect } from 'chai';
import { Timestamp } from 'firebase-admin/firestore';

import {
  HANDBOOK_FILENAME_REGEX,
  I9_FILENAME_REGEX,
  coerceLifecycleStatus,
  coerceTinVerificationStatus,
  computeEvereeReadinessMirror,
  derivePayPeriodCadence,
  isoToTimestampOrNull,
  pickFirstDateAlias,
  type EvereeFile,
  type EvereeWorkerApiResponse,
} from '../../integrations/everee/evereeReadinessMirror';

import '../setup'; // initialize admin SDK so Timestamp.now() works

// ─────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────

/** Stable test clock so every snapshot's `lastEvereeSyncAt` is comparable. */
const NOW = Timestamp.fromMillis(Date.parse('2026-04-30T10:00:00Z'));

function buildWorker(overrides: Partial<EvereeWorkerApiResponse> = {}): EvereeWorkerApiResponse {
  return {
    id: 'wkr-test',
    employmentType: 'EMPLOYEE',
    bankAccounts: [
      { id: 'ba-1', accountNumberLast4: '4321', isActive: true },
    ],
    availablePaymentMethods: { directDeposit: true },
    tinVerificationStatus: 'VERIFIED',
    tinVerificationStatusChangedAt: '2026-04-01T12:00:00Z',
    taxpayerIdentifierLast4: '1234',
    lifecycleStatus: 'ACTIVE',
    onboardingComplete: true,
    onboardingStatus: 'COMPLETE',
    payPeriodConfig: { startDate: '2026-04-13', endDate: '2026-04-26' }, // 14 days → BI_WEEKLY
    supportedPaymentTypes: ['PAYROLL', 'AD_HOC'],
    ...overrides,
  };
}

function file(documentType: string, fileName: string, publishedAt: string): EvereeFile {
  return { id: `f-${fileName}`, documentType, fileName, publishedAt };
}

// ─────────────────────────────────────────────────────────────────────────
// Spec test 1 — Happy path W-2.
// ─────────────────────────────────────────────────────────────────────────

describe('E.1 — computeEvereeReadinessMirror (happy path W-2 employee)', () => {
  it('emits a fully-green snapshot when all four endpoints resolve', () => {
    const mirror = computeEvereeReadinessMirror({
      worker: buildWorker(),
      w4: { applicable: true, data: { effectiveDate: '2026-04-15T00:00:00Z' } },
      w9: { applicable: false }, // W-9 doesn't apply to W-2
      files: {
        ok: true,
        files: [
          file('ONBOARDING', 'Form I-9.pdf', '2026-04-10T12:00:00Z'),
          file('POLICY', 'Employee Handbook 2026.pdf', '2026-04-12T12:00:00Z'),
          file('POLICY', 'Code of Conduct.pdf', '2026-04-12T12:00:00Z'),
          file('POLICY', 'Anti-Harassment Policy.pdf', '2026-04-12T12:00:00Z'),
        ],
      },
      syncSource: 'manual',
      now: NOW,
    });

    expect(mirror.directDepositReady).to.equal(true);
    expect(mirror.bankAccountCount).to.equal(1);
    expect(mirror.primaryBankLast4).to.equal('4321');

    expect(mirror.i9Applicable).to.equal(true);
    expect(mirror.i9SignedAt).to.not.equal(null);
    expect(mirror.i9SignedAt!.toMillis()).to.equal(Date.parse('2026-04-10T12:00:00Z'));

    expect(mirror.w4Applicable).to.equal(true);
    expect(mirror.w4SignedAt).to.not.equal(null);
    expect(mirror.w4SignedAt!.toMillis()).to.equal(Date.parse('2026-04-15T00:00:00Z'));

    expect(mirror.w9Applicable).to.equal(false);
    expect(mirror.w9SignedAt).to.equal(null);

    expect(mirror.handbookSignedAt).to.not.equal(null);
    expect(mirror.policiesSignedCount).to.equal(2); // 3 policies − handbook
    expect(mirror.tinVerificationStatus).to.equal('VERIFIED');
    expect(mirror.lifecycleStatus).to.equal('ACTIVE');
    expect(mirror.onboardingComplete).to.equal(true);
    expect(mirror.payPeriodCadence).to.equal('BI_WEEKLY');
    expect(mirror.supportedPaymentTypes).to.deep.equal(['PAYROLL', 'AD_HOC']);
    expect(mirror.lastEvereeSyncSource).to.equal('manual');
    expect(mirror.lastEvereeSyncAt.toMillis()).to.equal(NOW.toMillis());
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Spec test 2 — Happy path 1099.
// ─────────────────────────────────────────────────────────────────────────

describe('E.1 — computeEvereeReadinessMirror (happy path 1099 contractor)', () => {
  it('emits W-9 signed + I-9/W-4 not-applicable', () => {
    const mirror = computeEvereeReadinessMirror({
      worker: buildWorker({
        employmentType: 'CONTRACTOR',
        // Contractors are AD_HOC only — Everee's payPeriodConfig may be
        // absent. We still pass through `supportedPaymentTypes` literally.
        payPeriodConfig: undefined,
        supportedPaymentTypes: ['AD_HOC'],
      }),
      w4: { applicable: false }, // 404 from Everee for contractors
      w9: { applicable: true, data: { signedAt: '2026-04-09T12:00:00Z' } },
      files: {
        ok: true,
        files: [
          // No I-9 (contractors don't sign I-9)
          file('POLICY', 'Independent Contractor Handbook.pdf', '2026-04-10T12:00:00Z'),
        ],
      },
      syncSource: 'embed',
      now: NOW,
    });

    expect(mirror.i9Applicable).to.equal(false);
    expect(mirror.i9SignedAt).to.equal(null);

    expect(mirror.w4Applicable).to.equal(false);
    expect(mirror.w4SignedAt).to.equal(null);

    expect(mirror.w9Applicable).to.equal(true);
    expect(mirror.w9SignedAt).to.not.equal(null);
    expect(mirror.w9SignedAt!.toMillis()).to.equal(Date.parse('2026-04-09T12:00:00Z'));

    expect(mirror.handbookSignedAt).to.not.equal(null);
    expect(mirror.policiesSignedCount).to.equal(0);

    // Cadence intentionally null for contractors — even when the
    // worker happens to have a config. Pinned because misclassifying a
    // contractor as BI_WEEKLY in a UI table would be a confusing bug
    // for accounting.
    expect(mirror.payPeriodCadence).to.equal(null);
  });

  it('keeps payPeriodCadence null for a contractor even if Everee includes a config', () => {
    const mirror = computeEvereeReadinessMirror({
      worker: buildWorker({
        employmentType: 'CONTRACTOR',
        payPeriodConfig: { startDate: '2026-04-13', endDate: '2026-04-19' }, // would be WEEKLY
      }),
      w4: { applicable: false },
      w9: { applicable: true, data: { signedAt: '2026-04-09T12:00:00Z' } },
      files: { ok: true, files: [] },
      syncSource: 'manual',
      now: NOW,
    });
    expect(mirror.payPeriodCadence).to.equal(null);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Spec test 3 — Mid-onboarding W-2.
// ─────────────────────────────────────────────────────────────────────────

describe('E.1 — computeEvereeReadinessMirror (mid-onboarding W-2)', () => {
  it('reports bank ready but I-9/W-4 pending', () => {
    const mirror = computeEvereeReadinessMirror({
      worker: buildWorker({
        onboardingComplete: false,
        onboardingStatus: 'IN_PROGRESS',
        lifecycleStatus: 'ONBOARDING',
      }),
      // Worker hasn't filed W-4 yet → applicable: true but no data.
      w4: { applicable: true, data: undefined },
      w9: { applicable: false },
      files: {
        ok: true,
        // I-9 not yet signed.
        files: [],
      },
      syncSource: 'cron',
      now: NOW,
    });

    expect(mirror.directDepositReady).to.equal(true);
    expect(mirror.bankAccountCount).to.equal(1);
    expect(mirror.i9SignedAt).to.equal(null);
    expect(mirror.w4SignedAt).to.equal(null);
    expect(mirror.handbookSignedAt).to.equal(null);
    expect(mirror.policiesSignedCount).to.equal(0);
    expect(mirror.onboardingComplete).to.equal(false);
    expect(mirror.onboardingStatus).to.equal('IN_PROGRESS');
    expect(mirror.lifecycleStatus).to.equal('ONBOARDING');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Spec test 4 — TIN verification states.
// ─────────────────────────────────────────────────────────────────────────

describe('E.1 — coerceTinVerificationStatus', () => {
  for (const v of ['NEEDS_VERIFICATION', 'SENT_FOR_VERIFICATION', 'VERIFIED', 'MISMATCH'] as const) {
    it(`flows the canonical state "${v}" through unchanged`, () => {
      expect(coerceTinVerificationStatus(v)).to.equal(v);
    });
  }
  it('uppercases lowercase values from older sandbox responses', () => {
    expect(coerceTinVerificationStatus('verified')).to.equal('VERIFIED');
  });
  it('returns null for unknown / non-string values', () => {
    expect(coerceTinVerificationStatus('PROCESSING')).to.equal(null);
    expect(coerceTinVerificationStatus(undefined)).to.equal(null);
    expect(coerceTinVerificationStatus(null)).to.equal(null);
    expect(coerceTinVerificationStatus(123)).to.equal(null);
  });
});

describe('E.1 — coerceLifecycleStatus', () => {
  it('passes through canonical values', () => {
    expect(coerceLifecycleStatus('ACTIVE')).to.equal('ACTIVE');
    expect(coerceLifecycleStatus('TERMINATED')).to.equal('TERMINATED');
  });
  it('returns null for unknown values', () => {
    expect(coerceLifecycleStatus('DECEASED')).to.equal(null);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Spec test 5 — Files endpoint failure.
// ─────────────────────────────────────────────────────────────────────────

describe('E.1 — computeEvereeReadinessMirror (files endpoint failure)', () => {
  it('falls back to null handbook + I-9 when files.ok is false', () => {
    const mirror = computeEvereeReadinessMirror({
      worker: buildWorker(),
      w4: { applicable: true, data: { effectiveDate: '2026-04-15T00:00:00Z' } },
      w9: { applicable: false },
      files: { ok: false }, // Everee /files endpoint errored
      syncSource: 'manual',
      now: NOW,
    });

    expect(mirror.i9SignedAt).to.equal(null);
    expect(mirror.handbookSignedAt).to.equal(null);
    expect(mirror.policiesSignedCount).to.equal(0);
    // Other fields still populate from the `worker` response.
    expect(mirror.directDepositReady).to.equal(true);
    expect(mirror.w4SignedAt).to.not.equal(null);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Spec test 6 — I-9 filename matching.
// ─────────────────────────────────────────────────────────────────────────

describe('E.1 — I9_FILENAME_REGEX', () => {
  for (const name of [
    'Form I-9.pdf',
    'I-9 Employment Eligibility Verification.pdf',
    'i9.pdf',
    'I9_signed_2026.pdf',
    'employment-eligibility-2026.pdf',
    'EMPLOYMENT ELIGIBILITY.pdf',
  ]) {
    it(`matches "${name}"`, () => {
      expect(I9_FILENAME_REGEX.test(name)).to.equal(true);
    });
  }

  for (const name of [
    'W-9 Signed.pdf',
    'W4_2026.pdf',
    'Direct Deposit Auth.pdf',
    'Handbook.pdf',
  ]) {
    it(`does NOT match "${name}" (false positives we explicitly disallow)`, () => {
      expect(I9_FILENAME_REGEX.test(name)).to.equal(false);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// Spec test 7 — Handbook filename matching.
// ─────────────────────────────────────────────────────────────────────────

describe('E.1 — HANDBOOK_FILENAME_REGEX', () => {
  for (const name of [
    'Employee Handbook.pdf',
    'Company Handbook.pdf',
    'Handbook 2026.pdf',
    'handbook_v3.pdf',
    'C1 Events Handbook.docx',
  ]) {
    it(`matches "${name}"`, () => {
      expect(HANDBOOK_FILENAME_REGEX.test(name)).to.equal(true);
    });
  }
  it('does NOT match "Onboarding Checklist.pdf"', () => {
    expect(HANDBOOK_FILENAME_REGEX.test('Onboarding Checklist.pdf')).to.equal(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Spec test 8 — Empty bank accounts.
// ─────────────────────────────────────────────────────────────────────────

describe('E.1 — computeEvereeReadinessMirror (empty bank accounts)', () => {
  it('reports directDepositReady=false when bankAccounts is empty', () => {
    const mirror = computeEvereeReadinessMirror({
      worker: buildWorker({
        bankAccounts: [],
        availablePaymentMethods: { directDeposit: false },
      }),
      w4: { applicable: false },
      w9: { applicable: false },
      files: { ok: true, files: [] },
      syncSource: 'manual',
      now: NOW,
    });
    expect(mirror.directDepositReady).to.equal(false);
    expect(mirror.bankAccountCount).to.equal(0);
    expect(mirror.primaryBankLast4).to.equal(null);
  });

  it('reports directDepositReady=false when bank exists but availablePaymentMethods says no', () => {
    // Defensive corner: Everee has a separate `availablePaymentMethods`
    // toggle that gates direct deposit even when an account is on file
    // (e.g. micro-deposit verification still pending). We respect that.
    const mirror = computeEvereeReadinessMirror({
      worker: buildWorker({
        bankAccounts: [{ id: 'ba-1', accountNumberLast4: '0001' }],
        availablePaymentMethods: { directDeposit: false },
      }),
      w4: { applicable: false },
      w9: { applicable: false },
      files: { ok: true, files: [] },
      syncSource: 'manual',
      now: NOW,
    });
    expect(mirror.directDepositReady).to.equal(false);
    expect(mirror.bankAccountCount).to.equal(1);
    expect(mirror.primaryBankLast4).to.equal('0001');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Spec test 9 — Pay period cadence derivation.
// ─────────────────────────────────────────────────────────────────────────

describe('E.1 — derivePayPeriodCadence', () => {
  it('maps 1-day window to DAILY', () => {
    expect(
      derivePayPeriodCadence({ startDate: '2026-04-15', endDate: '2026-04-15' }),
    ).to.equal('DAILY');
  });
  it('maps 7-day window to WEEKLY', () => {
    expect(
      derivePayPeriodCadence({ startDate: '2026-04-13', endDate: '2026-04-19' }),
    ).to.equal('WEEKLY');
  });
  it('maps 14-day window to BI_WEEKLY', () => {
    expect(
      derivePayPeriodCadence({ startDate: '2026-04-13', endDate: '2026-04-26' }),
    ).to.equal('BI_WEEKLY');
  });
  it('maps 16-day window to SEMI_MONTHLY', () => {
    expect(
      derivePayPeriodCadence({ startDate: '2026-04-01', endDate: '2026-04-16' }),
    ).to.equal('SEMI_MONTHLY');
  });
  it('returns null for missing config', () => {
    expect(derivePayPeriodCadence(undefined)).to.equal(null);
  });
  it('returns null for missing dates', () => {
    expect(derivePayPeriodCadence({})).to.equal(null);
    expect(derivePayPeriodCadence({ startDate: '2026-04-13' })).to.equal(null);
  });
  it('returns null for malformed dates', () => {
    expect(
      derivePayPeriodCadence({ startDate: 'yesterday', endDate: 'today' }),
    ).to.equal(null);
  });
  it('returns null for an out-of-band window', () => {
    expect(
      derivePayPeriodCadence({ startDate: '2026-04-01', endDate: '2026-04-30' }),
    ).to.equal(null);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Date-alias picker — pinned because the W-4 / W-9 field-name uncertainty
// is the most likely place a future Everee schema change breaks us.
// ─────────────────────────────────────────────────────────────────────────

describe('E.1 — pickFirstDateAlias / isoToTimestampOrNull', () => {
  it('picks the first present alias in order', () => {
    const ts = pickFirstDateAlias(
      { lastModified: '2026-04-15T00:00:00Z' },
      ['effectiveDate', 'signedAt', 'lastModified'],
    );
    expect(ts).to.not.equal(null);
    expect(ts!.toMillis()).to.equal(Date.parse('2026-04-15T00:00:00Z'));
  });

  it('prefers the earlier alias when multiple are present', () => {
    const ts = pickFirstDateAlias(
      {
        effectiveDate: '2026-04-15T00:00:00Z',
        lastModified: '2026-01-01T00:00:00Z',
      },
      ['effectiveDate', 'lastModified'],
    );
    expect(ts!.toMillis()).to.equal(Date.parse('2026-04-15T00:00:00Z'));
  });

  it('returns null when none of the aliases match', () => {
    const ts = pickFirstDateAlias(
      { someOtherField: '2026-04-15T00:00:00Z' },
      ['effectiveDate', 'signedAt'],
    );
    expect(ts).to.equal(null);
  });

  it('returns null on empty / non-string / invalid date input', () => {
    expect(isoToTimestampOrNull(undefined)).to.equal(null);
    expect(isoToTimestampOrNull(null)).to.equal(null);
    expect(isoToTimestampOrNull('')).to.equal(null);
    expect(isoToTimestampOrNull('not a date')).to.equal(null);
    expect(isoToTimestampOrNull(123)).to.equal(null);
  });
});
