/**
 * Cascading Order Data — engine tests (handoff §6).
 *
 * Worked-example coverage per strategy + the cross-cutting concerns
 * (`editableAt` guard, child/location collapsing, "Reset to inherited"
 * by deleting a level's delta).
 *
 * Naming: tests use the registry keys directly (`uniformRequirements`,
 * `staffInstructions`, `positions`, etc.) so a regression here points
 * straight at the consumer the user will see break.
 */

import {
  provenanceForKey,
  resolveCascadedField,
  resolveCascadedFieldWithSpec,
} from '../resolveCascadedField';
import type {
  AncestorLevel,
  CascadeFieldSpec,
  ProvenanceEntry,
} from '../types';

// ---- Tiny chain helpers --------------------------------------------

function L(
  levelType: AncestorLevel['levelType'],
  levelId: string,
  deltas: Record<string, unknown>,
  levelLabel?: string,
): AncestorLevel {
  return { levelType, levelId, deltas, levelLabel };
}

function valueOnly<T = unknown>(field: any, chain: AncestorLevel[]): T {
  return resolveCascadedField(field, chain).value as T;
}

// ===================================================================
// Strategy: replace
// ===================================================================

describe('resolveCascadedField — replace', () => {
  it('returns undefined when no level supplies the field', () => {
    const out = resolveCascadedField('hiringEntityId', [
      L('account', 'a1', {}),
      L('child', 'c1', {}),
    ]);
    expect(out.value).toBeUndefined();
    expect(out.provenance).toEqual([]);
  });

  it('takes the value from a single contributing level', () => {
    const out = resolveCascadedField('hiringEntityId', [
      L('account', 'a1', { hiringEntityId: 'eor_acme' }, 'Acme'),
      L('child', 'c1', {}, 'Texas Warehouse'),
    ]);
    expect(out.value).toBe('eor_acme');
    expect(out.provenance).toEqual<ProvenanceEntry[]>([
      {
        levelType: 'account',
        levelId: 'a1',
        levelLabel: 'Acme',
        contribution: 'set_initial',
        value: 'eor_acme',
      },
    ]);
  });

  it('closest-to-target level wins; provenance shows overrode', () => {
    const out = resolveCascadedField('hiringEntityId', [
      L('account', 'a1', { hiringEntityId: 'eor_acme' }, 'Acme'),
      L('child', 'c1', { hiringEntityId: 'eor_tx' }, 'Texas'),
    ]);
    expect(out.value).toBe('eor_tx');
    expect(out.provenance.map((p) => p.contribution)).toEqual([
      'set_initial',
      'overrode',
    ]);
  });

  it('explicit null at a descendant clears an ancestor value', () => {
    const out = resolveCascadedField('hiringEntityId', [
      L('account', 'a1', { hiringEntityId: 'eor_acme' }),
      L('child', 'c1', { hiringEntityId: null }),
    ]);
    expect(out.value).toBeNull();
    expect(out.provenance).toHaveLength(2);
  });

  it('Reset to inherited: removing a level\'s delta falls back to ancestor', () => {
    // Setup: child overrides account.
    const overridden = resolveCascadedField('hiringEntityId', [
      L('account', 'a1', { hiringEntityId: 'eor_acme' }),
      L('child', 'c1', { hiringEntityId: 'eor_tx' }),
    ]);
    expect(overridden.value).toBe('eor_tx');

    // Reset: drop the child override (UI deletes the field).
    const reset = resolveCascadedField('hiringEntityId', [
      L('account', 'a1', { hiringEntityId: 'eor_acme' }),
      L('child', 'c1', {}),
    ]);
    expect(reset.value).toBe('eor_acme');
    expect(reset.provenance).toHaveLength(1);
    expect(reset.provenance[0].levelType).toBe('account');
  });

  it('editableAt guard: ignores writes at levels not in the spec', () => {
    // `hiringEntityId` is editable at account+child only. A JO write
    // is a stale/illegal contribution and must be silently dropped.
    const out = resolveCascadedField('hiringEntityId', [
      L('account', 'a1', { hiringEntityId: 'eor_acme' }),
      L('jo', 'j1', { hiringEntityId: 'eor_legacy_bad' }),
    ]);
    expect(out.value).toBe('eor_acme');
    expect(out.provenance).toHaveLength(1);
  });

  it('editableAt guard can be bypassed via ignoreEditableGuard option', () => {
    const out = resolveCascadedField(
      'hiringEntityId',
      [
        L('account', 'a1', { hiringEntityId: 'eor_acme' }),
        L('jo', 'j1', { hiringEntityId: 'eor_jo_bad' }),
      ],
      { ignoreEditableGuard: true },
    );
    expect(out.value).toBe('eor_jo_bad');
  });

  it('child and location level types both map to the "child" tier', () => {
    // Standalone account hierarchy: account → location → jo. The
    // engine must accept `location` as the second-tier just like
    // child does for the national-account hierarchy.
    const out = resolveCascadedField('hiringEntityId', [
      L('account', 'a1', { hiringEntityId: 'eor_root' }),
      L('location', 'l1', { hiringEntityId: 'eor_loc' }),
    ]);
    expect(out.value).toBe('eor_loc');
  });
});

// ===================================================================
// Strategy: union_with_remove
// ===================================================================

describe('resolveCascadedField — union_with_remove', () => {
  it('stacks string_exact items across levels in chain order', () => {
    // additionalScreenings is editable at account/child/jo with
    // string_exact identity (handoff §13).
    const out = valueOnly<string[]>('additionalScreenings', [
      L('account', 'a1', { additionalScreenings: ['Healthcare'] }),
      L('child', 'c1', { additionalScreenings: ['Forklift'] }),
      L('jo', 'j1', { additionalScreenings: ['CDL'] }),
    ]);
    expect(out).toEqual(['Healthcare', 'Forklift', 'CDL']);
  });

  it('dedupes items with identical string_exact identity', () => {
    const out = valueOnly<string[]>('additionalScreenings', [
      L('account', 'a1', { additionalScreenings: ['Healthcare'] }),
      L('child', 'c1', { additionalScreenings: ['Healthcare'] }),
    ]);
    expect(out).toEqual(['Healthcare']);
  });

  it('descendant remove subtracts an ancestor item', () => {
    const out = resolveCascadedField('additionalScreenings', [
      L('account', 'a1', { additionalScreenings: ['Healthcare', 'Forklift'] }),
      L('child', 'c1', {
        additionalScreenings: { removed: ['Forklift'] },
      }),
    ]);
    expect(out.value).toEqual(['Healthcare']);
    const removedEntry = out.provenance.find((p) => p.contribution === 'removed');
    expect(removedEntry).toBeDefined();
    expect(removedEntry!.value).toEqual(['Forklift']);
  });

  it('slug identity treats "Cowboy Boots" and "cowboy_boots" as the same item', () => {
    // uniformRequirements: slug identity, editable at all four levels.
    const out = valueOnly<string[]>('uniformRequirements', [
      L('account', 'a1', { uniformRequirements: ['Cowboy Boots'] }),
      L('jo', 'j1', { uniformRequirements: ['cowboy_boots'] }),
    ]);
    // Account inserted first; the JO duplicate is deduped.
    expect(out).toEqual(['Cowboy Boots']);
  });

  it('shorthand array form is treated as { added: [...] }', () => {
    const out = valueOnly<string[]>('additionalScreenings', [
      L('account', 'a1', { additionalScreenings: ['Healthcare'] }),
    ]);
    expect(out).toEqual(['Healthcare']);
  });

  it('removed-then-readded by a deeper level brings the item back', () => {
    const out = valueOnly<string[]>('additionalScreenings', [
      L('account', 'a1', { additionalScreenings: ['Healthcare'] }),
      L('child', 'c1', { additionalScreenings: { removed: ['Healthcare'] } }),
      L('jo', 'j1', { additionalScreenings: ['Healthcare'] }),
    ]);
    expect(out).toEqual(['Healthcare']);
  });

  it('non-identifiable items (no slug source) are skipped', () => {
    const out = valueOnly<unknown[]>('uniformRequirements', [
      L('account', 'a1', {
        uniformRequirements: ['Boots', { not: 'identifiable' }],
      }),
    ]);
    expect(out).toEqual(['Boots']);
  });
});

// ===================================================================
// Strategy: merge_deep
// ===================================================================

describe('resolveCascadedField — merge_deep', () => {
  it('merges per top-level key across levels', () => {
    const out = valueOnly<Record<string, unknown>>('staffInstructions', [
      L('account', 'a1', {
        staffInstructions: {
          firstDay: { text: 'Account first day' },
          parking: { text: 'Account parking' },
        },
      }),
      L('jo', 'j1', {
        staffInstructions: {
          parking: { text: 'JO parking override' },
          uniform: { text: 'JO uniform' },
        },
      }),
    ]);
    expect(out).toEqual({
      firstDay: { text: 'Account first day' },
      parking: { text: 'JO parking override' },
      uniform: { text: 'JO uniform' },
    });
  });

  it('explicit null at a descendant key clears the ancestor key', () => {
    const out = valueOnly<Record<string, unknown>>('staffInstructions', [
      L('account', 'a1', {
        staffInstructions: { parking: { text: 'Park out back' } },
      }),
      L('jo', 'j1', { staffInstructions: { parking: null } }),
    ]);
    expect(out).toEqual({});
  });

  it('does NOT recurse into nested objects (atomic at depth 1)', () => {
    // Reasoning: existing staffInstructions blobs carry { text,
    // updatedAt, updatedBy } per key. A JO override should replace
    // the whole blob, not surgically patch `text` while keeping the
    // ancestor's `updatedAt`. Lock that behaviour.
    const out = valueOnly<Record<string, unknown>>('staffInstructions', [
      L('account', 'a1', {
        staffInstructions: {
          parking: { text: 'Acct text', updatedAt: 'T1', updatedBy: 'u1' },
        },
      }),
      L('jo', 'j1', {
        staffInstructions: { parking: { text: 'JO text' } },
      }),
    ]);
    expect(out.parking).toEqual({ text: 'JO text' });
  });

  it('per-key provenance is queryable via provenanceForKey', () => {
    const { provenance } = resolveCascadedField('staffInstructions', [
      L('account', 'a1', {
        staffInstructions: {
          firstDay: { text: 'Account first day' },
          parking: { text: 'Account parking' },
        },
      }, 'Acme'),
      L('jo', 'j1', {
        staffInstructions: { parking: { text: 'JO parking' } },
      }, 'JO #108'),
    ]);

    const firstDay = provenanceForKey(provenance, 'firstDay');
    expect(firstDay?.levelType).toBe('account');
    expect(firstDay?.contribution).toBe('set_initial');

    const parking = provenanceForKey(provenance, 'parking');
    expect(parking?.levelType).toBe('jo');
    expect(parking?.contribution).toBe('overrode');

    expect(provenanceForKey(provenance, 'uniform')).toBeUndefined();
  });

  it('Reset to inherited (per key): drop JO key falls back to account', () => {
    const overridden = valueOnly<Record<string, unknown>>('staffInstructions', [
      L('account', 'a1', {
        staffInstructions: { parking: { text: 'Acct' } },
      }),
      L('jo', 'j1', { staffInstructions: { parking: { text: 'JO' } } }),
    ]);
    expect((overridden.parking as any).text).toBe('JO');

    const reset = valueOnly<Record<string, unknown>>('staffInstructions', [
      L('account', 'a1', {
        staffInstructions: { parking: { text: 'Acct' } },
      }),
      L('jo', 'j1', { staffInstructions: {} }),
    ]);
    expect((reset.parking as any).text).toBe('Acct');
  });

  it('editableAt guard ignores merge_deep writes at illegal levels', () => {
    // postingPolicy is editable at account/child/jo (NOT shift). A
    // shift-level write must be ignored.
    const out = valueOnly<Record<string, unknown>>('postingPolicy', [
      L('account', 'a1', { postingPolicy: { autoPublishOnOpenShifts: true } }),
      L('shift', 's1', { postingPolicy: { autoPublishOnOpenShifts: false } }),
    ]);
    expect(out).toEqual({ autoPublishOnOpenShifts: true });
  });

  it('non-object delta values are ignored (defensive)', () => {
    const out = valueOnly<Record<string, unknown>>('staffInstructions', [
      L('account', 'a1', { staffInstructions: 'oops not an object' }),
      L('jo', 'j1', { staffInstructions: { parking: { text: 'OK' } } }),
    ]);
    expect(out).toEqual({ parking: { text: 'OK' } });
  });
});

// ===================================================================
// Strategy: keyed_list (positions)
// ===================================================================

describe('resolveCascadedField — keyed_list (positions)', () => {
  it('Account header + Child pricing merge into a single per-position record', () => {
    // Worked example from handoff §5: Account defines title + markup;
    // Child defines payRate / billRate / FUTA / SUTA / WC.
    const out = valueOnly<Array<Record<string, unknown>>>('positions', [
      L('account', 'a1', {
        positions: [
          {
            positionId: 'forklift',
            jobTitle: 'Forklift Operator',
            jobDescription: 'Operates forklifts',
            rateMode: 'hourly',
            markupPercentage: 35,
          },
        ],
      }),
      L('child', 'c1', {
        positions: [
          {
            positionId: 'forklift',
            payRate: 18,
            billRate: 24.3,
            futa: 0.6,
            suta: 2.7,
            workersCompRate: 4.5,
          },
        ],
      }),
    ]);
    expect(out).toEqual([
      {
        positionId: 'forklift',
        jobTitle: 'Forklift Operator',
        jobDescription: 'Operates forklifts',
        rateMode: 'hourly',
        markupPercentage: 35,
        payRate: 18,
        billRate: 24.3,
        futa: 0.6,
        suta: 2.7,
        workersCompRate: 4.5,
      },
    ]);
  });

  it('Child can override an Account header field', () => {
    const out = valueOnly<Array<Record<string, unknown>>>('positions', [
      L('account', 'a1', {
        positions: [
          { positionId: 'p1', jobTitle: 'Loader', markupPercentage: 30 },
        ],
      }),
      L('child', 'c1', {
        positions: [
          { positionId: 'p1', markupPercentage: 40 },
        ],
      }),
    ]);
    expect(out[0].markupPercentage).toBe(40);
    expect(out[0].jobTitle).toBe('Loader');
  });

  it('child-only pricing fields drop a JO write (editableAt guard)', () => {
    // payRate is editable at child only. A JO that tries to set it
    // (e.g. a hand-edited doc) must be ignored.
    const out = valueOnly<Array<Record<string, unknown>>>('positions', [
      L('account', 'a1', {
        positions: [{ positionId: 'p1', jobTitle: 'Loader' }],
      }),
      L('child', 'c1', {
        positions: [{ positionId: 'p1', payRate: 18 }],
      }),
      L('jo', 'j1', {
        positions: [{ positionId: 'p1', payRate: 99 }],
      }),
    ]);
    // JO contribution to the OUTER list is dropped because positions
    // is editable at account/child only — so payRate stays at 18.
    expect(out[0].payRate).toBe(18);
  });

  it('items added at different levels stack by identity', () => {
    const out = valueOnly<Array<Record<string, unknown>>>('positions', [
      L('account', 'a1', {
        positions: [{ positionId: 'p1', jobTitle: 'A' }],
      }),
      L('child', 'c1', {
        positions: [{ positionId: 'p2', jobTitle: 'B' }],
      }),
    ]);
    expect(out.map((p) => p.positionId)).toEqual(['p1', 'p2']);
  });

  it('items missing identityKey are silently skipped (defensive)', () => {
    const out = valueOnly<Array<Record<string, unknown>>>('positions', [
      L('account', 'a1', {
        positions: [
          { positionId: 'p1', jobTitle: 'OK' },
          { jobTitle: 'No id' }, // dropped
          { positionId: '   ', jobTitle: 'Whitespace id' }, // dropped
        ],
      }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].positionId).toBe('p1');
  });
});

// ===================================================================
// Strategy: level_only
// ===================================================================

describe('resolveCascadedField — level_only', () => {
  it('returns the JO value for selectedPositionIds', () => {
    const out = valueOnly<string[]>('selectedPositionIds', [
      L('account', 'a1', {}),
      L('child', 'c1', {}),
      L('jo', 'j1', { selectedPositionIds: ['p1', 'p3'] }),
    ]);
    expect(out).toEqual(['p1', 'p3']);
  });

  it('returns undefined when the JO has no value', () => {
    const out = resolveCascadedField('selectedPositionIds', [
      L('jo', 'j1', {}),
    ]);
    expect(out.value).toBeUndefined();
    expect(out.provenance).toEqual([]);
  });

  it('ignores writes at the wrong level even when JO is silent', () => {
    // selectedPositionIds is editable at jo only. An account-level
    // write must NOT leak into the resolved value.
    const out = resolveCascadedField('selectedPositionIds', [
      L('account', 'a1', { selectedPositionIds: ['stale'] }),
      L('jo', 'j1', {}),
    ]);
    expect(out.value).toBeUndefined();
  });
});

// ===================================================================
// Cross-cutting: resolveCascadedFieldWithSpec (custom specs)
// ===================================================================

describe('resolveCascadedFieldWithSpec', () => {
  it('runs an arbitrary spec the same way the registry does', () => {
    const spec: CascadeFieldSpec = {
      strategy: 'replace',
      editableAt: ['account', 'child', 'jo', 'shift'],
      label: 'Custom Field',
    };
    const out = resolveCascadedFieldWithSpec('customField', spec, [
      L('account', 'a1', { customField: 'a' }),
      L('shift', 's1', { customField: 'z' }),
    ]);
    expect(out.value).toBe('z');
  });
});
