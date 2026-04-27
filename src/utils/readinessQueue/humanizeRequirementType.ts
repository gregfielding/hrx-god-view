/**
 * Display label for a readiness `requirementType`. Extracted from
 * `RecruiterMyQueue.tsx` (verbatim — preserves existing rendering for the
 * 7+ surfaces currently consuming raw requirement types).
 *
 * If you want overrides for specific types (e.g. `i9_section_2` → "I-9 §2"),
 * add them in a follow-up PR with explicit tests so we don't silently change
 * what users see today.
 */

export function humanizeRequirementType(raw: string): string {
  if (!raw) return '—';
  return raw.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
