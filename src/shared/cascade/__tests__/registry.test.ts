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
});
