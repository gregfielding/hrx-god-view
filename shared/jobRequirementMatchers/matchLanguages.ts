/**
 * Language matcher — does the worker speak the required language at the
 * required minimum proficiency?
 *
 * Cardinality: **one matcher call per `RequiredLanguageV1` entry on the JO.**
 * Bilingual roles stack multiple required entries; the trigger calls this
 * matcher per entry, producing one `language_match` readiness item per
 * required language.
 *
 * Reads the worker's typed `languagesV2` first; falls back to the legacy
 * `languages: string[]` via `parseLegacyLanguageString` when V2 is absent.
 *
 * @see shared/languageProficiency.ts
 * @see docs/READINESS_EXECUTION_MATRIX.md §4.5
 */

import {
  type LanguageProficiencyV1,
  type RequiredLanguageV1,
  isLanguageProficiencyLevel,
  languageProficiencyOrdinal,
  parseLegacyLanguageString,
} from '../languageProficiency';
import { matcherResult, type MatcherResult } from './types';

export type MatchLanguagesInput = {
  /** The single language requirement to evaluate. */
  required: RequiredLanguageV1;
  /** Worker's typed proficiencies (V2). Preferred. */
  workerLanguagesV2?: LanguageProficiencyV1[];
  /** Worker's legacy languages list (e.g. `['Spanish', 'English (fluent)']`). Fallback. */
  workerLegacyLanguages?: string[] | null;
};

export type MatchLanguagesDetails = {
  requiredLanguage: string;
  requiredMinLevel: RequiredLanguageV1['minLevel'];
  /** The matched proficiency entry, if any. */
  matchedEntry: LanguageProficiencyV1 | null;
  /** Where the matched entry came from. */
  matchSource: 'v2' | 'legacy_parsed' | 'none';
};

const norm = (s: string): string => s.trim().toLowerCase();

/**
 * Compare a worker's languages against a single JO language requirement.
 *
 *   - Required language not on worker's profile (V2 + legacy both empty for that lang) → `incomplete`
 *   - Worker has the language but level < minLevel → `complete_fail`
 *   - Worker has the language at >= minLevel → `complete_pass`
 *
 * Like `matchEducation`, this never returns `needs_review` — proficiency is
 * either claimed at sufficient level or it isn't. Recruiters can override the
 * status via callable later if they want to credit a worker manually.
 */
export function matchLanguages(input: MatchLanguagesInput): MatcherResult<MatchLanguagesDetails> {
  const reqLangNorm = norm(input.required.language);
  const requiredMinLevel = input.required.minLevel;

  if (!reqLangNorm) {
    // Defensive — caller passed an empty required.language. Skip.
    return matcherResult.notApplicable<MatchLanguagesDetails>('required_language_empty', {
      requiredLanguage: input.required.language,
      requiredMinLevel,
      matchedEntry: null,
      matchSource: 'none',
    });
  }

  // 1. V2 lookup — exact (case-insensitive on trimmed value).
  if (Array.isArray(input.workerLanguagesV2)) {
    for (const entry of input.workerLanguagesV2) {
      if (
        entry &&
        typeof entry.language === 'string' &&
        norm(entry.language) === reqLangNorm &&
        isLanguageProficiencyLevel(entry.level)
      ) {
        return assess(entry, input.required, 'v2');
      }
    }
  }

  // 2. Legacy fallback — parse strings, find first match.
  if (Array.isArray(input.workerLegacyLanguages)) {
    for (const raw of input.workerLegacyLanguages) {
      const parsed = parseLegacyLanguageString(raw);
      if (parsed && norm(parsed.language) === reqLangNorm) {
        return assess(parsed, input.required, 'legacy_parsed');
      }
    }
  }

  return matcherResult.incomplete<MatchLanguagesDetails>('language_not_on_profile', {
    requiredLanguage: input.required.language,
    requiredMinLevel,
    matchedEntry: null,
    matchSource: 'none',
  });
}

function assess(
  entry: LanguageProficiencyV1,
  required: RequiredLanguageV1,
  matchSource: MatchLanguagesDetails['matchSource'],
): MatcherResult<MatchLanguagesDetails> {
  const details: MatchLanguagesDetails = {
    requiredLanguage: required.language,
    requiredMinLevel: required.minLevel,
    matchedEntry: entry,
    matchSource,
  };
  if (languageProficiencyOrdinal(entry.level) >= languageProficiencyOrdinal(required.minLevel)) {
    return matcherResult.pass<MatchLanguagesDetails>('level_meets_minimum', details);
  }
  return matcherResult.fail<MatchLanguagesDetails>('level_below_minimum', details);
}
