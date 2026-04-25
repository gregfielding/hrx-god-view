/**
 * Worker-held language proficiency. Split from the legacy
 * `users.languages: string[]` (a list of names with no level) so we can match
 * against `JobOrder.languagesRequiredV2`.
 *
 * Runtime-neutral. No firebase imports.
 *
 * @see docs/READINESS_EXECUTION_MATRIX.md §4.5
 * @see shared/jobRequirementMatchers/matchLanguages.ts (consumer — Phase B.3)
 */

export const LANGUAGE_PROFICIENCY_V1_VERSION = 1;

/**
 * Proficiency tiers, ordinally ordered (basic < conversational < fluent < native).
 * Matchers compare numeric ordinals so `worker.level >= required.minLevel` works.
 */
export type LanguageProficiencyLevel = 'basic' | 'conversational' | 'fluent' | 'native';

const LEVEL_ORDINAL: Record<LanguageProficiencyLevel, number> = {
  basic: 1,
  conversational: 2,
  fluent: 3,
  native: 4,
};

/** Get the ordinal rank of a proficiency level. Higher = more proficient. */
export function languageProficiencyOrdinal(level: LanguageProficiencyLevel): number {
  return LEVEL_ORDINAL[level];
}

/** Type guard for runtime-data validation. */
export function isLanguageProficiencyLevel(v: unknown): v is LanguageProficiencyLevel {
  return v === 'basic' || v === 'conversational' || v === 'fluent' || v === 'native';
}

/**
 * One entry in `users.languagesV2[]`. `language` is freeform — tenants accept
 * any vocabulary. Matchers compare case-insensitively on the trimmed value.
 */
export type LanguageProficiencyV1 = {
  /** Display name of the language. Examples: `'Spanish'`, `'English'`, `'Mandarin'`. */
  language: string;
  /** Self-reported (or attested) proficiency. */
  level: LanguageProficiencyLevel;
};

/**
 * One entry in `JobOrder.languagesRequiredV2[]`. The JO declares "worker must
 * speak `language` at AT LEAST `minLevel`". Bilingual roles stack multiple
 * required entries.
 */
export type RequiredLanguageV1 = {
  /** Language name to match (case-insensitive on trimmed value). */
  language: string;
  /** Minimum acceptable proficiency. `'basic'` = most lenient. */
  minLevel: LanguageProficiencyLevel;
};

/**
 * Best-effort parser for legacy `users.languages: string[]` entries. Recognized
 * patterns (case-insensitive):
 *
 *   `'Spanish'`              → `{ language: 'Spanish', level: 'conversational' }`
 *   `'Spanish (fluent)'`     → `{ language: 'Spanish', level: 'fluent' }`
 *   `'Spanish - native'`     → `{ language: 'Spanish', level: 'native' }`
 *   `'Spanish: basic'`       → `{ language: 'Spanish', level: 'basic' }`
 *
 * **Default level when unspecified is `'conversational'`.** Rationale: a worker
 * who lists a language on a profile is making a non-trivial proficiency claim;
 * `'basic'` would systematically over-qualify them, `'fluent'` would
 * over-promise. Conversational is the safe middle. Surface this caveat in the
 * UI when the data came from a legacy parse.
 *
 * Returns `null` for empty / non-string input. Never throws.
 */
export function parseLegacyLanguageString(raw: unknown): LanguageProficiencyV1 | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Match `LangName (level)`, `LangName - level`, `LangName: level`.
  // Capture is generous on the language side (anything before the separator),
  // strict on the level side (only the four typed values).
  const match = trimmed.match(
    /^(.+?)\s*[(\-:]\s*(basic|conversational|fluent|native)\s*\)?$/i,
  );
  if (match) {
    const language = match[1].trim();
    const level = match[2].toLowerCase() as LanguageProficiencyLevel;
    if (!language) return null;
    return { language, level };
  }

  return { language: trimmed, level: 'conversational' };
}
