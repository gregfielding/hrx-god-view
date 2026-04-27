/**
 * **R.4** — Bridge tests for `buildAssignmentReadiness`.
 *
 * Verifies the additive contract:
 *
 *   - Pre-R.4 callers (no `assignmentReadinessItems` / `employeeReadinessItems`)
 *     still get the legacy result without `jobReadinessChip` (back-compat).
 *   - When BOTH item arrays are passed (even as `[]`), the result includes
 *     `jobReadinessChip` populated by `computeJobReadinessChip`.
 *   - The PENDING_INITIALIZATION early-return path also honors the chip
 *     contract (computes chip when items provided, omits when not).
 *   - The `readinessSnapshotV1` comparable carries the chip through to
 *     the persisted shape.
 *
 * Companion to `src/shared/jobReadinessChip/__tests__/computeJobReadinessChip.test.ts`
 * (which covers the helper itself in isolation).
 */

import { buildAssignmentReadiness } from '../buildAssignmentReadiness';
import { buildReadinessSnapshotV1Comparable } from '../readinessSnapshotV1';
import type { AssignmentReadinessItem } from '../assignmentReadinessItemV1';
import type { EmployeeReadinessItem } from '../employeeReadinessItemV1';

const T = '2026-04-26T00:00:00.000Z';
const OWNER = { primaryRecruiterId: 'r1', resolvedAt: T, source: 'auto' as const };

function ari(over: Partial<AssignmentReadinessItem>): AssignmentReadinessItem {
  return {
    id: 'a1__skill_match__forklift',
    tenantId: 't1',
    assignmentId: 'a1',
    workerUid: 'w1',
    jobOrderId: 'jo1',
    requirementType: 'skill_match',
    status: 'incomplete',
    actor: 'worker',
    blocking: false,
    severity: 'soft',
    resolutionMethod: null,
    ownership: OWNER,
    createdAt: T,
    updatedAt: T,
    ...over,
  } as AssignmentReadinessItem;
}

function eri(over: Partial<EmployeeReadinessItem>): EmployeeReadinessItem {
  return {
    id: 'w1__entA__background_check',
    tenantId: 't1',
    workerUid: 'w1',
    hiringEntityId: 'entA',
    requirementType: 'background_check',
    status: 'incomplete',
    actor: 'vendor',
    blocking: true,
    ownership: OWNER,
    createdAt: T,
    updatedAt: T,
    ...over,
  } as EmployeeReadinessItem;
}

const HAPPY_USER = { workAuthorization: true };
const HAPPY_EMP = {
  i9Complete: true,
  payrollInviteSent: true,
  directDepositComplete: true,
  taxFormComplete: true,
  handbookSigned: true,
  policiesSigned: true,
};
const HAPPY_ASSIGNMENT = {
  id: 'a1',
  name: 'Test shift',
  status: 'pending',
  requiresBackgroundCheck: false,
  requiresDrugScreen: false,
};

describe('buildAssignmentReadiness — R.4 bridge', () => {
  it('pre-R.4 caller (no item arrays) gets the legacy result without jobReadinessChip', () => {
    const r = buildAssignmentReadiness({
      user: HAPPY_USER,
      employment: HAPPY_EMP,
      assignment: HAPPY_ASSIGNMENT,
      screening: {},
    });
    expect(r.readiness).toBe('READY');
    expect(r.jobReadinessChip).toBeUndefined();
  });

  it('passing both item arrays (empty) and readinessSeeded=false yields chip state="computing"', () => {
    const r = buildAssignmentReadiness({
      user: HAPPY_USER,
      employment: HAPPY_EMP,
      assignment: HAPPY_ASSIGNMENT,
      screening: {},
      assignmentReadinessItems: [],
      employeeReadinessItems: [],
      readinessSeeded: false,
    });
    expect(r.jobReadinessChip).toBeDefined();
    expect(r.jobReadinessChip?.state).toBe('computing');
    expect(r.jobReadinessChip?.text).toBe('Job Ready (computing\u2026)');
  });

  it('passing both item arrays (empty) and readinessSeeded=true yields red orphan', () => {
    const r = buildAssignmentReadiness({
      user: HAPPY_USER,
      employment: HAPPY_EMP,
      assignment: HAPPY_ASSIGNMENT,
      screening: {},
      assignmentReadinessItems: [],
      employeeReadinessItems: [],
      readinessSeeded: true,
    });
    expect(r.jobReadinessChip?.state).toBe('red');
    expect(r.jobReadinessChip?.text).toBe('Job Not Ready');
  });

  it('cross-collection: employee BG fail dominates assignment greens', () => {
    const r = buildAssignmentReadiness({
      user: HAPPY_USER,
      employment: HAPPY_EMP,
      assignment: HAPPY_ASSIGNMENT,
      screening: {},
      assignmentReadinessItems: [
        ari({ severity: 'hard', status: 'complete_pass', requirementType: 'cert_match' }),
      ],
      employeeReadinessItems: [eri({ status: 'complete_fail' })],
      readinessSeeded: true,
    });
    expect(r.jobReadinessChip?.state).toBe('red');
    expect(r.jobReadinessChip?.contributors.find(
      (c) => c.source === 'employee' && c.requirementType === 'background_check',
    )?.contribution).toBe('red');
  });

  it('legacy result fields (readiness/requirements/summary) are unchanged when chip is computed', () => {
    const withoutChip = buildAssignmentReadiness({
      user: HAPPY_USER,
      employment: HAPPY_EMP,
      assignment: HAPPY_ASSIGNMENT,
      screening: {},
    });
    const withChip = buildAssignmentReadiness({
      user: HAPPY_USER,
      employment: HAPPY_EMP,
      assignment: HAPPY_ASSIGNMENT,
      screening: {},
      assignmentReadinessItems: [],
      employeeReadinessItems: [],
      readinessSeeded: true,
    });
    expect(withChip.readiness).toBe(withoutChip.readiness);
    expect(withChip.requirements).toEqual(withoutChip.requirements);
    expect(withChip.summary).toEqual(withoutChip.summary);
  });

  it('PENDING_INITIALIZATION early-return path honors the chip contract', () => {
    const noChip = buildAssignmentReadiness({
      user: HAPPY_USER,
      employment: HAPPY_EMP,
      assignment: { ...HAPPY_ASSIGNMENT, id: undefined },
      screening: {},
    });
    expect(noChip.readiness).toBe('PENDING_INITIALIZATION');
    expect(noChip.jobReadinessChip).toBeUndefined();

    const withChip = buildAssignmentReadiness({
      user: HAPPY_USER,
      employment: HAPPY_EMP,
      assignment: { ...HAPPY_ASSIGNMENT, id: undefined },
      screening: {},
      assignmentReadinessItems: [],
      employeeReadinessItems: [],
      readinessSeeded: false,
    });
    expect(withChip.readiness).toBe('PENDING_INITIALIZATION');
    expect(withChip.jobReadinessChip?.state).toBe('computing');
  });
});

describe('buildReadinessSnapshotV1Comparable — R.4 propagation', () => {
  it('omits jobReadinessChip when the result has none (back-compat persisted shape)', () => {
    const result = buildAssignmentReadiness({
      user: HAPPY_USER,
      employment: HAPPY_EMP,
      assignment: HAPPY_ASSIGNMENT,
      screening: {},
    });
    const comparable = buildReadinessSnapshotV1Comparable(result);
    expect(comparable.jobReadinessChip).toBeUndefined();
  });

  it('includes jobReadinessChip when the result has one', () => {
    const result = buildAssignmentReadiness({
      user: HAPPY_USER,
      employment: HAPPY_EMP,
      assignment: HAPPY_ASSIGNMENT,
      screening: {},
      assignmentReadinessItems: [
        ari({ severity: 'soft', status: 'incomplete', resolutionMethod: 'self_attest' }),
      ],
      employeeReadinessItems: [],
      readinessSeeded: true,
    });
    const comparable = buildReadinessSnapshotV1Comparable(result);
    expect(comparable.jobReadinessChip).toBeDefined();
    expect(comparable.jobReadinessChip?.state).toBe('yellow');
    expect(comparable.jobReadinessChip?.text).toBe('Job Ready (1 pending)');
  });
});
