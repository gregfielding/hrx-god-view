/**
 * Phase B.2 schema lock — the six new `*_match` requirement types and their
 * seed defaults. These tests catch silent removals or default-shape changes
 * that would otherwise only surface at runtime in the seed trigger.
 *
 * @see docs/READINESS_EXECUTION_MATRIX.md §7 Phase B
 * @see shared/assignmentReadinessItemV1.ts (the union)
 * @see shared/seedAssignmentReadinessItems.ts (the defaults)
 */

import {
  ASSIGNMENT_REQUIREMENT_DEFAULTS,
  seedAssignmentReadinessItems,
  type SeedAssignmentReadinessItemsInput,
} from '../seedAssignmentReadinessItems';
import type { AssignmentReadinessRequirementType } from '../assignmentReadinessItemV1';
import type { ActionItemOwnership } from '../actionItemOwnership';

const PHASE_B_MATCH_TYPES: AssignmentReadinessRequirementType[] = [
  'cert_match',
  'license_match',
  'skill_match',
  'education_match',
  'language_match',
  'screening_package_match',
];

const NOW = '2026-04-25T19:00:00.000Z';
const OWNERSHIP: ActionItemOwnership = {
  primaryRecruiterId: 'recA',
  visibleRecruiterIds: ['recA'],
  primarySource: 'job_order',
  history: [{ at: NOW, actorUid: 'system', action: 'assigned', from: null, to: 'recA', reason: 'Initial' }],
};

function baseInput(
  overrides: Partial<SeedAssignmentReadinessItemsInput> = {},
): SeedAssignmentReadinessItemsInput {
  return {
    tenantId: 'tenantA',
    assignmentId: 'asg-1',
    workerUid: 'worker1',
    jobOrderId: 'jo-1',
    requirements: [{ requirementType: 'cert_match' }],
    ownership: OWNERSHIP,
    nowIso: NOW,
    source: { kind: 'jobOrderAssignment' },
    ...overrides,
  };
}

describe('Phase B.2 — *_match types in the union', () => {
  it.each(PHASE_B_MATCH_TYPES)('union accepts %s', (t) => {
    // Type assignment + presence in defaults map = compile + runtime proof.
    const def = ASSIGNMENT_REQUIREMENT_DEFAULTS[t];
    expect(def).toBeDefined();
  });

  it('every match type is blocking by default', () => {
    // Phase B premise: a worker missing a required cert/license/skill/edu/lang
    // /screening package can be placed silently today. Defaults must block.
    for (const t of PHASE_B_MATCH_TYPES) {
      expect(ASSIGNMENT_REQUIREMENT_DEFAULTS[t].blocking).toBe(true);
    }
  });

  it('match-type actor assignments match the documented ownership rationale', () => {
    // Expected actors per the comment in seedAssignmentReadinessItems.ts.
    const expected: Record<(typeof PHASE_B_MATCH_TYPES)[number], string> = {
      cert_match: 'worker',
      license_match: 'worker',
      education_match: 'worker',
      language_match: 'worker',
      skill_match: 'recruiter',
      screening_package_match: 'vendor',
    };
    for (const t of PHASE_B_MATCH_TYPES) {
      expect(ASSIGNMENT_REQUIREMENT_DEFAULTS[t].actor).toBe(expected[t]);
    }
  });
});

describe('Phase B.2 — seed runner accepts the new types', () => {
  it('builds an item per match-type spec, with defaults applied and incomplete status', () => {
    // Multi-instance types need a customKey; single-instance ones don't.
    const items = seedAssignmentReadinessItems(
      baseInput({
        requirements: [
          { requirementType: 'cert_match', customKey: 'forklift', requirementLabel: 'Forklift' },
          { requirementType: 'license_match', customKey: 'cdl_a', requirementLabel: 'CDL Class A' },
          { requirementType: 'skill_match', customKey: 'pallet_jack', requirementLabel: 'Pallet jack' },
          { requirementType: 'education_match' },
          { requirementType: 'language_match', customKey: 'es', requirementLabel: 'Spanish' },
          { requirementType: 'screening_package_match' },
        ],
      }),
    );
    expect(items.map((i) => i.requirementType)).toEqual(PHASE_B_MATCH_TYPES);
    for (const item of items) {
      // No `spec.status` override → seed default is 'incomplete' (matcher fills in at trigger time).
      expect(item.status).toBe('incomplete');
      expect(item.blocking).toBe(true);
    }
  });

  it('seed-time matcher result can be passed through spec.status', () => {
    // The trigger (Phase B.5) computes the matcher result and passes it as
    // spec.status — this verifies that override path still works for the new
    // types so the wire-up will be straightforward.
    const items = seedAssignmentReadinessItems(
      baseInput({
        requirements: [
          { requirementType: 'cert_match', customKey: 'forklift', status: 'complete_pass' },
          { requirementType: 'license_match', customKey: 'cdl_a', status: 'complete_fail' },
          { requirementType: 'skill_match', customKey: 'pallet_jack', status: 'needs_review' },
          { requirementType: 'education_match', status: 'incomplete' },
          { requirementType: 'language_match', customKey: 'es', status: 'not_applicable' },
          { requirementType: 'screening_package_match', status: 'in_progress' },
        ],
      }),
    );
    expect(items.map((i) => i.status)).toEqual([
      'complete_pass',
      'complete_fail',
      'needs_review',
      'incomplete',
      'not_applicable',
      'in_progress',
    ]);
  });

  it('multi-instance match items require customKey to disambiguate ids', () => {
    // Without a customKey, the id-builder throws — two cert_match items
    // would otherwise silently collide on `asg-1__cert_match`.
    expect(() =>
      seedAssignmentReadinessItems(
        baseInput({ requirements: [{ requirementType: 'cert_match' }] }),
      ),
    ).toThrow(/customKey required.*cert_match/);

    expect(() =>
      seedAssignmentReadinessItems(
        baseInput({ requirements: [{ requirementType: 'license_match' }] }),
      ),
    ).toThrow(/customKey required.*license_match/);

    expect(() =>
      seedAssignmentReadinessItems(
        baseInput({ requirements: [{ requirementType: 'skill_match' }] }),
      ),
    ).toThrow(/customKey required.*skill_match/);

    expect(() =>
      seedAssignmentReadinessItems(
        baseInput({ requirements: [{ requirementType: 'language_match' }] }),
      ),
    ).toThrow(/customKey required.*language_match/);
  });

  it('multi-instance match items with distinct customKeys produce distinct ids', () => {
    const items = seedAssignmentReadinessItems(
      baseInput({
        requirements: [
          { requirementType: 'cert_match', customKey: 'forklift_basic', requirementLabel: 'Forklift' },
          { requirementType: 'cert_match', customKey: 'osha_30', requirementLabel: 'OSHA-30' },
          { requirementType: 'language_match', customKey: 'es', requirementLabel: 'Spanish' },
        ],
      }),
    );
    expect(items.map((i) => i.id)).toEqual([
      'asg-1__cert_match__forklift_basic',
      'asg-1__cert_match__osha_30',
      'asg-1__language_match__es',
    ]);
    // Ids unique within the batch.
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
  });

  it('single-instance match items do not require customKey', () => {
    // education_match and screening_package_match are 1-per-JO; the id-builder
    // accepts them with no customKey.
    const items = seedAssignmentReadinessItems(
      baseInput({
        requirements: [
          { requirementType: 'education_match' },
          { requirementType: 'screening_package_match' },
        ],
      }),
    );
    expect(items.map((i) => i.id)).toEqual([
      'asg-1__education_match',
      'asg-1__screening_package_match',
    ]);
  });

  it('customKey is sanitized to alphanumeric + underscore (Firestore-safe)', () => {
    const items = seedAssignmentReadinessItems(
      baseInput({
        requirements: [
          { requirementType: 'cert_match', customKey: 'OSHA-30 General/Industry!', requirementLabel: 'OSHA-30' },
        ],
      }),
    );
    expect(items[0].id).toBe('asg-1__cert_match__OSHA_30_General_Industry_');
  });
});

describe('Phase B.2 — required_certification still compiles (deprecated path)', () => {
  it('union still accepts required_certification with default actor=worker, blocking=true', () => {
    expect(ASSIGNMENT_REQUIREMENT_DEFAULTS.required_certification).toEqual({
      actor: 'worker',
      blocking: true,
    });
  });

  it('seed runner still builds a required_certification item (legacy seed callers do not break)', () => {
    const items = seedAssignmentReadinessItems(
      baseInput({ requirements: [{ requirementType: 'required_certification' }] }),
    );
    expect(items).toHaveLength(1);
    expect(items[0].requirementType).toBe('required_certification');
  });
});
