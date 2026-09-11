/**
 * C1 Events entity-wide auto-hire (2026-09-11) — pure decision rules.
 */
import { expect } from 'chai';

import {
  APPLY_RECENCY_MS,
  EVENTS_AUTO_HIRE_ENTITY_ID,
  applicationAppliedAtMs,
  evaluateEventsAutoHire,
  eventsRuleOwnsApplication,
} from '../../recruiter/eventsEntityAutoHire';

const NOW = Date.parse('2026-09-11T20:00:00Z');
const base = {
  enabled: true,
  entityId: EVENTS_AUTO_HIRE_ENTITY_ID,
  userId: 'u1',
  status: 'submitted',
  signal: 'created' as const,
  appliedAtMs: NOW - 60_000,
  nowMs: NOW,
  groupWillHire: false,
  hasEventsEmployment: false,
};
const reason = (over: Partial<typeof base> | Record<string, unknown>) => {
  const d = evaluateEventsAutoHire({ ...base, ...over } as typeof base);
  return d.hire ? 'hire' : d.reason;
};

describe('eventsEntityAutoHire — evaluateEventsAutoHire', () => {
  it('hires a fresh C1 Events applicant with no employment and no hiring group', () => {
    expect(reason({})).to.equal('hire');
  });

  it('the kill switch stops everything', () => {
    expect(reason({ enabled: false })).to.equal('kill_switch_off');
  });

  it('only C1 Events postings hire', () => {
    expect(reason({ entityId: 'c1_select_llc' })).to.equal('not_events');
    expect(reason({ entityId: '' })).to.equal('not_events');
  });

  it('terminal and draft statuses never hire', () => {
    for (const status of ['rejected', 'withdrawn', 'in_progress', '']) expect(reason({ status })).to.equal('status_not_live');
    for (const status of ['submitted', 'accepted', 'confirmed', 'waitlisted']) expect(reason({ status })).to.equal('hire');
  });

  it('a created application older than the recency window never hires (imports, historical writes)', () => {
    expect(reason({ appliedAtMs: NOW - APPLY_RECENCY_MS - 1 })).to.equal('stale_application');
    expect(reason({ appliedAtMs: NOW - APPLY_RECENCY_MS + 1000 })).to.equal('hire');
  });

  it('an undated doc hires only when a draft left in_progress (the apply moment), never when created', () => {
    expect(reason({ appliedAtMs: null, signal: 'created' })).to.equal('stale_application');
    expect(reason({ appliedAtMs: null, signal: 'left_in_progress' })).to.equal('hire');
  });

  it('a draft started days ago and submitted now hires (appliedAt dates the draft start)', () => {
    expect(reason({ appliedAtMs: NOW - 3 * 86400e3, signal: 'left_in_progress' })).to.equal('hire');
  });

  it('an application whose group still hires everyone at C1 Events stays with group hiring', () => {
    expect(reason({ groupWillHire: true })).to.equal('group_hires');
    expect(reason({ groupWillHire: true, signal: 'other' })).to.equal('group_hires');
  });

  it('prescreen / orchestrator signals never hire', () => {
    expect(reason({ signal: 'other' })).to.equal('not_apply_moment');
  });

  it('owns C1 Events applications without a hiring group; hands the rest back to group hiring', () => {
    const own = (over: Record<string, unknown>) => eventsRuleOwnsApplication(evaluateEventsAutoHire({ ...base, ...over } as typeof base));
    expect(own({})).to.equal(true);
    expect(own({ signal: 'other' })).to.equal(true);
    expect(own({ hasEventsEmployment: true })).to.equal(true);
    expect(own({ status: 'withdrawn' })).to.equal(true);
    expect(own({ entityId: 'c1_select_llc' })).to.equal(false);
    expect(own({ enabled: false })).to.equal(false);
    expect(own({ groupWillHire: true })).to.equal(false);
  });

  it('any existing C1 Events employment (including ended) is skipped', () => {
    expect(reason({ hasEventsEmployment: true })).to.equal('already_employed');
  });
});

describe('eventsEntityAutoHire — applicationAppliedAtMs', () => {
  it('prefers appliedAt, then submittedAt, then createdAt; reads Timestamp-like, seconds, Date, ISO', () => {
    expect(applicationAppliedAtMs({ appliedAt: { toMillis: () => 5 }, submittedAt: { toMillis: () => 9 } })).to.equal(5);
    expect(applicationAppliedAtMs({ submittedAt: { seconds: 2 } })).to.equal(2000);
    expect(applicationAppliedAtMs({ createdAt: new Date(7) })).to.equal(7);
    expect(applicationAppliedAtMs({ createdAt: '2026-09-11T20:00:00Z' })).to.equal(NOW);
    expect(applicationAppliedAtMs({})).to.equal(null);
  });
});
