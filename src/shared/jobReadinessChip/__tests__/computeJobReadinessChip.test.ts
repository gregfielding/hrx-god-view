/**
 * **R.4** — Unit tests for `computeJobReadinessChip`.
 *
 * Pure-function test surface. Covers the two-axis classification
 * (status × severity × resolutionMethod), aggregate rule (red > yellow >
 * green), `'computing'` vs orphan-red empty case, `csa_waived` shortcut,
 * and cross-collection assembly (BG / drug / e-verify from
 * `employeeReadinessItems`).
 *
 * Jest (`craco test`).
 */

import {
  computeJobReadinessChip,
  type ComputeJobReadinessChipArgs,
} from '../computeJobReadinessChip';
import type { AssignmentReadinessItem } from '../../assignmentReadinessItemV1';
import type { EmployeeReadinessItem } from '../../employeeReadinessItemV1';

const T = '2026-04-26T00:00:00.000Z';
const OWNER = {
  primaryRecruiterId: 'r1',
  resolvedAt: T,
  source: 'auto' as const,
};

function ari(over: Partial<AssignmentReadinessItem>): AssignmentReadinessItem {
  return {
    id: over.id ?? 'a1__skill_match__forklift',
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
    id: over.id ?? 'w1__entA__background_check',
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

function args(over: Partial<ComputeJobReadinessChipArgs>): ComputeJobReadinessChipArgs {
  return {
    assignmentReadinessItems: [],
    employeeReadinessItems: [],
    readinessSeeded: true,
    ...over,
  };
}

describe('computeJobReadinessChip — empty input', () => {
  it("returns 'computing' when no items AND seeder has not run yet", () => {
    const r = computeJobReadinessChip(args({ readinessSeeded: false }));
    expect(r.state).toBe('computing');
    expect(r.text).toBe('Job Ready (computing\u2026)');
    expect(r.contributors).toHaveLength(0);
    expect(r.pendingCount).toBe(0);
    expect(r.blockerCount).toBe(0);
  });

  it("returns 'red' (orphan) when no items but seeder reports done", () => {
    // Per Greg's spec: empty after seeder ran = orphan placement; chip is red
    // so the CSA notices and re-seeds. Distinct from 'computing' which is the
    // pre-first-snapshot state.
    const r = computeJobReadinessChip(args({ readinessSeeded: true }));
    expect(r.state).toBe('red');
    expect(r.text).toBe('Job Not Ready');
    expect(r.contributors).toHaveLength(0);
  });
});

describe('computeJobReadinessChip — single-item classification', () => {
  it('hard + complete_pass → green', () => {
    const r = computeJobReadinessChip(args({
      assignmentReadinessItems: [ari({ severity: 'hard', status: 'complete_pass', resolutionMethod: 'auto' })],
    }));
    expect(r.state).toBe('green');
    expect(r.text).toBe('Job Ready');
  });

  it('hard + complete_fail → red', () => {
    const r = computeJobReadinessChip(args({
      assignmentReadinessItems: [ari({ severity: 'hard', status: 'complete_fail', requirementType: 'cert_match' })],
    }));
    expect(r.state).toBe('red');
    expect(r.contributors[0]?.detail).toBe('Failed');
    expect(r.blockerCount).toBe(1);
  });

  it('hard + incomplete → red (cert/license/screening genuinely blocking)', () => {
    const r = computeJobReadinessChip(args({
      assignmentReadinessItems: [ari({ severity: 'hard', status: 'incomplete', requirementType: 'cert_match' })],
    }));
    expect(r.state).toBe('red');
    expect(r.contributors[0]?.detail).toBe('Pending');
  });

  it('hard + in_progress → red (with In progress detail)', () => {
    const r = computeJobReadinessChip(args({
      assignmentReadinessItems: [ari({ severity: 'hard', status: 'in_progress', requirementType: 'license_match' })],
    }));
    expect(r.state).toBe('red');
    expect(r.contributors[0]?.detail).toBe('In progress');
  });

  it('hard + expired → red', () => {
    const r = computeJobReadinessChip(args({
      assignmentReadinessItems: [ari({ severity: 'hard', status: 'expired', requirementType: 'license_match' })],
    }));
    expect(r.state).toBe('red');
    expect(r.contributors[0]?.detail).toBe('Expired');
  });

  it('soft + incomplete → yellow ("self-attestation pending")', () => {
    const r = computeJobReadinessChip(args({
      assignmentReadinessItems: [
        ari({
          severity: 'soft',
          status: 'incomplete',
          requirementType: 'physical_willingness',
          resolutionMethod: 'self_attest',
        }),
      ],
    }));
    expect(r.state).toBe('yellow');
    expect(r.text).toBe('Job Ready (1 pending)');
    expect(r.contributors[0]?.detail).toBe('Worker has not answered yet');
  });

  it('soft + complete_fail → yellow (informational, CSA can address)', () => {
    const r = computeJobReadinessChip(args({
      assignmentReadinessItems: [ari({ severity: 'soft', status: 'complete_fail', requirementType: 'skill_match' })],
    }));
    expect(r.state).toBe('yellow');
    expect(r.contributors[0]?.detail).toBe('Failed (soft requirement)');
  });

  it('soft + expired → yellow', () => {
    const r = computeJobReadinessChip(args({
      assignmentReadinessItems: [ari({ severity: 'soft', status: 'expired' })],
    }));
    expect(r.state).toBe('yellow');
    expect(r.contributors[0]?.detail).toBe('Expired (soft requirement)');
  });

  it('needs_review splits on severity (R.5 Q-R5-4): hard → red, soft → yellow', () => {
    const hard = computeJobReadinessChip(args({
      assignmentReadinessItems: [ari({ severity: 'hard', status: 'needs_review', requirementType: 'cert_match' })],
    }));
    const soft = computeJobReadinessChip(args({
      assignmentReadinessItems: [ari({ severity: 'soft', status: 'needs_review' })],
    }));
    expect(hard.state).toBe('red');
    expect(hard.contributors[0]?.contribution).toBe('red');
    expect(hard.contributors[0]?.detail).toBe('Needs review');
    expect(soft.state).toBe('yellow');
    expect(soft.contributors[0]?.contribution).toBe('yellow');
    expect(soft.contributors[0]?.detail).toBe('Needs review (soft requirement)');
  });

  it('not_applicable → green (no popover noise)', () => {
    const r = computeJobReadinessChip(args({
      assignmentReadinessItems: [ari({ severity: 'hard', status: 'not_applicable' })],
    }));
    expect(r.state).toBe('green');
  });

  it("legacy 'complete' status is treated as complete_pass (green)", () => {
    const r = computeJobReadinessChip(args({
      assignmentReadinessItems: [ari({ severity: 'hard', status: 'complete' as never })],
    }));
    expect(r.state).toBe('green');
  });
});

describe('computeJobReadinessChip — csa_waived dominates', () => {
  it("csa_waived flips a hard complete_fail → green", () => {
    const r = computeJobReadinessChip(args({
      assignmentReadinessItems: [
        ari({
          severity: 'hard',
          status: 'complete_fail',
          resolutionMethod: 'csa_waived',
          requirementType: 'cert_match',
        }),
      ],
    }));
    expect(r.state).toBe('green');
    expect(r.contributors[0]?.contribution).toBe('green');
    expect(r.contributors[0]?.detail).toBe('Waived by recruiter');
  });

  it("csa_waived flips an expired hard item → green", () => {
    const r = computeJobReadinessChip(args({
      assignmentReadinessItems: [
        ari({ severity: 'hard', status: 'expired', resolutionMethod: 'csa_waived' }),
      ],
    }));
    expect(r.state).toBe('green');
  });
});

describe('computeJobReadinessChip — aggregate rule', () => {
  it('any red → red even with green and yellow siblings', () => {
    const r = computeJobReadinessChip(args({
      assignmentReadinessItems: [
        ari({ id: 'a1', severity: 'hard', status: 'complete_pass' }),
        ari({ id: 'a2', severity: 'soft', status: 'incomplete', resolutionMethod: 'self_attest' }),
        ari({ id: 'a3', severity: 'hard', status: 'complete_fail', requirementType: 'cert_match' }),
      ],
    }));
    expect(r.state).toBe('red');
    expect(r.text).toBe('Job Not Ready');
    expect(r.blockerCount).toBe(1);
  });

  it('all green → green', () => {
    const r = computeJobReadinessChip(args({
      assignmentReadinessItems: [
        ari({ id: 'a1', severity: 'hard', status: 'complete_pass' }),
        ari({ id: 'a2', severity: 'soft', status: 'complete_pass' }),
      ],
    }));
    expect(r.state).toBe('green');
    expect(r.text).toBe('Job Ready');
    expect(r.pendingCount).toBe(0);
    expect(r.blockerCount).toBe(0);
  });

  it('greens + yellows → yellow with pendingCount = N', () => {
    const r = computeJobReadinessChip(args({
      assignmentReadinessItems: [
        ari({ id: 'a1', severity: 'hard', status: 'complete_pass' }),
        ari({ id: 'a2', severity: 'soft', status: 'incomplete', resolutionMethod: 'self_attest' }),
        ari({ id: 'a3', severity: 'soft', status: 'incomplete', resolutionMethod: 'self_attest' }),
        ari({ id: 'a4', severity: 'soft', status: 'incomplete', resolutionMethod: 'self_attest' }),
      ],
    }));
    expect(r.state).toBe('yellow');
    expect(r.text).toBe('Job Ready (3 pending)');
    expect(r.pendingCount).toBe(3);
  });

  it("contributors are sorted red \u2192 yellow \u2192 green within source", () => {
    const r = computeJobReadinessChip(args({
      assignmentReadinessItems: [
        ari({ id: 'a-green', severity: 'hard', status: 'complete_pass' }),
        ari({ id: 'a-yellow', severity: 'soft', status: 'incomplete', resolutionMethod: 'self_attest' }),
        ari({ id: 'a-red', severity: 'hard', status: 'complete_fail', requirementType: 'cert_match' }),
      ],
    }));
    expect(r.contributors.map((c) => c.contribution)).toEqual(['red', 'yellow', 'green']);
  });
});

describe('computeJobReadinessChip — cross-collection (employee + assignment)', () => {
  it('employee BG complete_fail beats assignment greens (red wins)', () => {
    const r = computeJobReadinessChip(args({
      assignmentReadinessItems: [ari({ severity: 'hard', status: 'complete_pass' })],
      employeeReadinessItems: [eri({ status: 'complete_fail' })],
    }));
    expect(r.state).toBe('red');
    expect(r.contributors.some((c) => c.source === 'employee' && c.requirementType === 'background_check' && c.contribution === 'red')).toBe(true);
  });

  it('employee E-Verify needs_review → red (R.5 Q-R5-4: TNC blocks placement)', () => {
    const r = computeJobReadinessChip(args({
      assignmentReadinessItems: [],
      employeeReadinessItems: [eri({ requirementType: 'e_verify', status: 'needs_review' })],
    }));
    // E-Verify employee items are always severity=hard (see fromEmployeeItem),
    // so a TNC / further_action_required → 'needs_review' must be a placement
    // blocker. R.5 flips this from R.4's blanket "needs_review → yellow".
    expect(r.state).toBe('red');
    expect(r.contributors[0].contribution).toBe('red');
    expect(r.contributors[0].detail).toBe('Needs review');
    expect(r.contributors[0].severity).toBe('hard');
  });

  it('employee E-Verify in_progress (DHS verification) → yellow contributor (worker contested, clock running)', () => {
    // Q-R5-4 lock: once worker contests and the case moves to
    // dhs_verification_in_process, `everifyToReadinessStatus` flips the
    // readiness item to `in_progress`. The chip's E-Verify-specific
    // override in `fromEmployeeItem` then yellows the contributor (USCIS
    // verifying — placement allowed during the regulated wait window)
    // rather than letting the default `hard + in_progress → red` path
    // block placements. See Master Plan §1.4 and matrix doc §3.3 / §5.2.
    const r = computeJobReadinessChip(args({
      assignmentReadinessItems: [],
      employeeReadinessItems: [eri({ requirementType: 'e_verify', status: 'in_progress' })],
    }));
    expect(r.state).toBe('yellow');
    expect(r.contributors[0].contribution).toBe('yellow');
    expect(r.contributors[0].detail).toBe('USCIS verifying');
    expect(r.contributors[0].severity).toBe('hard');
  });

  it('employee BG in_progress stays red (E-Verify override is type-specific)', () => {
    // Sibling check: the E-Verify in_progress override does NOT generalize
    // to other employee items. background_check + in_progress + hard still
    // reds the chip per R.4 baseline. Codifies that future BG/drug
    // decisions are independent.
    const r = computeJobReadinessChip(args({
      assignmentReadinessItems: [],
      employeeReadinessItems: [eri({ requirementType: 'background_check', status: 'in_progress' })],
    }));
    expect(r.state).toBe('red');
    expect(r.contributors[0].contribution).toBe('red');
  });

  it('employee E-Verify with externalRef → contributor.caseId is propagated (R.5)', () => {
    const r = computeJobReadinessChip(args({
      assignmentReadinessItems: [],
      employeeReadinessItems: [
        eri({ requirementType: 'e_verify', status: 'needs_review', externalRef: 'case-abc-123' }),
      ],
    }));
    expect(r.contributors[0].caseId).toBe('case-abc-123');
  });

  it('employee E-Verify without externalRef → contributor.caseId is undefined (R.5 fallback to entity lookup)', () => {
    const r = computeJobReadinessChip(args({
      assignmentReadinessItems: [],
      employeeReadinessItems: [eri({ requirementType: 'e_verify', status: 'needs_review' })],
    }));
    expect(r.contributors[0].caseId).toBeUndefined();
  });

  it('employee background_check with externalRef → contributor.caseId is propagated (R.6)', () => {
    const r = computeJobReadinessChip(args({
      assignmentReadinessItems: [],
      employeeReadinessItems: [
        eri({ requirementType: 'background_check', status: 'needs_review', externalRef: 'check-abc-123' }),
      ],
    }));
    expect(r.contributors[0].caseId).toBe('check-abc-123');
  });

  it('employee drug_screen with externalRef → contributor.caseId is propagated (R.6)', () => {
    const r = computeJobReadinessChip(args({
      assignmentReadinessItems: [],
      employeeReadinessItems: [
        eri({ requirementType: 'drug_screen', status: 'needs_review', externalRef: 'check-def-456' }),
      ],
    }));
    expect(r.contributors[0].caseId).toBe('check-def-456');
  });

  it('employee background_check without externalRef → contributor.caseId is undefined (R.6 graceful absence)', () => {
    const r = computeJobReadinessChip(args({
      assignmentReadinessItems: [],
      employeeReadinessItems: [
        eri({ requirementType: 'background_check', status: 'needs_review' }),
      ],
    }));
    expect(r.contributors[0].caseId).toBeUndefined();
  });

  it("non-job-level employee items (i9, handbook) are filtered out (Employee Readiness chip\u2019s concern)", () => {
    const r = computeJobReadinessChip(args({
      employeeReadinessItems: [
        eri({ id: 'w1__entA__i9_section_2', requirementType: 'i9_section_2', status: 'incomplete' }),
        eri({ id: 'w1__entA__handbook_acknowledgement', requirementType: 'handbook_acknowledgement', status: 'incomplete' }),
        eri({ id: 'w1__entA__background_check', requirementType: 'background_check', status: 'complete_pass' }),
      ],
    }));
    expect(r.contributors).toHaveLength(1);
    expect(r.contributors[0].requirementType).toBe('background_check');
    expect(r.state).toBe('green');
  });

  it("employee items default severity to 'hard' (no severity field on schema)", () => {
    const r = computeJobReadinessChip(args({
      employeeReadinessItems: [eri({ requirementType: 'drug_screen', status: 'incomplete' })],
    }));
    // hard + incomplete → red (genuinely blocking until vendor returns)
    expect(r.state).toBe('red');
    expect(r.contributors[0].severity).toBe('hard');
    expect(r.contributors[0].resolutionMethod).toBeNull();
  });

  it('cross-collection ordering: red employee item sorts before yellow assignment item', () => {
    const r = computeJobReadinessChip(args({
      assignmentReadinessItems: [
        ari({ severity: 'soft', status: 'incomplete', resolutionMethod: 'self_attest' }),
      ],
      employeeReadinessItems: [eri({ status: 'complete_fail' })],
    }));
    expect(r.contributors[0].contribution).toBe('red');
    expect(r.contributors[0].source).toBe('employee');
    expect(r.contributors[1].contribution).toBe('yellow');
    expect(r.contributors[1].source).toBe('assignment');
  });
});

describe('computeJobReadinessChip — labels + popover details', () => {
  it("uses the canonical label table (e.g. physical_willingness \u2192 'Physical requirements')", () => {
    const r = computeJobReadinessChip(args({
      assignmentReadinessItems: [ari({ requirementType: 'physical_willingness', status: 'complete_pass' })],
    }));
    expect(r.contributors[0].requirementLabel).toBe('Physical requirements');
  });

  it('falls back to per-item requirementLabel when present (e.g. for custom items)', () => {
    const r = computeJobReadinessChip(args({
      assignmentReadinessItems: [
        ari({
          id: 'a1__custom__site_orientation',
          requirementType: 'custom',
          requirementLabel: 'Cort warehouse walkthrough',
          status: 'complete_pass',
        }),
      ],
    }));
    expect(r.contributors[0].requirementLabel).toBe('Cort warehouse walkthrough');
  });
});

describe('computeJobReadinessChip — pendingCount text formatting', () => {
  it("yellow with 0 pending (degenerate, not produced by real inputs) renders 'Job Ready'", () => {
    // The aggregator can't actually produce yellow with pendingCount=0 from
    // valid inputs; this test guards `buildText` against future regressions
    // if a contributor were dropped after the count was tallied.
    const r = computeJobReadinessChip(args({
      assignmentReadinessItems: [ari({ severity: 'soft', status: 'incomplete', resolutionMethod: 'self_attest' })],
    }));
    expect(r.text).toBe('Job Ready (1 pending)');
  });

  it("text formatting matches Greg's spec exactly (em-dash + ellipsis usage)", () => {
    expect(computeJobReadinessChip(args({ readinessSeeded: false })).text).toBe('Job Ready (computing\u2026)');
    expect(
      computeJobReadinessChip(args({
        assignmentReadinessItems: [ari({ severity: 'hard', status: 'complete_fail', requirementType: 'cert_match' })],
      })).text,
    ).toBe('Job Not Ready');
  });
});
