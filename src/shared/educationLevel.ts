/**
 * Canonical EducationLevel enum + ordinal helper + legacy adapter.
 *
 * **Schema decision (Phase B.0, 2026-04-25):** the typed enum follows matrix §B
 * with two additions retained from the existing dropdown vocabulary —
 * `'ged'` and `'trade'` — because production data carries them and they are
 * meaningful job-eligibility tiers that don't fit `'high_school'` or
 * `'associate'`.
 *
 * Legacy data uses two non-typed shapes:
 *   - `'highschool'` (no underscore) — historical dropdown value at
 *     `src/data/experienceOptions.ts`
 *   - Freeform strings from `functions/src/resumeParser.ts` (e.g. `'Unknown'`)
 *
 * `parseLegacyEducationLevel()` normalizes both into the typed enum.
 *
 * Runtime-neutral. No firebase imports.
 *
 * @see docs/READINESS_EXECUTION_MATRIX.md §4.4
 * @see shared/jobRequirementMatchers/matchEducation.ts (consumer — Phase B.3)
 * @see src/data/experienceOptions.ts (legacy dropdown source — to be migrated)
 */

export const EDUCATION_LEVEL_V1_VERSION = 1;

/**
 * Canonical 8-tier education enum. Ordered roughly from least to most academic
 * for `educationLevelOrdinal()` comparisons.
 *
 * `'ged'` and `'trade'` slot between `'high_school'` and `'associate'`: both
 * are post-secondary in some sense but not full degree programs. See
 * `EDUCATION_LEVEL_ORDINAL` for the exact ranking.
 */
export type EducationLevel =
  | 'none'
  | 'high_school'
  | 'ged'
  | 'trade'
  | 'associate'
  | 'bachelor'
  | 'master'
  | 'doctorate';

/**
 * Ordinal rank for `worker >= required` comparisons. Higher = more academic.
 *
 * `'ged'` ranks equal to `'high_school'` (equivalency claim). `'trade'` ranks
 * one above (vocational completion = post-secondary credit). `'associate'`
 * and up follow the standard degree hierarchy.
 *
 * **Tied ranks matter for matching:** if a JO requires `'high_school'` and a
 * worker holds `'ged'`, the matcher returns `complete_pass` because the
 * ordinals are equal.
 */
export const EDUCATION_LEVEL_ORDINAL: Record<EducationLevel, number> = {
  none: 0,
  high_school: 1,
  ged: 1,
  trade: 2,
  associate: 3,
  bachelor: 4,
  master: 5,
  doctorate: 6,
};

/** Get the ordinal rank. Use `educationLevelOrdinal(a) >= educationLevelOrdinal(b)` to compare. */
export function educationLevelOrdinal(level: EducationLevel): number {
  return EDUCATION_LEVEL_ORDINAL[level];
}

/** Type guard for runtime-data validation. */
export function isEducationLevel(v: unknown): v is EducationLevel {
  return (
    v === 'none' ||
    v === 'high_school' ||
    v === 'ged' ||
    v === 'trade' ||
    v === 'associate' ||
    v === 'bachelor' ||
    v === 'master' ||
    v === 'doctorate'
  );
}

/**
 * Normalize legacy / freeform education strings into the typed enum.
 *
 * Returns `null` when the input can't be confidently mapped — callers should
 * treat `null` as "unknown level; can't satisfy any non-`'none'` requirement".
 *
 * Recognized inputs (case-insensitive; whitespace, hyphens, slashes collapsed
 * to underscores before matching):
 *
 *   - `'high_school'`, `'highschool'`, `'high school'`, `'hs'`, `'diploma'` → `'high_school'`
 *   - `'ged'` → `'ged'`
 *   - `'trade'`, `'vocational'`, `'cert'`, `'certificate'` → `'trade'`
 *   - `'associate'`, `'aa'`, `'as'`, `'aas'`, `'associates'` → `'associate'`
 *   - `'bachelor'`, `'ba'`, `'bs'`, `'bachelors'` → `'bachelor'`
 *   - `'master'`, `'ma'`, `'ms'`, `'mba'`, `'masters'` → `'master'`
 *   - `'doctorate'`, `'phd'`, `'edd'`, `'md'`, `'jd'` → `'doctorate'`
 *   - `'none'`, `'no_education'` → `'none'`
 *   - Anything else (incl. `'Unknown'` from the resume parser) → `null`
 */
export function parseLegacyEducationLevel(raw: unknown): EducationLevel | null {
  if (typeof raw !== 'string') return null;
  const norm = raw.trim().toLowerCase().replace(/[\s\-/]+/g, '_');
  if (!norm) return null;

  // Direct typed-enum match (covers the canonical values).
  if (isEducationLevel(norm)) return norm;

  // Aliases.
  if (norm === 'highschool' || norm === 'hs' || norm === 'diploma') return 'high_school';
  if (norm === 'no_education') return 'none';
  if (norm === 'vocational' || norm === 'cert' || norm === 'certificate') return 'trade';
  if (norm === 'aa' || norm === 'as' || norm === 'aas' || norm === 'associates') return 'associate';
  if (norm === 'ba' || norm === 'bs' || norm === 'bachelors') return 'bachelor';
  if (norm === 'ma' || norm === 'ms' || norm === 'mba' || norm === 'masters') return 'master';
  if (norm === 'phd' || norm === 'edd' || norm === 'md' || norm === 'jd') return 'doctorate';

  return null;
}
