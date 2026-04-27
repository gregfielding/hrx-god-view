/**
 * **R.2** — PPE willingness matcher.
 *
 * Distinct from `ppe_acknowledgement` (which is the per-shift "did you
 * bring it?" gate, hard severity). This is the standing willingness answer
 * the worker gave on the application wizard, persisted to
 * `users/{uid}.workerAttestations.requiredPpeWillingness`.
 *
 * Cardinality: **one matcher call per assignment** (single-instance type).
 * The helper (`buildPhaseBMatchSpecs`) gates the call on the JO having a
 * non-empty `ppeRequirements` field (string or string[] in production).
 *
 * @see ./willingness.ts (status mapping)
 * @see docs/READINESS_R1_R2_HANDOFF.md §D8.R2
 */

import { matcherResult, type MatcherResult } from './types';
import {
  normalizeWillingness,
  willingnessToStatus,
  type NormalizedWillingness,
  type WillingnessInput,
} from './willingness';

export type MatchPpeWillingnessInput = {
  willingness: WillingnessInput;
};

export type MatchPpeWillingnessDetails = {
  willingness: NormalizedWillingness;
};

export function matchPpeWillingness(
  input: MatchPpeWillingnessInput,
): MatcherResult<MatchPpeWillingnessDetails> {
  const normalized = normalizeWillingness(input.willingness);
  const status = willingnessToStatus(normalized);

  const reasonByStatus: Record<typeof status, string> = {
    complete_pass: 'ppe_willingness_yes',
    complete_fail: 'ppe_willingness_no',
    needs_review: 'ppe_willingness_maybe',
    incomplete: 'ppe_willingness_not_picked',
    not_applicable: 'ppe_willingness_not_applicable',
  };

  const builders = {
    complete_pass: matcherResult.pass<MatchPpeWillingnessDetails>,
    complete_fail: matcherResult.fail<MatchPpeWillingnessDetails>,
    needs_review: matcherResult.needsReview<MatchPpeWillingnessDetails>,
    incomplete: matcherResult.incomplete<MatchPpeWillingnessDetails>,
    not_applicable: matcherResult.notApplicable<MatchPpeWillingnessDetails>,
  } as const;

  return builders[status](reasonByStatus[status], { willingness: normalized });
}
