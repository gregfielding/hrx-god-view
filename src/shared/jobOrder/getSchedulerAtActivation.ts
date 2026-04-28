/**
 * **R.16.2d** — Activation-snapshot scheduler reader + divergence
 * predicate for the JO header sub-line.
 *
 * Background:
 *   `scheduler` was promoted to `propagation: 'snapshot-on-activation'`
 *   in R.16.2c (see `docs/CASCADE_R16.2c_HANDOFF.md`). The activation
 *   trigger captures the cascade-resolved scheduler list as
 *   `joDoc.snapshot.scheduler: string[]`. Meanwhile the
 *   denormalized live cache `joDoc.schedulerUid: string` continues to
 *   reflect the *current* scheduler — maintained by
 *   `onJobOrderWriteStampScheduler` /
 *   `onAccountRolesChangeRestampSchedulers` (see
 *   `docs/RECRUITING_ROLE_MODEL.md` §2.2).
 *
 *   The two fields can legitimately diverge:
 *     - The activation captured `['alice']`, then alice handed off to
 *       bob → snapshot stays `['alice']`, current is `'bob'`.
 *     - The activation captured `['alice', 'bob']` (parent had two
 *       schedulers), then bob was removed at the parent → snapshot
 *       still includes both, current shows whoever survived.
 *     - Activation captured `[]` (no scheduler at the time), bob was
 *       added later → snapshot `[]`, current `'bob'`. We treat this
 *       as "no useful activation signal" and hide the sub-line.
 *
 *   The R.16.2d alt path surfaces this divergence as an
 *   "Activated with: <names>" sub-line on the JO header — operators
 *   need this for commission tracking, accountability audits, and
 *   "why does the current scheduler differ from when this JO was set
 *   up" investigations. See `docs/CLEANUP_R4_R16.2D_HANDOFF.md`
 *   §L.16.2d.1 for the lock.
 *
 * Why a separate file (not folded into `getEffectiveJobOrderField`):
 *   - The shape mismatch (`string[]` snapshot vs `string` live) means
 *     the generic `EffectiveResult<T>` helper would force every
 *     caller to type-assert or branch on the source. The dedicated
 *     reader returns `string[] | null` directly with snapshot-only
 *     semantics — no fallback ever, because the live `schedulerUid`
 *     is *not* a fallback for the activation list (it's a *different*
 *     piece of information by design).
 *   - The divergence predicate is pure presentation logic and lives
 *     next to the reader so the contract is one-glance reviewable.
 *
 * Pure / SDK-agnostic / type-self-contained — kept that way so the
 * helper can be byte-mirrored into `shared/jobOrder/` later if a
 * server-side consumer (e.g. commission-tracking trigger) needs it.
 *
 * @see docs/CLEANUP_R4_R16.2D_HANDOFF.md §L.16.2d
 * @see docs/CASCADE_R16.2c_HANDOFF.md (scheduler promotion)
 * @see ./getEffectiveJobOrderField.ts (the generic snapshot reader)
 */

/**
 * Minimum structural shape needed to read the activation snapshot's
 * `scheduler` field. Intentionally has NO index signature so it stays
 * assignable from typed `JobOrder.snapshot` shapes (which carry their
 * own concrete fields). The reader only inspects `capturedAt` and
 * `scheduler` — anything else on the real snapshot is irrelevant.
 */
interface MinimalSchedulerSnapshot {
  capturedAt?: unknown;
  scheduler?: unknown;
}

/**
 * Minimum shape needed to read the activation-snapshot scheduler list
 * AND determine current divergence. Mirrors the relevant subset of
 * `JobOrderForEffectiveRead` plus the live `schedulerUid` cache.
 */
export interface JobOrderForSchedulerActivation {
  status?: string | null;
  schedulerUid?: string | null;
  snapshot?: MinimalSchedulerSnapshot | null;
}

function isSnapshotted(snapshot: MinimalSchedulerSnapshot | null | undefined): boolean {
  if (!snapshot || typeof snapshot !== 'object') return false;
  return snapshot.capturedAt !== undefined && snapshot.capturedAt !== null;
}

function isDraftStatus(status: string | null | undefined): boolean {
  return !status || status === 'draft';
}

/**
 * Read the scheduler UIDs captured at JO activation.
 *
 * Returns:
 *   - `string[]` — the snapshot's `scheduler` array (possibly empty);
 *     elements are normalised (trimmed, non-empty strings only) and
 *     deduplicated while preserving first-seen order.
 *   - `null` — JO is draft, has no snapshot, or `snapshot.scheduler`
 *     is absent / unparseable. Caller treats `null` as "no
 *     activation signal — don't render the sub-line."
 *
 * Note: returns `[]` (empty array) — distinct from `null` — when the
 * snapshot was captured but the cascade resolved to zero schedulers.
 * The divergence predicate `shouldRenderActivationSubline` collapses
 * that case back to "hide the sub-line" because there's nothing
 * useful to display, but callers that want the raw signal can
 * distinguish "no schedulers at activation" (`[]`) from "no snapshot
 * at all" (`null`).
 */
export function getSchedulerAtActivation(
  joDoc: JobOrderForSchedulerActivation | null | undefined,
): string[] | null {
  if (!joDoc) return null;
  if (isDraftStatus(joDoc.status) || !isSnapshotted(joDoc.snapshot)) return null;

  const raw = (joDoc.snapshot as MinimalSchedulerSnapshot).scheduler;
  if (!Array.isArray(raw)) return null;

  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== 'string') continue;
    const trimmed = v.trim();
    if (!trimmed) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

function setEqual(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) {
    if (!b.has(x)) return false;
  }
  return true;
}

export interface ShouldRenderActivationSublineArgs {
  /**
   * Current denormalized scheduler — typically `joDoc.schedulerUid`
   * pre-trimmed by the caller. `null` / empty means "no current
   * scheduler" (rendered as "Unassigned" elsewhere).
   */
  currentSchedulerUid: string | null;
  /**
   * Result of `getSchedulerAtActivation(joDoc)` — `null` for
   * pre-snapshot JOs, otherwise the (possibly empty) normalised
   * activation array.
   */
  activationSchedulers: readonly string[] | null;
}

/**
 * Decide whether to render the "Activated with: <names>" sub-line on
 * the JO header.
 *
 * Returns `true` IFF:
 *   - The JO has a non-empty activation snapshot scheduler list
 *     (`activationSchedulers` is a non-empty array of normalised UIDs), AND
 *   - That set differs from `{currentSchedulerUid}` (treating
 *     null/empty current as the empty set).
 *
 * Returns `false` for:
 *   - `null` activation array (no snapshot signal at all).
 *   - Empty `[]` activation array (snapshot exists but captured zero
 *     schedulers — nothing useful to surface).
 *   - Activation set equals current set — no divergence, no clutter.
 *
 * The asymmetry between `null` and `[]` is intentional: both hide the
 * sub-line, but the reader exposes them distinctly so future consumers
 * (e.g. an audit log "scheduler at activation: none") can act on
 * the empty case without repeating the snapshot-presence check.
 */
export function shouldRenderActivationSubline(
  args: ShouldRenderActivationSublineArgs,
): boolean {
  const { activationSchedulers, currentSchedulerUid } = args;
  if (!activationSchedulers || activationSchedulers.length === 0) return false;

  const activationSet = new Set<string>();
  for (const s of activationSchedulers) {
    if (typeof s === 'string' && s.trim().length > 0) {
      activationSet.add(s.trim());
    }
  }
  if (activationSet.size === 0) return false;

  const currentSet = new Set<string>();
  if (typeof currentSchedulerUid === 'string' && currentSchedulerUid.trim().length > 0) {
    currentSet.add(currentSchedulerUid.trim());
  }

  return !setEqual(activationSet, currentSet);
}
