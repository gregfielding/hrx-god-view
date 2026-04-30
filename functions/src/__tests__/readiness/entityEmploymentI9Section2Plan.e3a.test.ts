/**
 * **E.3 addendum** — Unit tests for `planEntityEmploymentI9Section2Update`
 * and `mapI9Section2Status`.
 *
 * Pure-function tests (Mocha + Chai per `functions/package.json`).
 *
 * Coverage:
 *   - Per-workerType applicability (w2 / 1099 / unknown / case + dash variations)
 *   - Section 2 completion stamp presence
 *   - Fingerprint short-circuit on unrelated entity_employments mutations
 *   - Doc-creation fires (no `before`)
 *   - Doc-deletion is no-op (no `after`)
 *   - Defensive identity field reads (`userId` / `candidateId`, `hiringEntityId` / `entityId`)
 *
 * @see ../../readiness/entityEmploymentI9Section2Plan.ts
 * @see ../../readiness/onEntityEmploymentI9Section2WriteUpdateReadiness.ts
 */

import { expect } from 'chai';

import {
  mapI9Section2Status,
  planEntityEmploymentI9Section2Update,
  type EntityEmploymentDocLike,
} from '../../readiness/entityEmploymentI9Section2Plan';

const SIGNED_PLACEHOLDER = { _kind: 'placeholder-timestamp' } as unknown;

function emp(over: Partial<EntityEmploymentDocLike> = {}): EntityEmploymentDocLike {
  return {
    workerType: 'w2',
    userId: 'worker-1',
    hiringEntityId: 'entity-1',
    i9Section2CompletedAt: null,
    ...over,
  };
}

describe('mapI9Section2Status — applicability', () => {
  it('1099 contractor → not_applicable (regardless of completion stamp)', () => {
    expect(mapI9Section2Status(emp({ workerType: '1099' }))).to.equal('not_applicable');
    expect(
      mapI9Section2Status(emp({ workerType: '1099', i9Section2CompletedAt: SIGNED_PLACEHOLDER })),
    ).to.equal('not_applicable');
  });

  it('w2 + completed → complete_pass', () => {
    expect(
      mapI9Section2Status(emp({ workerType: 'w2', i9Section2CompletedAt: SIGNED_PLACEHOLDER })),
    ).to.equal('complete_pass');
  });

  it('w2 + not completed → incomplete', () => {
    expect(mapI9Section2Status(emp({ workerType: 'w2', i9Section2CompletedAt: null }))).to.equal(
      'incomplete',
    );
    expect(
      mapI9Section2Status(emp({ workerType: 'w2', i9Section2CompletedAt: undefined })),
    ).to.equal('incomplete');
  });

  it('missing workerType → not_applicable (defensive — bail rather than block)', () => {
    expect(mapI9Section2Status(emp({ workerType: null }))).to.equal('not_applicable');
    expect(mapI9Section2Status(emp({ workerType: undefined }))).to.equal('not_applicable');
    expect(mapI9Section2Status(emp({ workerType: '' }))).to.equal('not_applicable');
  });

  it('unknown workerType (e.g. "intern") → not_applicable', () => {
    expect(mapI9Section2Status(emp({ workerType: 'intern' }))).to.equal('not_applicable');
  });
});

describe('mapI9Section2Status — workerType normalization', () => {
  it('uppercase / dash / underscore variations all match w2', () => {
    expect(mapI9Section2Status(emp({ workerType: 'W2' }))).to.equal('incomplete');
    expect(mapI9Section2Status(emp({ workerType: 'W-2' }))).to.equal('incomplete');
    expect(mapI9Section2Status(emp({ workerType: 'w-2' }))).to.equal('incomplete');
    expect(mapI9Section2Status(emp({ workerType: 'employee' }))).to.equal('incomplete');
    expect(mapI9Section2Status(emp({ workerType: 'Employee' }))).to.equal('incomplete');
  });

  it('contractor / 1099 variations all map to not_applicable', () => {
    expect(mapI9Section2Status(emp({ workerType: '1099' }))).to.equal('not_applicable');
    expect(
      mapI9Section2Status(emp({ workerType: 'contractor', i9Section2CompletedAt: SIGNED_PLACEHOLDER })),
    ).to.equal('not_applicable');
    expect(mapI9Section2Status(emp({ workerType: 'CONTRACTOR' }))).to.equal('not_applicable');
  });

  it('does NOT inspect Section 1 state — Section 2 status is independent', () => {
    // The mapper has no parameter for mirror.i9SignedAt, by design.
    // Whether to surface as actionable is a UI / queue concern.
    expect(mapI9Section2Status(emp({ workerType: 'w2', i9Section2CompletedAt: null }))).to.equal(
      'incomplete',
    );
  });
});

describe('planEntityEmploymentI9Section2Update — fingerprint short-circuit', () => {
  it('no change in workerType + completion → no-op', () => {
    const before = emp({ workerType: 'w2', i9Section2CompletedAt: null });
    const after = emp({ workerType: 'w2', i9Section2CompletedAt: null });
    const plan = planEntityEmploymentI9Section2Update({ before, after });
    expect(plan.shouldFire).to.equal(false);
  });

  it('unrelated field change (e.g. status) → no-op', () => {
    const before: EntityEmploymentDocLike = {
      workerType: 'w2',
      userId: 'worker-1',
      hiringEntityId: 'entity-1',
      i9Section2CompletedAt: null,
      // status: 'invited' — not in the planner's interface, but on the real doc
    };
    const after: EntityEmploymentDocLike = {
      workerType: 'w2',
      userId: 'worker-1',
      hiringEntityId: 'entity-1',
      i9Section2CompletedAt: null,
      // status: 'onboarding' — changed but not part of fingerprint
    };
    const plan = planEntityEmploymentI9Section2Update({ before, after });
    expect(plan.shouldFire).to.equal(false);
  });

  it('Section 2 stamp transitions null → set → fires', () => {
    const before = emp({ i9Section2CompletedAt: null });
    const after = emp({ i9Section2CompletedAt: SIGNED_PLACEHOLDER });
    const plan = planEntityEmploymentI9Section2Update({ before, after });
    expect(plan.shouldFire).to.equal(true);
    expect(plan.newStatus).to.equal('complete_pass');
    expect(plan.debug.section2Completed).to.equal(true);
  });

  it('Section 2 stamp re-stamped (set → set, both non-null) → no-op', () => {
    // Backfill case: someone re-runs the attestation script with a new
    // timestamp. The status itself didn't change (still complete), so we
    // shouldn't fire.
    const before = emp({ i9Section2CompletedAt: { _t: 1 } });
    const after = emp({ i9Section2CompletedAt: { _t: 2 } });
    const plan = planEntityEmploymentI9Section2Update({ before, after });
    expect(plan.shouldFire).to.equal(false);
  });

  it('workerType flip w2 → 1099 → fires (status now not_applicable)', () => {
    const before = emp({ workerType: 'w2', i9Section2CompletedAt: null });
    const after = emp({ workerType: '1099', i9Section2CompletedAt: null });
    const plan = planEntityEmploymentI9Section2Update({ before, after });
    expect(plan.shouldFire).to.equal(true);
    expect(plan.newStatus).to.equal('not_applicable');
  });

  it('workerType flip 1099 → w2 → fires (status now incomplete)', () => {
    const before = emp({ workerType: '1099', i9Section2CompletedAt: null });
    const after = emp({ workerType: 'w2', i9Section2CompletedAt: null });
    const plan = planEntityEmploymentI9Section2Update({ before, after });
    expect(plan.shouldFire).to.equal(true);
    expect(plan.newStatus).to.equal('incomplete');
  });
});

describe('planEntityEmploymentI9Section2Update — doc lifecycle', () => {
  it('doc creation (before === null) → fires (seeds the new employment\'s item)', () => {
    const plan = planEntityEmploymentI9Section2Update({
      before: null,
      after: emp({ workerType: 'w2', i9Section2CompletedAt: null }),
    });
    expect(plan.shouldFire).to.equal(true);
    expect(plan.newStatus).to.equal('incomplete');
  });

  it('doc creation, 1099 contractor → fires with not_applicable', () => {
    const plan = planEntityEmploymentI9Section2Update({
      before: null,
      after: emp({ workerType: '1099' }),
    });
    expect(plan.shouldFire).to.equal(true);
    expect(plan.newStatus).to.equal('not_applicable');
  });

  it('doc deletion (after === null) → no-op', () => {
    const plan = planEntityEmploymentI9Section2Update({
      before: emp(),
      after: null,
    });
    expect(plan.shouldFire).to.equal(false);
  });
});

describe('planEntityEmploymentI9Section2Update — identity field resolution', () => {
  it('reads userId + hiringEntityId (canonical fields)', () => {
    const plan = planEntityEmploymentI9Section2Update({
      before: null,
      after: emp({ userId: 'w-99', hiringEntityId: 'e-77' }),
    });
    expect(plan.workerUid).to.equal('w-99');
    expect(plan.hiringEntityId).to.equal('e-77');
  });

  it('falls back to candidateId when userId absent (legacy doc shape)', () => {
    const plan = planEntityEmploymentI9Section2Update({
      before: null,
      after: { workerType: 'w2', candidateId: 'cand-1', hiringEntityId: 'e-1' },
    });
    expect(plan.workerUid).to.equal('cand-1');
  });

  it('falls back to entityId when hiringEntityId absent (legacy doc shape)', () => {
    const plan = planEntityEmploymentI9Section2Update({
      before: null,
      after: { workerType: 'w2', userId: 'w-1', entityId: 'e-legacy' },
    });
    expect(plan.hiringEntityId).to.equal('e-legacy');
  });

  it('returns null identity fields when both canonical + legacy absent', () => {
    const plan = planEntityEmploymentI9Section2Update({
      before: null,
      after: { workerType: 'w2', i9Section2CompletedAt: null },
    });
    expect(plan.shouldFire).to.equal(true);
    expect(plan.workerUid).to.be.null;
    expect(plan.hiringEntityId).to.be.null;
    // The trigger's I/O wrapper should detect missing identity and
    // log + bail rather than calling updateReadinessItemStatus.
  });

  it('trims whitespace + treats empty strings as null', () => {
    const plan = planEntityEmploymentI9Section2Update({
      before: null,
      after: emp({ userId: '  w-1  ', hiringEntityId: '   ' }),
    });
    expect(plan.workerUid).to.equal('w-1');
    expect(plan.hiringEntityId).to.be.null;
  });
});

describe('planEntityEmploymentI9Section2Update — debug fields + idempotency', () => {
  it('debug.workerTypeNormalized reports normalized value', () => {
    const plan = planEntityEmploymentI9Section2Update({
      before: null,
      after: emp({ workerType: 'W-2' }),
    });
    expect(plan.debug.workerTypeNormalized).to.equal('w2');
  });

  it('debug.section2Completed reflects after-state stamp presence', () => {
    const plan = planEntityEmploymentI9Section2Update({
      before: null,
      after: emp({ i9Section2CompletedAt: SIGNED_PLACEHOLDER }),
    });
    expect(plan.debug.section2Completed).to.equal(true);
  });

  it('two consecutive plans on identical input → identical structure (deterministic)', () => {
    const before = emp({ workerType: 'w2', i9Section2CompletedAt: null });
    const after = emp({ workerType: 'w2', i9Section2CompletedAt: SIGNED_PLACEHOLDER });
    const planA = planEntityEmploymentI9Section2Update({ before, after });
    const planB = planEntityEmploymentI9Section2Update({ before, after });
    expect(planA).to.deep.equal(planB);
  });
});
