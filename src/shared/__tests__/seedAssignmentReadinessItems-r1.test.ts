/**
 * R.1 unit tests — covers the new `severity` + `resolutionMethod` fields on
 * `AssignmentReadinessItem` and the seed-time derivation rules added by
 * D3.R1 (default table) and D5.R1 (`blocking` derives from `severity`).
 *
 * Companion to `seedAssignmentReadinessItems.test.ts` (basic shape) and
 * `assignmentReadinessRequirementType.b2.test.ts` (Phase B match types).
 *
 * Mirror tests live nowhere else — `src/shared/` is the CRA/Jest copy of
 * `shared/`; the `functions/` test stack (Mocha) covers the matcher helper
 * resolution chain in `jobRequirementMatcherHelpers-r1.test.ts`.
 */

import {
  DEFAULT_REQUIREMENT_SEVERITY,
  seedAssignmentReadinessItems,
  SeedAssignmentReadinessItemsInput,
} from '../seedAssignmentReadinessItems';
import {
  AssignmentReadinessRequirementType,
  AssignmentReadinessSeverity,
} from '../assignmentReadinessItemV1';
import { ActionItemOwnership } from '../actionItemOwnership';

const NOW = '2026-04-26T19:00:00.000Z';

const OWNERSHIP: ActionItemOwnership = {
  primaryRecruiterId: 'recA',
  visibleRecruiterIds: ['recA'],
  primarySource: 'job_order',
  history: [
    { at: NOW, actorUid: 'system', action: 'assigned', from: null, to: 'recA', reason: 'Initial' },
  ],
};

function baseInput(
  overrides: Partial<SeedAssignmentReadinessItemsInput> = {},
): SeedAssignmentReadinessItemsInput {
  return {
    tenantId: 'tenantA',
    assignmentId: 'asg-r1',
    workerUid: 'workerR1',
    jobOrderId: 'jo-r1',
    requirements: [{ requirementType: 'background_check' }],
    ownership: OWNERSHIP,
    nowIso: NOW,
    source: { kind: 'jobOrderAssignment' },
    ...overrides,
  };
}

describe('R.1 — DEFAULT_REQUIREMENT_SEVERITY table (D3.R1)', () => {
  it('marks vendor + system + worker-blocking pathways as hard', () => {
    expect(DEFAULT_REQUIREMENT_SEVERITY.background_check).toBe('hard');
    expect(DEFAULT_REQUIREMENT_SEVERITY.drug_screen).toBe('hard');
    expect(DEFAULT_REQUIREMENT_SEVERITY.e_verify).toBe('hard');
    expect(DEFAULT_REQUIREMENT_SEVERITY.cert_match).toBe('hard');
    expect(DEFAULT_REQUIREMENT_SEVERITY.license_match).toBe('hard');
    expect(DEFAULT_REQUIREMENT_SEVERITY.screening_package_match).toBe('hard');
    expect(DEFAULT_REQUIREMENT_SEVERITY.orientation).toBe('hard');
    expect(DEFAULT_REQUIREMENT_SEVERITY.safety_briefing).toBe('hard');
    expect(DEFAULT_REQUIREMENT_SEVERITY.required_certification).toBe('hard');
    // `ppe_acknowledgement` is the per-shift "did you bring / wear your PPE?"
    // confirmation. It gates the shift, so it's hard. Distinct from R.2's
    // `ppe_willingness` (a soft self-attestation captured at application).
    expect(DEFAULT_REQUIREMENT_SEVERITY.ppe_acknowledgement).toBe('hard');
  });

  it('marks soft-by-default pathways as soft', () => {
    expect(DEFAULT_REQUIREMENT_SEVERITY.skill_match).toBe('soft');
    expect(DEFAULT_REQUIREMENT_SEVERITY.education_match).toBe('soft');
    expect(DEFAULT_REQUIREMENT_SEVERITY.language_match).toBe('soft');
    expect(DEFAULT_REQUIREMENT_SEVERITY.shift_confirmation).toBe('soft');
  });

  it('intentionally excludes custom (callers must pass severity explicitly)', () => {
    // `'custom'` is not a key on the table — TypeScript already enforces this
    // via `Exclude<AssignmentReadinessRequirementType, 'custom'>`. This
    // assertion catches the case where someone widens the table and forgets
    // the documented "custom requires explicit severity" rule.
    const keys = Object.keys(DEFAULT_REQUIREMENT_SEVERITY);
    expect(keys).not.toContain('custom');
  });
});

describe('R.1 — seed-time severity resolution', () => {
  it('falls through to DEFAULT_REQUIREMENT_SEVERITY when spec.severity is omitted', () => {
    const items = seedAssignmentReadinessItems(
      baseInput({
        requirements: [
          { requirementType: 'background_check' },
          { requirementType: 'skill_match', customKey: 'pallet_jack', requirementLabel: 'Pallet jack' },
        ],
      }),
    );
    expect(items[0].severity).toBe('hard');
    expect(items[1].severity).toBe('soft');
  });

  it('uses the spec value when provided (override)', () => {
    const items = seedAssignmentReadinessItems(
      baseInput({
        requirements: [
          // Override default 'soft' → 'hard' (e.g. JO declares this skill is critical).
          { requirementType: 'skill_match', customKey: 'forklift', requirementLabel: 'Forklift', severity: 'hard' },
          // Override default 'hard' → 'soft' (rare, but allowed for hard-passed-already cases).
          { requirementType: 'cert_match', customKey: 'osha_30', requirementLabel: 'OSHA-30', severity: 'soft' },
        ],
      }),
    );
    expect(items[0].severity).toBe('hard');
    expect(items[1].severity).toBe('soft');
  });

  it('throws when a custom requirement omits severity', () => {
    expect(() =>
      seedAssignmentReadinessItems(
        baseInput({
          requirements: [
            {
              requirementType: 'custom',
              requirementLabel: 'Tenant-specific badge handover',
              customKey: 'badge_v1',
            },
          ],
        }),
      ),
    ).toThrow(/custom requirement requires severity/);
  });

  it('accepts a custom requirement when severity is explicit', () => {
    const items = seedAssignmentReadinessItems(
      baseInput({
        requirements: [
          {
            requirementType: 'custom',
            requirementLabel: 'Tenant-specific badge handover',
            customKey: 'badge_v1',
            severity: 'hard',
          },
        ],
      }),
    );
    expect(items[0].severity).toBe('hard');
  });
});

describe('R.1 — blocking derivation from severity (D5.R1)', () => {
  it('derives blocking=true when severity resolves to hard', () => {
    const items = seedAssignmentReadinessItems(
      baseInput({
        requirements: [
          { requirementType: 'background_check' },
          { requirementType: 'cert_match', customKey: 'forklift', requirementLabel: 'Forklift' },
        ],
      }),
    );
    expect(items[0].blocking).toBe(true);
    expect(items[1].blocking).toBe(true);
  });

  it('derives blocking=false when severity resolves to soft', () => {
    const items = seedAssignmentReadinessItems(
      baseInput({
        requirements: [
          { requirementType: 'skill_match', customKey: 'pallet_jack', requirementLabel: 'Pallet jack' },
          { requirementType: 'shift_confirmation' },
        ],
      }),
    );
    for (const item of items) {
      expect(item.blocking).toBe(false);
      expect(item.severity).toBe('soft');
    }
  });

  it('honours an explicit spec.blocking override even when severity disagrees (forward-flex)', () => {
    // Forward-flexibility case from the D5.R1 rationale: a hard requirement
    // that's already passed could carry blocking:false on the item even
    // though severity stays 'hard'. The spec.blocking explicit override wins.
    const items = seedAssignmentReadinessItems(
      baseInput({
        requirements: [
          { requirementType: 'background_check', blocking: false },
          { requirementType: 'skill_match', customKey: 'forklift', requirementLabel: 'Forklift', blocking: true },
        ],
      }),
    );
    expect(items[0].severity).toBe('hard');
    expect(items[0].blocking).toBe(false);
    expect(items[1].severity).toBe('soft');
    expect(items[1].blocking).toBe(true);
  });

  it('blocking derivation table (regression matrix)', () => {
    // Build one item per requirement type, default severity → assert
    // blocking matches `severity === 'hard'`. Catches accidental drift in
    // either DEFAULT_REQUIREMENT_SEVERITY or the derivation expression.
    const cases: Array<{ type: AssignmentReadinessRequirementType; customKey?: string; label?: string }> = [
      { type: 'background_check' },
      { type: 'drug_screen' },
      { type: 'e_verify' },
      { type: 'cert_match', customKey: 'forklift', label: 'Forklift' },
      { type: 'license_match', customKey: 'cdl_a', label: 'CDL Class A' },
      { type: 'skill_match', customKey: 'pallet_jack', label: 'Pallet jack' },
      { type: 'education_match' },
      { type: 'language_match', customKey: 'es', label: 'Spanish' },
      { type: 'screening_package_match' },
      { type: 'orientation' },
      { type: 'ppe_acknowledgement' },
      { type: 'safety_briefing' },
      { type: 'shift_confirmation' },
      { type: 'required_certification' },
    ];

    const items = seedAssignmentReadinessItems(
      baseInput({
        requirements: cases.map((c) => ({
          requirementType: c.type,
          ...(c.customKey ? { customKey: c.customKey, requirementLabel: c.label } : {}),
        })),
      }),
    );

    for (const item of items) {
      const expected: AssignmentReadinessSeverity =
        DEFAULT_REQUIREMENT_SEVERITY[
          item.requirementType as Exclude<AssignmentReadinessRequirementType, 'custom'>
        ];
      expect(item.severity).toBe(expected);
      expect(item.blocking).toBe(expected === 'hard');
    }
  });
});

describe('R.1 — resolutionMethod stamping', () => {
  it('defaults to null when spec.resolutionMethod is omitted', () => {
    const items = seedAssignmentReadinessItems(
      baseInput({ requirements: [{ requirementType: 'background_check' }] }),
    );
    expect(items[0].resolutionMethod).toBeNull();
  });

  it('passes spec.resolutionMethod through unchanged', () => {
    const items = seedAssignmentReadinessItems(
      baseInput({
        requirements: [
          { requirementType: 'background_check', resolutionMethod: 'external' },
          { requirementType: 'skill_match', customKey: 'forklift', requirementLabel: 'Forklift', resolutionMethod: 'auto' },
          {
            requirementType: 'ppe_acknowledgement',
            resolutionMethod: 'self_attest',
          },
        ],
      }),
    );
    expect(items[0].resolutionMethod).toBe('external');
    expect(items[1].resolutionMethod).toBe('auto');
    expect(items[2].resolutionMethod).toBe('self_attest');
  });
});
