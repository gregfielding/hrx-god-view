/**
 * Claim Shift policy (2026-09-06) — pure rules behind the worker-initiated
 * claim endpoint. No Firestore.
 */
import { expect } from 'chai';
import { HttpsError } from 'firebase-functions/v2/https';

import {
  CLAIM_TIER_WINDOWS_ENABLED,
  CLAIM_UNPROVEN_CONCURRENT_CAP,
  SELF_SERVE_HIRE_ENTITY_IDS,
  allAcknowledged,
  assignmentOccupiesDay,
  claimError,
  computeShiftAssignmentsTarget,
  evaluateClaimReadiness,
  isPayrollReadyForClaim,
  countsTowardCapacity,
  evaluateClaimCap,
  evaluateClaimTierWindow,
  isJobOrderClaimable,
  isPostingClaimable,
  isShiftClaimable,
  normalizeClaimAcknowledgements,
  resolvePostingPublishedAtMs,
  resolveShiftDay,
  resolveWorkerTier,
} from '../../claims/claimShiftPolicy';

describe('claimShiftPolicy — typed errors', () => {
  it('claimError is a failed-precondition HttpsError carrying the code in details', () => {
    const err = claimError('shift_filled', 'This shift just filled up.', { remaining: 0 });
    expect(err).to.be.instanceOf(HttpsError);
    expect(err.code).to.equal('failed-precondition');
    expect(err.details).to.deep.equal({ code: 'shift_filled', remaining: 0 });
  });
});

describe('claimShiftPolicy — tier', () => {
  it('resolves workerTiers.global; absent/malformed = Tier 3', () => {
    expect(resolveWorkerTier({ workerTiers: { global: 1 } })).to.equal(1);
    expect(resolveWorkerTier({ workerTiers: { global: '2' } })).to.equal(2);
    expect(resolveWorkerTier({ workerTiers: { global: 7 } })).to.equal(3);
    expect(resolveWorkerTier({})).to.equal(3);
    expect(resolveWorkerTier(null)).to.equal(3);
  });

  it('release windows are OFF for v1 (everyone is one tier)', () => {
    expect(CLAIM_TIER_WINDOWS_ENABLED).to.equal(false);
    const published = Date.UTC(2026, 8, 10, 12);
    const out = evaluateClaimTierWindow({ tier: 3, publishedAtMs: published, nowMs: published + 1000 });
    expect(out).to.deep.equal({ locked: false, opensAtMs: null });
  });

  it('when enabled: T+0 / +10h / +24h from publish, and no clock means open', () => {
    const published = Date.UTC(2026, 8, 10, 12);
    const at = (h: number) => published + h * 3600 * 1000;
    expect(evaluateClaimTierWindow({ tier: 1, publishedAtMs: published, nowMs: at(0), enabled: true }).locked).to.equal(false);
    const t2 = evaluateClaimTierWindow({ tier: 2, publishedAtMs: published, nowMs: at(9), enabled: true });
    expect(t2.locked).to.equal(true);
    expect(t2.opensAtMs).to.equal(at(10));
    expect(evaluateClaimTierWindow({ tier: 2, publishedAtMs: published, nowMs: at(10), enabled: true }).locked).to.equal(false);
    expect(evaluateClaimTierWindow({ tier: 3, publishedAtMs: published, nowMs: at(23.9), enabled: true }).locked).to.equal(true);
    expect(evaluateClaimTierWindow({ tier: 3, publishedAtMs: published, nowMs: at(24), enabled: true }).locked).to.equal(false);
    expect(evaluateClaimTierWindow({ tier: 3, publishedAtMs: null, nowMs: at(0), enabled: true }).locked).to.equal(false);
  });

  it('unproven workers hold at most the cap; one completed shift lifts it', () => {
    expect(CLAIM_UNPROVEN_CONCURRENT_CAP).to.equal(2);
    expect(evaluateClaimCap({ hasCompletedShift: false, liveClaimedCount: 1 }).blocked).to.equal(false);
    expect(evaluateClaimCap({ hasCompletedShift: false, liveClaimedCount: 2 }).blocked).to.equal(true);
    expect(evaluateClaimCap({ hasCompletedShift: true, liveClaimedCount: 9 }).blocked).to.equal(false);
    expect(evaluateClaimCap({ hasCompletedShift: false, liveClaimedCount: 3, cap: 5 }).blocked).to.equal(false);
  });
});

describe('claimShiftPolicy — what can be claimed', () => {
  it('posting must opt in (claimShiftEnabled) AND be active', () => {
    expect(isPostingClaimable({ claimShiftEnabled: true, status: 'active' })).to.equal(true);
    expect(isPostingClaimable({ claimShiftEnabled: true, status: 'paused' })).to.equal(false);
    expect(isPostingClaimable({ status: 'active' })).to.equal(false);
    expect(isPostingClaimable({ claimShiftEnabled: 'true', status: 'active' })).to.equal(false);
    expect(isPostingClaimable(null)).to.equal(false);
  });

  it('job order must be a gig that is not paused/closed', () => {
    expect(isJobOrderClaimable({ jobType: 'gig', status: 'open' })).to.deep.equal({ ok: true });
    expect(isJobOrderClaimable({ jobType: 'gig' })).to.deep.equal({ ok: true });
    expect(isJobOrderClaimable({ jobType: 'career', status: 'open' })).to.deep.equal({ ok: false, reason: 'not_gig' });
    expect(isJobOrderClaimable({ jobType: 'gig', status: 'On Hold' })).to.deep.equal({ ok: false, reason: 'job_order_on_hold' });
    expect(isJobOrderClaimable({ jobType: 'gig', status: 'cancelled' }).ok).to.equal(false);
    expect(isJobOrderClaimable({ jobType: 'gig', status: 'filled' }).ok).to.equal(true); // capacity decides
  });

  it('shift must not be cancelled/closed and never an open (standing-crew) shift', () => {
    expect(isShiftClaimable({ status: 'open' })).to.deep.equal({ ok: true });
    expect(isShiftClaimable({ status: 'filled' })).to.deep.equal({ ok: true });
    expect(isShiftClaimable({ status: 'cancelled' })).to.deep.equal({ ok: false, reason: 'shift_cancelled' });
    expect(isShiftClaimable({ shiftType: 'open' })).to.deep.equal({ ok: false, reason: 'open_shift' });
  });
});

describe('claimShiftPolicy — day resolution + capacity', () => {
  const singleDay = {
    shiftDate: '2026-09-12',
    startTime: '17:00',
    endTime: '01:00',
    totalStaffRequested: 3,
  };
  const multiDay = {
    shiftDate: '2026-09-12',
    endDate: '2026-09-14',
    startTime: '09:00',
    endTime: '17:00',
    totalStaffRequested: 5,
    dateSchedule: {
      '2026-09-12': { startTime: '09:00', endTime: '17:00', workersNeeded: 2 },
      '2026-09-13': { startTime: '10:00', endTime: '16:00', workersNeeded: 4, overstaff: 1 },
      '2026-09-14': { startTime: '', endTime: '' },
    },
  };

  it('single-day shift: the shift date is the day, its times + total headcount apply', () => {
    const d = resolveShiftDay(singleDay, null);
    expect(d).to.deep.equal({
      ok: true,
      dayKey: '2026-09-12',
      startTime: '17:00',
      endTime: '01:00',
      capacity: 3,
      multiDay: false,
    });
    expect(resolveShiftDay(singleDay, '2026-09-12').ok).to.equal(true);
    expect(resolveShiftDay(singleDay, '2026-09-13')).to.deep.equal({ ok: false, reason: 'invalid_date' });
    expect(resolveShiftDay({ shiftDate: '2026-09-12' }, null)).to.deep.equal({ ok: false, reason: 'no_times' });
  });

  it('multi-day gig: claim one day; per-day hours and workersNeeded (+overstaff) win', () => {
    expect(resolveShiftDay(multiDay, null)).to.deep.equal({ ok: false, reason: 'date_required' });
    const sat = resolveShiftDay(multiDay, '2026-09-13');
    expect(sat).to.deep.equal({
      ok: true,
      dayKey: '2026-09-13',
      startTime: '10:00',
      endTime: '16:00',
      capacity: 5,
      multiDay: true,
    });
    // A dateSchedule day with no hours is not claimable.
    expect(resolveShiftDay(multiDay, '2026-09-14')).to.deep.equal({ ok: false, reason: 'invalid_date' });
    expect(resolveShiftDay(multiDay, '2026-09-20')).to.deep.equal({ ok: false, reason: 'invalid_date' });
  });

  it('multi-day day without its own workersNeeded falls back to the shift target', () => {
    const shift = {
      ...multiDay,
      dateSchedule: { '2026-09-12': { startTime: '09:00', endTime: '17:00' }, '2026-09-13': { startTime: '09:00', endTime: '17:00' } },
    };
    const d = resolveShiftDay(shift, '2026-09-12');
    expect(d.ok && d.capacity).to.equal(5);
  });

  it('assignments target mirrors shiftFillAutomation (overstaff count/percent)', () => {
    expect(computeShiftAssignmentsTarget({ totalStaffRequested: 4 })).to.equal(4);
    expect(computeShiftAssignmentsTarget({ totalStaffRequested: 4, overstaffCount: 2 })).to.equal(6);
    expect(computeShiftAssignmentsTarget({ totalStaffRequested: 10, overstaffPercent: 25 })).to.equal(13);
    expect(computeShiftAssignmentsTarget({})).to.equal(1);
  });

  it('live statuses count toward capacity; terminal ones do not', () => {
    for (const s of ['pending', 'proposed', 'confirmed', 'active', 'in_progress', 'Confirmed ']) {
      expect(countsTowardCapacity(s), s).to.equal(true);
    }
    for (const s of ['completed', 'cancelled', 'worker-cancelled', 'declined', '', undefined]) {
      expect(countsTowardCapacity(s), String(s)).to.equal(false);
    }
  });

  it('assignmentOccupiesDay: day-scoped docs by startDate, legacy no-date docs only on the single-day date', () => {
    expect(assignmentOccupiesDay({ startDate: '2026-09-13' }, '2026-09-13', '')).to.equal(true);
    expect(assignmentOccupiesDay({ startDate: '2026-09-12T00:00:00' }, '2026-09-13', '')).to.equal(false);
    expect(assignmentOccupiesDay({}, '2026-09-12', '2026-09-12')).to.equal(true);
    expect(assignmentOccupiesDay({}, '2026-09-12', '')).to.equal(false);
  });
});

describe('claimShiftPolicy — acknowledgements + publish clock', () => {
  it('accepts web, app, and short ack keys; all four required', () => {
    const fromApp = normalizeClaimAcknowledgements({
      uniformPpeCommitment: true,
      transportCommitment: true,
      arrivalCommitment: true,
      attendancePolicyAcknowledged: true,
    });
    expect(allAcknowledged(fromApp)).to.equal(true);
    const fromWeb = normalizeClaimAcknowledgements({
      understandsUniformAndRequirements: true,
      transportation: true,
      onTimeArrival: true,
      understandsNoShowConsequence: true,
    });
    expect(allAcknowledged(fromWeb)).to.equal(true);
    const partial = normalizeClaimAcknowledgements({ uniform: true, arrival: true });
    expect(partial).to.deep.equal({ uniform: true, transportation: false, arrival: true, attendancePolicy: false });
    expect(allAcknowledged(partial)).to.equal(false);
    expect(normalizeClaimAcknowledgements('nope').uniform).to.equal(false);
  });

  it('publish clock prefers postedAt, then createdAt; Timestamp-like, Date, or ISO', () => {
    const ts = { toMillis: () => 1000 };
    expect(resolvePostingPublishedAtMs({ postedAt: ts, createdAt: new Date(5000) })).to.equal(1000);
    expect(resolvePostingPublishedAtMs({ createdAt: new Date(5000) })).to.equal(5000);
    expect(resolvePostingPublishedAtMs({ createdAt: '2026-09-10T12:00:00Z' })).to.equal(Date.UTC(2026, 8, 10, 12));
    expect(resolvePostingPublishedAtMs({})).to.equal(null);
  });
});

describe('claimShiftPolicy — payroll readiness (2026-09-11)', () => {
  const EVENTS = 'c1_events_llc';
  const SELECT = 'c1_select_llc';
  const ts = { seconds: 1 };

  it('C1 Events is the only self-serve hiring entity', () => {
    expect([...SELF_SERVE_HIRE_ENTITY_IDS]).to.deep.equal([EVENTS]);
  });

  it('an engine-active row is ready', () => {
    expect(isPayrollReadyForClaim([{ status: 'active', onboardingComplete: true }], null)).to.equal(true);
  });

  it('Everee-complete workers whose engine row still says onboarding are ready', () => {
    expect(
      isPayrollReadyForClaim(
        [{ status: 'onboarding', onboardingComplete: false, payrollStatus: 'in_progress', evereeOnboardingStatus: 'complete' }],
        null,
      ),
    ).to.equal(true);
    expect(isPayrollReadyForClaim([{ status: 'onboarding', payrollStatus: 'not_started', payrollOnboardingCompletedAt: ts }], null)).to.equal(true);
    expect(isPayrollReadyForClaim([{ status: 'onboarding', payrollStatus: 'in_progress' }], { status: 'onboarding_complete' })).to.equal(true);
    expect(isPayrollReadyForClaim([], { status: 'created', apiObservedOnboardingCompleteAt: ts })).to.equal(true);
  });

  it('a worker still in progress at Everee is not ready', () => {
    expect(isPayrollReadyForClaim([{ status: 'onboarding', payrollStatus: 'in_progress' }], { status: 'created' })).to.equal(false);
  });

  it('an ended employment never counts as ready', () => {
    expect(isPayrollReadyForClaim([{ status: 'terminated', payrollStatus: 'complete' }], null)).to.equal(false);
  });

  it('ready → ready', () => {
    expect(evaluateClaimReadiness({ entityId: EVENTS, employments: [{ status: 'active' }], link: null }).kind).to.equal('ready');
  });

  it('C1 Events with no employment → start onboarding (even with a stale link)', () => {
    expect(evaluateClaimReadiness({ entityId: EVENTS, employments: [], link: null }).kind).to.equal('start_onboarding');
    expect(evaluateClaimReadiness({ entityId: EVENTS, employments: [], link: { status: 'created' } }).kind).to.equal('start_onboarding');
  });

  it('C1 Select with no employment → not hired (apply instead)', () => {
    expect(evaluateClaimReadiness({ entityId: SELECT, employments: [], link: null }).kind).to.equal('not_hired');
  });

  it('hired but payroll unfinished → setup in progress, at any entity', () => {
    const employments = [{ status: 'onboarding', payrollStatus: 'in_progress' }];
    expect(evaluateClaimReadiness({ entityId: EVENTS, employments, link: { status: 'created' } }).kind).to.equal('setup_in_progress');
    expect(evaluateClaimReadiness({ entityId: SELECT, employments, link: null }).kind).to.equal('setup_in_progress');
  });

  it('only ended employments → employment ended, even when Everee says complete', () => {
    expect(
      evaluateClaimReadiness({ entityId: EVENTS, employments: [{ status: 'terminated' }], link: { status: 'onboarding_complete' } }).kind,
    ).to.equal('employment_ended');
  });

  it('a live row beside an ended one still counts', () => {
    expect(
      evaluateClaimReadiness({ entityId: EVENTS, employments: [{ status: 'inactive' }, { status: 'active' }], link: null }).kind,
    ).to.equal('ready');
  });

  it('setup_required carries the entity and stage in the error details', () => {
    const err = claimError('setup_required', 'Finish payroll setup.', { entityId: EVENTS, stage: 'started' });
    expect(err.details).to.deep.equal({ code: 'setup_required', entityId: EVENTS, stage: 'started' });
  });
});
