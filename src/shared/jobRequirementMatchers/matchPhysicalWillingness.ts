/**
 * **R.2** — Physical-requirements willingness matcher.
 *
 * The JO authors a `physicalRequirements` field (a list of physical demands —
 * lifting, standing, climbing, etc.; runtime shape is `string[]` even though
 * the legacy `JobOrder` type declares `string`). The worker, on the
 * application wizard's `RequirementsAcknowledgementStep`, picks
 * Yes / No / Maybe to attest comfort with those demands. That answer is
 * persisted to `users/{uid}.workerAttestations.physicalRequirementWillingness`
 * via the R.0 sync trigger.
 *
 * This matcher is the bridge — no objective "worker record" exists for
 * physical comfort, so the readiness status is derived directly from the
 * worker's self-attestation per the locked D8.R2 mapping.
 *
 * Cardinality: **one matcher call per assignment** (single-instance type).
 * The helper (`buildPhaseBMatchSpecs`) gates the call on the JO having a
 * non-empty `physicalRequirements` field.
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

export type MatchPhysicalWillingnessInput = {
  /**
   * Worker's standing answer for `physicalRequirementWillingness`. Accepted
   * lenient — see `WillingnessInput` for the case / null tolerances.
   */
  willingness: WillingnessInput;
};

export type MatchPhysicalWillingnessDetails = {
  willingness: NormalizedWillingness;
};

/**
 * Map the worker's physical-requirements willingness onto a readiness
 * status. Yes → pass, Maybe → needs_review, No → fail, anything else
 * (including the `''` not-picked sentinel) → incomplete.
 *
 * Never returns `not_applicable`: callers gate the matcher externally on
 * the JO actually having a `physicalRequirements` field populated.
 */
export function matchPhysicalWillingness(
  input: MatchPhysicalWillingnessInput,
): MatcherResult<MatchPhysicalWillingnessDetails> {
  const normalized = normalizeWillingness(input.willingness);
  const status = willingnessToStatus(normalized);

  const reasonByStatus: Record<typeof status, string> = {
    complete_pass: 'physical_willingness_yes',
    complete_fail: 'physical_willingness_no',
    needs_review: 'physical_willingness_maybe',
    incomplete: 'physical_willingness_not_picked',
    not_applicable: 'physical_willingness_not_applicable',
  };

  const builders = {
    complete_pass: matcherResult.pass<MatchPhysicalWillingnessDetails>,
    complete_fail: matcherResult.fail<MatchPhysicalWillingnessDetails>,
    needs_review: matcherResult.needsReview<MatchPhysicalWillingnessDetails>,
    incomplete: matcherResult.incomplete<MatchPhysicalWillingnessDetails>,
    not_applicable: matcherResult.notApplicable<MatchPhysicalWillingnessDetails>,
  } as const;

  return builders[status](reasonByStatus[status], { willingness: normalized });
}
