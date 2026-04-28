/**
 * **R.4.1** — Idempotency tests for `readinessSnapshotV1ComparableJson`.
 *
 * Locks in the stable-key replacer that fixes the recompute write-skip
 * for `'computing'` empty-contributor chips and any other case where
 * Firestore returns nested objects with alphabetically-sorted keys
 * vs the insertion-order-keyed objects produced by
 * `buildReadinessSnapshotV1Comparable`. See the hotfix note on the
 * stable-key replacer in `src/shared/readinessSnapshotV1.ts` for the
 * full root-cause writeup.
 *
 * Per L.4.1.3 in `docs/CLEANUP_R4_R16.2D_HANDOFF.md`, this suite must
 * cover (a) the chip-bearing case, (b) the empty-contributors case,
 * and (c) at least one nested `requirements[]` row to verify the
 * replacer applies recursively.
 *
 * Jest (`react-scripts test`).
 */

import {
  readinessSnapshotV1ComparableJson,
  type ReadinessSnapshotV1Comparable,
} from '../readinessSnapshotV1';
import type { JobReadinessChipData } from '../jobReadinessChip/types';

/**
 * Build the same comparable twice — once with insertion-order keys
 * (mirrors `buildReadinessSnapshotV1Comparable` output) and once with
 * keys re-inserted in alphabetical order (mirrors what Firestore
 * returns from a `DocumentSnapshot.data()` round-trip). The shape is
 * value-identical; only the runtime key-insertion order differs.
 *
 * `JSON.stringify` honours insertion order, so without the stable-key
 * replacer these two comparables stringify to *different* JSON, which
 * is the exact regression we're locking out.
 */
function reshuffleKeysAlphabetically<T extends object>(o: T): T {
  const sorted: Record<string, unknown> = {};
  for (const k of Object.keys(o).sort()) {
    const v = (o as Record<string, unknown>)[k];
    sorted[k] = v && typeof v === 'object' && !Array.isArray(v)
      ? reshuffleKeysAlphabetically(v as object)
      : Array.isArray(v)
        ? v.map((el) =>
            el && typeof el === 'object' && !Array.isArray(el)
              ? reshuffleKeysAlphabetically(el as object)
              : el,
          )
        : v;
  }
  return sorted as T;
}

const COMPUTING_CHIP: JobReadinessChipData = {
  state: 'computing',
  text: 'Job Ready (computing\u2026)',
  pendingCount: 0,
  blockerCount: 0,
  contributors: [],
};

const RED_CHIP_WITH_CASE_ID: JobReadinessChipData = {
  state: 'red',
  text: 'Job Not Ready',
  pendingCount: 0,
  blockerCount: 1,
  contributors: [
    {
      source: 'employee',
      itemId: 'w1__entA__e_verify',
      workerUid: 'w1',
      requirementType: 'e_verify',
      requirementLabel: 'E-Verify',
      contribution: 'red',
      status: 'needs_review',
      resolutionMethod: null,
      severity: 'hard',
      detail: 'Needs review',
      caseId: 'everify_cases/abc-123',
    },
  ],
};

const MIXED_CHIP: JobReadinessChipData = {
  state: 'yellow',
  text: 'Job Ready (1 pending)',
  pendingCount: 1,
  blockerCount: 0,
  contributors: [
    {
      source: 'assignment',
      itemId: 'a1__skill_match__forklift',
      workerUid: 'w1',
      requirementType: 'skill_match',
      requirementLabel: 'Skills',
      contribution: 'yellow',
      status: 'incomplete',
      resolutionMethod: 'self_attest',
      severity: 'soft',
      detail: 'Worker has not answered yet',
    },
    {
      source: 'assignment',
      itemId: 'a1__cert_match__forklift_cert',
      workerUid: 'w1',
      requirementType: 'cert_match',
      requirementLabel: 'Certifications',
      contribution: 'green',
      status: 'complete_pass',
      resolutionMethod: 'auto',
      severity: 'hard',
      detail: 'Satisfied',
    },
  ],
};

function buildSnapshot(over: Partial<ReadinessSnapshotV1Comparable>): ReadinessSnapshotV1Comparable {
  return {
    state: 'PENDING_INITIALIZATION',
    sourceVersion: 1,
    summary: { blockers: 0, warnings: 0, completed: 0 },
    requirements: [],
    ...over,
  };
}

describe('readinessSnapshotV1ComparableJson — stable-key replacer (R.4.1)', () => {
  // (b) — empty-contributors `'computing'` chip case. This is the
  // canonical reproduction of the bug from the R.7 follow-up note.
  it('canonicalises the empty-contributor `computing` chip across insertion-order vs alphabetical-key shapes', () => {
    const fresh = buildSnapshot({
      jobReadinessChip: COMPUTING_CHIP,
    });
    const firestoreShaped = reshuffleKeysAlphabetically(fresh);
    expect(readinessSnapshotV1ComparableJson(fresh)).toBe(
      readinessSnapshotV1ComparableJson(firestoreShaped),
    );
  });

  // (a) — chip-bearing case, this time with the optional `caseId?`
  // field so we exercise a path where a contributor object's key set
  // changes shape across items.
  it('canonicalises a red chip with one contributor carrying an optional `caseId`', () => {
    const fresh = buildSnapshot({
      state: 'BLOCKED',
      summary: { blockers: 1, warnings: 0, completed: 0 },
      jobReadinessChip: RED_CHIP_WITH_CASE_ID,
    });
    const firestoreShaped = reshuffleKeysAlphabetically(fresh);
    expect(readinessSnapshotV1ComparableJson(fresh)).toBe(
      readinessSnapshotV1ComparableJson(firestoreShaped),
    );
  });

  // (c) — recursive replacer coverage. The mixed chip has two
  // contributors, AND we also reshuffle a `requirements[]` row's keys
  // to assert the replacer descends into array elements (objects-
  // inside-arrays must also be canonicalised).
  it('canonicalises mixed contributors AND a reshuffled `requirements[]` row (recursive)', () => {
    const fresh = buildSnapshot({
      state: 'READY_WITH_WARNINGS',
      summary: { blockers: 0, warnings: 1, completed: 1 },
      requirements: [
        {
          key: 'cert_forklift',
          label: 'Forklift cert',
          category: 'certification',
          status: 'complete',
          severity: 'warning',
        },
        {
          key: 'cert_forklift_skill',
          label: 'Forklift skill',
          category: 'certification',
          status: 'in_progress',
          severity: 'warning',
        },
      ],
      jobReadinessChip: MIXED_CHIP,
    });
    const firestoreShaped = reshuffleKeysAlphabetically(fresh);
    expect(readinessSnapshotV1ComparableJson(fresh)).toBe(
      readinessSnapshotV1ComparableJson(firestoreShaped),
    );
  });

  // Round-trip: parse → serialize → parse → serialize. Two trips
  // because the very first stringify already canonicalises; we want
  // to assert the canonical form survives a re-parse without drifting.
  it('round-trips through JSON.parse without changing the canonical string', () => {
    const fresh = buildSnapshot({
      state: 'READY_WITH_WARNINGS',
      summary: { blockers: 0, warnings: 1, completed: 0 },
      requirements: [
        {
          key: 'cert_cdl',
          label: 'CDL License',
          category: 'certification',
          status: 'in_progress',
          severity: 'warning',
        },
      ],
      jobReadinessChip: MIXED_CHIP,
    });
    const json1 = readinessSnapshotV1ComparableJson(fresh);
    const reparsed = JSON.parse(json1) as ReadinessSnapshotV1Comparable;
    const json2 = readinessSnapshotV1ComparableJson(reparsed);
    expect(json2).toBe(json1);
  });

  // Pre-R.4 snapshot shape: no `jobReadinessChip` field at all. The
  // canonical JSON must NOT regress to having `"jobReadinessChip":{}`
  // on either side; absent-key comparables stay equal across both
  // construction paths (literal-omit vs explicit-`undefined`-then-spread).
  it('preserves the absent `jobReadinessChip` key for pre-R.4 snapshots (no false-positive against `chip:{}`)', () => {
    const noChipKey: ReadinessSnapshotV1Comparable = buildSnapshot({
      state: 'READY',
      summary: { blockers: 0, warnings: 0, completed: 1 },
      requirements: [
        {
          key: 'cert_cpr',
          label: 'CPR',
          category: 'certification',
          status: 'complete',
          severity: 'warning',
        },
      ],
    });
    const explicitUndefined: ReadinessSnapshotV1Comparable = {
      ...noChipKey,
      jobReadinessChip: undefined,
    };
    const a = readinessSnapshotV1ComparableJson(noChipKey);
    const b = readinessSnapshotV1ComparableJson(explicitUndefined);
    expect(a).toBe(b);
    expect(a).not.toContain('jobReadinessChip');
  });
});
