/**
 * **R.8** — Unit tests for the per-cell category aggregator.
 *
 * Coverage targets (verification gate):
 *   - Empty input → empty map (NOT a 'computing' or red-orphan map)
 *   - Single-item-per-category → chip data threads through
 *   - Multiple items in one category → aggregate rule (red > yellow > green)
 *     applied within that category
 *   - Cross-collection: assignment-side vs employee-side filtered to their
 *     own categories (no leakage)
 *   - `csa_waived` resolution → green dominates within that category
 *   - Legacy `required_certification` items roll up into the `cert_match`
 *     column for cutover-era data
 *   - itemRefs surface ALL contributing items (assignment + employee), tagged
 *     with the right collection so the bulk-action machine can fan out
 *
 * Pure-function tests. Jest (`craco test`).
 */

import { aggregateByCategory } from '../aggregateByCategory';
import type { AssignmentReadinessItem } from '../../../shared/assignmentReadinessItemV1';
import type { EmployeeReadinessItem } from '../../../shared/employeeReadinessItemV1';

const T = '2026-04-27T00:00:00.000Z';
const OWNER = {
  primaryRecruiterId: 'r1',
  resolvedAt: T,
  source: 'auto' as const,
};

function ari(over: Partial<AssignmentReadinessItem>): AssignmentReadinessItem {
  return {
    id: over.id ?? `aitem_${Math.random().toString(36).slice(2, 8)}`,
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
    id: over.id ?? `eitem_${Math.random().toString(36).slice(2, 8)}`,
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

describe('aggregateByCategory — empty cases', () => {
  it('returns an empty map when both arrays are empty', () => {
    const result = aggregateByCategory({
      assignmentItems: [],
      employeeItems: [],
    });
    expect(result.size).toBe(0);
  });

  it('skips categories with zero contributing items (NOT a "computing" cell)', () => {
    // A worker who only has a single cert_match item should NOT have a BG /
    // drug / e_verify / license_match / etc. cell. Empty cells are absent
    // from the map; cells render "—" when the consumer doesn't find the key.
    const result = aggregateByCategory({
      assignmentItems: [ari({ requirementType: 'cert_match', severity: 'hard' })],
      employeeItems: [],
    });
    expect(result.has('cert_match')).toBe(true);
    expect(result.has('background_check')).toBe(false);
    expect(result.has('skill_match')).toBe(false);
    expect(result.has('shift_confirmation')).toBe(false);
  });
});

describe('aggregateByCategory — single-category single-item', () => {
  it('hard incomplete cert → red cell, blockerCount=1', () => {
    const result = aggregateByCategory({
      assignmentItems: [
        ari({ requirementType: 'cert_match', severity: 'hard', status: 'incomplete' }),
      ],
      employeeItems: [],
    });
    const cell = result.get('cert_match');
    expect(cell).toBeTruthy();
    expect(cell!.chip.state).toBe('red');
    expect(cell!.chip.blockerCount).toBe(1);
    expect(cell!.chip.contributors).toHaveLength(1);
  });

  it('soft incomplete uniform_willingness → yellow cell, pendingCount=1', () => {
    const result = aggregateByCategory({
      assignmentItems: [
        ari({
          requirementType: 'uniform_willingness',
          severity: 'soft',
          status: 'incomplete',
          resolutionMethod: 'self_attest',
        }),
      ],
      employeeItems: [],
    });
    const cell = result.get('uniform_willingness');
    expect(cell).toBeTruthy();
    expect(cell!.chip.state).toBe('yellow');
    expect(cell!.chip.pendingCount).toBe(1);
  });

  it('hard complete_pass cert → green cell', () => {
    const result = aggregateByCategory({
      assignmentItems: [
        ari({
          requirementType: 'cert_match',
          severity: 'hard',
          status: 'complete_pass',
          resolutionMethod: 'auto',
        }),
      ],
      employeeItems: [],
    });
    expect(result.get('cert_match')!.chip.state).toBe('green');
  });

  it('csa_waived cert → green even if status would otherwise be red', () => {
    const result = aggregateByCategory({
      assignmentItems: [
        ari({
          requirementType: 'cert_match',
          severity: 'hard',
          status: 'incomplete',
          resolutionMethod: 'csa_waived',
        }),
      ],
      employeeItems: [],
    });
    expect(result.get('cert_match')!.chip.state).toBe('green');
    expect(result.get('cert_match')!.chip.contributors[0].detail).toBe('Waived by recruiter');
  });
});

describe('aggregateByCategory — multi-item rollup within one category', () => {
  it('mixed cert items: any red → red (blockerCount sums)', () => {
    const result = aggregateByCategory({
      assignmentItems: [
        ari({
          id: 'cert1',
          requirementType: 'cert_match',
          severity: 'hard',
          status: 'complete_pass',
          resolutionMethod: 'auto',
        }),
        ari({
          id: 'cert2',
          requirementType: 'cert_match',
          severity: 'hard',
          status: 'incomplete',
        }),
      ],
      employeeItems: [],
    });
    const cell = result.get('cert_match');
    expect(cell!.chip.state).toBe('red');
    expect(cell!.chip.blockerCount).toBe(1);
    expect(cell!.chip.contributors).toHaveLength(2);
  });

  it('mixed cert items: no red, any yellow → yellow', () => {
    const result = aggregateByCategory({
      assignmentItems: [
        ari({
          id: 'cert1',
          requirementType: 'cert_match',
          severity: 'soft',
          status: 'incomplete',
          resolutionMethod: 'self_attest',
        }),
        ari({
          id: 'cert2',
          requirementType: 'cert_match',
          severity: 'hard',
          status: 'complete_pass',
        }),
      ],
      employeeItems: [],
    });
    expect(result.get('cert_match')!.chip.state).toBe('yellow');
  });

  it('all green cert items → green', () => {
    const result = aggregateByCategory({
      assignmentItems: [
        ari({
          id: 'cert1',
          requirementType: 'cert_match',
          severity: 'hard',
          status: 'complete_pass',
        }),
        ari({
          id: 'cert2',
          requirementType: 'cert_match',
          severity: 'hard',
          status: 'not_applicable',
        }),
      ],
      employeeItems: [],
    });
    expect(result.get('cert_match')!.chip.state).toBe('green');
  });
});

describe('aggregateByCategory — cross-collection split', () => {
  it('assignment items only feed assignment-source categories; employee items only feed employee-source categories', () => {
    const result = aggregateByCategory({
      assignmentItems: [
        ari({ requirementType: 'cert_match', severity: 'hard', status: 'incomplete' }),
        ari({ requirementType: 'skill_match', severity: 'soft', status: 'incomplete' }),
      ],
      employeeItems: [
        eri({ requirementType: 'background_check', status: 'incomplete' }),
        eri({ requirementType: 'e_verify', status: 'in_progress' }),
      ],
    });

    expect(result.has('cert_match')).toBe(true);
    expect(result.has('skill_match')).toBe(true);
    expect(result.has('background_check')).toBe(true);
    expect(result.has('e_verify')).toBe(true);

    expect(result.get('background_check')!.chip.state).toBe('red');
    // E-Verify in_progress is the R.5 yellow override (USCIS verifying)
    expect(result.get('e_verify')!.chip.state).toBe('yellow');
  });

  it('does NOT cross items into the wrong source: an assignment-side `e_verify` is ignored (matrix authoritatively reads e_verify from employee side)', () => {
    // The employee column for e_verify reads from employee-side items only;
    // an assignment-side item with requirementType: 'e_verify' (which can
    // exist as the per-shift mirror) does not contribute to the matrix's
    // e_verify column and there's no assignment-side e_verify column.
    const result = aggregateByCategory({
      assignmentItems: [
        // Synthetic — not normally seeded as `e_verify` per current taxonomy
        // but the type union allows it and we want to assert source-isolation.
        ari({ requirementType: 'e_verify', status: 'complete_pass', severity: 'hard' }),
      ],
      employeeItems: [],
    });
    expect(result.has('e_verify')).toBe(false);
  });
});

describe('aggregateByCategory — legacy required_certification rolls into cert_match', () => {
  it('legacy `required_certification` items contribute to the cert_match cell', () => {
    const result = aggregateByCategory({
      assignmentItems: [
        ari({
          id: 'legacy1',
          requirementType: 'required_certification',
          severity: 'hard',
          status: 'incomplete',
        }),
      ],
      employeeItems: [],
    });
    expect(result.get('cert_match')!.chip.state).toBe('red');
    expect(result.get('cert_match')!.chip.contributors).toHaveLength(1);
  });

  it('mixed legacy + new cert items roll up together', () => {
    const result = aggregateByCategory({
      assignmentItems: [
        ari({
          id: 'legacy1',
          requirementType: 'required_certification',
          severity: 'hard',
          status: 'complete_pass',
        }),
        ari({
          id: 'new1',
          requirementType: 'cert_match',
          severity: 'hard',
          status: 'incomplete',
        }),
      ],
      employeeItems: [],
    });
    const cell = result.get('cert_match');
    expect(cell!.chip.state).toBe('red');
    expect(cell!.chip.contributors).toHaveLength(2);
  });
});

describe('aggregateByCategory — itemRefs', () => {
  it('surfaces every contributing item, tagged with its source collection', () => {
    const result = aggregateByCategory({
      assignmentItems: [
        ari({
          id: 'a__cert',
          requirementType: 'cert_match',
          severity: 'hard',
          status: 'complete_pass',
        }),
        ari({
          id: 'a__skill',
          requirementType: 'skill_match',
          severity: 'soft',
          status: 'complete_pass',
        }),
      ],
      employeeItems: [
        eri({ id: 'e__bg', requirementType: 'background_check', status: 'in_progress' }),
      ],
    });

    expect(result.get('cert_match')!.itemRefs).toEqual([
      { itemId: 'a__cert', source: 'assignment' },
    ]);
    expect(result.get('skill_match')!.itemRefs).toEqual([
      { itemId: 'a__skill', source: 'assignment' },
    ]);
    expect(result.get('background_check')!.itemRefs).toEqual([
      { itemId: 'e__bg', source: 'employee' },
    ]);
  });

  it('multi-item rollup surfaces all itemRefs in source order (assignment first, then employee)', () => {
    // The aggregator interleaves at the per-category boundary but within a
    // single category preserves the input order per source. This is locked
    // because the bulk-action machine reads itemRefs to fan out and the
    // ordering becomes the per-row outcome ordering.
    const result = aggregateByCategory({
      assignmentItems: [
        ari({
          id: 'cert1',
          requirementType: 'cert_match',
          severity: 'hard',
          status: 'complete_pass',
        }),
        ari({
          id: 'cert2',
          requirementType: 'cert_match',
          severity: 'hard',
          status: 'incomplete',
        }),
      ],
      employeeItems: [],
    });
    expect(result.get('cert_match')!.itemRefs.map((r) => r.itemId)).toEqual([
      'cert1',
      'cert2',
    ]);
  });
});
