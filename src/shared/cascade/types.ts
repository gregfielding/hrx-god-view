/**
 * Cascading Order Data — type contract.
 *
 * Source of truth for the cascade engine described in the
 * "Cascading Order Data system" handoff (2026-04-26). All cascade
 * behaviour is data-driven: the engine reads `CASCADE_REGISTRY`
 * (see `./registry.ts`) and switches on the per-field strategy.
 * No special-casing per field — adding a new cascading field is
 * one registry entry plus tests.
 *
 * This file is mirrored at `src/shared/cascade/types.ts` for the
 * CRA bundle. They MUST stay in sync byte-for-byte.
 */

// ---- Levels --------------------------------------------------------

/**
 * Every level the cascade can attribute provenance to. The engine
 * walks an ancestor chain composed by the caller; the chain shape
 * differs between the two hierarchies (see handoff §1):
 *
 *   National Account → Child Account → Job Order → Shift
 *   Standalone Account → Location    → Job Order → Shift
 *
 * `child` and `location` are the same conceptual depth but carry
 * different `levelType` tags so the UI can render "(from Texas
 * Warehouse)" vs "(from Acme child account)" without the engine
 * having to know either one's display label.
 */
export type LevelType = 'account' | 'child' | 'location' | 'jo' | 'shift';

/**
 * Levels at which a field is editable. The registry uses `child` as
 * the canonical name for the second hierarchy level (because the
 * engine treats `child` and `location` as the same depth), so
 * `EditableLevel` deliberately omits `location` — anything editable
 * at the second-depth tier is editable at both child accounts and
 * standalone-account locations.
 */
export type EditableLevel = 'account' | 'child' | 'jo' | 'shift';

// ---- Strategies ----------------------------------------------------

/**
 * The five strategies enumerated in handoff §3. The engine has one
 * implementation per strategy; the registry chooses which one runs
 * per field.
 *
 *  - `replace`            closest-to-target level wins.
 *  - `union_with_remove`  per-level deltas of `{added, removed}`
 *                         lists; ancestors stack, descendants can
 *                         subtract.
 *  - `merge_deep`         per-key object merge, child keys win.
 *  - `keyed_list`         list of items identified by `identityKey`;
 *                         each item runs its own per-field cascade
 *                         using `itemFields`.
 *  - `level_only`         no cascade; lives at the declared level
 *                         only. Used for things like
 *                         `selectedPositionIds` (JO-only).
 */
export type CascadeStrategy =
  | 'replace'
  | 'union_with_remove'
  | 'merge_deep'
  | 'keyed_list'
  | 'level_only';

/**
 * Identity rule for items inside a `union_with_remove` list. Used
 * by the engine to dedupe stacked items and to honour removals.
 *
 *  - `string_exact` — case-sensitive string equality.
 *  - `slug`         — case-insensitive, whitespace-collapsed,
 *                     non-alphanumerics stripped. Lets a user enter
 *                     "Cowboy Boots" at one level and "cowboy_boots"
 *                     at another and have them resolve as the same
 *                     item.
 */
export type ItemIdentity = 'string_exact' | 'slug';

/**
 * How a given level contributed to the resolved value. Surfaced in
 * `ProvenanceEntry.contribution` so the UI can render
 * "(set by Account)" / "(overrode at JO)" / "(removed at Shift)"
 * without re-deriving the reason on the client.
 */
export type ContributionKind =
  | 'set_initial' // first level in the chain to provide a value
  | 'overrode' // closer-to-target level replaced an ancestor's value
  | 'added' // union_with_remove: this level added an item
  | 'removed' // union_with_remove: this level removed a parent item
  | 'derived'; // value was computed (e.g. billRate from pay × markup)

// ---- Registry shape ------------------------------------------------

/**
 * One entry per cascading field. The exact shape is locked by the
 * shape-lock test in `src/shared/cascade/__tests__/registry.test.ts`
 * — the engine assumes these invariants when it dispatches.
 *
 * Adding optional sub-strategies later is fine; removing or
 * renaming any of these fields is a breaking change to the engine.
 */
export interface CascadeFieldSpec {
  /** Which strategy runs for this field. */
  strategy: CascadeStrategy;
  /** Levels where this field can be edited. UI gates its edit affordance from this. */
  editableAt: ReadonlyArray<EditableLevel>;
  /** For `keyed_list` — the field on each item that identifies it across levels. */
  identityKey?: string;
  /** For `union_with_remove` — what counts as an item identity. */
  itemIdentity?: ItemIdentity;
  /** For `keyed_list` — sub-spec per field on the item. */
  itemFields?: Record<string, CascadeFieldSpec>;
  /**
   * Marks a leaf field as required for the parent record to be
   * "complete" enough for downstream automation. Currently used by
   * the planned auto-JO-creator (handoff §14.1) to decide whether
   * a position is eligible for inclusion: a position is only
   * auto-selected on a JO once every `requiredForCompleteness`
   * sub-field has a value resolved through the cascade. Today this
   * is set on the child-level pricing fields inside
   * `positions.itemFields`. Surfacing it on the registry — rather
   * than deriving from `editableAt: ['child']` — keeps the rule
   * queryable per §14.4 and decouples it from the editing tier.
   */
  requiredForCompleteness?: boolean;
  /**
   * Account-level seed defaults for `merge_deep` fields. Consumed
   * by the Account-creation flow (and similar onboarding paths)
   * to populate sensible initial values; the cascade engine itself
   * does NOT layer these in at resolve time — defaults still live
   * inside an actual `account` deltas blob if/when seeded. Adding
   * them to the registry rather than a parallel seed file keeps
   * everything for one field in one place (handoff §15.3 +
   * confirm 2026-04-26).
   */
  defaults?: Record<string, unknown>;
  /** Display label for provenance / debug tools. */
  label: string;
}

// ---- Engine I/O ----------------------------------------------------

/**
 * One link in the ancestor chain the caller passes to
 * `resolveCascadedField`. `deltas` is *only* what's stored at this
 * level — never the merged result. The engine composes the merged
 * result from all the deltas in the chain.
 */
export interface AncestorLevel {
  levelType: LevelType;
  levelId: string;
  /** Optional human label so provenance can be rendered without an extra fetch. */
  levelLabel?: string;
  deltas: Record<string, unknown>;
}

/**
 * One row in the provenance trail returned alongside every
 * resolved value. `value` is what *this level* contributed
 * (e.g. for `union_with_remove` it's just the items this level
 * added or removed, not the full merged set).
 */
export interface ProvenanceEntry {
  levelType: LevelType;
  levelId: string;
  levelLabel?: string;
  contribution: ContributionKind;
  value: unknown;
}

/**
 * Standard envelope returned by every engine call. The UI is free
 * to ignore `provenance`, but the engine must always produce it
 * (see handoff §9 — provenance is part of the contract).
 */
export interface ResolvedCascadeValue<T = unknown> {
  value: T;
  provenance: ProvenanceEntry[];
}

// ---- Downstream consumer types (handoff §14) ----------------------

/**
 * Day-of-week tokens used by `ShiftTemplate.defaultDaysOfWeek`.
 * Lowercased to match the existing `weeklySchedule` Firestore
 * convention used by the recruiter shift form.
 */
export type DayOfWeek =
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday'
  | 'sunday';

/**
 * Per-section show/hide toggles for what a public job-board posting
 * exposes (handoff §15.3). Cascades via `merge_deep` across
 * Account → Child → JO so a tenant can set "default to hide
 * education" at the Account level and override per-JO when a
 * specific JO needs to surface it.
 *
 * Every field is optional so partially-configured levels still
 * resolve cleanly — the public board treats missing keys as
 * "use the registry default" (see `CASCADE_REGISTRY.postingVisibility.defaults`).
 */
export interface PostingVisibility {
  // Compensation & timing
  showPayRate?: boolean;
  showStartDate?: boolean;
  showEndDate?: boolean;
  showShiftTimes?: boolean;
  // Requirements
  showSkills?: boolean;
  showLicensesCerts?: boolean;
  showExperience?: boolean;
  showEducation?: boolean;
  showLanguages?: boolean;
  showPhysicalRequirements?: boolean;
  showUniformRequirements?: boolean;
  showPpe?: boolean;
  // Screening
  showBackgroundChecks?: boolean;
  showDrugScreening?: boolean;
  showAdditionalScreenings?: boolean;
  showEVerify?: boolean;
}

/**
 * Posting lifecycle policy (handoff §15.3 + §15.7). Cascades via
 * `merge_deep` across Account → Child → JO. Read by:
 *
 *  - `gigJobOrderStatusSync` (auto-publish on open shifts,
 *    auto-unpublish when no future shifts) — §15.7.
 *  - The auto-create-posting flow — §14.3 / §15.7.
 *  - The Posting form — to seed expiration / max-applications
 *    inputs.
 *
 * Nullable scalars (`defaultExpirationDays`, `maxApplicationsDefault`,
 * `autoAddToUserGroup`) use `null` rather than `undefined` so a
 * descendant level can explicitly clear an ancestor's setting via
 * `merge_deep` (e.g. Child says "no expiration" overriding
 * Account's 30-day default).
 */
export interface PostingPolicy {
  /** §14.1 hook into gigJobOrderStatusSync. */
  autoPublishOnOpenShifts?: boolean;
  autoUnpublishWhenNoOpenShifts?: boolean;
  /** `null` = never expires (gig JOs). */
  defaultExpirationDays?: number | null;
  maxApplicationsDefault?: number | null;
  autoAddToUserGroup?: string | null;
}

/**
 * JO-level template that pre-populates the click-to-create-shift
 * form (handoff §14.2). Stored under the `shiftTemplate` field on
 * each JO doc; never cascades — the auto-creator just reads it raw.
 *
 * Every field is optional so partially-configured JOs still produce
 * a usable template (the shift form falls back to its existing
 * defaults for whatever's missing).
 */
export interface ShiftTemplate {
  /** Pre-selects from `selectedPositionIds`. */
  defaultPositionId?: string;
  /** "HH:mm" 24-hour format, e.g. "07:00". */
  defaultStartTime?: string;
  /** "HH:mm" 24-hour format, e.g. "15:30". */
  defaultEndTime?: string;
  /** Alternative to `defaultEndTime` — engine prefers explicit end. */
  defaultDurationMinutes?: number;
  /** Workers requested per shift. */
  defaultHeadcount?: number;
  /** Recurring-shift creation pre-fill. */
  defaultDaysOfWeek?: ReadonlyArray<DayOfWeek>;
  /** Unpaid break length, in minutes. */
  defaultBreakMinutes?: number;
}

// ---- Type guards ---------------------------------------------------

const LEVEL_TYPES: ReadonlySet<LevelType> = new Set<LevelType>([
  'account',
  'child',
  'location',
  'jo',
  'shift',
]);

const EDITABLE_LEVELS: ReadonlySet<EditableLevel> = new Set<EditableLevel>([
  'account',
  'child',
  'jo',
  'shift',
]);

const CASCADE_STRATEGIES: ReadonlySet<CascadeStrategy> = new Set<CascadeStrategy>([
  'replace',
  'union_with_remove',
  'merge_deep',
  'keyed_list',
  'level_only',
]);

const ITEM_IDENTITIES: ReadonlySet<ItemIdentity> = new Set<ItemIdentity>([
  'string_exact',
  'slug',
]);

export function isLevelType(value: unknown): value is LevelType {
  return typeof value === 'string' && LEVEL_TYPES.has(value as LevelType);
}

export function isEditableLevel(value: unknown): value is EditableLevel {
  return typeof value === 'string' && EDITABLE_LEVELS.has(value as EditableLevel);
}

export function isCascadeStrategy(value: unknown): value is CascadeStrategy {
  return typeof value === 'string' && CASCADE_STRATEGIES.has(value as CascadeStrategy);
}

export function isItemIdentity(value: unknown): value is ItemIdentity {
  return typeof value === 'string' && ITEM_IDENTITIES.has(value as ItemIdentity);
}
