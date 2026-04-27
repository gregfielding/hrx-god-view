/**
 * Cascading Order Data — pure resolver engine (handoff §6).
 *
 * Single entry-point: {@link resolveCascadedField}. The engine is
 * data-driven by `CASCADE_REGISTRY` (`./registry.ts`) and dispatches
 * on the per-field strategy. No Firestore, no React, no async — this
 * file is unit-testable in isolation.
 *
 * The caller composes the ancestor chain (account → child/location
 * → jo → shift) and passes it as `chain`. The engine never looks up
 * data on its own; it just computes the resolved value + provenance
 * from the deltas the caller supplied.
 *
 * Mirrored to `src/shared/cascade/resolveCascadedField.ts` for the
 * CRA bundle. They MUST stay in sync byte-for-byte.
 */

import { CASCADE_REGISTRY, type CascadingFieldKey } from './registry';
import type {
  AncestorLevel,
  CascadeFieldSpec,
  ContributionKind,
  EditableLevel,
  ItemIdentity,
  LevelType,
  ProvenanceEntry,
  ResolvedCascadeValue,
} from './types';

// ---- Public API ----------------------------------------------------

export interface ResolveOptions {
  /**
   * Skip the `editableAt` guard entirely. Off by default — the guard
   * is a defense-in-depth check that ignores writes at levels the
   * registry says shouldn't carry the field. Tests may want to flip
   * this to verify the guard's behaviour rather than work around it.
   */
  ignoreEditableGuard?: boolean;
}

/**
 * Resolve a single cascading field against an ancestor chain.
 *
 * @param field  Registered field key. Narrowed to the registry, so
 *               `resolveCascadedField('uniformRequirements', chain)`
 *               gets a typed return without runtime checks.
 * @param chain  Ancestor → target order (e.g. `[account, child, jo,
 *               shift]`). Order matters — the last entry is the
 *               closest-to-target level. Levels missing the field
 *               are simply skipped.
 * @returns      `{ value, provenance }`. `value` is the strategy-
 *               specific resolved type (T[] for unions, Record for
 *               merge_deep, etc.). `provenance` is one entry per
 *               level that contributed, in chain order.
 */
export function resolveCascadedField<K extends CascadingFieldKey>(
  field: K,
  chain: ReadonlyArray<AncestorLevel>,
  options: ResolveOptions = {},
): ResolvedCascadeValue {
  const spec = CASCADE_REGISTRY[field] as CascadeFieldSpec;
  if (!spec) {
    // Should be unreachable thanks to the K extends constraint, but
    // keep a runtime guard for JS callers / dynamic dispatch.
    throw new Error(`[cascade] unknown field "${String(field)}"`);
  }
  return dispatch(field as string, spec, chain, options);
}

/**
 * Lower-level escape hatch: resolve against an arbitrary
 * `CascadeFieldSpec`. Used internally by the `keyed_list` strategy
 * to recursively resolve `itemFields` (which aren't in the top-level
 * registry). Exported for engine tests; consumers should prefer
 * `resolveCascadedField` so registry typing is enforced.
 */
export function resolveCascadedFieldWithSpec(
  field: string,
  spec: CascadeFieldSpec,
  chain: ReadonlyArray<AncestorLevel>,
  options: ResolveOptions = {},
): ResolvedCascadeValue {
  return dispatch(field, spec, chain, options);
}

// ---- Dispatch ------------------------------------------------------

function dispatch(
  field: string,
  spec: CascadeFieldSpec,
  chain: ReadonlyArray<AncestorLevel>,
  options: ResolveOptions,
): ResolvedCascadeValue {
  const guarded = options.ignoreEditableGuard
    ? chain
    : chain.filter((lvl) => isLevelEditableForSpec(lvl.levelType, spec));

  switch (spec.strategy) {
    case 'replace':
      return resolveReplace(field, guarded);
    case 'union_with_remove':
      return resolveUnionWithRemove(field, spec, guarded);
    case 'merge_deep':
      return resolveMergeDeep(field, guarded);
    case 'keyed_list':
      return resolveKeyedList(field, spec, guarded, options);
    case 'level_only':
      return resolveLevelOnly(field, spec, guarded);
    default: {
      // Exhaustiveness check — TS will flag a missing branch above,
      // and the throw makes the runtime behaviour explicit if a new
      // strategy lands without an engine update.
      const _exhaustive: never = spec.strategy;
      throw new Error(
        `[cascade] no resolver for strategy "${String(_exhaustive)}" on field "${field}"`,
      );
    }
  }
}

// ---- Strategy: replace --------------------------------------------

/**
 * Closest-to-target non-undefined value wins. Explicit `null` IS a
 * value (means "cleared at this level") and overrides any ancestor.
 * `undefined` / missing key means "no contribution from this level".
 *
 * Provenance: one entry per level that contributed. The first
 * contributor is `set_initial`; every subsequent contributor is
 * `overrode`.
 */
function resolveReplace(
  field: string,
  chain: ReadonlyArray<AncestorLevel>,
): ResolvedCascadeValue {
  const provenance: ProvenanceEntry[] = [];
  let value: unknown = undefined;
  let hasAny = false;

  for (const level of chain) {
    if (!hasOwn(level.deltas, field)) continue;
    const v = level.deltas[field];
    provenance.push(
      makeProv(level, hasAny ? 'overrode' : 'set_initial', v),
    );
    value = v;
    hasAny = true;
  }

  return { value, provenance };
}

// ---- Strategy: union_with_remove ----------------------------------

interface UnionDelta {
  added?: ReadonlyArray<unknown>;
  removed?: ReadonlyArray<unknown>;
}

/**
 * Stack items across the chain with per-level add/remove deltas.
 * Each level's `deltas[field]` is one of:
 *
 *   - `{ added?: T[], removed?: T[] }`  — explicit delta blob
 *   - `T[]`                              — shorthand for `{ added: T[] }`
 *
 * Identity is governed by `spec.itemIdentity`:
 *
 *   - `string_exact` — case-sensitive string equality
 *   - `slug`         — lowercase, alphanumeric-only normalised key
 *
 * Output: a deduped array of items in insertion order (ancestor
 * adds first, then descendants). Removals at any level remove
 * matching items already present.
 *
 * Provenance: per level that contributed; one entry for `added`
 * items and a separate entry for `removed` items if both were
 * present. `value` carries just the items that level touched (not
 * the merged set), so the UI can render "(added at JO)" /
 * "(removed at Shift)" without re-deriving.
 */
function resolveUnionWithRemove(
  field: string,
  spec: CascadeFieldSpec,
  chain: ReadonlyArray<AncestorLevel>,
): ResolvedCascadeValue {
  const identity: ItemIdentity = spec.itemIdentity ?? 'string_exact';
  const provenance: ProvenanceEntry[] = [];

  // Map of identity key → item value. Insertion order on a Map is
  // preserved, so iterating it later yields items in chain order.
  const acc = new Map<string, unknown>();

  for (const level of chain) {
    if (!hasOwn(level.deltas, field)) continue;
    const raw = level.deltas[field];
    const delta = normalizeUnionDelta(raw);
    if (!delta) continue;

    const added = delta.added ?? [];
    const removed = delta.removed ?? [];

    if (added.length > 0) {
      const reallyAdded: unknown[] = [];
      for (const item of added) {
        const id = identityFor(item, identity);
        if (id == null) continue; // skip non-identifiable items
        if (!acc.has(id)) {
          acc.set(id, item);
          reallyAdded.push(item);
        }
        // If already present, this level's "added" is a no-op for the
        // resolved value but we still record the intent in provenance
        // below by including it under `value`. Choose the cleaner
        // story: only report items that actually entered the set.
      }
      if (reallyAdded.length > 0) {
        provenance.push(makeProv(level, 'added', reallyAdded));
      }
    }

    if (removed.length > 0) {
      const reallyRemoved: unknown[] = [];
      for (const item of removed) {
        const id = identityFor(item, identity);
        if (id == null) continue;
        if (acc.has(id)) {
          reallyRemoved.push(acc.get(id));
          acc.delete(id);
        }
      }
      if (reallyRemoved.length > 0) {
        provenance.push(makeProv(level, 'removed', reallyRemoved));
      }
    }
  }

  return { value: Array.from(acc.values()), provenance };
}

// ---- Strategy: merge_deep -----------------------------------------

/**
 * Per-key merge. Each level's `deltas[field]` is an object whose
 * top-level keys are the merge unit:
 *
 *   - missing key  → no contribution at this level for that key
 *   - explicit `null` → clears the key (descendant wins, key is removed)
 *   - any other value → replaces the key (atomic — does NOT recurse)
 *
 * "Atomic at depth 1" mirrors how the existing
 * `recruiterAccountOrderDefaultsMerge` works for `staffInstructions`
 * (each instruction blob like `{ text, updatedAt, updatedBy }` is
 * stored / replaced as a unit per key).
 *
 * Provenance: one entry per (level, top-level-key) pair that
 * contributed. The entry's `value` is `{ key, value }` so the UI
 * can render per-key provenance ("Parking from Account, First Day
 * from JO") via {@link provenanceForKey} without re-deriving.
 *
 *  - First contributor for a key  → `set_initial`
 *  - Later contributor for the same key (non-null) → `overrode`
 *  - Later contributor for the same key (null)     → `removed`
 */
function resolveMergeDeep(
  field: string,
  chain: ReadonlyArray<AncestorLevel>,
): ResolvedCascadeValue {
  const provenance: ProvenanceEntry[] = [];
  const acc: Record<string, unknown> = {};
  const seenKeys = new Set<string>();

  for (const level of chain) {
    if (!hasOwn(level.deltas, field)) continue;
    const raw = level.deltas[field];
    if (!isPlainObject(raw)) continue;
    const delta = raw as Record<string, unknown>;

    for (const key of Object.keys(delta)) {
      const v = delta[key];
      const isFirstForKey = !seenKeys.has(key);
      seenKeys.add(key);

      if (v === null) {
        // Explicit clear. Remove from acc; provenance is `removed`
        // (using the union_with_remove vocabulary — "this level
        // cleared the key").
        if (key in acc) delete acc[key];
        provenance.push(
          makeProv(level, isFirstForKey ? 'set_initial' : 'removed', { key, value: null }),
        );
        continue;
      }

      // Any other value: replace at this key.
      acc[key] = v;
      provenance.push(
        makeProv(level, isFirstForKey ? 'set_initial' : 'overrode', { key, value: v }),
      );
    }
  }

  return { value: acc, provenance };
}

/**
 * Convenience: pull the most recent contributor for a single key
 * out of a `merge_deep` provenance trail. Returns `undefined` if no
 * level contributed to that key.
 *
 *   const { provenance } = resolveCascadedField('staffInstructions', chain);
 *   const parkingProv = provenanceForKey(provenance, 'parking');
 *   // → "Parking last set at JO"
 */
export function provenanceForKey(
  provenance: ReadonlyArray<ProvenanceEntry>,
  key: string,
): ProvenanceEntry | undefined {
  let last: ProvenanceEntry | undefined;
  for (const entry of provenance) {
    const v = entry.value as { key?: unknown } | undefined;
    if (v && v.key === key) last = entry;
  }
  return last;
}

// ---- Strategy: keyed_list -----------------------------------------

/**
 * List of items identified by `spec.identityKey`. Each item runs its
 * own per-field cascade across whichever levels supplied that item.
 * Used by `positions` (handoff §5).
 *
 * Item presence semantics:
 *   - An item exists in the resolved list if ANY level contributed
 *     it (no remove semantics — `keyed_list` doesn't use the
 *     `removed` channel because positions are referenced by id from
 *     the JO via `selectedPositionIds`).
 *   - The item's per-field values are computed by re-running the
 *     engine for each `itemFields` sub-spec, with a synthetic chain
 *     where each level's `deltas[itemFieldName]` is the item's
 *     value at that level (or `undefined` if missing).
 *
 * Provenance: one entry per level that contributed any item, with
 * `value` set to that level's full item subset. (Per-item provenance
 * lives inside each merged item's own resolution if the caller
 * wants finer detail — they can re-run the engine on a single item
 * field via {@link resolveCascadedFieldWithSpec}.)
 */
function resolveKeyedList(
  field: string,
  spec: CascadeFieldSpec,
  chain: ReadonlyArray<AncestorLevel>,
  options: ResolveOptions,
): ResolvedCascadeValue {
  const identityKey = spec.identityKey;
  const itemFields = spec.itemFields;
  if (!identityKey || !itemFields) {
    throw new Error(
      `[cascade] keyed_list field "${field}" missing identityKey or itemFields (registry shape lock should have caught this)`,
    );
  }

  const provenance: ProvenanceEntry[] = [];

  // First pass: collect items per identity, grouped by level.
  // Map<itemIdentity, Map<levelIndex, rawItem>>. Using levelIndex
  // (not level itself) makes the second pass deterministic in chain
  // order regardless of object identity.
  const perItem = new Map<string, Map<number, Record<string, unknown>>>();
  const insertionOrder: string[] = [];

  chain.forEach((level, idx) => {
    if (!hasOwn(level.deltas, field)) return;
    const raw = level.deltas[field];
    if (!Array.isArray(raw)) return;

    const levelItems: Record<string, unknown>[] = [];
    for (const item of raw) {
      if (!isPlainObject(item)) continue;
      const id = (item as Record<string, unknown>)[identityKey];
      if (typeof id !== 'string' || id.trim() === '') continue;
      let perLevel = perItem.get(id);
      if (!perLevel) {
        perLevel = new Map();
        perItem.set(id, perLevel);
        insertionOrder.push(id);
      }
      perLevel.set(idx, item as Record<string, unknown>);
      levelItems.push(item as Record<string, unknown>);
    }

    if (levelItems.length > 0) {
      provenance.push(makeProv(level, idx === 0 ? 'set_initial' : 'overrode', levelItems));
    }
  });

  // Second pass: for each item, run the per-field cascade.
  const merged: Array<Record<string, unknown>> = [];
  for (const id of insertionOrder) {
    const perLevel = perItem.get(id)!;
    const mergedItem: Record<string, unknown> = { [identityKey]: id };

    for (const [subField, subSpec] of Object.entries(itemFields)) {
      // Build a synthetic chain where each level carries this item's
      // value for `subField` (or no key at all). Preserving the
      // original level ordering + metadata keeps provenance correct
      // if the caller later asks for per-item-field provenance.
      const subChain: AncestorLevel[] = chain.map((level, idx) => {
        const itemAtLevel = perLevel.get(idx);
        const subDeltas: Record<string, unknown> = {};
        if (itemAtLevel && hasOwn(itemAtLevel, subField)) {
          subDeltas[subField] = itemAtLevel[subField];
        }
        return {
          levelType: level.levelType,
          levelId: level.levelId,
          levelLabel: level.levelLabel,
          deltas: subDeltas,
        };
      });

      const { value } = resolveCascadedFieldWithSpec(
        subField,
        subSpec,
        subChain,
        options,
      );
      if (value !== undefined) mergedItem[subField] = value;
    }

    merged.push(mergedItem);
  }

  return { value: merged, provenance };
}

// ---- Strategy: level_only -----------------------------------------

/**
 * Read from the single level the field lives at. No cascade — the
 * field is intentionally not inheritable. Used for things like
 * `selectedPositionIds` (JO-only) and `shiftTemplate` (JO-only).
 *
 * Spec invariant: `editableAt` must have exactly one level. The
 * registry shape-lock test enforces this.
 */
function resolveLevelOnly(
  field: string,
  spec: CascadeFieldSpec,
  chain: ReadonlyArray<AncestorLevel>,
): ResolvedCascadeValue {
  if (spec.editableAt.length !== 1) {
    throw new Error(
      `[cascade] level_only field "${field}" must have exactly one editableAt level (got ${spec.editableAt.length})`,
    );
  }
  const target = spec.editableAt[0];

  // Walk the chain and pick the last level whose levelType maps to
  // the target editable level. Most chains have exactly one such
  // level (e.g. one JO); if a caller hands us multiple, the closest-
  // to-target wins (consistent with `replace`).
  for (let i = chain.length - 1; i >= 0; i--) {
    const level = chain[i];
    if (mapToEditableLevel(level.levelType) !== target) continue;
    if (!hasOwn(level.deltas, field)) {
      return { value: undefined, provenance: [] };
    }
    const v = level.deltas[field];
    return { value: v, provenance: [makeProv(level, 'set_initial', v)] };
  }

  return { value: undefined, provenance: [] };
}

// ---- Helpers -------------------------------------------------------

/**
 * Map a `LevelType` to an `EditableLevel`. Both `child` and
 * `location` collapse to `'child'` because the registry uses `child`
 * as the canonical name for the second-depth tier (handoff §1).
 */
function mapToEditableLevel(level: LevelType): EditableLevel {
  switch (level) {
    case 'account':
      return 'account';
    case 'child':
    case 'location':
      return 'child';
    case 'jo':
      return 'jo';
    case 'shift':
      return 'shift';
    default: {
      const _exhaustive: never = level;
      throw new Error(`[cascade] unknown levelType "${String(_exhaustive)}"`);
    }
  }
}

function isLevelEditableForSpec(
  level: LevelType,
  spec: CascadeFieldSpec,
): boolean {
  return spec.editableAt.includes(mapToEditableLevel(level));
}

function makeProv(
  level: AncestorLevel,
  contribution: ContributionKind,
  value: unknown,
): ProvenanceEntry {
  const entry: ProvenanceEntry = {
    levelType: level.levelType,
    levelId: level.levelId,
    contribution,
    value,
  };
  if (level.levelLabel !== undefined) entry.levelLabel = level.levelLabel;
  return entry;
}

function hasOwn(obj: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  if (Array.isArray(value)) return false;
  // Accept plain objects only — no Date / Map / Set / class instances.
  // Firestore data we resolve over should always be plain.
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function normalizeUnionDelta(raw: unknown): UnionDelta | null {
  if (Array.isArray(raw)) {
    return { added: raw };
  }
  if (isPlainObject(raw)) {
    const obj = raw as Record<string, unknown>;
    const delta: UnionDelta = {};
    if (Array.isArray(obj.added)) delta.added = obj.added;
    if (Array.isArray(obj.removed)) delta.removed = obj.removed;
    if (delta.added || delta.removed) return delta;
  }
  return null;
}

/**
 * Compute the identity string for an item under a given identity
 * rule. Returns `null` if the item isn't identifiable (so the
 * union strategy can skip it without poisoning the result).
 *
 * For `string_exact`, items must be strings. For `slug`, items can
 * be strings (preferred) or `{ name|label|title|id: string }` —
 * common shapes for chip-style selections.
 */
function identityFor(item: unknown, mode: ItemIdentity): string | null {
  if (mode === 'string_exact') {
    return typeof item === 'string' ? item : null;
  }
  // slug
  let candidate: string | null = null;
  if (typeof item === 'string') {
    candidate = item;
  } else if (isPlainObject(item)) {
    const obj = item as Record<string, unknown>;
    for (const key of ['slug', 'id', 'name', 'label', 'title'] as const) {
      const v = obj[key];
      if (typeof v === 'string' && v.trim() !== '') {
        candidate = v;
        break;
      }
    }
  }
  if (candidate == null) return null;
  return slugify(candidate);
}

/**
 * Lower-case, collapse non-alphanumeric runs to a single `-`, and
 * trim leading/trailing dashes. Lets `"Cowboy Boots"`,
 * `"cowboy_boots"`, and `"COWBOY-BOOTS"` resolve as the same item
 * across levels (handoff §3 union_with_remove notes).
 */
function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
