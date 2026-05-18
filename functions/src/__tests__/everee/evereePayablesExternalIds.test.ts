/**
 * `buildPayableExternalId` / `buildAdjustmentExternalId` unit tests
 * (TS.1.P4 Slice 2).
 *
 * Pure functions — no HTTP, no Firestore. These are the dedup keys the
 * orchestrator submits to Everee; changing the format silently would
 * make every prior submission look new on retry. Pinning the format
 * here prevents accidental drift.
 *
 * Source spec: `timesheet-build-plan-addendum-phase4.md` §7.
 */

import { expect } from 'chai';

import {
  buildAdjustmentExternalId,
  buildPayableExternalId,
} from '../../integrations/everee/evereePayables';

describe('buildPayableExternalId', () => {
  const fixed = {
    tenantId: 'BCiP2bQ9CgVOCTfV6MhD',
    assignmentId: 'assign123',
    workDate: '2026-05-18',
  };

  it('produces the spec-pinned tips format', () => {
    expect(buildPayableExternalId({ ...fixed, kind: 'TIPS' })).to.equal(
      'BCiP2bQ9CgVOCTfV6MhD::assign123::2026-05-18::TIPS',
    );
  });

  it('produces distinct ids per kind for the same tenant/assignment/date', () => {
    const tips = buildPayableExternalId({ ...fixed, kind: 'TIPS' });
    const bonus = buildPayableExternalId({ ...fixed, kind: 'BONUS' });
    const meal = buildPayableExternalId({ ...fixed, kind: 'MEAL_PREMIUM' });
    const rest = buildPayableExternalId({ ...fixed, kind: 'REST_PREMIUM' });
    const contractor = buildPayableExternalId({ ...fixed, kind: 'CONTRACTOR' });
    const all = new Set([tips, bonus, meal, rest, contractor]);
    expect(all.size).to.equal(5);
  });

  it('is fully deterministic — same input → same output', () => {
    const a = buildPayableExternalId({ ...fixed, kind: 'TIPS' });
    const b = buildPayableExternalId({ ...fixed, kind: 'TIPS' });
    expect(a).to.equal(b);
  });

  it('produces distinct ids per workDate (so per-day idempotency holds)', () => {
    const d1 = buildPayableExternalId({ ...fixed, workDate: '2026-05-17', kind: 'TIPS' });
    const d2 = buildPayableExternalId({ ...fixed, workDate: '2026-05-18', kind: 'TIPS' });
    expect(d1).to.not.equal(d2);
  });

  it('produces distinct ids per assignmentId', () => {
    const a1 = buildPayableExternalId({ ...fixed, assignmentId: 'assign-1', kind: 'TIPS' });
    const a2 = buildPayableExternalId({ ...fixed, assignmentId: 'assign-2', kind: 'TIPS' });
    expect(a1).to.not.equal(a2);
  });
});

describe('buildAdjustmentExternalId', () => {
  it('produces the spec-pinned adjustment format', () => {
    expect(
      buildAdjustmentExternalId({ tenantId: 'BCiP2bQ9CgVOCTfV6MhD', adjustmentId: 'adj-456' }),
    ).to.equal('BCiP2bQ9CgVOCTfV6MhD::adj-456');
  });

  it('is fully deterministic', () => {
    const args = { tenantId: 'tenant-x', adjustmentId: 'adj-y' };
    expect(buildAdjustmentExternalId(args)).to.equal(buildAdjustmentExternalId(args));
  });

  it('is distinct from any payable externalId (different separator depth)', () => {
    // Adjustment IDs have 1 `::`, payable IDs have 3. The shapes can
    // never collide so re-submission of the same adjustment can never
    // accidentally appear as a same-id payable on Everee's side.
    const adj = buildAdjustmentExternalId({ tenantId: 't', adjustmentId: 'foo' });
    const pay = buildPayableExternalId({
      tenantId: 't',
      assignmentId: 'foo',
      workDate: '2026-05-18',
      kind: 'TIPS',
    });
    expect(adj.split('::').length).to.equal(2);
    expect(pay.split('::').length).to.equal(4);
    expect(adj).to.not.equal(pay);
  });
});
