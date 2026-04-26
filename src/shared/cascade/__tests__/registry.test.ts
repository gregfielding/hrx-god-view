import { CASCADE_REGISTRY } from '../registry';
import type { CascadeFieldSpec } from '../types';
import {
  isCascadeStrategy,
  isEditableLevel,
  isItemIdentity,
} from '../types';

/**
 * Shape-lock for the cascade registry. The cascade engine (added
 * in O.2) assumes every entry obeys these invariants — without
 * this lock a typo in `editableAt` or a missing `itemFields` for
 * `keyed_list` would silently break cascade behaviour at runtime.
 *
 * Add a new field? Add it to the registry — these tests catch
 * malformed entries automatically.
 */
describe('CASCADE_REGISTRY shape lock', () => {
  const entries = Object.entries(CASCADE_REGISTRY) as Array<
    [string, CascadeFieldSpec]
  >;

  it('has at least one registered field', () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  describe.each(entries)('field "%s"', (key, spec) => {
    it('declares a known strategy', () => {
      expect(isCascadeStrategy(spec.strategy)).toBe(true);
    });

    it('has a non-empty label', () => {
      expect(typeof spec.label).toBe('string');
      expect(spec.label.trim().length).toBeGreaterThan(0);
    });

    it('declares at least one editable level', () => {
      expect(Array.isArray(spec.editableAt)).toBe(true);
      expect(spec.editableAt.length).toBeGreaterThan(0);
    });

    it('only references known editable levels', () => {
      for (const level of spec.editableAt) {
        expect(isEditableLevel(level)).toBe(true);
      }
    });

    it('does not declare duplicate editable levels', () => {
      const set = new Set(spec.editableAt);
      expect(set.size).toBe(spec.editableAt.length);
    });

    it('requiredForCompleteness, when set, is strictly boolean true', () => {
      // The flag is binary by design (handoff §14.1). We never
      // store `false` — absence of the property means "not
      // required." Catching `false` here keeps the registry tidy
      // and the auto-JO-creator's truthy-check robust.
      if (spec.requiredForCompleteness !== undefined) {
        expect(spec.requiredForCompleteness).toBe(true);
      }
    });

    if (spec.strategy === 'keyed_list') {
      it('declares an identityKey for keyed_list', () => {
        expect(typeof spec.identityKey).toBe('string');
        expect((spec.identityKey ?? '').length).toBeGreaterThan(0);
      });

      it('declares an itemFields map for keyed_list', () => {
        expect(spec.itemFields).toBeDefined();
        expect(Object.keys(spec.itemFields ?? {}).length).toBeGreaterThan(0);
      });

      it('every itemFields entry recursively passes the same checks', () => {
        const itemEntries = Object.entries(spec.itemFields ?? {}) as Array<
          [string, CascadeFieldSpec]
        >;
        for (const [, sub] of itemEntries) {
          expect(isCascadeStrategy(sub.strategy)).toBe(true);
          expect(sub.label.trim().length).toBeGreaterThan(0);
          expect(sub.editableAt.length).toBeGreaterThan(0);
          for (const subLevel of sub.editableAt) {
            expect(isEditableLevel(subLevel)).toBe(true);
          }
          // Sub-fields should not themselves nest a keyed_list
          // (registry stays one level deep — see handoff §5).
          expect(sub.strategy).not.toBe('keyed_list');
        }
      });
    } else {
      it('does not declare keyed_list-only fields', () => {
        expect(spec.identityKey).toBeUndefined();
        expect(spec.itemFields).toBeUndefined();
      });
    }

    if (spec.strategy === 'union_with_remove') {
      it('declares an itemIdentity for union_with_remove', () => {
        expect(spec.itemIdentity).toBeDefined();
        expect(isItemIdentity(spec.itemIdentity)).toBe(true);
      });
    } else {
      it('does not declare itemIdentity outside union_with_remove', () => {
        expect(spec.itemIdentity).toBeUndefined();
      });
    }

    if (spec.strategy === 'level_only') {
      it('level_only fields are editable at exactly one level', () => {
        expect(spec.editableAt.length).toBe(1);
      });
    }

    // Re-state the key on each test fixture so the parameterised
    // `describe.each` row label is meaningful in jest output.
    it('key is a non-empty string', () => {
      expect(typeof key).toBe('string');
      expect(key.length).toBeGreaterThan(0);
    });
  });

  describe('locked decisions from handoff §13', () => {
    it('positions is keyed_list, edited only at account/child', () => {
      const spec = CASCADE_REGISTRY.positions;
      expect(spec.strategy).toBe('keyed_list');
      expect(spec.identityKey).toBe('positionId');
      // No JO-level position overrides — handoff §5 + §13.4.
      expect([...spec.editableAt].sort()).toEqual(['account', 'child']);
    });

    it('positions.payRate / billRate / futa / suta / workersCompRate are child-only', () => {
      const childOnly = ['payRate', 'billRate', 'futa', 'suta', 'workersCompRate'] as const;
      for (const fieldName of childOnly) {
        const spec = CASCADE_REGISTRY.positions.itemFields[fieldName];
        expect([...spec.editableAt]).toEqual(['child']);
      }
    });

    it('selectedPositionIds is JO-only and does not cascade', () => {
      const spec = CASCADE_REGISTRY.selectedPositionIds;
      expect(spec.strategy).toBe('level_only');
      expect([...spec.editableAt]).toEqual(['jo']);
    });

    it('uniformRequirements stacks across all four levels with slug identity', () => {
      const spec = CASCADE_REGISTRY.uniformRequirements;
      expect(spec.strategy).toBe('union_with_remove');
      expect(spec.itemIdentity).toBe('slug');
      expect([...spec.editableAt].sort()).toEqual(['account', 'child', 'jo', 'shift']);
    });

    it('screeningPackageId is the canonical key (not backgroundCheckPackageId)', () => {
      // Spec §13.1 — `backgroundCheckPackageId` is an alias to clean
      // up in O.4. The registry must not register the alias.
      expect(CASCADE_REGISTRY).toHaveProperty('screeningPackageId');
      expect(CASCADE_REGISTRY).not.toHaveProperty('backgroundCheckPackageId');
    });
  });

  describe('downstream consumer hooks (handoff §14)', () => {
    it('shiftTemplate is registered as JO-only level_only (no cascade)', () => {
      // §14.2 — JO-level template that pre-populates the
      // click-to-create-shift form. Engine returns the value as-is.
      expect(CASCADE_REGISTRY).toHaveProperty('shiftTemplate');
      const spec = CASCADE_REGISTRY.shiftTemplate;
      expect(spec.strategy).toBe('level_only');
      expect([...spec.editableAt]).toEqual(['jo']);
    });

    it('positions completeness gate is encoded as a queryable flag (§14.4)', () => {
      // §14.1 lists payRate / billRate / futa / suta /
      // workersCompRate as the explicit child-level required-fields
      // set the auto-JO-creator must check before auto-selecting
      // a position. Encoding it on the registry (rather than
      // deriving from `editableAt`) keeps the rule queryable per
      // §14.4 and decouples it from the editing tier.
      const required = ['payRate', 'billRate', 'futa', 'suta', 'workersCompRate'] as const;
      for (const fieldName of required) {
        const sub = CASCADE_REGISTRY.positions.itemFields[fieldName];
        expect(sub.requiredForCompleteness).toBe(true);
      }
    });

    it('header & markup fields on positions are NOT required for completeness', () => {
      // markupPercentage is account/child editable; jobTitle /
      // jobDescription / rateMode are header fields. None gate
      // auto-JO inclusion at the child tier — the gate is
      // exclusively on the pricing tax fields.
      const notRequired = [
        'jobTitle',
        'jobDescription',
        'rateMode',
        'markupPercentage',
      ] as const;
      for (const fieldName of notRequired) {
        // Cast through CascadeFieldSpec — the registry's
        // `as const satisfies` narrows literal types to omit
        // unset optional properties, so we widen back to the
        // declared spec interface to ask the question.
        const sub = CASCADE_REGISTRY.positions.itemFields[fieldName] as CascadeFieldSpec;
        expect(sub.requiredForCompleteness).toBeUndefined();
      }
    });
  });
});
