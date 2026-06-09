/**
 * AC.0a — Pure helpers for grouping AccuSource service lines into the four
 * verdict bands rendered on the User Profile → Backgrounds tab.
 *
 * **Why a separate module.** Pre-AC.0a, `AccusourceOrderServiceLinesTable.tsx`
 * rendered every line in a flat 9-column table. AC.0a regroups them into
 * collapsible bands (Needs review / Failed / Pending / Passed) so CSAs can
 * see "what needs my attention" at a glance instead of scanning N rows of
 * "Waiting" looking for the one that matters. The grouping logic + synthetic-
 * row filter is purely data-shape and testable without React, so it lives
 * here; the table component just consumes the result.
 *
 * **Spec naming gap.** The AC.0a spec calls the bands by emoji + label
 * ("🟧 Needs review", "❌ Failed", "⏳ Pending", "✅ Passed"). The
 * `AccusourceLineVerdict` enum the rest of the codebase uses is
 * `'PASSED' | 'FAILED' | 'NEEDS_REVIEW' | 'PENDING'` — so we treat the
 * verdict enum AS the band id (1:1) and let display metadata live next to
 * the band order array. That keeps the mapping trivial: one verdict ↔ one
 * band, no aliasing.
 *
 * **Synthetic order:* row filter.** AccuSource sends two parallel webhook
 * events for every named service: `service_status_change` (keyed by
 * service id) AND `order_status_change` (keyed `order:<orderId>`). The
 * line builder (`accusourceScreeningLineItems.ts` ~245-303) already does
 * a 90-second time-correlated dedup of the named-vs-order pair, but per
 * the AC.0a spec we need a defensive guard that hides any `order:*` row
 * that survives — they confuse CSAs ("is `Order 8534895` something I
 * need to act on?"). Lab/jurisdiction-bearing `order:*` rows are
 * preserved in the line builder as real data; this filter ONLY catches
 * the bare `order:N` synthetics that match `/^order\s+\S+$/i` after the
 * builder's name normalization has already had a chance to rewrite them.
 *
 * @see src/pages/UserProfile/components/AccusourceOrderServiceLinesTable.tsx
 * @see src/utils/accusourceScreeningLineItems.ts (line builder)
 */

import type { AccusourceLineVerdict } from '../types/backgroundCheck';
import type { AccusourceScreeningLineItem } from './accusourceScreeningLineItems';

/**
 * Verdict band id — 1:1 with `AccusourceLineVerdict`. Kept as a separate
 * type alias so the band-display API doesn't accidentally accept future
 * non-verdict values (e.g. `'EXPIRED'`) the verdict enum might gain.
 */
export type AccusourceVerdictBand = 'NEEDS_REVIEW' | 'FAILED' | 'PENDING' | 'PASSED';

/**
 * Render order top-to-bottom per the AC.0a spec:
 *   🟧 Needs review (pinned top — actionable)
 *   ❌ Failed (pinned near top — actionable, less urgent)
 *   ⏳ Pending (informational)
 *   ✅ Passed (informational)
 *
 * Frozen so callers can't reorder by accident — band order is part of
 * the spec acceptance ("Pinned Needs Review band renders first; Passed
 * last").
 */
export const BAND_ORDER: ReadonlyArray<AccusourceVerdictBand> = Object.freeze([
  'NEEDS_REVIEW',
  'FAILED',
  'PENDING',
  'PASSED',
]);

/**
 * Bands collapsed by default. Per the spec:
 *   - Needs review + Failed: expanded by default (the CSA needs to see them)
 *   - Pending + Passed: collapsed by default (informational, takes a click
 *     to peek at)
 *
 * Returned as a `Set` for O(1) lookup in the component without re-coercing
 * each render.
 */
export const BAND_DEFAULT_COLLAPSED: ReadonlySet<AccusourceVerdictBand> = new Set([
  'PENDING',
  'PASSED',
]);

/**
 * Display labels per band — the user-facing copy. The emoji is part of the
 * spec but rendered separately as an MUI `Icon` next to the label, so this
 * map carries the text only.
 */
export const BAND_LABEL: Readonly<Record<AccusourceVerdictBand, string>> = Object.freeze({
  NEEDS_REVIEW: 'Needs review',
  FAILED: 'Failed',
  PENDING: 'Pending',
  PASSED: 'Passed',
});

/**
 * MUI `<Chip color>` value per band. Matches the existing per-row chip
 * colors in `AccusourceOrderServiceLinesTable` so the band header chip
 * and the row's verdict chip read the same color (warning / error /
 * default / success).
 */
export const BAND_CHIP_COLOR: Readonly<
  Record<AccusourceVerdictBand, 'warning' | 'error' | 'default' | 'success'>
> = Object.freeze({
  NEEDS_REVIEW: 'warning',
  FAILED: 'error',
  PENDING: 'default',
  PASSED: 'success',
});

// ─────────────────────────────────────────────────────────────────────────
// Pure helpers
// ─────────────────────────────────────────────────────────────────────────

/**
 * Map a line's effective `AccusourceLineVerdict` to its band id. Trivial
 * 1:1 today; kept as a function so a future ENV-based remapping (e.g.
 * "treat all FAILED as NEEDS_REVIEW until CSA confirms") is one-edit.
 *
 * Unknown / future verdict values fall through to `PENDING` (the safest
 * informational bucket — won't surface as actionable to a CSA).
 */
export function verdictBand(verdict: AccusourceLineVerdict | string): AccusourceVerdictBand {
  switch (verdict) {
    case 'NEEDS_REVIEW':
      return 'NEEDS_REVIEW';
    case 'FAILED':
      return 'FAILED';
    case 'PASSED':
      return 'PASSED';
    case 'PENDING':
    default:
      return 'PENDING';
  }
}

/**
 * True when a line should be hidden from the AC.0a UI as a "synthetic"
 * vendor-order entry rather than an actual service line. Per the spec:
 *
 *   "Detection rule: filter rows where serviceId.startsWith('order:') OR
 *   serviceName === 'Order ' + providerOrderId (or similar pattern —
 *   adjust based on observed data)."
 *
 * The line builder (`accusourceScreeningLineItems.ts`) ALREADY rewrites
 * generic `Order N` names to `County Criminal · {jurisdiction}` when
 * jurisdiction info is present, so by the time we see a row whose name
 * still matches `/^order\s+\S+$/i`, it has no useful info to surface.
 * Filtering it is safe — and aligns with the spec's "either pattern" rule.
 *
 * NOTE: this is a presentation guard — it does NOT delete rows from
 * Firestore. The line builder's 90-second time-correlated dedup is the
 * primary mechanism; this filter is the catch-all for synthetics that
 * survive that dedup (rare, e.g. when the named webhook never arrived).
 */
export function isSyntheticOrderRow(line: AccusourceScreeningLineItem): boolean {
  if (typeof line.id === 'string' && line.id.startsWith('order:')) return true;
  if (typeof line.name === 'string' && /^order\s+\S+$/i.test(line.name.trim())) return true;
  return false;
}

/**
 * Group lines into bands using their effective verdict. Returns one entry
 * per band in `BAND_ORDER` (so iteration order is the spec-mandated render
 * order). Empty bands are returned as empty arrays — the caller decides
 * whether to render or hide them (per the spec, empty bands hide entirely).
 *
 * Lines flagged as synthetic by `isSyntheticOrderRow` are skipped silently.
 * Pass `{ keepSynthetic: true }` if a future surface needs them (none today).
 *
 * Pure: stable input → stable output. Safe to memoize on (lines reference)
 * since `accusourceScreeningLineItems` already returns a fresh array on
 * each `record` change.
 */
export function groupLinesByBand(
  lines: ReadonlyArray<AccusourceScreeningLineItem>,
  opts: { keepSynthetic?: boolean } = {},
): Record<AccusourceVerdictBand, AccusourceScreeningLineItem[]> {
  const out: Record<AccusourceVerdictBand, AccusourceScreeningLineItem[]> = {
    NEEDS_REVIEW: [],
    FAILED: [],
    PENDING: [],
    PASSED: [],
  };
  for (const line of lines) {
    if (!opts.keepSynthetic && isSyntheticOrderRow(line)) continue;
    const band = verdictBand(line.verdict);
    out[band].push(line);
  }
  return out;
}

/**
 * Total non-synthetic line count. The card header uses this so the
 * "AccuSource service lines (N)" subtext matches the sum of band counts
 * the CSA can actually see (not the raw `lines.length` which would
 * include filtered synthetics).
 */
export function totalVisibleLineCount(
  lines: ReadonlyArray<AccusourceScreeningLineItem>,
): number {
  let n = 0;
  for (const line of lines) {
    if (!isSyntheticOrderRow(line)) n += 1;
  }
  return n;
}

/**
 * Card-header sub-badge copy — shown to the right of the title when the
 * worker has actionable lines. Returns `null` when no actionable lines
 * exist (no badge renders).
 *
 * Priority: needs-review beats failed beats nothing. Both don't stack —
 * the spec calls for "1 item needs attention", not "1 needs review and
 * 2 failed", which would crowd the header.
 */
export function cardHeaderSubBadge(
  byBand: Record<AccusourceVerdictBand, ReadonlyArray<unknown>>,
): { label: string; severity: 'warning' | 'error' } | null {
  const nReview = byBand.NEEDS_REVIEW.length;
  if (nReview > 0) {
    return {
      label: `${nReview} need${nReview === 1 ? 's' : ''} review`,
      severity: 'warning',
    };
  }
  const nFailed = byBand.FAILED.length;
  if (nFailed > 0) {
    return {
      label: `${nFailed} failed`,
      severity: 'error',
    };
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────
// Package-level rollup (AC.0b — "is CORT Basic cleared?")
// ─────────────────────────────────────────────────────────────────────────

/**
 * Single package-level verdict rolled up from the per-line effective
 * verdicts. Gives recruiters the one answer they actually want — "is this
 * person cleared for CORT Basic?" — instead of scanning N line bands.
 */
export type PackageRollupVerdict =
  | 'CLEARED'
  | 'FAILED'
  | 'ACTION_NEEDED'
  | 'IN_PROGRESS'
  | 'NONE';

export const PACKAGE_ROLLUP_LABEL: Readonly<Record<PackageRollupVerdict, string>> =
  Object.freeze({
    CLEARED: 'Cleared',
    FAILED: 'Failed',
    ACTION_NEEDED: 'Action needed',
    IN_PROGRESS: 'In progress',
    NONE: '—',
  });

export const PACKAGE_ROLLUP_COLOR: Readonly<
  Record<PackageRollupVerdict, 'success' | 'error' | 'warning' | 'info' | 'default'>
> = Object.freeze({
  CLEARED: 'success',
  FAILED: 'error',
  ACTION_NEEDED: 'warning',
  IN_PROGRESS: 'info',
  NONE: 'default',
});

/**
 * Roll the per-line effective verdicts up to one package verdict.
 *
 * Decision (Greg, 2026-06-09): explicit adjudication is the source of truth,
 * and a line only counts toward "Cleared" when its EFFECTIVE verdict is
 * PASSED. So a Canceled / Expired / needs-review line blocks "Cleared" until
 * a recruiter explicitly marks it Passed (its effective verdict flips to
 * PASSED via the manual override). Vendor status never auto-clears.
 *
 *   FAILED        — any line FAILED (hard stop)
 *   ACTION_NEEDED — any line NEEDS_REVIEW (incl. canceled/expired auto-flagged)
 *   IN_PROGRESS   — any line still PENDING (and none failed / needs review)
 *   CLEARED       — every line PASSED
 *   NONE          — no non-synthetic lines on the record
 */
export function computePackageRollup(
  lines: ReadonlyArray<AccusourceScreeningLineItem>,
): PackageRollupVerdict {
  const visible = lines.filter((l) => !isSyntheticOrderRow(l));
  if (visible.length === 0) return 'NONE';
  const verdicts = visible.map((l) => l.verdict);
  if (verdicts.some((v) => v === 'FAILED')) return 'FAILED';
  if (verdicts.some((v) => v === 'NEEDS_REVIEW')) return 'ACTION_NEEDED';
  if (verdicts.some((v) => v === 'PENDING')) return 'IN_PROGRESS';
  return 'CLEARED';
}

/**
 * "All checks are still in progress with the vendor." special state —
 * true when the worker has lines but ALL of them are PENDING (everything
 * else is empty). Per the spec, the UI renders only the Pending band
 * with a small explanatory note in this case.
 */
export function isAllPendingState(
  byBand: Record<AccusourceVerdictBand, ReadonlyArray<unknown>>,
): boolean {
  return (
    byBand.PENDING.length > 0 &&
    byBand.NEEDS_REVIEW.length === 0 &&
    byBand.FAILED.length === 0 &&
    byBand.PASSED.length === 0
  );
}
