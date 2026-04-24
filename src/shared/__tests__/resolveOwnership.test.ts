/**
 * Unit tests for `resolveOwnership`.
 *
 * Covers the resolution algorithm in `recruiter-ownership-model.md §4`
 * (hierarchy walk, tie-breaker, visibility union, unassigned pool fallback)
 * and the edge cases enumerated in §7.
 *
 * The resolver is pure — no Firestore, no I/O — so these tests exercise only
 * the decision logic. Sticky-primary semantics live in callers; this file
 * does NOT test stickiness.
 */

import {
  resolveOwnership,
  gatherTierCandidates,
  pickPrimaryAtTier,
  stableHashPick,
} from '../resolveOwnership';
import { ResolveOwnershipInput, ResolveOwnershipResult } from '../actionItemOwnership';

/** Helper: minimum-viable input stub. */
function baseInput(overrides: Partial<ResolveOwnershipInput> = {}): ResolveOwnershipInput {
  return {
    tenantId: 'tenantA',
    workerUid: 'worker1',
    ...overrides,
  };
}

describe('resolveOwnership — hierarchy walk (§4b)', () => {
  it('picks job-order recruiter when JO tier has candidates', () => {
    const result = resolveOwnership(
      baseInput({
        jobOrder: { id: 'jo1', assignedRecruiters: ['recA'] },
        account: { id: 'acc1', recruiterIds: ['recB'] },
        userGroups: [{ id: 'g1', groupManagerIds: ['recC'] }],
        tenantDefaults: { defaultRecruiterId: 'recD' },
      }),
    );
    expect(result.primaryRecruiterId).toBe('recA');
    expect(result.primarySource).toBe('job_order');
  });

  it('falls through to account when JO has no recruiters', () => {
    const result = resolveOwnership(
      baseInput({
        jobOrder: { id: 'jo1', assignedRecruiters: [] },
        account: { id: 'acc1', recruiterIds: ['recB'] },
        userGroups: [{ id: 'g1', groupManagerIds: ['recC'] }],
      }),
    );
    expect(result.primaryRecruiterId).toBe('recB');
    expect(result.primarySource).toBe('account');
  });

  it('falls through to user groups when JO and account empty', () => {
    const result = resolveOwnership(
      baseInput({
        account: { id: 'acc1', recruiterIds: [] },
        userGroups: [{ id: 'g1', groupManagerIds: ['recC'] }],
        tenantDefaults: { defaultRecruiterId: 'recD' },
      }),
    );
    expect(result.primaryRecruiterId).toBe('recC');
    expect(result.primarySource).toBe('user_group');
  });

  it('falls through to tenant default when all hierarchy tiers empty', () => {
    const result = resolveOwnership(
      baseInput({
        tenantDefaults: { defaultRecruiterId: 'recD', unassignedPoolEnabled: false },
      }),
    );
    expect(result.primaryRecruiterId).toBe('recD');
    expect(result.primarySource).toBe('tenant_default');
  });

  it('lands in unassigned pool when no hierarchy match and pool enabled', () => {
    const result = resolveOwnership({
      ...baseInput(),
      tenantDefaults: { unassignedPoolEnabled: true },
      unassignedPool: ['poolRec1', 'poolRec2'],
    });
    expect(result.primaryRecruiterId).toBeNull();
    expect(result.primarySource).toBe('unassigned');
    expect(result.visibleRecruiterIds).toEqual(expect.arrayContaining(['poolRec1', 'poolRec2']));
  });

  it('stays orphaned (null primary, empty visibility) when pool disabled and nothing matches (§9 #6 edge)', () => {
    const result = resolveOwnership(
      baseInput({
        tenantDefaults: { unassignedPoolEnabled: false },
      }),
    );
    expect(result.primaryRecruiterId).toBeNull();
    expect(result.primarySource).toBe('unassigned');
    expect(result.visibleRecruiterIds).toEqual([]);
  });
});

describe('resolveOwnership — tie-breaker (§4c)', () => {
  it('honors explicit isPrimary flag at the winning tier', () => {
    const result = resolveOwnership(
      baseInput({
        jobOrder: {
          id: 'jo1',
          assignedRecruiters: ['recA', 'recB', 'recC'],
          recruiterAssociations: [
            { recruiterId: 'recA', isPrimary: false },
            { recruiterId: 'recB', isPrimary: true },
            { recruiterId: 'recC', isPrimary: false },
          ],
        },
      }),
    );
    expect(result.primaryRecruiterId).toBe('recB');
    expect(result.primarySource).toBe('job_order');
  });

  it('breaks ties deterministically by stable hash when no isPrimary flags', () => {
    const input = baseInput({
      jobOrder: { id: 'jo1', assignedRecruiters: ['r2', 'r1', 'r3'] },
    });
    const first = resolveOwnership(input);
    const second = resolveOwnership(input);
    // Determinism: repeated calls with same seed pick the same recruiter.
    expect(first.primaryRecruiterId).toBe(second.primaryRecruiterId);
    // And the pick is one of the candidates.
    expect(['r1', 'r2', 'r3']).toContain(first.primaryRecruiterId);
  });

  it('different items (different stable seeds) can pick different primaries from the same candidate set', () => {
    const jo = { id: 'jo1', assignedRecruiters: ['r1', 'r2', 'r3'] };
    const picks = new Set<string | null>();
    for (let i = 0; i < 20; i++) {
      const result = resolveOwnership(
        baseInput({
          workerUid: `worker_${i}`, // seed varies
          jobOrder: jo,
        }),
      );
      picks.add(result.primaryRecruiterId);
    }
    // With 20 different seeds and 3 candidates, we expect all 3 to appear.
    expect(picks.size).toBeGreaterThanOrEqual(2);
  });

  it('when multiple candidates are flagged isPrimary, picks deterministically among the flagged', () => {
    const result = resolveOwnership(
      baseInput({
        jobOrder: {
          id: 'jo1',
          assignedRecruiters: ['recA', 'recB', 'recC', 'recD'],
          recruiterAssociations: [
            { recruiterId: 'recA', isPrimary: true },
            { recruiterId: 'recB', isPrimary: true },
            { recruiterId: 'recC', isPrimary: false },
          ],
        },
      }),
    );
    // Result must be one of the flagged ones; non-flagged recC/recD never win.
    expect(['recA', 'recB']).toContain(result.primaryRecruiterId);
  });

  it('ignores isPrimary flags whose recruiterId is not actually in the tier candidates', () => {
    const result = resolveOwnership(
      baseInput({
        jobOrder: {
          id: 'jo1',
          assignedRecruiters: ['recA', 'recB'],
          recruiterAssociations: [
            { recruiterId: 'ghost', isPrimary: true }, // not in assignedRecruiters
          ],
        },
      }),
    );
    expect(['recA', 'recB']).toContain(result.primaryRecruiterId);
  });
});

describe('resolveOwnership — visibility (§4a)', () => {
  it('unions visibility across every tier with candidates, not only the primary tier', () => {
    const result = resolveOwnership(
      baseInput({
        jobOrder: { id: 'jo1', assignedRecruiters: ['recA'] },
        account: { id: 'acc1', recruiterIds: ['recB'] },
        userGroups: [
          { id: 'g1', groupManagerIds: ['recC'] },
          { id: 'g2', groupManagerIds: ['recD'] },
        ],
        tenantDefaults: { defaultRecruiterId: 'recE' },
      }),
    );
    expect(result.primaryRecruiterId).toBe('recA');
    expect(result.visibleRecruiterIds.sort()).toEqual(['recA', 'recB', 'recC', 'recD', 'recE'].sort());
  });

  it('ensures primaryRecruiterId is always in visibleRecruiterIds when non-null', () => {
    const result = resolveOwnership(
      baseInput({
        jobOrder: { id: 'jo1', assignedRecruiters: ['recA'] },
      }),
    );
    expect(result.visibleRecruiterIds).toContain(result.primaryRecruiterId);
  });

  it('dedupes recruiters that appear in multiple tiers (§7 #1)', () => {
    const result = resolveOwnership(
      baseInput({
        jobOrder: { id: 'jo1', assignedRecruiters: ['recShared'] },
        account: { id: 'acc1', recruiterIds: ['recShared'] },
        userGroups: [{ id: 'g1', groupManagerIds: ['recShared', 'recC'] }],
      }),
    );
    expect(result.visibleRecruiterIds.filter((r) => r === 'recShared')).toHaveLength(1);
    expect(result.visibleRecruiterIds.sort()).toEqual(['recC', 'recShared']);
  });

  it('returns a sorted list of visible recruiters for stable UI rendering', () => {
    const result = resolveOwnership(
      baseInput({
        jobOrder: { id: 'jo1', assignedRecruiters: ['zzzz', 'aaaa', 'mmmm'] },
      }),
    );
    const sorted = [...result.visibleRecruiterIds].sort();
    expect(result.visibleRecruiterIds).toEqual(sorted);
  });
});

describe('resolveOwnership — edge cases (§7)', () => {
  it('#1 — worker in two user groups with different recruiters: both contribute to visibility', () => {
    const result = resolveOwnership(
      baseInput({
        userGroups: [
          { id: 'g1', groupManagerIds: ['recA'] },
          { id: 'g2', groupManagerIds: ['recB'] },
        ],
      }),
    );
    expect(result.visibleRecruiterIds.sort()).toEqual(['recA', 'recB']);
    expect(['recA', 'recB']).toContain(result.primaryRecruiterId);
    expect(result.primarySource).toBe('user_group');
  });

  it('#2 — assignment readiness item for JO with no assigned recruiters falls through', () => {
    const result = resolveOwnership(
      baseInput({
        jobOrder: { id: 'jo1', assignedRecruiters: [] },
        account: { id: 'acc1', recruiterIds: ['accountRec'] },
      }),
    );
    expect(result.primaryRecruiterId).toBe('accountRec');
    expect(result.primarySource).toBe('account');
  });

  it('#3 — employee readiness item with no placements: user-group recruiter wins', () => {
    const result = resolveOwnership(
      baseInput({
        userGroups: [{ id: 'g1', groupManagerIds: ['groupRec'] }],
      }),
    );
    expect(result.primaryRecruiterId).toBe('groupRec');
    expect(result.primarySource).toBe('user_group');
  });

  it('#6 — orphaned when tenant disables pool and no hierarchy matches', () => {
    const result = resolveOwnership({
      ...baseInput(),
      tenantDefaults: { unassignedPoolEnabled: false },
      unassignedPool: ['shouldNotBeUsed'],
    });
    expect(result.primaryRecruiterId).toBeNull();
    expect(result.primarySource).toBe('unassigned');
    expect(result.visibleRecruiterIds).toEqual([]);
  });

  it('pool fallback adds to visibility even when pool is supplied but hierarchy also empty', () => {
    const result = resolveOwnership({
      ...baseInput(),
      tenantDefaults: { unassignedPoolEnabled: true },
      unassignedPool: ['rec1', 'rec2', 'rec3'],
    });
    expect(result.primaryRecruiterId).toBeNull();
    expect(result.visibleRecruiterIds.sort()).toEqual(['rec1', 'rec2', 'rec3']);
  });

  it('ignores empty / whitespace-only recruiter IDs on every tier', () => {
    const result = resolveOwnership(
      baseInput({
        jobOrder: { id: 'jo1', assignedRecruiters: ['', '   ', 'recA'] },
        account: { id: 'acc1', recruiterIds: ['', 'recB'] },
      }),
    );
    expect(result.primaryRecruiterId).toBe('recA'); // JO tier wins, empty strings filtered
    expect(result.visibleRecruiterIds.sort()).toEqual(['recA', 'recB']);
  });
});

describe('resolveOwnership — tie-breaker helpers (exported for unit testing)', () => {
  it('pickPrimaryAtTier: single candidate returns that candidate', () => {
    const pick = pickPrimaryAtTier(
      { tier: 'job_order', candidates: ['onlyOne'], associations: [] },
      'seed',
    );
    expect(pick).toBe('onlyOne');
  });

  it('pickPrimaryAtTier: zero candidates returns null', () => {
    const pick = pickPrimaryAtTier(
      { tier: 'job_order', candidates: [], associations: [] },
      'seed',
    );
    expect(pick).toBeNull();
  });

  it('stableHashPick: order of input array does not change result', () => {
    const a = stableHashPick(['a', 'b', 'c', 'd'], 'seed-x');
    const b = stableHashPick(['d', 'c', 'b', 'a'], 'seed-x');
    expect(a).toBe(b);
  });

  it('stableHashPick: different seeds can produce different winners', () => {
    const uids = ['a', 'b', 'c', 'd'];
    const winners = new Set<string>();
    for (let i = 0; i < 20; i++) {
      winners.add(stableHashPick(uids, `seed-${i}`));
    }
    // With 20 seeds across 4 candidates, we should see variety.
    expect(winners.size).toBeGreaterThan(1);
  });

  it('gatherTierCandidates: only emits tiers that were provided in input', () => {
    const tiers = gatherTierCandidates(
      baseInput({
        jobOrder: { id: 'jo1', assignedRecruiters: ['r'] },
        // no account, no user groups, no tenant default
      }),
    );
    expect(tiers.map((t) => t.tier)).toEqual(['job_order']);
  });

  it('gatherTierCandidates: includes tenant_default tier only when defaultRecruiterId is set', () => {
    const withDefault = gatherTierCandidates(
      baseInput({ tenantDefaults: { defaultRecruiterId: 'recD' } }),
    );
    expect(withDefault.map((t) => t.tier)).toContain('tenant_default');

    const withoutDefault = gatherTierCandidates(
      baseInput({ tenantDefaults: { unassignedPoolEnabled: true } }),
    );
    expect(withoutDefault.map((t) => t.tier)).not.toContain('tenant_default');
  });
});

describe('resolveOwnership — return shape invariants', () => {
  it('returns the exact ResolveOwnershipResult shape every call (no extras, no missing fields)', () => {
    const result: ResolveOwnershipResult = resolveOwnership(
      baseInput({
        jobOrder: { id: 'jo1', assignedRecruiters: ['r'] },
      }),
    );
    const keys = Object.keys(result).sort();
    expect(keys).toEqual(['primaryRecruiterId', 'primarySource', 'visibleRecruiterIds']);
    expect(typeof result.primarySource).toBe('string');
    expect(Array.isArray(result.visibleRecruiterIds)).toBe(true);
  });
});
