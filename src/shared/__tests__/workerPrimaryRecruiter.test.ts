/**
 * Unit tests for `computePrimaryRecruiterForWorker` — the pure function that
 * decides which recruiter ends up on `users/{uid}.primaryRecruiterId`.
 *
 * Covers the priority rule in `recruiter-ownership-model.md §12a / §13b`:
 * assignment anchors beat employee anchors; newer activeAt wins within a
 * kind; null primaries (pool items) are ignored.
 */

import {
  computePrimaryRecruiterForWorker,
  WorkerOwnershipAnchor,
} from '../workerPrimaryRecruiter';

function assignmentAnchor(overrides: Partial<WorkerOwnershipAnchor>): WorkerOwnershipAnchor {
  return {
    kind: 'assignmentReadinessItem',
    sourceItemId: 'asg-item-1',
    primaryRecruiterId: 'recA',
    activeAt: '2026-04-01T00:00:00.000Z',
    ...overrides,
  };
}

function employeeAnchor(overrides: Partial<WorkerOwnershipAnchor>): WorkerOwnershipAnchor {
  return {
    kind: 'employeeReadinessItem',
    sourceItemId: 'emp-item-1',
    primaryRecruiterId: 'recE',
    activeAt: '2026-04-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('computePrimaryRecruiterForWorker — empty / null cases', () => {
  it('returns null primary when anchor list is empty', () => {
    const result = computePrimaryRecruiterForWorker([]);
    expect(result.primaryRecruiterId).toBeNull();
    expect(result.sourceAnchor).toBeNull();
  });

  it('returns null when every anchor has a null primaryRecruiterId (all in pool)', () => {
    const result = computePrimaryRecruiterForWorker([
      assignmentAnchor({ primaryRecruiterId: null }),
      employeeAnchor({ primaryRecruiterId: null }),
    ]);
    expect(result.primaryRecruiterId).toBeNull();
    expect(result.sourceAnchor).toBeNull();
  });

  it('treats whitespace-only primaryRecruiterId as null', () => {
    const result = computePrimaryRecruiterForWorker([
      assignmentAnchor({ primaryRecruiterId: '   ' }),
    ]);
    expect(result.primaryRecruiterId).toBeNull();
    expect(result.sourceAnchor).toBeNull();
  });
});

describe('computePrimaryRecruiterForWorker — priority', () => {
  it('prefers assignmentReadinessItem over employeeReadinessItem', () => {
    const result = computePrimaryRecruiterForWorker([
      employeeAnchor({ primaryRecruiterId: 'recE', activeAt: '2026-04-10T00:00:00.000Z' }),
      assignmentAnchor({ primaryRecruiterId: 'recA', activeAt: '2026-04-01T00:00:00.000Z' }),
    ]);
    expect(result.primaryRecruiterId).toBe('recA');
    expect(result.sourceAnchor?.kind).toBe('assignmentReadinessItem');
  });

  it('falls back to employeeReadinessItem when no assignment anchor exists', () => {
    const result = computePrimaryRecruiterForWorker([
      employeeAnchor({ primaryRecruiterId: 'recE' }),
    ]);
    expect(result.primaryRecruiterId).toBe('recE');
    expect(result.sourceAnchor?.kind).toBe('employeeReadinessItem');
  });

  it('ignores assignment anchors whose primary is null, then uses the employee anchor', () => {
    const result = computePrimaryRecruiterForWorker([
      assignmentAnchor({ primaryRecruiterId: null, sourceItemId: 'asg-pool' }),
      employeeAnchor({ primaryRecruiterId: 'recE', sourceItemId: 'emp-ok' }),
    ]);
    expect(result.primaryRecruiterId).toBe('recE');
    expect(result.sourceAnchor?.sourceItemId).toBe('emp-ok');
  });
});

describe('computePrimaryRecruiterForWorker — tiebreak within kind', () => {
  it('picks the most recent assignmentReadinessItem by activeAt', () => {
    const result = computePrimaryRecruiterForWorker([
      assignmentAnchor({
        sourceItemId: 'older',
        primaryRecruiterId: 'recOld',
        activeAt: '2026-04-01T00:00:00.000Z',
      }),
      assignmentAnchor({
        sourceItemId: 'newer',
        primaryRecruiterId: 'recNew',
        activeAt: '2026-04-15T00:00:00.000Z',
      }),
    ]);
    expect(result.primaryRecruiterId).toBe('recNew');
    expect(result.sourceAnchor?.sourceItemId).toBe('newer');
  });

  it('falls back to sourceItemId string-sort when activeAt is identical', () => {
    const result = computePrimaryRecruiterForWorker([
      assignmentAnchor({
        sourceItemId: 'zzzz',
        primaryRecruiterId: 'recZ',
        activeAt: '2026-04-01T00:00:00.000Z',
      }),
      assignmentAnchor({
        sourceItemId: 'aaaa',
        primaryRecruiterId: 'recA',
        activeAt: '2026-04-01T00:00:00.000Z',
      }),
    ]);
    // Same kind + same activeAt — sort by sourceItemId ASC, first wins.
    expect(result.primaryRecruiterId).toBe('recA');
    expect(result.sourceAnchor?.sourceItemId).toBe('aaaa');
  });

  it('is deterministic — repeated runs with identical input give identical output', () => {
    const input: WorkerOwnershipAnchor[] = [
      assignmentAnchor({ sourceItemId: 'b', primaryRecruiterId: 'recB', activeAt: '2026-04-10T00:00:00.000Z' }),
      assignmentAnchor({ sourceItemId: 'a', primaryRecruiterId: 'recA', activeAt: '2026-04-10T00:00:00.000Z' }),
      employeeAnchor({ sourceItemId: 'e', primaryRecruiterId: 'recE', activeAt: '2026-04-10T00:00:00.000Z' }),
    ];
    const first = computePrimaryRecruiterForWorker(input);
    const second = computePrimaryRecruiterForWorker([...input].reverse());
    expect(first.primaryRecruiterId).toBe(second.primaryRecruiterId);
    expect(first.sourceAnchor?.sourceItemId).toBe(second.sourceAnchor?.sourceItemId);
  });
});

describe('computePrimaryRecruiterForWorker — realistic scenarios', () => {
  it('worker with an active shift and an entity-onboarding item: shift wins', () => {
    const result = computePrimaryRecruiterForWorker([
      assignmentAnchor({
        sourceItemId: 'bg-check-for-asg-99',
        primaryRecruiterId: 'shiftRecruiter',
        activeAt: '2026-04-20T00:00:00.000Z',
      }),
      employeeAnchor({
        sourceItemId: 'i9-for-entity-C1Workforce',
        primaryRecruiterId: 'onboardingRecruiter',
        activeAt: '2026-03-15T00:00:00.000Z',
      }),
    ]);
    expect(result.primaryRecruiterId).toBe('shiftRecruiter');
  });

  it('worker who finished their shift but still has an open Employee Readiness item (I-9 pending) rolls to that owner', () => {
    // Assignment is done / closed → caller should have filtered it out before passing.
    // Only the Employee Readiness anchor remains.
    const result = computePrimaryRecruiterForWorker([
      employeeAnchor({
        sourceItemId: 'i9-section-2',
        primaryRecruiterId: 'onboardingRecruiter',
        activeAt: '2026-04-18T00:00:00.000Z',
      }),
    ]);
    expect(result.primaryRecruiterId).toBe('onboardingRecruiter');
    expect(result.sourceAnchor?.kind).toBe('employeeReadinessItem');
  });

  it('worker with multiple active shifts assigns ownership to the recruiter on the most recent shift', () => {
    const result = computePrimaryRecruiterForWorker([
      assignmentAnchor({
        sourceItemId: 'asg-monday',
        primaryRecruiterId: 'mondayRec',
        activeAt: '2026-04-14T08:00:00.000Z',
      }),
      assignmentAnchor({
        sourceItemId: 'asg-friday',
        primaryRecruiterId: 'fridayRec',
        activeAt: '2026-04-18T08:00:00.000Z',
      }),
    ]);
    expect(result.primaryRecruiterId).toBe('fridayRec');
    expect(result.sourceAnchor?.sourceItemId).toBe('asg-friday');
  });
});
