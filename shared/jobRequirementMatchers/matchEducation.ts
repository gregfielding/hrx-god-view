/**
 * Education matcher — does the worker's typed education level meet or exceed
 * what the JO requires?
 *
 * Pure ordinal comparison via `educationLevelOrdinal()`. Reads the worker's
 * V2 field first; falls back to parsing the legacy freeform `educationLevel`
 * string when V2 is absent.
 *
 * Cardinality: **single instance per assignment** — one JO has one
 * `educationLevelRequiredV2`. Matcher is called once.
 *
 * @see shared/educationLevel.ts
 * @see docs/READINESS_EXECUTION_MATRIX.md §4.4
 */

import {
  type EducationLevel,
  educationLevelOrdinal,
  isEducationLevel,
  parseLegacyEducationLevel,
} from '../educationLevel';
import { matcherResult, type MatcherResult } from './types';

export type MatchEducationInput = {
  /** JO's required level (typed). If `undefined` / `'none'`, requirement is vacuous → `not_applicable`. */
  required?: EducationLevel;
  /** Worker's typed level (V2). Preferred; matcher reads this first. */
  workerLevelV2?: EducationLevel;
  /** Worker's legacy freeform level (e.g. `'highschool'`, `'BS'`, `'Unknown'`). Used as fallback. */
  workerLegacyLevel?: string | null;
};

export type MatchEducationDetails = {
  required: EducationLevel | null;
  workerLevel: EducationLevel | null;
  /** Where `workerLevel` came from (for audit / UI hints). */
  workerLevelSource: 'v2' | 'legacy_parsed' | 'none';
};

/**
 * Compare a worker's education level against the JO requirement.
 *
 *   - JO has no requirement (`undefined`) or requires `'none'` → `not_applicable`
 *   - Worker has no level (V2 absent + legacy unparseable) → `incomplete`
 *   - Worker level < required → `complete_fail`
 *   - Worker level >= required → `complete_pass`
 *
 * The matcher never returns `needs_review` — education is binary against an
 * ordinal threshold; there's no fuzziness for a recruiter to adjudicate.
 */
export function matchEducation(input: MatchEducationInput): MatcherResult<MatchEducationDetails> {
  const required = input.required ?? null;

  // No requirement on JO → vacuously satisfied; readiness item irrelevant.
  if (!required || required === 'none') {
    return matcherResult.notApplicable<MatchEducationDetails>('no_requirement', {
      required,
      workerLevel: null,
      workerLevelSource: 'none',
    });
  }

  // Resolve worker's level: V2 wins; legacy parser fills in if needed.
  let workerLevel: EducationLevel | null = null;
  let workerLevelSource: MatchEducationDetails['workerLevelSource'] = 'none';

  if (input.workerLevelV2 && isEducationLevel(input.workerLevelV2)) {
    workerLevel = input.workerLevelV2;
    workerLevelSource = 'v2';
  } else if (input.workerLegacyLevel != null) {
    const parsed = parseLegacyEducationLevel(input.workerLegacyLevel);
    if (parsed) {
      workerLevel = parsed;
      workerLevelSource = 'legacy_parsed';
    }
  }

  const details: MatchEducationDetails = { required, workerLevel, workerLevelSource };

  if (workerLevel == null) {
    return matcherResult.incomplete<MatchEducationDetails>('worker_level_unknown', details);
  }

  if (educationLevelOrdinal(workerLevel) >= educationLevelOrdinal(required)) {
    return matcherResult.pass<MatchEducationDetails>('level_meets_requirement', details);
  }

  return matcherResult.fail<MatchEducationDetails>('level_below_required', details);
}
