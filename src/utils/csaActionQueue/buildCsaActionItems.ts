/**
 * **E.7** — Pure aggregation helper for the unified CSA action queue.
 *
 * Given the four data sources the queue depends on:
 *
 *   - `entity_employments` rows (action signals: workerType,
 *     i9Section2CompletedAt, everifyStatus, everifyRequired override)
 *   - `everee_workers.readinessMirror` (i9SignedAt — Section 1 done?)
 *   - `entities` (display name + tenant-level everifyRequired)
 *   - `users` (display name / email / phone / avatar)
 *
 * …decide which (if any) action item each (worker × entity) row triggers,
 * and assemble the renderable `CsaActionItem` list.
 *
 * Kept pure (no Firestore / no React) so the rules can be unit-tested
 * deterministically. The hook (`useCsaActionQueueItems`) is a thin
 * subscriber/loader that delegates the join to this helper.
 *
 * Per-row priority: a single (worker × entity) might satisfy multiple
 * action types in a transient state — surface only the highest-priority
 * one (lower `priority` value wins) so the queue never double-counts.
 *
 * E-Verify enablement: a row only enters the `start_everify` band when
 * BOTH conditions hold:
 *   - `entity_employments.everifyRequired !== false` (per-row override
 *     can disable on a Workforce baseline that's set up for E-Verify);
 *   - `entities[entityId].everifyRequired !== false` (tenant-level).
 *   The override semantics: `everifyRequired === false` ⇒ disabled, any
 *   other value ⇒ enabled (matches `EmploymentMinimalOnboardingChecklist`'s
 *   `!== false` check). Defaulting to enabled keeps existing C1 Select
 *   behavior (where the field has historically been omitted).
 */

import type {
  CsaActionItem,
  CsaActionType,
} from '../../types/csaActionQueue';
import {
  CSA_ACTION_PRIORITY,
} from '../../types/csaActionQueue';

/**
 * Subset of `EntityEmploymentRecord` the aggregator reads. Kept as a
 * permissive shape (most fields `unknown`) so callers can pass
 * `Record<string, unknown>` straight from a Firestore snapshot — no
 * runtime type assertion required.
 */
export interface CsaQueueEntityEmploymentLite {
  id: string;
  userId: string;
  entityId: string | null;
  /** Denormalized — `'select'` / `'workforce'` / `'events'` etc. */
  entityKey?: unknown;
  workerType: unknown;
  /** Used to filter out terminated rows. */
  active?: unknown;
  /** Federal-deadline anchor for the I-9 Section 2 sub-line. */
  hiredAt?: unknown;
  i9Section2CompletedAt?: unknown;
  everifyRequired?: unknown;
  everifyStatus?: unknown;
  /** Recorded by R.5 trigger when E-Verify produced the TNC verdict. */
  everifyTncReceivedAt?: unknown;
  /**
   * Latest meaningful update timestamp on the row — used as a fallback
   * "ageMs" anchor when a more specific field (e.g. `everifyTncReceivedAt`)
   * isn't available.
   */
  updatedAt?: unknown;
}

/** Subset of `everee_workers.readinessMirror` the aggregator reads. */
export interface CsaQueueEvereeMirrorLite {
  i9SignedAt?: unknown;
  /** Worker has both Section 1 + W-4 done — used to anchor "I-9 fully signed" sub-lines. */
  w4SignedAt?: unknown;
}

export interface CsaQueueEntityLite {
  id: string;
  name: string;
  /**
   * Tenant-level E-Verify enablement. `false` means E-Verify is
   * intentionally disabled for this entity (e.g. test tenant).
   * Anything else is treated as enabled.
   */
  everifyRequired?: boolean;
}

export interface CsaQueueUserLite {
  uid: string;
  displayName: string;
  email: string | null;
  phone: string | null;
  avatarUrl: string | null;
}

export interface BuildCsaActionItemsInput {
  entityEmployments: ReadonlyArray<CsaQueueEntityEmploymentLite>;
  /** Keyed by `${entityId}__${userId}` — same key Everee uses for its doc id. */
  evereeMirrorByKey: Readonly<Record<string, CsaQueueEvereeMirrorLite | undefined>>;
  entityById: Readonly<Record<string, CsaQueueEntityLite | undefined>>;
  userByUid: Readonly<Record<string, CsaQueueUserLite | undefined>>;
  /**
   * When non-null, only items whose `workerUid` is in this set are
   * included (RD.1's My/All toggle). `null` ⇒ no scope filter.
   */
  myWorkerUids?: ReadonlySet<string> | null;
  /** Treated as "now" when computing `ageMs`. Defaults to `Date.now()`. */
  nowMs?: number;
}

function toMillis(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  if (typeof value === 'object') {
    const obj = value as { toMillis?: () => number; toDate?: () => Date; seconds?: number };
    if (typeof obj.toMillis === 'function') {
      try {
        return obj.toMillis();
      } catch {
        /* fall through */
      }
    }
    if (typeof obj.toDate === 'function') {
      try {
        return obj.toDate().getTime();
      } catch {
        /* fall through */
      }
    }
    if (typeof obj.seconds === 'number') {
      return obj.seconds * 1000;
    }
  }
  return null;
}

function isTimestampLike(value: unknown): boolean {
  return toMillis(value) != null;
}

function normalizeWorkerType(raw: unknown): 'w2' | '1099' | null {
  if (typeof raw !== 'string') return null;
  const v = raw.trim().toLowerCase().replace(/[-_\s]/g, '');
  if (v === 'w2' || v === 'employee') return 'w2';
  if (v === '1099' || v === 'contractor') return '1099';
  return null;
}

/** Both `tnc` and `further_action_required` route to the TNC band. */
function isTncStatus(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const v = value.trim().toLowerCase();
  return v === 'tnc' || v === 'further_action_required';
}

/**
 * Decide which (if any) action type a single (worker × entity) row
 * triggers, given the joined data. Higher-priority types win when
 * multiple apply simultaneously.
 *
 * Returns `null` when no action is currently due — keeps the row out
 * of the queue without polluting the type list with "no_action".
 */
export function decideActionType(args: {
  emp: CsaQueueEntityEmploymentLite;
  mirror: CsaQueueEvereeMirrorLite | undefined;
  entity: CsaQueueEntityLite | undefined;
}): CsaActionType | null {
  const { emp, mirror, entity } = args;

  // TNC band — federal 8-day clock; surfaces regardless of other state.
  if (isTncStatus(emp.everifyStatus)) {
    return 'address_tnc';
  }

  const workerType = normalizeWorkerType(emp.workerType);
  const section2Done = isTimestampLike(emp.i9Section2CompletedAt);
  const i9Section1Done = isTimestampLike(mirror?.i9SignedAt);

  // I-9 Section 2 band — only W-2, Section 1 done by worker, Section 2
  // not yet stamped by CSA. 1099 contractors (no I-9) never qualify.
  if (workerType === 'w2' && i9Section1Done && !section2Done) {
    return 'i9_section_2';
  }

  // Start E-Verify band — both I-9 sections complete, no E-Verify case
  // started, and the entity actually requires E-Verify (per-row override
  // OR tenant-level enablement BOTH need to allow it).
  const empEverifyEnabled = emp.everifyRequired !== false;
  const entityEverifyEnabled = entity?.everifyRequired !== false;
  const everifyEnabled = empEverifyEnabled && entityEverifyEnabled;
  const everifyStartable =
    typeof emp.everifyStatus !== 'string' ||
    emp.everifyStatus.trim().length === 0 ||
    emp.everifyStatus === 'not_started';

  if (
    workerType === 'w2' &&
    i9Section1Done &&
    section2Done &&
    everifyEnabled &&
    everifyStartable
  ) {
    return 'start_everify';
  }

  return null;
}

/**
 * Compute "when did this action become actionable" for the secondary
 * (within-band) sort. Older actionable items rise to the top of each
 * band so federal deadlines aren't accidentally deprioritized.
 *
 * Each band uses the most semantically-relevant anchor available, and
 * falls back through progressively weaker signals so a row missing the
 * preferred timestamp still gets placed somewhere reasonable instead of
 * silently disappearing from the band.
 */
function computeActionableAtMs(args: {
  actionType: CsaActionType;
  emp: CsaQueueEntityEmploymentLite;
  mirror: CsaQueueEvereeMirrorLite | undefined;
  nowMs: number;
}): number {
  const { actionType, emp, mirror, nowMs } = args;
  switch (actionType) {
    case 'address_tnc': {
      // R.5 records this when it processes the TNC verdict from
      // E-Verify. If absent (legacy rows), fall back to the row's
      // last-update timestamp.
      return (
        toMillis(emp.everifyTncReceivedAt) ??
        toMillis(emp.updatedAt) ??
        nowMs
      );
    }
    case 'i9_section_2': {
      // The action becomes actionable when Section 1 is signed by the
      // worker — that's when the federal 3-day clock for Section 2
      // starts. Falls back to hire date or row update.
      return (
        toMillis(mirror?.i9SignedAt) ??
        toMillis(emp.hiredAt) ??
        toMillis(emp.updatedAt) ??
        nowMs
      );
    }
    case 'start_everify': {
      // E-Verify case must be created within 3 business days of the
      // first day of work. The "trigger" for the queue is when the I-9
      // is fully signed (later of Section 1 / Section 2). Section 2
      // completion is the actionable anchor; Section 1 alone isn't
      // sufficient (Section 2 must come first per the band order).
      return (
        toMillis(emp.i9Section2CompletedAt) ??
        toMillis(mirror?.i9SignedAt) ??
        toMillis(emp.hiredAt) ??
        toMillis(emp.updatedAt) ??
        nowMs
      );
    }
    default:
      return nowMs;
  }
}

/** Construct the per-action context bundle the renderer reads inline. */
function buildContext(args: {
  emp: CsaQueueEntityEmploymentLite;
  mirror: CsaQueueEvereeMirrorLite | undefined;
}): CsaActionItem['context'] {
  const { emp, mirror } = args;
  // Casts to `Timestamp | null` are intentionally lossy — the renderer
  // formats whatever shape is present, and the helpers in this file
  // already accept `unknown`. Keeping the field typed as `Timestamp`
  // avoids leaking `unknown` to downstream consumers; tests pass plain
  // objects with `toMillis`/`toDate` and the renderer handles them via
  // its own date formatter.
  return {
    hireDate: (emp.hiredAt as CsaActionItem['context']['hireDate']) ?? null,
    i9Section1SignedAt:
      (mirror?.i9SignedAt as CsaActionItem['context']['i9Section1SignedAt']) ?? null,
    i9FullySignedAt:
      (emp.i9Section2CompletedAt as CsaActionItem['context']['i9FullySignedAt']) ?? null,
    everifyTncReceivedAt:
      (emp.everifyTncReceivedAt as CsaActionItem['context']['everifyTncReceivedAt']) ?? null,
    everifyStatus: typeof emp.everifyStatus === 'string' ? emp.everifyStatus : null,
  };
}

export function buildCsaActionItems(input: BuildCsaActionItemsInput): CsaActionItem[] {
  const {
    entityEmployments,
    evereeMirrorByKey,
    entityById,
    userByUid,
    myWorkerUids = null,
    nowMs = Date.now(),
  } = input;

  const items: CsaActionItem[] = [];

  for (const emp of entityEmployments) {
    if (emp.active === false) continue;
    if (!emp.entityId || !emp.userId) continue;

    if (myWorkerUids && !myWorkerUids.has(emp.userId)) continue;

    const mirror = evereeMirrorByKey[`${emp.entityId}__${emp.userId}`];
    const entity = entityById[emp.entityId];

    const actionType = decideActionType({ emp, mirror, entity });
    if (actionType == null) continue;

    const user = userByUid[emp.userId];
    const actionableAt = computeActionableAtMs({ actionType, emp, mirror, nowMs });

    items.push({
      id: `${actionType}__${emp.entityId}__${emp.userId}`,
      actionType,
      workerUid: emp.userId,
      // Render-friendly defaults when the user/entity haven't loaded yet.
      // The hook re-runs as those caches fill, so this only flickers on
      // the very first render.
      workerName: user?.displayName ?? emp.userId,
      workerEmail: user?.email ?? null,
      workerPhone: user?.phone ?? null,
      workerAvatarUrl: user?.avatarUrl ?? null,
      entityId: emp.entityId,
      entityName: entity?.name ?? emp.entityId,
      entityKey: typeof emp.entityKey === 'string' ? emp.entityKey : '',
      entityEmploymentId: emp.id,
      context: buildContext({ emp, mirror }),
      ageMs: Math.max(0, nowMs - actionableAt),
      priority: CSA_ACTION_PRIORITY[actionType],
    });
  }

  return items;
}
