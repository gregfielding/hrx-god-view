/**
 * Unit tests for `seedAssignmentReadinessItems` — pure builder for
 * shift-scoped readiness items. Mirrors the shape of the Employee-side tests.
 */

import {
  seedAssignmentReadinessItems,
  BASELINE_SHIFT_REQUIREMENTS,
  ASSIGNMENT_REQUIREMENT_DEFAULTS,
  SeedAssignmentReadinessItemsInput,
} from '../seedAssignmentReadinessItems';
import { ActionItemOwnership } from '../actionItemOwnership';

const NOW = '2026-04-23T19:00:00.000Z';

const OWNERSHIP: ActionItemOwnership = {
  primaryRecruiterId: 'recA',
  visibleRecruiterIds: ['recA', 'recB'],
  primarySource: 'job_order',
  history: [
    { at: NOW, actorUid: 'system', action: 'assigned', from: null, to: 'recA', reason: 'Initial' },
  ],
};

function baseInput(overrides: Partial<SeedAssignmentReadinessItemsInput> = {}): SeedAssignmentReadinessItemsInput {
  return {
    tenantId: 'tenantA',
    assignmentId: 'asg-1',
    workerUid: 'worker1',
    jobOrderId: 'jo-1',
    shiftId: 'shift-1',
    requirements: [{ requirementType: 'shift_confirmation' }],
    ownership: OWNERSHIP,
    nowIso: NOW,
    source: { kind: 'jobOrderAssignment' },
    ...overrides,
  };
}

describe('seedAssignmentReadinessItems — basic shape', () => {
  it('produces one item per requirement spec', () => {
    const items = seedAssignmentReadinessItems(
      baseInput({
        requirements: [
          { requirementType: 'background_check' },
          { requirementType: 'drug_screen' },
          { requirementType: 'shift_confirmation' },
        ],
      }),
    );
    expect(items).toHaveLength(3);
    expect(items.map((i) => i.requirementType)).toEqual(['background_check', 'drug_screen', 'shift_confirmation']);
  });

  it('stamps every item with createdAt + updatedAt = nowIso', () => {
    const items = seedAssignmentReadinessItems(baseInput());
    expect(items[0].createdAt).toBe(NOW);
    expect(items[0].updatedAt).toBe(NOW);
  });

  it('attaches the same ownership snapshot to every item', () => {
    const items = seedAssignmentReadinessItems(
      baseInput({ requirements: [{ requirementType: 'background_check' }, { requirementType: 'drug_screen' }] }),
    );
    expect(items[0].ownership).toBe(OWNERSHIP);
    expect(items[1].ownership).toBe(OWNERSHIP);
  });

  it('denormalizes shiftId when provided', () => {
    const items = seedAssignmentReadinessItems(baseInput({ shiftId: 'shift-42' }));
    expect(items[0].shiftId).toBe('shift-42');
  });

  it('omits shiftId when not provided', () => {
    const items = seedAssignmentReadinessItems(baseInput({ shiftId: undefined }));
    expect('shiftId' in items[0]).toBe(false);
  });

  it('carries workerUid + jobOrderId onto every item for fast queries', () => {
    const items = seedAssignmentReadinessItems(
      baseInput({
        workerUid: 'worker-abc',
        jobOrderId: 'jo-xyz',
        requirements: BASELINE_SHIFT_REQUIREMENTS,
      }),
    );
    for (const item of items) {
      expect(item.workerUid).toBe('worker-abc');
      expect(item.jobOrderId).toBe('jo-xyz');
    }
  });
});

describe('seedAssignmentReadinessItems — id building', () => {
  it('builds deterministic id pattern: ${assignmentId}__${requirementType}', () => {
    const items = seedAssignmentReadinessItems(
      baseInput({
        assignmentId: 'asg-42',
        requirements: [{ requirementType: 'background_check' }],
      }),
    );
    expect(items[0].id).toBe('asg-42__background_check');
  });

  it('appends customKey for custom requirements', () => {
    const items = seedAssignmentReadinessItems(
      baseInput({
        assignmentId: 'asg-42',
        requirements: [
          {
            requirementType: 'custom',
            requirementLabel: 'Client-specific badge pickup',
            customKey: 'badge_pickup_v1',
            // R.1 — custom items have no type-default severity; callers MUST
            // supply one explicitly. See seedAssignmentReadinessItems-r1.test.ts.
            severity: 'hard',
          },
        ],
      }),
    );
    expect(items[0].id).toBe('asg-42__custom__badge_pickup_v1');
  });

  it('produces stable ids across calls with the same inputs', () => {
    const a = seedAssignmentReadinessItems(baseInput());
    const b = seedAssignmentReadinessItems(baseInput());
    expect(a[0].id).toBe(b[0].id);
  });
});

describe('seedAssignmentReadinessItems — defaults', () => {
  it('applies actor + blocking defaults from ASSIGNMENT_REQUIREMENT_DEFAULTS when spec omits them', () => {
    const items = seedAssignmentReadinessItems(
      baseInput({ requirements: [{ requirementType: 'drug_screen' }] }),
    );
    expect(items[0].actor).toBe(ASSIGNMENT_REQUIREMENT_DEFAULTS.drug_screen.actor);
    expect(items[0].blocking).toBe(ASSIGNMENT_REQUIREMENT_DEFAULTS.drug_screen.blocking);
  });

  it('lets the spec override actor + blocking', () => {
    const items = seedAssignmentReadinessItems(
      baseInput({
        requirements: [
          {
            requirementType: 'ppe_acknowledgement',
            actor: 'recruiter',
            blocking: false,
          },
        ],
      }),
    );
    expect(items[0].actor).toBe('recruiter');
    expect(items[0].blocking).toBe(false);
  });

  it('vendor items (background_check, drug_screen) default to vendor + blocking', () => {
    const items = seedAssignmentReadinessItems(
      baseInput({
        requirements: [{ requirementType: 'background_check' }, { requirementType: 'drug_screen' }],
      }),
    );
    expect(items[0].actor).toBe('vendor');
    expect(items[0].blocking).toBe(true);
    expect(items[1].actor).toBe('vendor');
    expect(items[1].blocking).toBe(true);
  });
});

describe('seedAssignmentReadinessItems — validation', () => {
  it('throws when requirements list is empty', () => {
    expect(() => seedAssignmentReadinessItems(baseInput({ requirements: [] }))).toThrow(/empty/);
  });

  it('throws when a custom spec is missing requirementLabel', () => {
    expect(() =>
      seedAssignmentReadinessItems(
        baseInput({ requirements: [{ requirementType: 'custom', customKey: 'x' }] }),
      ),
    ).toThrow(/custom requirement requires both requirementLabel and customKey/);
  });

  it('throws when a custom spec is missing customKey', () => {
    expect(() =>
      seedAssignmentReadinessItems(
        baseInput({ requirements: [{ requirementType: 'custom', requirementLabel: 'Badge' }] }),
      ),
    ).toThrow(/custom requirement requires both requirementLabel and customKey/);
  });
});

describe('seedAssignmentReadinessItems — baseline set', () => {
  it('BASELINE_SHIFT_REQUIREMENTS covers confirmation + screenings + acknowledgements', () => {
    const types = BASELINE_SHIFT_REQUIREMENTS.map((r) => r.requirementType);
    expect(types).toEqual(
      expect.arrayContaining([
        'shift_confirmation',
        'background_check',
        'drug_screen',
        'orientation',
        'safety_briefing',
        'ppe_acknowledgement',
      ]),
    );
  });

  it('end-to-end seed with BASELINE_SHIFT_REQUIREMENTS produces a full set', () => {
    const items = seedAssignmentReadinessItems(
      baseInput({ requirements: BASELINE_SHIFT_REQUIREMENTS }),
    );
    expect(items).toHaveLength(BASELINE_SHIFT_REQUIREMENTS.length);
    for (const item of items) {
      expect(item.tenantId).toBe('tenantA');
      expect(item.assignmentId).toBe('asg-1');
      expect(item.status).toBe('incomplete');
    }
  });
});
