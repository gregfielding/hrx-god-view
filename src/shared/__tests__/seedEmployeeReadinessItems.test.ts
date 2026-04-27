/**
 * Unit tests for `seedEmployeeReadinessItems` — the pure builder that produces
 * `EmployeeReadinessItem` docs at first (worker × entity) association.
 *
 * Pure function — no Firestore — so we exercise input shape, deterministic id
 * building, default-vs-override behavior, and validation guards.
 */

import {
  seedEmployeeReadinessItems,
  BASELINE_W2_REQUIREMENTS,
  BASELINE_1099_REQUIREMENTS,
  REQUIREMENT_DEFAULTS,
  SeedEmployeeReadinessItemsInput,
} from '../seedEmployeeReadinessItems';
import { ActionItemOwnership } from '../actionItemOwnership';

const NOW = '2026-04-23T18:00:00.000Z';

const OWNERSHIP: ActionItemOwnership = {
  primaryRecruiterId: 'recA',
  visibleRecruiterIds: ['recA', 'recB'],
  primarySource: 'account',
  history: [
    { at: NOW, actorUid: 'system', action: 'assigned', from: null, to: 'recA', reason: 'Initial derivation' },
  ],
};

function baseInput(overrides: Partial<SeedEmployeeReadinessItemsInput> = {}): SeedEmployeeReadinessItemsInput {
  return {
    tenantId: 'tenantA',
    workerUid: 'worker1',
    hiringEntityId: 'entityWorkforce',
    hiringEntityName: 'C1 Workforce',
    requirements: [{ requirementType: 'i9_section_1' }],
    ownership: OWNERSHIP,
    nowIso: NOW,
    source: { kind: 'workerApply' },
    ...overrides,
  };
}

describe('seedEmployeeReadinessItems — basic shape', () => {
  it('produces one item per requirement spec', () => {
    const items = seedEmployeeReadinessItems(
      baseInput({
        requirements: [
          { requirementType: 'i9_section_1' },
          { requirementType: 'i9_section_2' },
          { requirementType: 'tax_w4' },
        ],
      }),
    );
    expect(items).toHaveLength(3);
    expect(items.map((i) => i.requirementType)).toEqual(['i9_section_1', 'i9_section_2', 'tax_w4']);
  });

  it('stamps every item with createdAt + updatedAt = nowIso', () => {
    const items = seedEmployeeReadinessItems(baseInput());
    expect(items[0].createdAt).toBe(NOW);
    expect(items[0].updatedAt).toBe(NOW);
  });

  it('attaches the same ownership snapshot to every item', () => {
    const items = seedEmployeeReadinessItems(
      baseInput({
        requirements: [{ requirementType: 'i9_section_1' }, { requirementType: 'tax_w4' }],
      }),
    );
    expect(items[0].ownership).toBe(OWNERSHIP);
    expect(items[1].ownership).toBe(OWNERSHIP);
  });

  it('denormalizes hiringEntityName onto every item when provided', () => {
    const items = seedEmployeeReadinessItems(baseInput({ hiringEntityName: 'C1 Select' }));
    expect(items[0].hiringEntityName).toBe('C1 Select');
  });

  it('omits hiringEntityName when not provided (no junk undefined fields)', () => {
    const items = seedEmployeeReadinessItems(baseInput({ hiringEntityName: undefined }));
    expect('hiringEntityName' in items[0]).toBe(false);
  });

  it('omits source when not provided', () => {
    const items = seedEmployeeReadinessItems(baseInput({ source: undefined as any }));
    expect('source' in items[0]).toBe(false);
  });
});

describe('seedEmployeeReadinessItems — id building', () => {
  it('builds deterministic id pattern: ${workerUid}__${hiringEntityId}__${requirementType}', () => {
    const items = seedEmployeeReadinessItems(
      baseInput({
        workerUid: 'wkr-99',
        hiringEntityId: 'ent-Workforce',
        requirements: [{ requirementType: 'handbook_acknowledgement' }],
      }),
    );
    expect(items[0].id).toBe('wkr-99__ent-Workforce__handbook_acknowledgement');
  });

  it('appends customKey for custom requirements', () => {
    const items = seedEmployeeReadinessItems(
      baseInput({
        workerUid: 'wkr-99',
        requirements: [
          {
            requirementType: 'custom',
            requirementLabel: 'Sign safety waiver',
            customKey: 'safety_waiver_v2',
          },
        ],
      }),
    );
    expect(items[0].id).toBe('wkr-99__entityWorkforce__custom__safety_waiver_v2');
  });

  it('produces stable ids across calls with the same inputs', () => {
    const a = seedEmployeeReadinessItems(baseInput());
    const b = seedEmployeeReadinessItems(baseInput());
    expect(a[0].id).toBe(b[0].id);
  });
});

describe('seedEmployeeReadinessItems — defaults', () => {
  it('applies actor + blocking defaults from REQUIREMENT_DEFAULTS when spec omits them', () => {
    const items = seedEmployeeReadinessItems(
      baseInput({ requirements: [{ requirementType: 'i9_section_2' }] }),
    );
    expect(items[0].actor).toBe(REQUIREMENT_DEFAULTS.i9_section_2.actor);
    expect(items[0].blocking).toBe(REQUIREMENT_DEFAULTS.i9_section_2.blocking);
  });

  it('lets the spec override actor + blocking', () => {
    const items = seedEmployeeReadinessItems(
      baseInput({
        requirements: [
          {
            requirementType: 'profile_photo',
            actor: 'recruiter',
            blocking: true,
          },
        ],
      }),
    );
    expect(items[0].actor).toBe('recruiter');
    expect(items[0].blocking).toBe(true);
  });

  it('defaults status to "incomplete" but lets the spec override it (e.g. for migration backfills)', () => {
    const a = seedEmployeeReadinessItems(
      baseInput({ requirements: [{ requirementType: 'i9_section_1' }] }),
    );
    expect(a[0].status).toBe('incomplete');

    const b = seedEmployeeReadinessItems(
      baseInput({
        requirements: [{ requirementType: 'i9_section_1', status: 'complete' }],
      }),
    );
    expect(b[0].status).toBe('complete');
  });

  it('accepts the §6e status vocabulary (complete_pass, complete_fail, needs_review, expired)', () => {
    // Each §6e status should be assignable on a seeded item. If the enum regresses,
    // TS blocks this test from compiling — which is the behavior we want.
    const items = seedEmployeeReadinessItems(
      baseInput({
        requirements: [
          { requirementType: 'handbook_acknowledgement', status: 'complete_pass' },
          { requirementType: 'e_verify', status: 'complete_fail' },
          { requirementType: 'background_check', status: 'needs_review' },
          { requirementType: 'i9_section_1', status: 'expired' },
        ],
      }),
    );
    expect(items.map((i) => i.status)).toEqual([
      'complete_pass',
      'complete_fail',
      'needs_review',
      'expired',
    ]);
  });
});

describe('seedEmployeeReadinessItems — validation', () => {
  it('throws when requirements list is empty', () => {
    expect(() => seedEmployeeReadinessItems(baseInput({ requirements: [] }))).toThrow(/empty/);
  });

  it('throws when a custom spec is missing requirementLabel', () => {
    expect(() =>
      seedEmployeeReadinessItems(
        baseInput({
          requirements: [{ requirementType: 'custom', customKey: 'something' }],
        }),
      ),
    ).toThrow(/custom requirement requires both requirementLabel and customKey/);
  });

  it('throws when a custom spec is missing customKey', () => {
    expect(() =>
      seedEmployeeReadinessItems(
        baseInput({
          requirements: [{ requirementType: 'custom', requirementLabel: 'Sign waiver' }],
        }),
      ),
    ).toThrow(/custom requirement requires both requirementLabel and customKey/);
  });
});

describe('seedEmployeeReadinessItems — baseline requirement sets', () => {
  it('BASELINE_W2_REQUIREMENTS includes the federal-form essentials', () => {
    const types = BASELINE_W2_REQUIREMENTS.map((r) => r.requirementType);
    expect(types).toEqual(
      expect.arrayContaining(['i9_section_1', 'i9_section_2', 'tax_w4', 'e_verify', 'handbook_acknowledgement']),
    );
    // Should NOT seed background / drug screening at entity onboarding (those are per-shift).
    expect(types).not.toContain('background_check');
    expect(types).not.toContain('drug_screen');
  });

  it('BASELINE_1099_REQUIREMENTS uses W-9 + 1099 consent, no W-4 or e-verify or everee', () => {
    const types = BASELINE_1099_REQUIREMENTS.map((r) => r.requirementType);
    expect(types).toEqual(expect.arrayContaining(['tax_w9', 'tax_1099_consent']));
    expect(types).not.toContain('tax_w4');
    expect(types).not.toContain('e_verify');
    expect(types).not.toContain('everee_profile');
  });

  it('end-to-end seed of BASELINE_W2_REQUIREMENTS produces a full set with sensible defaults', () => {
    const items = seedEmployeeReadinessItems(
      baseInput({ requirements: BASELINE_W2_REQUIREMENTS }),
    );
    expect(items).toHaveLength(BASELINE_W2_REQUIREMENTS.length);
    // All items share workerUid + hiringEntityId
    for (const item of items) {
      expect(item.workerUid).toBe('worker1');
      expect(item.hiringEntityId).toBe('entityWorkforce');
      expect(item.tenantId).toBe('tenantA');
      expect(item.status).toBe('incomplete');
    }
    // Specific spot checks on actor / blocking defaults
    const i9s1 = items.find((i) => i.requirementType === 'i9_section_1');
    expect(i9s1?.actor).toBe('worker');
    expect(i9s1?.blocking).toBe(true);
    const i9s2 = items.find((i) => i.requirementType === 'i9_section_2');
    expect(i9s2?.actor).toBe('recruiter');
    const photo = items.find((i) => i.requirementType === 'profile_photo');
    expect(photo?.blocking).toBe(false);
  });
});
