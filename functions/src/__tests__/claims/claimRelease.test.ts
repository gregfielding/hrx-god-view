/**
 * Claim release planner (2026-09-06) — what a cancelled claim does to the
 * linked application. Pure.
 */
import { expect } from 'chai';
import { planClaimRelease } from '../../claims/claimRelease';

describe('planClaimRelease', () => {
  it('no linked application → nothing to do', () => {
    expect(planClaimRelease({ application: null, shiftId: 's1', dayKey: '2026-09-28' })).to.deep.equal({
      action: 'none',
      reason: 'no_application',
    });
  });

  it('application the claim created → delete (worker never applied to the JO)', () => {
    expect(
      planClaimRelease({
        application: { source: 'claim', status: 'accepted', shiftId: 's1', applyDate: '2026-09-28' },
        shiftId: 's1',
        dayKey: '2026-09-28',
      }),
    ).to.deep.equal({ action: 'delete', reason: 'created_by_claim' });
  });

  it("legacy claim-created doc (source 'manual' + workerClaimConfirmation, nothing else) → delete", () => {
    expect(
      planClaimRelease({
        application: { source: 'manual', workerClaimConfirmation: { assignmentId: 'a' }, shiftId: 's1', shiftIds: ['s1'] },
        shiftId: 's1',
        dayKey: '2026-09-28',
      }),
    ).to.deep.equal({ action: 'delete', reason: 'only_this_claim' });
  });

  it('pre-existing multi-day application → drop just this day, keep the others', () => {
    expect(
      planClaimRelease({
        application: { source: 'jobs_board', status: 'submitted', shiftId: 's1', applyDates: ['2026-09-27', '2026-09-28'], applyDate: '2026-09-27' },
        shiftId: 's1',
        dayKey: '2026-09-28',
      }),
    ).to.deep.equal({
      action: 'update',
      patch: { applyDates: ['2026-09-27'], applyDate: '2026-09-27' },
      reason: 'other_days_remain',
    });
  });

  it('pre-existing application on other shifts → drop this shift, keep the rest', () => {
    const plan = planClaimRelease({
      application: { source: 'jobs_board', status: 'submitted', shiftIds: ['s1', 's2'] },
      shiftId: 's1',
      dayKey: '2026-09-28',
    });
    expect(plan.action).to.equal('update');
    if (plan.action === 'update') {
      expect(plan.patch.shiftIds).to.deep.equal(['s2']);
      expect(plan.patch.shiftId).to.equal('s2');
      expect(plan.reason).to.equal('other_shifts_remain');
    }
  });

  it('pre-existing application with nothing left after this claim → withdrawn, never a live request', () => {
    expect(
      planClaimRelease({
        application: { source: 'jobs_board', status: 'submitted', shiftId: 's1', applyDate: '2026-09-28' },
        shiftId: 's1',
        dayKey: '2026-09-28',
      }),
    ).to.deep.equal({
      action: 'update',
      patch: { status: 'withdrawn', applyDates: [], applyDate: null },
      reason: 'nothing_left',
    });
  });
});
