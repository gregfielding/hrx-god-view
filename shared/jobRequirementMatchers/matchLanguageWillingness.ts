/**
 * **R.2** — Language willingness matcher.
 *
 * Distinct from `language_match` (which checks proficiency against the
 * worker's typed `languagesV2` records — hard match against
 * `languagesRequiredV2`). This is the standing comfort answer: "are you
 * comfortable working in this site's language(s)?" — persisted to
 * `users/{uid}.workerAttestations.languageRequirementWillingness`.
 *
 * Both items can seed for the same JO + worker (Q-R2-3 locked):
 * proficiency and comfort answer different questions, and the chip
 * aggregator (R.4) handles the double-counting cleanly.
 *
 * Cardinality: **one matcher call per assignment** (single-instance type).
 * The helper (`buildPhaseBMatchSpecs`) gates the call on the JO having
 * either `languagesRequired` or `languagesRequiredV2` populated.
 *
 * @see ./willingness.ts (status mapping)
 * @see ./matchLanguages.ts (the proficiency counterpart)
 * @see docs/READINESS_R1_R2_HANDOFF.md §D8.R2
 */

import { matcherResult, type MatcherResult } from './types';
import {
  normalizeWillingness,
  willingnessToStatus,
  type NormalizedWillingness,
  type WillingnessInput,
} from './willingness';

export type MatchLanguageWillingnessInput = {
  willingness: WillingnessInput;
};

export type MatchLanguageWillingnessDetails = {
  willingness: NormalizedWillingness;
};

export function matchLanguageWillingness(
  input: MatchLanguageWillingnessInput,
): MatcherResult<MatchLanguageWillingnessDetails> {
  const normalized = normalizeWillingness(input.willingness);
  const status = willingnessToStatus(normalized);

  const reasonByStatus: Record<typeof status, string> = {
    complete_pass: 'language_willingness_yes',
    complete_fail: 'language_willingness_no',
    needs_review: 'language_willingness_maybe',
    incomplete: 'language_willingness_not_picked',
    not_applicable: 'language_willingness_not_applicable',
  };

  const builders = {
    complete_pass: matcherResult.pass<MatchLanguageWillingnessDetails>,
    complete_fail: matcherResult.fail<MatchLanguageWillingnessDetails>,
    needs_review: matcherResult.needsReview<MatchLanguageWillingnessDetails>,
    incomplete: matcherResult.incomplete<MatchLanguageWillingnessDetails>,
    not_applicable: matcherResult.notApplicable<MatchLanguageWillingnessDetails>,
  } as const;

  return builders[status](reasonByStatus[status], { willingness: normalized });
}
