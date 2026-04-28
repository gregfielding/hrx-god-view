/**
 * Persisted HRX V1 readiness snapshot on `tenants/{tid}/assignments/{id}.readinessSnapshotV1`.
 * Cross-app contract (e.g. Flutter) — separate from `assignmentReadinessV1` (onboarding/package sync).
 *
 * **R.4 — additive extension (2026-04-26):**
 * The shape gains an OPTIONAL `jobReadinessChip` field carrying the
 * per-(worker × shift) Job Readiness chip data. Existing `state` /
 * `summary` / `requirements` fields are unchanged; existing consumers
 * (`PlacementsTab.tsx`, Flutter) keep working without modification. New
 * surfaces (R.4 chip, R.7 worker view header, R.8 CSA matrix) read the
 * new field. `sourceVersion` stays at `1` because the legacy fields are
 * untouched; readers that don't recognise `jobReadinessChip` simply ignore
 * it.
 */

import type {
  BuildAssignmentReadinessResult,
  OverallReadinessState,
  ReadinessCategory,
  ReadinessRequirement,
  ReadinessRequirementStatus,
  ReadinessSeverity,
} from './buildAssignmentReadiness';
import type { JobReadinessChipData } from './jobReadinessChip/types';

export const READINESS_SNAPSHOT_V1_SOURCE_VERSION = 1;

export type ReadinessSnapshotV1Requirement = {
  key: string;
  label: string;
  category: ReadinessCategory;
  status: ReadinessRequirementStatus;
  severity: ReadinessSeverity;
};

/** Firestore document shape (`updatedAt` = `serverTimestamp()` at write time). */
export type ReadinessSnapshotV1Firestore = {
  state: OverallReadinessState;
  sourceVersion: number;
  summary: {
    blockers: number;
    warnings: number;
    completed: number;
  };
  requirements: ReadinessSnapshotV1Requirement[];
  updatedAt?: unknown;
  /**
   * **R.4** — Per-(worker × shift) Job Readiness chip. Optional / additive;
   * absent on snapshots written by pre-R.4 trigger code. New surfaces
   * (R.4 placement chip, R.7 worker view header, R.8 CSA matrix) read this
   * field directly off the snapshot doc — no extra Firestore read needed
   * because the writer already touched both readiness collections to
   * compute it.
   */
  jobReadinessChip?: JobReadinessChipData;
};

/** Serializable payload for comparisons (no timestamps). */
export type ReadinessSnapshotV1Comparable = {
  state: OverallReadinessState;
  sourceVersion: number;
  summary: { blockers: number; warnings: number; completed: number };
  requirements: ReadinessSnapshotV1Requirement[];
  /** **R.4** — included in the comparable so triggers can short-circuit the
   *  Firestore write when the chip data is also unchanged. */
  jobReadinessChip?: JobReadinessChipData;
};

export function buildReadinessSnapshotV1Comparable(result: BuildAssignmentReadinessResult): ReadinessSnapshotV1Comparable {
  return {
    state: result.readiness,
    sourceVersion: READINESS_SNAPSHOT_V1_SOURCE_VERSION,
    summary: { ...result.summary },
    requirements: result.requirements.map(requirementToSnapshotRow),
    ...(result.jobReadinessChip ? { jobReadinessChip: result.jobReadinessChip } : {}),
  };
}

export function requirementToSnapshotRow(r: ReadinessRequirement): ReadinessSnapshotV1Requirement {
  return {
    key: r.key,
    label: r.label,
    category: r.category,
    status: r.status,
    severity: r.severity,
  };
}

/**
 * **R.4.1** — Recursive object-key normaliser used as a `JSON.stringify`
 * replacer.
 *
 * Why this exists:
 *   The recompute path in `syncHrxReadinessSnapshotV1.ts` short-circuits
 *   the Firestore write when
 *   `readinessSnapshotV1ComparableJson(existing) === readinessSnapshotV1ComparableJson(next)`.
 *   That comparison is purely string-equality, so the two JSON strings
 *   must be byte-identical. `tryParseComparable` reconstructs the
 *   *top-level* shape with explicit key order, but the nested
 *   `requirements[]` rows and `jobReadinessChip` object are passed
 *   through as raw casts — and Firestore returns nested objects with
 *   alphabetically-sorted keys, while `buildReadinessSnapshotV1Comparable`
 *   produces them in insertion order. For an empty-contributor
 *   `'computing'` chip the freshly-built `{state, text, pendingCount,
 *   blockerCount, contributors}` becomes Firestore-shaped
 *   `{blockerCount, contributors, pendingCount, state, text}` after a
 *   round-trip, and the `===` check fails → wasted write. Same applies
 *   to every `requirements[]` row.
 *
 * The fix is to canonicalise the JSON output: recursively sort the keys
 * of every object node before stringification. Both sides go through
 * the same normaliser, so insertion order on either side stops mattering.
 *
 * Scope notes:
 *   - Arrays preserve their element order — semantic. (`requirements`
 *     and `contributors` are sorted upstream by the aggregator.)
 *   - `null` short-circuits via the `value &&` check (`typeof null === 'object'`
 *     in JS but `Boolean(null) === false`).
 *   - The persisted Firestore doc also benefits — `assignRef.set(...)`
 *     receives the canonical-keyed object, so future test fixtures /
 *     external consumers see deterministic key order too.
 *
 * @see docs/CLEANUP_R4_R16.2D_HANDOFF.md §L.4.1.2
 * @see functions/src/readiness/syncHrxReadinessSnapshotV1.ts (the consumer)
 */
function stableKeyReplacer(_key: string, value: unknown): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(value as object).sort()) {
      sorted[k] = (value as Record<string, unknown>)[k];
    }
    return sorted;
  }
  return value;
}

export function readinessSnapshotV1ComparableJson(c: ReadinessSnapshotV1Comparable): string {
  return JSON.stringify(c, stableKeyReplacer);
}
