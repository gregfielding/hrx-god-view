/**
 * **R.16.1 Phase 7** — Snapshot-aware effective field reader for Job
 * Orders. Pure, sync, library-only.
 *
 * The slice as shipped does NOT rewire any production read site to
 * use this helper. Consumers (`recruiterAccountOrderDefaultsMerge.ts`,
 * `JobOrderForm`, billing/payroll pipelines, etc.) still go through
 * the legacy cascade resolution. R.16.2 wires the helper into the
 * critical financial paths (`markupPercentage`, `payRate`/`billRate`,
 * `futa`/`suta`/`workersCompRate`, `hiringEntityId`) before the CORT
 * push. See `docs/CASCADE_PROPAGATION_R16.1_HANDOFF.md` §L2.
 *
 * Usage shape (post-R.16.2 — illustrative only):
 *
 *   const { value: markup, source } = getEffectiveJobOrderPositionField<number>(
 *     joDoc,
 *     positionId,
 *     'markupPercentage',
 *     { fallback: cascadeResolved.markupPercentage },
 *   );
 *
 * Why a separate helper instead of folding into `resolveCascadedField`:
 *   - The cascade engine is sync but reads from an `AncestorLevel[]`
 *     that the caller has already loaded. Snapshot lookup needs the
 *     JO doc itself. They're different inputs and different decision
 *     trees, so the helper layers cleanly on top of the engine.
 *   - The slice ships without consumer rewires. Keeping the helper
 *     standalone means R.16.2 can switch each consumer over without
 *     touching the engine.
 *
 * Decision tree (top-level fields):
 *
 *   1. JO is `'draft'` (or status is missing) → snapshot ignored →
 *      return `{ value: fallback, source: 'fallback' }`. Draft JOs
 *      are pre-activation; snapshots only matter post-activation.
 *
 *   2. JO has no snapshot (or `snapshot.capturedAt` is absent) →
 *      treat as un-frozen → return fallback. Defensively guards
 *      against partial-write states (e.g. a Push-to-Active write
 *      that landed `lastPushedAt` but somehow missed `capturedAt`).
 *
 *   3. Snapshot present + JO non-draft + `snapshot[fieldKey] !==
 *      undefined` → return `{ value: snapshotValue, source: 'snapshot' }`.
 *      `null` snapshot values are honoured — the snapshot trigger
 *      can intentionally capture `null` when the cascade resolved
 *      to nothing (e.g. no `screeningPackageId` set anywhere). A
 *      `null` snapshot value is "I deliberately froze nothing here,"
 *      not "fall back to live."
 *
 *   4. Snapshot present but `snapshot[fieldKey]` is `undefined` →
 *      fall back. The snapshot didn't capture this field for some
 *      reason (legacy snapshot before the field was added to the
 *      registry, partial backfill, etc.).
 *
 * Per-position decision tree mirrors the above with one extra step:
 * find the position by `positionId` in `snapshot.positions[]`. If no
 * matching position is found, fall back.
 *
 * @see docs/CASCADE_PROPAGATION_R16.1_HANDOFF.md §L2
 */

// ─────────────────────────────────────────────────────────────────────
// Self-contained structural fragments — keep this file pure /
// SDK-agnostic / type-self-contained so it can be byte-identical
// mirrored into `shared/jobOrder/` for the cloud-functions tree.
// (R.16.2a Q3 lock — `scripts/check-cascade-mirror.sh` enforces parity.)
//
// We intentionally don't import `JobOrderSnapshot` /
// `ResolvedPositionSnapshot` from `src/types/recruiter/jobOrder.ts`
// because that file pulls in `firebase/firestore`'s `FieldValue`,
// which would force this helper to pick a side (CRA SDK vs.
// admin SDK) and break the byte-mirror invariant.
//
// The helper only needs structural truthy/indexed access on the
// snapshot blob and its `positions` array — see decision tree above.
// Callers retain their own typed JO interfaces; the helper accepts
// them via the `JobOrderForEffectiveRead` minimum-shape interface.
// ─────────────────────────────────────────────────────────────────────

interface MinimalSnapshot {
  capturedAt?: unknown;
  positions?: unknown;
  [key: string]: unknown;
}

interface MinimalPositionSnapshot {
  positionId?: unknown;
  [key: string]: unknown;
}

// ─────────────────────────────────────────────────────────────────────
// Type narrowing — keep callers honest about which fields the helper
// can read. Mirrors the snapshot-policy field set in the registry.
// ─────────────────────────────────────────────────────────────────────

/**
 * Field keys readable as top-level snapshot envelope members.
 * Mirrors `JobOrderSnapshot`'s top-level keys — kept in lockstep
 * with `src/types/recruiter/jobOrder.ts:JobOrderSnapshot`.
 */
export type SnapshotFieldKey =
  | 'hiringEntityId'
  | 'eVerifyRequired'
  | 'workersCompCode'
  | 'screeningPackageId'
  | 'additionalScreenings'
  | 'selectedPositionIds'
  // R.16.2c additions — promoted to `propagation: 'snapshot-on-activation'`
  // in the registry. Adding them here unlocks consumer wraps via
  // `getEffectiveJobOrderField(joDoc, 'physicalRequirements', { fallback: ... })`.
  | 'scheduler'
  | 'pricingFlatMarkupPercent'
  | 'physicalRequirements'
  | 'customUniformRequirements'
  | 'attachments';

/**
 * Sub-field keys readable per-position from
 * `JobOrderSnapshot.positions[i]`. Mirrors `ResolvedPositionSnapshot`
 * minus `positionId`.
 */
export type SnapshotPositionFieldKey =
  | 'jobTitle'
  | 'jobDescription'
  | 'rateMode'
  | 'payRate'
  | 'billRate'
  | 'futa'
  | 'suta'
  | 'workersCompRate'
  | 'markupPercentage';

/** Where the returned value came from. */
export type EffectiveSource = 'snapshot' | 'fallback' | 'absent';

export interface EffectiveResult<T = unknown> {
  /**
   * Effective value. `null` is a valid snapshot-captured value (see
   * §16.1 L5) and is distinct from `undefined` (absent everywhere).
   */
  value: T | null | undefined;
  /**
   * `'snapshot'` — value came from `joDoc.snapshot.{fieldKey}`.
   * `'fallback'` — value came from the caller's `options.fallback`.
   * `'absent'` — neither snapshot nor fallback had a value; the
   * caller asked for a field nothing has provided. Distinct from
   * `'snapshot'` returning `null` so callers can disambiguate
   * "snapshot deliberately said no" from "no one knows."
   */
  source: EffectiveSource;
}

/**
 * Minimum shape the helper needs from a JO doc. Avoids importing the
 * full `JobOrder` interface so utilities can call this with arbitrary
 * Firestore data without a cast dance.
 */
export interface JobOrderForEffectiveRead {
  status?: string | null;
  snapshot?: MinimalSnapshot | null;
}

// ─────────────────────────────────────────────────────────────────────
// Implementation
// ─────────────────────────────────────────────────────────────────────

function isSnapshotted(snapshot: MinimalSnapshot | null | undefined): boolean {
  if (!snapshot || typeof snapshot !== 'object') return false;
  return snapshot.capturedAt !== undefined && snapshot.capturedAt !== null;
}

function isDraftStatus(status: string | null | undefined): boolean {
  // Treat missing status as draft — defensive. The snapshot trigger
  // never fires without a `status` field present, but a hand-written
  // legacy doc could have an empty status; in that case prefer the
  // live/cascade value over a stray snapshot blob.
  return !status || status === 'draft';
}

/**
 * Read a top-level snapshot-policy field with the §16.1 L2 precedence
 * applied. See module docstring for the full decision tree.
 */
export function getEffectiveJobOrderField<T = unknown>(
  joDoc: JobOrderForEffectiveRead | null | undefined,
  fieldKey: SnapshotFieldKey,
  options: { fallback?: T } = {},
): EffectiveResult<T> {
  const hasFallback = 'fallback' in options;
  const fallback = options.fallback;

  if (!joDoc) {
    return hasFallback
      ? { value: fallback, source: 'fallback' }
      : { value: undefined, source: 'absent' };
  }

  if (isDraftStatus(joDoc.status) || !isSnapshotted(joDoc.snapshot)) {
    return hasFallback
      ? { value: fallback, source: 'fallback' }
      : { value: undefined, source: 'absent' };
  }

  // Snapshot is authoritative once captured. Honour explicit `null`.
  const snapValue = (joDoc.snapshot as Record<string, unknown>)[fieldKey];
  if (snapValue !== undefined) {
    return { value: snapValue as T | null, source: 'snapshot' };
  }

  return hasFallback
    ? { value: fallback, source: 'fallback' }
    : { value: undefined, source: 'absent' };
}

/**
 * Read a sub-field of a single position from
 * `joDoc.snapshot.positions[i]` with the same L2 precedence.
 *
 * The `positions` snapshot is captured as one blob at activation
 * (see `onJobOrderStatusTransitionSnapshot.ts` for the resolver).
 * Each entry includes a `positionId` key plus the per-position
 * sub-fields registered in the cascade registry's `positions.itemFields`.
 *
 * If the JO is non-draft and a snapshot exists but the requested
 * `positionId` is not in `snapshot.positions`, we fall back. This
 * happens in two legitimate cases:
 *   1. The position wasn't selected at activation
 *      (`selectedPositionIds` didn't include it).
 *   2. The caller is asking about a position added after activation
 *      via a draft JO clone or similar.
 * In either case the snapshot has nothing authoritative to say, so
 * the cascade-resolved (or live) value wins.
 */
export function getEffectiveJobOrderPositionField<T = unknown>(
  joDoc: JobOrderForEffectiveRead | null | undefined,
  positionId: string,
  subField: SnapshotPositionFieldKey,
  options: { fallback?: T } = {},
): EffectiveResult<T> {
  const hasFallback = 'fallback' in options;
  const fallback = options.fallback;

  const fbResult: EffectiveResult<T> = hasFallback
    ? { value: fallback, source: 'fallback' }
    : { value: undefined, source: 'absent' };

  if (!joDoc || isDraftStatus(joDoc.status) || !isSnapshotted(joDoc.snapshot)) {
    return fbResult;
  }
  if (!positionId || typeof positionId !== 'string') {
    return fbResult;
  }

  const positions = joDoc.snapshot?.positions;
  if (!Array.isArray(positions)) return fbResult;

  const match = positions.find(
    (p): p is MinimalPositionSnapshot =>
      typeof p === 'object' &&
      p !== null &&
      (p as { positionId?: unknown }).positionId === positionId,
  );
  if (!match) return fbResult;

  const subValue = (match as Record<string, unknown>)[subField];
  if (subValue !== undefined) {
    return { value: subValue as T | null, source: 'snapshot' };
  }
  return fbResult;
}
