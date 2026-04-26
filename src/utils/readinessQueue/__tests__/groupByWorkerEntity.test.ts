/**
 * `groupByWorkerEntity` — Phase D.1.1a unit tests.
 *
 * Locks the per-worker × per-hiring-entity bucketing semantics so the
 * collapsed-row UI can rely on a stable contract. These tests are the
 * canary if a future schema change accidentally splits or merges groups
 * the wrong way.
 */

import {
  familyCounts,
  groupByWorkerEntity,
  statusFamily,
  type WorkerGroup,
} from '../groupByWorkerEntity';
import type { QueueRow } from '../queueRow';
import type { WorkerNameMap } from '../loadWorkerNames';

/**
 * Test fixture builder. Defaults match a typical "incomplete I-9 §1 owed
 * by the worker" so individual tests only override the fields they care
 * about.
 */
function makeRow(overrides: Partial<QueueRow> = {}): QueueRow {
  return {
    id: overrides.id ?? `row-${Math.random().toString(36).slice(2, 8)}`,
    kind: 'employee',
    tenantId: 't1',
    workerUid: 'w1',
    hiringEntityId: 'e1',
    hiringEntityName: 'Select LLC',
    requirementType: 'i9_section_1',
    requirementLabel: 'I-9 Section 1',
    status: 'incomplete',
    actor: 'worker',
    blocking: false,
    primaryRecruiterId: null,
    visibleRecruiterIds: [],
    primarySource: 'unassigned',
    history: [],
    createdAtMs: 1_700_000_000_000,
    updatedAtMs: 1_700_000_000_000,
    ...overrides,
  } as QueueRow;
}

describe('groupByWorkerEntity', () => {
  it('returns an empty array for empty input', () => {
    expect(groupByWorkerEntity([])).toEqual([]);
  });

  it('groups items by (workerUid, hiringEntityId)', () => {
    const rows: QueueRow[] = [
      makeRow({ id: 'a', workerUid: 'w1', hiringEntityId: 'e1' }),
      makeRow({ id: 'b', workerUid: 'w1', hiringEntityId: 'e1' }),
      makeRow({ id: 'c', workerUid: 'w1', hiringEntityId: 'e2' }),
      makeRow({ id: 'd', workerUid: 'w2', hiringEntityId: 'e1' }),
    ];
    const groups = groupByWorkerEntity(rows);
    // 3 distinct (worker, entity) pairs → 3 groups.
    expect(groups.length).toBe(3);
    const keys = groups.map((g) => g.key).sort();
    expect(keys).toEqual(['w1::e1', 'w1::e2', 'w2::e1']);
    const w1e1 = groups.find((g) => g.key === 'w1::e1') as WorkerGroup;
    expect(w1e1.items.map((i) => i.id).sort()).toEqual(['a', 'b']);
  });

  it('drops rows without a hiringEntityId (assignment-kind rows)', () => {
    const rows: QueueRow[] = [
      makeRow({ id: 'employee-row' }),
      // Simulating an assignment-kind row that was accidentally passed in.
      makeRow({
        id: 'assignment-row',
        kind: 'assignment',
        hiringEntityId: undefined,
        assignmentId: 'asg-1',
      }),
    ];
    const groups = groupByWorkerEntity(rows);
    expect(groups.length).toBe(1);
    expect(groups[0].items[0].id).toBe('employee-row');
  });

  it('sorts items inside a group by urgency, then updatedAt desc', () => {
    const rows: QueueRow[] = [
      makeRow({
        id: 'old-needs-review',
        status: 'needs_review',
        updatedAtMs: 1_000,
      }),
      makeRow({
        id: 'recent-incomplete',
        status: 'incomplete',
        updatedAtMs: 9_000,
      }),
      makeRow({
        id: 'recent-needs-review',
        status: 'needs_review',
        updatedAtMs: 5_000,
      }),
      makeRow({
        id: 'old-complete-pass',
        status: 'complete_pass',
        updatedAtMs: 8_000,
      }),
    ];
    const [group] = groupByWorkerEntity(rows);
    expect(group.items.map((i) => i.id)).toEqual([
      // Both needs_review come first; within tier, more-recent wins.
      'recent-needs-review',
      'old-needs-review',
      'recent-incomplete',
      'old-complete-pass',
    ]);
  });

  it('sorts groups by lastUpdatedAtMs desc, then workerName asc', () => {
    const rows: QueueRow[] = [
      // Group "Carol@e1" — oldest activity.
      makeRow({
        workerUid: 'w-carol',
        workerName: 'Carol',
        hiringEntityId: 'e1',
        updatedAtMs: 1_000,
      }),
      // Group "Alice@e1" — most recent activity → should sort first.
      makeRow({
        workerUid: 'w-alice',
        workerName: 'Alice',
        hiringEntityId: 'e1',
        updatedAtMs: 9_000,
      }),
      // Group "Bob@e1" — ties with Alice; alphabetical tiebreak puts Alice first.
      makeRow({
        workerUid: 'w-bob',
        workerName: 'Bob',
        hiringEntityId: 'e1',
        updatedAtMs: 9_000,
      }),
    ];
    const groups = groupByWorkerEntity(rows);
    expect(groups.map((g) => g.workerName)).toEqual(['Alice', 'Bob', 'Carol']);
  });

  it('counts statuses by raw value (does not collapse families pre-counting)', () => {
    const rows: QueueRow[] = [
      makeRow({ status: 'needs_review' }),
      makeRow({ status: 'needs_review' }),
      makeRow({ status: 'complete_fail' }),
      makeRow({ status: 'expired' }),
      makeRow({ status: 'incomplete' }),
      makeRow({ status: 'incomplete' }),
      makeRow({ status: 'incomplete' }),
      makeRow({ status: 'in_progress' }),
      makeRow({ status: 'complete_pass' }),
      makeRow({ status: 'not_applicable' }),
    ];
    const [group] = groupByWorkerEntity(rows);
    expect(group.counts).toEqual({
      needs_review: 2,
      complete_fail: 1,
      expired: 1,
      blocked: 0,
      incomplete: 3,
      in_progress: 1,
      complete_pass: 1,
      complete: 0,
      not_applicable: 1,
    });
    expect(group.totalItems).toBe(10);
  });

  it('counts blocking items only when the item is still actually blocking', () => {
    const rows: QueueRow[] = [
      makeRow({ status: 'incomplete', blocking: true }),
      makeRow({ status: 'needs_review', blocking: true }),
      // Blocking flag left stale on a passed item — must NOT count.
      makeRow({ status: 'complete_pass', blocking: true }),
      // Same for not_applicable.
      makeRow({ status: 'not_applicable', blocking: true }),
      // Non-blocking item — never counts.
      makeRow({ status: 'incomplete', blocking: false }),
    ];
    const [group] = groupByWorkerEntity(rows);
    expect(group.blockingCount).toBe(2);
  });

  it('lastUpdatedAtMs is the max across the group', () => {
    const rows: QueueRow[] = [
      makeRow({ updatedAtMs: 1_000 }),
      makeRow({ updatedAtMs: 5_000 }),
      makeRow({ updatedAtMs: 3_000 }),
    ];
    const [group] = groupByWorkerEntity(rows);
    expect(group.lastUpdatedAtMs).toBe(5_000);
  });

  it('owner is taken from the most-urgent item, not the first by id', () => {
    const rows: QueueRow[] = [
      // Less urgent but earlier in input.
      makeRow({
        id: 'a',
        status: 'incomplete',
        primaryRecruiterId: 'csa-low-urgency',
      }),
      // More urgent — owner here should win.
      makeRow({
        id: 'b',
        status: 'needs_review',
        primaryRecruiterId: 'csa-most-urgent',
      }),
    ];
    const [group] = groupByWorkerEntity(rows);
    expect(group.primaryRecruiterId).toBe('csa-most-urgent');
  });

  it('uses nameMap when provided, falls back to row workerName, then to uid', () => {
    const rows: QueueRow[] = [
      makeRow({ workerUid: 'with-namemap', workerName: undefined }),
      makeRow({ workerUid: 'no-namemap-with-rowname', workerName: 'Row Fallback' }),
      makeRow({ workerUid: 'no-namemap-no-rowname', workerName: undefined }),
    ];
    const nameMap: WorkerNameMap = new Map([
      ['with-namemap', { name: 'NameMap Wins', avatar: 'avatar-url' }],
    ]);
    const groups = groupByWorkerEntity(rows, nameMap);
    const byUid = new Map(groups.map((g) => [g.workerUid, g]));
    expect(byUid.get('with-namemap')?.workerName).toBe('NameMap Wins');
    expect(byUid.get('with-namemap')?.workerAvatar).toBe('avatar-url');
    expect(byUid.get('no-namemap-with-rowname')?.workerName).toBe('Row Fallback');
    // No name available anywhere → fall back to uid so the row still renders.
    expect(byUid.get('no-namemap-no-rowname')?.workerName).toBe('no-namemap-no-rowname');
  });

  it('groups remain stable when called twice with the same input', () => {
    const rows: QueueRow[] = [
      makeRow({ workerUid: 'w1', updatedAtMs: 5_000 }),
      makeRow({ workerUid: 'w1', updatedAtMs: 6_000 }),
      makeRow({ workerUid: 'w2', updatedAtMs: 7_000 }),
    ];
    const a = groupByWorkerEntity(rows);
    const b = groupByWorkerEntity(rows);
    // Use JSON to compare; references differ across calls (intentional —
    // grouper is pure but allocates fresh arrays).
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });
});

describe('statusFamily', () => {
  it('maps every QueueRow status to a stable family', () => {
    expect(statusFamily('needs_review')).toBe('needs_review');
    expect(statusFamily('complete_fail')).toBe('needs_review');
    expect(statusFamily('expired')).toBe('expired');
    expect(statusFamily('blocked')).toBe('incomplete');
    expect(statusFamily('incomplete')).toBe('incomplete');
    expect(statusFamily('in_progress')).toBe('in_progress');
    expect(statusFamily('complete_pass')).toBe('complete');
    expect(statusFamily('complete')).toBe('complete');
    expect(statusFamily('not_applicable')).toBe('not_applicable');
  });
});

describe('familyCounts', () => {
  it('rolls raw counts into family aggregates correctly', () => {
    const result = familyCounts({
      needs_review: 2,
      complete_fail: 1,
      expired: 1,
      blocked: 1,
      incomplete: 3,
      in_progress: 2,
      complete_pass: 4,
      complete: 1,
      not_applicable: 5,
    });
    expect(result).toEqual({
      needs_review: 3, // 2 + 1
      expired: 1,
      incomplete: 4, // 3 + 1 (blocked)
      in_progress: 2,
      complete: 5, // 4 + 1 (legacy)
      not_applicable: 5,
    });
  });
});
