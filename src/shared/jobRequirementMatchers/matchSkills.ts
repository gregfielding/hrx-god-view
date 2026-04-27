/**
 * Skill matcher — does the worker have the required skill?
 *
 * Cardinality: **one matcher call per skill in `JobOrder.skillsRequired`.**
 * The trigger calls per entry, producing one `skill_match` readiness item per
 * required skill.
 *
 * Skills today are loose strings on both sides (`skillsRequired: string[]`,
 * `users.skills: any[]`). This matcher accepts a `strictness` mode so tenants
 * can tune false-positive vs false-negative tradeoffs at the JO / tenant
 * level. Default is `'tokenized'` — the middle option.
 *
 * @see docs/READINESS_EXECUTION_MATRIX.md §4.3
 */

import { matcherResult, type MatcherResult } from './types';

/**
 * Match strictness:
 *
 *   - `'exact'`     — case-insensitive equality on trimmed values.
 *                     `'forklift'` matches `'Forklift'` but not `'Forklift Operator'`.
 *   - `'tokenized'` — split each side on whitespace + non-alphanumeric, then
 *                     require ALL tokens of `required` to appear in the worker
 *                     skill (subset match). `'forklift operator'` matches
 *                     `'Certified Forklift Operator'`.
 *   - `'fuzzy'`     — substring match in either direction. `'forklift'` matches
 *                     `'Forklift'` AND `'Forklift Operator'`. Higher false-positive
 *                     risk; reserve for legacy / unstructured worker skill lists.
 *
 * The matcher is pure — caller decides which mode based on JO / tenant config.
 */
export type SkillMatchStrictness = 'exact' | 'tokenized' | 'fuzzy';

export type MatchSkillsInput = {
  /** The single skill string from `JobOrder.skillsRequired`. */
  required: string;
  /** Worker's skills. Accepts strings or `{ name }` objects (legacy `any[]`). */
  workerSkills?: ReadonlyArray<string | { name?: string } | null | undefined> | null;
  /** Strictness mode. Default `'tokenized'`. */
  strictness?: SkillMatchStrictness;
};

export type MatchSkillsDetails = {
  required: string;
  strictness: SkillMatchStrictness;
  /** The first worker skill that matched, normalized for display. */
  matchedSkill: string | null;
};

const TOKEN_SPLIT = /[^a-z0-9]+/i;
const norm = (s: string): string => s.trim().toLowerCase();

function workerSkillName(s: string | { name?: string } | null | undefined): string | null {
  if (s == null) return null;
  if (typeof s === 'string') return s.trim() || null;
  if (typeof s === 'object' && typeof s.name === 'string') return s.name.trim() || null;
  return null;
}

function tokensOf(s: string): string[] {
  return s
    .toLowerCase()
    .split(TOKEN_SPLIT)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

function matches(required: string, worker: string, strictness: SkillMatchStrictness): boolean {
  if (strictness === 'exact') {
    return norm(required) === norm(worker);
  }
  if (strictness === 'tokenized') {
    const reqTokens = tokensOf(required);
    if (reqTokens.length === 0) return false;
    const workerLower = norm(worker);
    const workerTokens = new Set(tokensOf(worker));
    // All required tokens must appear in worker tokens, OR substring fallback.
    if (reqTokens.every((t) => workerTokens.has(t))) return true;
    // Tokenized has a softer fallback: substring of the joined required phrase.
    return workerLower.includes(reqTokens.join(' '));
  }
  // fuzzy
  const a = norm(required);
  const b = norm(worker);
  if (!a || !b) return false;
  return a.includes(b) || b.includes(a);
}

/**
 * Match a single required skill against the worker's skills.
 *
 *   - JO requirement is empty / blank → `not_applicable`
 *   - Worker has no skills array / empty → `incomplete`
 *   - No skill matches under the chosen strictness → `complete_fail`
 *   - At least one match → `complete_pass`
 *
 * Matcher does not return `needs_review`; recruiters can override after seed.
 */
export function matchSkills(input: MatchSkillsInput): MatcherResult<MatchSkillsDetails> {
  const strictness: SkillMatchStrictness = input.strictness ?? 'tokenized';
  const requiredTrim = input.required.trim();

  if (!requiredTrim) {
    return matcherResult.notApplicable<MatchSkillsDetails>('required_skill_empty', {
      required: input.required,
      strictness,
      matchedSkill: null,
    });
  }

  const workerSkills = Array.isArray(input.workerSkills) ? input.workerSkills : [];
  const workerNames = workerSkills.map(workerSkillName).filter((s): s is string => s != null);

  if (workerNames.length === 0) {
    return matcherResult.incomplete<MatchSkillsDetails>('worker_has_no_skills', {
      required: input.required,
      strictness,
      matchedSkill: null,
    });
  }

  for (const ws of workerNames) {
    if (matches(requiredTrim, ws, strictness)) {
      return matcherResult.pass<MatchSkillsDetails>('skill_match_found', {
        required: input.required,
        strictness,
        matchedSkill: ws,
      });
    }
  }

  return matcherResult.fail<MatchSkillsDetails>('skill_not_found', {
    required: input.required,
    strictness,
    matchedSkill: null,
  });
}
