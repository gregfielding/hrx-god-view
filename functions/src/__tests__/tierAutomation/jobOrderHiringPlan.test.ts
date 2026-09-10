/**
 * Job-order hiring plan (2026-09-10) — pure selection rules. No Firestore.
 */
import { expect } from 'chai';

import {
  computeHiringPlanTargets,
  normalizeHiringPlan,
  selectHiringPlanActions,
} from '../../tierAutomation/jobOrderHiringPlan';
import type { HiringPlanCandidate } from '../../tierAutomation/jobOrderHiringPlan';

const plan = (over: Record<string, unknown> = {}) =>
  normalizeHiringPlan({
    enabled: true,
    workersNeeded: 10,
    backupWorkers: 5,
    poolMultiplier: 2,
    tier2Intensity: 'aggressive',
    ...over,
  });

let seq = 0;
const cand = (over: Partial<HiringPlanCandidate> = {}): HiringPlanCandidate => {
  seq++;
  return {
    userId: `u${seq}`,
    applicationId: `a${seq}`,
    tier: 2,
    score: 50,
    appliedAtMs: seq,
    employed: false,
    screeningDone: false,
    blocked: false,
    ...over,
  };
};
const many = (n: number, over: Partial<HiringPlanCandidate> = {}) =>
  Array.from({ length: n }, () => cand(over));

describe('jobOrderHiringPlan — targets and normalization', () => {
  it('max hires is (needed + backups) × multiplier: 10 + 5 at 2× is 30', () => {
    expect(computeHiringPlanTargets(plan())).to.deep.equal({ poolTarget: 15, maxHires: 30 });
  });

  it('rounds fractional maxes up', () => {
    expect(computeHiringPlanTargets(plan({ workersNeeded: 7, backupWorkers: 0, poolMultiplier: 1.5 })).maxHires).to.equal(11);
  });

  it('normalizes missing and junk values to a disabled, Tier-1-only plan', () => {
    expect(normalizeHiringPlan(undefined)).to.deep.equal({
      enabled: false,
      workersNeeded: 0,
      backupWorkers: 0,
      poolMultiplier: 1,
      tier2Intensity: 'none',
    });
    const n = normalizeHiringPlan({ enabled: 'yes', workersNeeded: '12', backupWorkers: -3, poolMultiplier: 0.5, tier2Intensity: 'toString' });
    expect(n).to.deep.equal({ enabled: false, workersNeeded: 12, backupWorkers: 0, poolMultiplier: 1, tier2Intensity: 'none' });
    expect(normalizeHiringPlan({ poolMultiplier: 50 }).poolMultiplier).to.equal(10);
  });
});

describe('jobOrderHiringPlan — selectHiringPlanActions', () => {
  it('does nothing when the plan is disabled', () => {
    const s = selectHiringPlanActions(plan({ enabled: false }), [cand({ tier: 1 }), cand()]);
    expect(s.actions).to.have.length(0);
  });

  it('always onboards Tier 1, even past the max', () => {
    const s = selectHiringPlanActions(plan({ workersNeeded: 1, backupWorkers: 0, poolMultiplier: 1 }), many(3, { tier: 1 }));
    expect(s.maxHires).to.equal(1);
    expect(s.actions.map((a) => a.kind)).to.deep.equal(['onboard_and_screen', 'onboard_and_screen', 'onboard_and_screen']);
    expect(s.projectedPool).to.equal(3);
  });

  it('skips Tier 1 already onboarded and screened, and screens Tier 1 onboarded without screening', () => {
    const done = cand({ tier: 1, employed: true, screeningDone: true });
    const unscreened = cand({ tier: 1, employed: true, screeningDone: false });
    const s = selectHiringPlanActions(plan(), [done, unscreened]);
    expect(s.actions).to.deep.equal([
      { userId: unscreened.userId, applicationId: unscreened.applicationId, tier: 1, kind: 'screen_only' },
    ]);
    expect(s.alreadyHired).to.equal(2);
  });

  it('never selects Tier 3', () => {
    const s = selectHiringPlanActions(plan(), many(4, { tier: 3, score: 99 }));
    expect(s.actions).to.have.length(0);
    expect(s.tier3).to.equal(4);
  });

  it('applies the Tier 2 intensity share of the Tier 2 applicants', () => {
    expect(selectHiringPlanActions(plan({ tier2Intensity: 'selective' }), many(8)).actions).to.have.length(2);
    expect(selectHiringPlanActions(plan({ tier2Intensity: 'moderate' }), many(5)).actions).to.have.length(3);
    expect(selectHiringPlanActions(plan({ tier2Intensity: 'aggressive' }), many(5)).actions).to.have.length(5);
    expect(selectHiringPlanActions(plan({ tier2Intensity: 'none' }), many(5)).actions).to.have.length(0);
  });

  it('ranks Tier 2 by score, earliest applicant breaking ties', () => {
    const low = cand({ score: 40 });
    const midLate = cand({ score: 60, appliedAtMs: 500 });
    const topLate = cand({ score: 80, appliedAtMs: 300 });
    const topEarly = cand({ score: 80, appliedAtMs: 100 });
    const s = selectHiringPlanActions(plan({ workersNeeded: 2, backupWorkers: 0, poolMultiplier: 1 }), [low, midLate, topLate, topEarly]);
    expect(s.actions.map((a) => a.userId)).to.deep.equal([topEarly.userId, topLate.userId]);
  });

  it('keeps hiring until the max: 10 + 5 at 2× with 40 Tier 2 applicants hires 30', () => {
    const s = selectHiringPlanActions(plan(), many(40));
    expect(s.actions).to.have.length(30);
    expect(s.projectedPool).to.equal(30);
  });

  it('counts already-hired Tier 2 applicants first and hires only the remainder', () => {
    const hired = many(2, { employed: true, screeningDone: true, score: 10 });
    const fresh = many(5, { score: 90 });
    const s = selectHiringPlanActions(plan({ workersNeeded: 4, backupWorkers: 0, poolMultiplier: 1 }), [...fresh, ...hired]);
    expect(s.alreadyHired).to.equal(2);
    expect(s.actions).to.have.length(2);
    expect(s.actions.every((a) => a.kind === 'onboard_and_screen')).to.equal(true);
    expect(s.projectedPool).to.equal(4);
  });

  it('Tier 1 uses up the max before Tier 2', () => {
    const s = selectHiringPlanActions(plan({ workersNeeded: 3, backupWorkers: 0, poolMultiplier: 1 }), [
      ...many(5, { score: 95 }),
      ...many(2, { tier: 1, score: 10 }),
    ]);
    expect(s.actions.map((a) => a.tier)).to.deep.equal([1, 1, 2]);
  });

  it('blocked applicants do not use a slot', () => {
    const blocked = cand({ score: 99, blocked: true });
    const next = many(3, { score: 50 });
    const s = selectHiringPlanActions(plan({ workersNeeded: 2, backupWorkers: 0, poolMultiplier: 1 }), [blocked, ...next]);
    expect(s.actions.map((a) => a.userId)).to.deep.equal([next[0].userId, next[1].userId]);
    expect(s.blockedSkipped).to.equal(1);
  });

  it('a hired applicant whose screening is blocked still counts toward the pool', () => {
    const paused = cand({ tier: 1, employed: true, screeningDone: false, blocked: true });
    const s = selectHiringPlanActions(plan({ workersNeeded: 1, backupWorkers: 0, poolMultiplier: 1 }), [paused, cand()]);
    expect(s.actions).to.have.length(0);
    expect(s.projectedPool).to.equal(1);
  });
});
