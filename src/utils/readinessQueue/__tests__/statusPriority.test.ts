/**
 * Workforce queue sort + filter logic tests. Locks the product-defined
 * ordering (Phase D spec §3) and the filter chip → raw status expansion so
 * a future refactor of the priority table can't silently flip the queue.
 */

import {
  ACTIVE_WORKFORCE_STATUSES,
  COMPLETE_WORKFORCE_STATUSES,
  DEFAULT_WORKFORCE_STATUS_FILTERS,
  compareReadinessRowsForQueue,
  expandStatusFilters,
  statusPriority,
} from '../statusPriority';

import type { WorkforceItemStatus } from '../statusPriority';

describe('statusPriority', () => {
  it('orders the action-urgency tiers exactly as the spec calls for', () => {
    // Spec §3 sort priority: needs_review > complete_fail > expired > blocked
    // > incomplete > in_progress > complete_pass > not_applicable.
    const expected: WorkforceItemStatus[] = [
      'needs_review',
      'complete_fail',
      'expired',
      'blocked',
      'incomplete',
      'in_progress',
      'complete_pass',
      'not_applicable',
    ];
    const actual = [...expected].sort((a, b) => statusPriority(a) - statusPriority(b));
    expect(actual).toEqual(expected);
  });

  it('treats legacy `complete` identically to `complete_pass`', () => {
    expect(statusPriority('complete')).toBe(statusPriority('complete_pass'));
  });
});

describe('compareReadinessRowsForQueue', () => {
  it('puts higher-priority status first regardless of timestamp', () => {
    const failedOld = { id: 'a', status: 'complete_fail' as const, updatedAtMs: 1 };
    const incompleteNew = { id: 'b', status: 'incomplete' as const, updatedAtMs: 9_999_999 };
    const sorted = [incompleteNew, failedOld].sort(compareReadinessRowsForQueue);
    expect(sorted.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('within a status, sorts by updatedAt desc (newest first)', () => {
    const older = { id: 'older', status: 'needs_review' as const, updatedAtMs: 100 };
    const newer = { id: 'newer', status: 'needs_review' as const, updatedAtMs: 200 };
    const sorted = [older, newer].sort(compareReadinessRowsForQueue);
    expect(sorted.map((r) => r.id)).toEqual(['newer', 'older']);
  });

  it('falls back to a stable id-based tiebreaker on identical timestamps', () => {
    const a = { id: 'aaa', status: 'incomplete' as const, updatedAtMs: 500 };
    const b = { id: 'bbb', status: 'incomplete' as const, updatedAtMs: 500 };
    expect([b, a].sort(compareReadinessRowsForQueue).map((r) => r.id)).toEqual(['aaa', 'bbb']);
  });
});

describe('expandStatusFilters', () => {
  it('expands the `incomplete` chip to incomplete + in_progress + blocked', () => {
    const expanded = expandStatusFilters(['incomplete']);
    expect(expanded.has('incomplete')).toBe(true);
    expect(expanded.has('in_progress')).toBe(true);
    expect(expanded.has('blocked')).toBe(true);
  });

  it('expands the `complete` chip to complete_pass + legacy complete', () => {
    const expanded = expandStatusFilters(['complete']);
    expect(expanded.has('complete_pass')).toBe(true);
    expect(expanded.has('complete')).toBe(true);
  });

  it('returns the union when multiple chips are selected', () => {
    const expanded = expandStatusFilters(['needs_review', 'failed']);
    expect(expanded.has('needs_review')).toBe(true);
    expect(expanded.has('complete_fail')).toBe(true);
    // Should not bleed into other chips' statuses.
    expect(expanded.has('incomplete')).toBe(false);
    expect(expanded.has('complete_pass')).toBe(false);
  });

  it('returns empty when given an empty selection (caller treats as universe)', () => {
    expect(expandStatusFilters([]).size).toBe(0);
  });
});

describe('default filter set + status universe', () => {
  it('default filters target the highest-urgency action surface', () => {
    expect([...DEFAULT_WORKFORCE_STATUS_FILTERS].sort()).toEqual(['failed', 'needs_review']);
  });

  it('active and complete sets are disjoint', () => {
    const active = new Set(ACTIVE_WORKFORCE_STATUSES);
    for (const c of COMPLETE_WORKFORCE_STATUSES) {
      expect(active.has(c)).toBe(false);
    }
  });
});
