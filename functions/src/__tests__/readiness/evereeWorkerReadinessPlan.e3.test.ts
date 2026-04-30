/**
 * **E.3** — Unit tests for `planEvereeWorkerReadinessUpdates`.
 *
 * The planner is the pure decision layer beneath
 * `onEvereeWorkerWriteUpdateReadiness`. It owns:
 *
 *   - Should the trigger fire? (legacy + mirror fingerprint short-circuit)
 *   - Which `employeeReadinessItems` to update + with what status?
 *   - Mirror-wins rule for `direct_deposit` when the snapshot is present.
 *   - Provenance-only changes (`lastEvereeSyncAt` etc.) must NOT re-fire.
 *
 * Pure-function tests (Mocha + Chai per `functions/package.json`).
 *
 * @see ../../readiness/evereeWorkerReadinessPlan.ts
 * @see ../../readiness/onEvereeWorkerWriteUpdateReadiness.ts
 */

import { expect } from 'chai';

import {
  planEvereeWorkerReadinessUpdates,
  type EvereeWorkerDocLike,
} from '../../readiness/evereeWorkerReadinessPlan';

const SIGNED_PLACEHOLDER = { _kind: 'placeholder-timestamp' } as unknown;

const MIRROR_DEFAULTS = {
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

function withMirror(over: Partial<typeof MIRROR_DEFAULTS> = {}): EvereeWorkerDocLike {
  return {
    status: 'onboarding_complete',
    bankAccount: { verified: false },
    readinessMirror: { ...MIRROR_DEFAULTS, ...over },
  };
}

function legacyOnly(over: Partial<EvereeWorkerDocLike> = {}): EvereeWorkerDocLike {
  return {
    status: 'in_progress',
    bankAccount: { verified: false },
    ...over,
  };
}

describe('planEvereeWorkerReadinessUpdates — fingerprint short-circuit', () => {
  it('legacy fingerprint unchanged + no mirror → no-op', () => {
    const before = legacyOnly();
    const after = legacyOnly();
    const plan = planEvereeWorkerReadinessUpdates({ before, after });
    expect(plan.shouldFire).to.equal(false);
    expect(plan.updates).to.deep.equal([]);
    expect(plan.debug.mirrorPresent).to.equal(false);
  });

  it('legacy status changed → fires (no mirror branch)', () => {
    const before = legacyOnly({ status: 'invited' });
    const after = legacyOnly({ status: 'in_progress' });
    const plan = planEvereeWorkerReadinessUpdates({ before, after });
    expect(plan.shouldFire).to.equal(true);
    expect(plan.debug.legacyFingerprintChanged).to.equal(true);
    expect(plan.debug.mirrorFingerprintChanged).to.equal(false);
    expect(plan.debug.mirrorPresent).to.equal(false);
    // Legacy-only path: just everee_profile + direct_deposit.
    expect(plan.updates.map((u) => u.requirementType).sort()).to.deep.equal(
      ['direct_deposit', 'everee_profile'].sort(),
    );
    expect(plan.updates.every((u) => u.source === 'legacy')).to.equal(true);
  });

  it('bankAccount.verified change → fires legacy-only path', () => {
    const before = legacyOnly({ bankAccount: { verified: false } });
    const after = legacyOnly({ bankAccount: { verified: true } });
    const plan = planEvereeWorkerReadinessUpdates({ before, after });
    expect(plan.shouldFire).to.equal(true);
    expect(plan.updates.find((u) => u.requirementType === 'direct_deposit')?.newStatus).to.equal(
      'in_progress', // status: 'in_progress' → DD `in_progress` regardless of bank
    );
  });

  it('mirror unchanged + only provenance changed → no-op (no re-fire on cron sweep)', () => {
    // Simulate the cron sweep re-stamping `lastEvereeSyncAt` /
    // `lastEvereeSyncSource` without changing semantic mirror fields.
    const before: EvereeWorkerDocLike = {
      status: 'onboarding_complete',
      bankAccount: { verified: true },
      readinessMirror: {
        ...MIRROR_DEFAULTS,
        directDepositReady: true,
        lastEvereeSyncAt: { _t: 1 },
        lastEvereeSyncSource: 'cron',
      },
    };
    const after: EvereeWorkerDocLike = {
      status: 'onboarding_complete',
      bankAccount: { verified: true },
      readinessMirror: {
        ...MIRROR_DEFAULTS,
        directDepositReady: true,
        lastEvereeSyncAt: { _t: 2 }, // different
        lastEvereeSyncSource: 'cron',
      },
    };
    const plan = planEvereeWorkerReadinessUpdates({ before, after });
    expect(plan.shouldFire).to.equal(false);
    expect(plan.updates).to.deep.equal([]);
  });

  it('mirror semantic field changed → fires', () => {
    const before = withMirror({ directDepositReady: false });
    const after = withMirror({ directDepositReady: true });
    const plan = planEvereeWorkerReadinessUpdates({ before, after });
    expect(plan.shouldFire).to.equal(true);
    expect(plan.debug.mirrorFingerprintChanged).to.equal(true);
  });
});

describe('planEvereeWorkerReadinessUpdates — mirror-driven dispatch', () => {
  it('mirror present → dispatches all 7 mirror-owned items + everee_profile (8 total)', () => {
    const before: EvereeWorkerDocLike = {
      status: 'in_progress',
      bankAccount: { verified: false },
    };
    const after = withMirror({
      directDepositReady: true,
      i9Applicable: true,
      i9SignedAt: SIGNED_PLACEHOLDER,
      w4Applicable: true,
      w4SignedAt: SIGNED_PLACEHOLDER,
      handbookSignedAt: SIGNED_PLACEHOLDER,
      policiesSignedCount: 2,
      tinVerificationStatus: 'VERIFIED',
    });
    const plan = planEvereeWorkerReadinessUpdates({ before, after });
    expect(plan.shouldFire).to.equal(true);
    const types = plan.updates.map((u) => u.requirementType).sort();
    expect(types).to.deep.equal(
      [
        'direct_deposit',
        'everee_profile',
        'handbook_acknowledgement',
        'i9_section_1',
        'policy_acknowledgement',
        'tax_w4',
        'tax_w9',
        'tin_verification',
      ].sort(),
    );
  });

  it('mirror present → direct_deposit comes from mirror (mirror wins)', () => {
    // Legacy says DD is incomplete (status=in_progress, bank not verified)
    // but the mirror says DD is ready. Mirror should win.
    const before: EvereeWorkerDocLike = {
      status: 'invited',
      bankAccount: { verified: false },
    };
    const after: EvereeWorkerDocLike = {
      status: 'in_progress',
      bankAccount: { verified: false },
      readinessMirror: {
        ...MIRROR_DEFAULTS,
        directDepositReady: true,
      },
    };
    const plan = planEvereeWorkerReadinessUpdates({ before, after });
    const ddUpdate = plan.updates.find((u) => u.requirementType === 'direct_deposit');
    expect(ddUpdate).to.exist;
    expect(ddUpdate?.source).to.equal('mirror');
    expect(ddUpdate?.newStatus).to.equal('complete_pass');
  });

  it('mirror absent → direct_deposit falls back to legacy translator', () => {
    const before = legacyOnly({ status: 'invited' });
    const after = legacyOnly({ status: 'onboarding_complete', bankAccount: { verified: true } });
    const plan = planEvereeWorkerReadinessUpdates({ before, after });
    const ddUpdate = plan.updates.find((u) => u.requirementType === 'direct_deposit');
    expect(ddUpdate?.source).to.equal('legacy');
    expect(ddUpdate?.newStatus).to.equal('complete_pass');
  });

  it('mirror absent → does NOT touch i9/w4/w9/handbook/policies/tin items', () => {
    const before = legacyOnly({ status: 'invited' });
    const after = legacyOnly({ status: 'onboarding_complete' });
    const plan = planEvereeWorkerReadinessUpdates({ before, after });
    const types = plan.updates.map((u) => u.requirementType);
    expect(types).to.not.include('i9_section_1');
    expect(types).to.not.include('tax_w4');
    expect(types).to.not.include('tax_w9');
    expect(types).to.not.include('handbook_acknowledgement');
    expect(types).to.not.include('policy_acknowledgement');
    expect(types).to.not.include('tin_verification');
  });

  it('everee_profile always sourced from legacy translator (even when mirror present)', () => {
    const after = withMirror({ directDepositReady: true });
    const plan = planEvereeWorkerReadinessUpdates({
      before: { status: 'in_progress' },
      after,
    });
    const profile = plan.updates.find((u) => u.requirementType === 'everee_profile');
    expect(profile).to.exist;
    expect(profile?.source).to.equal('legacy');
    // status: 'onboarding_complete' (default in withMirror) → complete_pass
    expect(profile?.newStatus).to.equal('complete_pass');
  });
});

describe('planEvereeWorkerReadinessUpdates — TIN MISMATCH propagation', () => {
  it('TIN MISMATCH → tin_verification update has status=blocked', () => {
    const before = withMirror({ tinVerificationStatus: 'SENT_FOR_VERIFICATION' });
    const after = withMirror({ tinVerificationStatus: 'MISMATCH' });
    const plan = planEvereeWorkerReadinessUpdates({ before, after });
    expect(plan.shouldFire).to.equal(true);
    const tin = plan.updates.find((u) => u.requirementType === 'tin_verification');
    expect(tin?.newStatus).to.equal('blocked');
    expect(tin?.source).to.equal('mirror');
  });

  it('TIN VERIFIED → tin_verification complete_pass', () => {
    const before = withMirror({ tinVerificationStatus: 'SENT_FOR_VERIFICATION' });
    const after = withMirror({ tinVerificationStatus: 'VERIFIED' });
    const plan = planEvereeWorkerReadinessUpdates({ before, after });
    const tin = plan.updates.find((u) => u.requirementType === 'tin_verification');
    expect(tin?.newStatus).to.equal('complete_pass');
  });
});

describe('planEvereeWorkerReadinessUpdates — applicability flags', () => {
  it('1099 contractor (W-9 applicable) → tax_w9 complete_pass, tax_w4/i9 not_applicable', () => {
    const after = withMirror({
      directDepositReady: true,
      i9Applicable: false,
      w4Applicable: false,
      w9Applicable: true,
      w9SignedAt: SIGNED_PLACEHOLDER,
      handbookSignedAt: SIGNED_PLACEHOLDER,
      policiesSignedCount: 1,
      tinVerificationStatus: 'VERIFIED',
    });
    const plan = planEvereeWorkerReadinessUpdates({ before: legacyOnly(), after });
    const find = (t: string) => plan.updates.find((u) => u.requirementType === t)?.newStatus;
    expect(find('tax_w9')).to.equal('complete_pass');
    expect(find('tax_w4')).to.equal('not_applicable');
    expect(find('i9_section_1')).to.equal('not_applicable');
  });

  it('W-2 worker (I-9 + W-4 applicable) → I-9 / W-4 complete, W-9 not_applicable', () => {
    const after = withMirror({
      directDepositReady: true,
      i9Applicable: true,
      i9SignedAt: SIGNED_PLACEHOLDER,
      w4Applicable: true,
      w4SignedAt: SIGNED_PLACEHOLDER,
      w9Applicable: false,
      handbookSignedAt: SIGNED_PLACEHOLDER,
      policiesSignedCount: 1,
      tinVerificationStatus: 'VERIFIED',
    });
    const plan = planEvereeWorkerReadinessUpdates({ before: legacyOnly(), after });
    const find = (t: string) => plan.updates.find((u) => u.requirementType === t)?.newStatus;
    expect(find('i9_section_1')).to.equal('complete_pass');
    expect(find('tax_w4')).to.equal('complete_pass');
    expect(find('tax_w9')).to.equal('not_applicable');
  });
});

describe('planEvereeWorkerReadinessUpdates — defensive shape handling', () => {
  it('after data missing entirely → no-op', () => {
    const plan = planEvereeWorkerReadinessUpdates({ before: legacyOnly(), after: null });
    expect(plan.shouldFire).to.equal(false);
    expect(plan.updates).to.deep.equal([]);
  });

  it('readinessMirror is malformed (missing required boolean) → mirror treated as absent', () => {
    const after: EvereeWorkerDocLike = {
      status: 'onboarding_complete',
      bankAccount: { verified: true },
      readinessMirror: {
        // Missing `directDepositReady`, `i9Applicable`, etc. — partial write.
        i9SignedAt: SIGNED_PLACEHOLDER,
      },
    };
    const plan = planEvereeWorkerReadinessUpdates({ before: legacyOnly(), after });
    // Falls back to legacy-only path (legacy fingerprint changed).
    expect(plan.debug.mirrorPresent).to.equal(false);
    const types = plan.updates.map((u) => u.requirementType).sort();
    expect(types).to.deep.equal(['direct_deposit', 'everee_profile'].sort());
  });

  it('readinessMirror set to non-object → treated as absent', () => {
    const after: EvereeWorkerDocLike = {
      status: 'onboarding_complete',
      readinessMirror: 'oops' as unknown,
    };
    const plan = planEvereeWorkerReadinessUpdates({
      before: { status: 'in_progress' },
      after,
    });
    expect(plan.debug.mirrorPresent).to.equal(false);
  });

  it('newly-mirror-populated worker (before had no mirror, after has mirror) → fires + dispatches mirror items', () => {
    const before = legacyOnly();
    const after = withMirror({
      directDepositReady: true,
      tinVerificationStatus: 'VERIFIED',
    });
    const plan = planEvereeWorkerReadinessUpdates({ before, after });
    expect(plan.shouldFire).to.equal(true);
    expect(plan.debug.mirrorFingerprintChanged).to.equal(true);
    expect(plan.debug.mirrorPresent).to.equal(true);
    expect(plan.updates.find((u) => u.requirementType === 'tin_verification')?.newStatus).to.equal(
      'complete_pass',
    );
  });

  it('mirror cleared (before had mirror, after has none) → fires + falls back to legacy-only', () => {
    const before = withMirror({ directDepositReady: true });
    const after = legacyOnly({ status: 'in_progress', bankAccount: { verified: false } });
    const plan = planEvereeWorkerReadinessUpdates({ before, after });
    expect(plan.shouldFire).to.equal(true);
    expect(plan.debug.mirrorFingerprintChanged).to.equal(true);
    const types = plan.updates.map((u) => u.requirementType).sort();
    expect(types).to.deep.equal(['direct_deposit', 'everee_profile'].sort());
  });
});

describe('planEvereeWorkerReadinessUpdates — idempotency precondition', () => {
  it('identical before/after → shouldFire false (no spurious recompute)', () => {
    const doc = withMirror({
      directDepositReady: true,
      i9Applicable: true,
      i9SignedAt: SIGNED_PLACEHOLDER,
      w4Applicable: true,
      w4SignedAt: SIGNED_PLACEHOLDER,
      handbookSignedAt: SIGNED_PLACEHOLDER,
      policiesSignedCount: 3,
      tinVerificationStatus: 'VERIFIED',
    });
    const plan = planEvereeWorkerReadinessUpdates({ before: doc, after: doc });
    expect(plan.shouldFire).to.equal(false);
  });

  it('two consecutive plans on same input → identical structure (deterministic)', () => {
    const before = legacyOnly({ status: 'invited' });
    const after = withMirror({
      directDepositReady: true,
      handbookSignedAt: SIGNED_PLACEHOLDER,
      tinVerificationStatus: 'VERIFIED',
    });
    const planA = planEvereeWorkerReadinessUpdates({ before, after });
    const planB = planEvereeWorkerReadinessUpdates({ before, after });
    expect(planA).to.deep.equal(planB);
  });
});
