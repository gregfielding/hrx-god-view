/**
 * **R.2** — Shared helpers for the willingness matchers.
 *
 * Worker self-attestation answers come in via the application wizard
 * (`RequirementsAcknowledgementStep`), are written through to the user doc
 * as `workerAttestations.*Willingness` (R.0a), and are consumed here by the
 * willingness matchers (`matchPhysicalWillingness`,
 * `matchUniformWillingness`, `matchPpeWillingness`,
 * `matchLanguageWillingness`).
 *
 * Three quirks the matcher has to defend against (all grounded in the
 * existing apply UX, see Q-R2-2 grounding pass in `READINESS_R1_R2_HANDOFF.md`):
 *
 *   1. **Sentinel is `''`, not `null` or `'unknown'`.** The shipped
 *      `AttestationWillingness` enum is `'yes' | 'no' | 'maybe' | ''`. The
 *      apply wizard writes `''` (or omits the field) when the worker hasn't
 *      picked an answer; some legacy paths leave `null` / `undefined` instead.
 *      The matcher treats all of those identically as "not picked".
 *   2. **UI persists Title-Case.** `RequirementsAcknowledgementStep` writes
 *      `'Yes' | 'No' | 'Maybe'` to `comfortableWith*` legacy keys; the R.0
 *      sync trigger copies those values verbatim into the
 *      `workerAttestations.*Willingness` fields. Production data therefore
 *      has both lowercase (when sourced from typed clients) and Title-Case
 *      (when sourced from the wizard). Normalizing here keeps callers from
 *      having to think about it.
 *   3. **Gate-not-source semantic.** A `null` / `''` here means "incomplete",
 *      not "fail". The chip aggregator (R.4) reads `status: 'incomplete'`
 *      with `severity: 'soft'` differently from `status: 'complete_fail'`
 *      with the same severity (yellow vs grey on the chip).
 *
 * Runtime-neutral. No firebase imports.
 *
 * @see shared/assignmentReadinessItemV1.ts (`'physical_willingness'` etc.)
 * @see src/types/UserProfile.ts (canonical `AttestationWillingness` + `WorkerAttestations`)
 */

import type { MatchedReadinessStatus } from './types';

/**
 * Mirror of `AttestationWillingness` in `src/types/UserProfile.ts`. Kept
 * inline here so this `shared/` layer stays runtime-neutral (no `src/`
 * imports). The shapes MUST stay in sync — when one changes, change both.
 *
 * Note: the canonical enum includes `''` as the "not picked" sentinel; the
 * matcher's `normalizeWillingness` collapses `''` (and `null` / `undefined`
 * / unknown strings) into the post-normalization sentinel `null`, so
 * downstream code only branches on `'yes' | 'no' | 'maybe' | null`.
 */
export type AttestationWillingnessValue = 'yes' | 'no' | 'maybe' | '';

/**
 * Lenient input type for the matchers — accepts what production
 * actually contains: the canonical enum, Title-Case from the wizard,
 * `null`, `undefined`, and arbitrary strings (treated as "not picked").
 */
export type WillingnessInput =
  | AttestationWillingnessValue
  | 'Yes'
  | 'No'
  | 'Maybe'
  | string
  | null
  | undefined;

/**
 * Post-normalization shape — what callers branch on after running the
 * input through `normalizeWillingness`. `null` is the unified "not picked"
 * sentinel that collapses `''`, `undefined`, and unknown strings.
 */
export type NormalizedWillingness = 'yes' | 'no' | 'maybe' | null;

/**
 * Normalize the raw willingness value to the canonical lowercase enum.
 * Strips whitespace, lowercases, and only emits a recognized value.
 * Anything unrecognized (including `''`, `null`, `undefined`) → `null`,
 * which matchers map to `'incomplete'` per D8.R2.
 */
export function normalizeWillingness(value: WillingnessInput): NormalizedWillingness {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  if (trimmed === 'yes' || trimmed === 'no' || trimmed === 'maybe') return trimmed;
  return null;
}

/**
 * **D8.R2** — Map a normalized willingness answer onto the readiness
 * status the seeder will stamp. `'self_attest'` is the partner
 * `resolutionMethod` (set by the helper that pushes the spec).
 *
 *   yes   → complete_pass
 *   maybe → needs_review (CSA can adjudicate later)
 *   no    → complete_fail (soft severity → yellow on the chip)
 *   null  → incomplete (worker hasn't answered yet)
 */
export function willingnessToStatus(normalized: NormalizedWillingness): MatchedReadinessStatus {
  switch (normalized) {
    case 'yes':
      return 'complete_pass';
    case 'maybe':
      return 'needs_review';
    case 'no':
      return 'complete_fail';
    case null:
    default:
      return 'incomplete';
  }
}

/**
 * Worse-of severity rank. Used by `matchUniformWillingness` to combine the
 * library and custom answers when both apply: the worst answer wins so a
 * worker who said "yes to the polo, no to the steel-toe boots" surfaces as
 * `complete_fail`, not `complete_pass`.
 *
 * `null` (not picked) is treated as the LOWEST priority — if either side
 * has an explicit answer, it dominates over the empty side. This way a
 * partially-answered application doesn't drag a `'yes'` down to
 * `'incomplete'`. The integration test covers this matrix.
 */
const RANK: Record<Exclude<NormalizedWillingness, null>, number> = {
  yes: 3,
  maybe: 2,
  no: 1,
};

/**
 * Lower-rank-wins worse-of, ignoring the `null` (not-picked) side when the
 * other has any answer.
 */
export function worseOfWillingness(
  a: NormalizedWillingness,
  b: NormalizedWillingness,
): NormalizedWillingness {
  if (a === null && b === null) return null;
  if (a === null) return b;
  if (b === null) return a;
  return RANK[a] <= RANK[b] ? a : b;
}
