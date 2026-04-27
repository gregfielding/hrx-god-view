/**
 * **R.2** — Uniform willingness matcher with worse-of combination.
 *
 * Single complication vs the other three willingness matchers: the JO can
 * have **library uniform requirements** (`dressCode` / legacy
 * `uniformRequirements`) AND **custom uniform notes**
 * (`customUniformRequirements` free-text) populated independently — the
 * apply wizard collects two separate answers
 * (`uniformRequirementWillingness` + `customUniformRequirementWillingness`)
 * to match.
 *
 * The matcher takes the **worse-of** when both gates are active and both
 * answers exist. The integration test fixes the matrix; the gist is:
 *
 *   - Both 'yes'                     → complete_pass
 *   - 'yes' + 'no'                   → complete_fail (no wins)
 *   - 'yes' + 'maybe'                → needs_review
 *   - 'yes' + null                   → complete_pass (the answered side wins)
 *   - both null                      → incomplete
 *   - 'no' + 'maybe'                 → complete_fail (no wins over maybe)
 *
 * Severity rank: `no < maybe < yes`. `null` (not picked) is the lowest
 * priority and yields to whatever the other side answered.
 *
 * Cardinality: **one matcher call per assignment**. The helper
 * (`buildPhaseBMatchSpecs`) gates the call on at least one of the JO's
 * uniform fields being populated; the matcher itself reads BOTH worker
 * willingness fields and only consults the side(s) the helper marked as
 * applicable.
 *
 * @see ./willingness.ts (status mapping + worse-of helper)
 * @see docs/READINESS_R1_R2_HANDOFF.md §D7.R2 (uniform special-case rationale)
 */

import { matcherResult, type MatcherResult } from './types';
import {
  normalizeWillingness,
  willingnessToStatus,
  worseOfWillingness,
  type NormalizedWillingness,
  type WillingnessInput,
} from './willingness';

export type MatchUniformWillingnessInput = {
  /**
   * Whether the JO has library uniform requirements (`dressCode` /
   * `uniformRequirements`) populated. When `false`, the matcher ignores
   * `libraryWillingness` even if the worker has answered.
   */
  jobHasLibraryUniform: boolean;
  /**
   * Whether the JO has custom uniform requirements
   * (`customUniformRequirements` free-text) populated. When `false`, the
   * matcher ignores `customWillingness`.
   */
  jobHasCustomUniform: boolean;
  /** Worker's `workerAttestations.uniformRequirementWillingness` answer. */
  libraryWillingness: WillingnessInput;
  /** Worker's `workerAttestations.customUniformRequirementWillingness` answer. */
  customWillingness: WillingnessInput;
};

export type MatchUniformWillingnessDetails = {
  jobHasLibraryUniform: boolean;
  jobHasCustomUniform: boolean;
  libraryWillingness: NormalizedWillingness;
  customWillingness: NormalizedWillingness;
  /** The combined answer the matcher resolved against the worse-of rule. */
  effectiveWillingness: NormalizedWillingness;
};

/**
 * Combine library and custom uniform willingness per the worse-of rule,
 * then map onto the standard willingness → readiness status table.
 *
 * Returns `not_applicable` ONLY when neither uniform gate is active — at
 * which point the helper shouldn't have called the matcher in the first
 * place; the branch exists as a defensive guard.
 */
export function matchUniformWillingness(
  input: MatchUniformWillingnessInput,
): MatcherResult<MatchUniformWillingnessDetails> {
  const libraryNorm = input.jobHasLibraryUniform
    ? normalizeWillingness(input.libraryWillingness)
    : null;
  const customNorm = input.jobHasCustomUniform
    ? normalizeWillingness(input.customWillingness)
    : null;

  if (!input.jobHasLibraryUniform && !input.jobHasCustomUniform) {
    return matcherResult.notApplicable<MatchUniformWillingnessDetails>(
      'uniform_willingness_no_active_gate',
      {
        jobHasLibraryUniform: false,
        jobHasCustomUniform: false,
        libraryWillingness: null,
        customWillingness: null,
        effectiveWillingness: null,
      },
    );
  }

  const effective = worseOfWillingness(libraryNorm, customNorm);
  const status = willingnessToStatus(effective);

  const reasonByStatus: Record<typeof status, string> = {
    complete_pass: 'uniform_willingness_yes',
    complete_fail: 'uniform_willingness_no',
    needs_review: 'uniform_willingness_maybe',
    incomplete: 'uniform_willingness_not_picked',
    not_applicable: 'uniform_willingness_not_applicable',
  };

  const details: MatchUniformWillingnessDetails = {
    jobHasLibraryUniform: input.jobHasLibraryUniform,
    jobHasCustomUniform: input.jobHasCustomUniform,
    libraryWillingness: libraryNorm,
    customWillingness: customNorm,
    effectiveWillingness: effective,
  };

  const builders = {
    complete_pass: matcherResult.pass<MatchUniformWillingnessDetails>,
    complete_fail: matcherResult.fail<MatchUniformWillingnessDetails>,
    needs_review: matcherResult.needsReview<MatchUniformWillingnessDetails>,
    incomplete: matcherResult.incomplete<MatchUniformWillingnessDetails>,
    not_applicable: matcherResult.notApplicable<MatchUniformWillingnessDetails>,
  } as const;

  return builders[status](reasonByStatus[status], details);
}
