/**
 * Canonical worker preference model: `workerProfile.preferences.*`
 * Legacy fields (`targetIndustries`, `scheduleIntentOptions`, `jobReadiness.intent.*`) are
 * fallbacks for reads and dual-written on updates for transition — not a second source of truth.
 */

export const CANONICAL_PREFERENCE_KEYS = [
  'targetWorkTypes',
  'schedulePreferences',
  'experienceCategories',
  'gigWorkInterestCategories',
  'openToGigWork',
] as const;

export type CanonicalPreferenceKey = (typeof CANONICAL_PREFERENCE_KEYS)[number];

function toStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => String(v || '').trim()).filter(Boolean);
}

/** Prescreen / profile opening schedule tokens (subset). */
const LEGACY_SCHEDULE_TO_CANONICAL: Record<string, string> = {
  full_time: 'full_time',
  part_time: 'part_time',
  gig: 'gig_work',
};

/**
 * Canonical `schedulePreferences` from legacy `scheduleIntentOptions` (full_time | part_time | gig)
 * plus optional hints from `desiredWorkType` when lists are empty.
 */
export function scheduleIntentOptionsToSchedulePreferences(
  scheduleIntentOptions: string[],
  desiredWorkTypeHint?: string,
): string[] {
  const out = new Set<string>();
  for (const raw of scheduleIntentOptions) {
    const k = String(raw || '').toLowerCase().trim();
    const mapped = LEGACY_SCHEDULE_TO_CANONICAL[k];
    if (mapped) out.add(mapped);
  }
  if (out.size === 0 && desiredWorkTypeHint) {
    const dw = desiredWorkTypeHint.toLowerCase().trim();
    if (dw === 'full_time') out.add('full_time');
    if (dw === 'part_time') out.add('part_time');
    if (dw === 'gig') out.add('gig_work');
  }
  return [...out];
}

/** Legacy three-value schedule options used by job readiness UI + jobReadiness.intent. */
export function schedulePreferencesToScheduleIntentOptions(schedulePreferences: string[]): string[] {
  const out = new Set<string>();
  for (const raw of schedulePreferences) {
    const k = String(raw || '').toLowerCase().trim();
    if (k === 'full_time') out.add('full_time');
    if (k === 'part_time') out.add('part_time');
    if (k === 'gig_work') out.add('gig');
  }
  return [...out];
}

/** Narrow prescreen-style work types to legacy readiness industries (hospitality | industrial). */
export function legacyTargetIndustriesSubsetFromTargetWorkTypes(targetWorkTypes: string[]): ('hospitality' | 'industrial')[] {
  const out: ('hospitality' | 'industrial')[] = [];
  const set = new Set(targetWorkTypes.map((x) => x.toLowerCase()));
  if (set.has('hospitality')) out.push('hospitality');
  if (set.has('industrial')) out.push('industrial');
  return out;
}

/**
 * Read canonical `targetWorkTypes` when present; otherwise derive from legacy `targetIndustries`
 * (hospitality / industrial only — same values as prescreen tokens).
 */
export function normalizeTargetWorkTypes(prefs: Record<string, unknown>): string[] {
  const canonical = toStringList(prefs.targetWorkTypes).map((s) => s.toLowerCase());
  if (canonical.length > 0) return [...new Set(canonical)];
  const legacy = toStringList(prefs.targetIndustries)
    .map((v) => v.toLowerCase())
    .filter((v) => v === 'hospitality' || v === 'industrial');
  return [...new Set(legacy)];
}

/**
 * Read canonical `schedulePreferences` when present; otherwise derive from `scheduleIntentOptions`
 * and `desiredWorkType`.
 */
export function normalizeSchedulePreferences(prefs: Record<string, unknown>): string[] {
  const canonical = toStringList(prefs.schedulePreferences).map((s) => s.toLowerCase());
  if (canonical.length > 0) return [...new Set(canonical)];
  const legacyOpts = toStringList(prefs.scheduleIntentOptions);
  const dw = String(prefs.desiredWorkType || '').trim();
  return scheduleIntentOptionsToSchedulePreferences(legacyOpts, dw);
}

export function deriveOpenToGigWork(prefs: Record<string, unknown>, schedulePreferences: string[]): boolean {
  if (typeof prefs.openToGigWork === 'boolean') return prefs.openToGigWork;
  return schedulePreferences.includes('gig_work');
}

export interface ResolvedWorkerPreferences {
  targetWorkTypes: string[];
  schedulePreferences: string[];
  experienceCategories: string[];
  gigWorkInterestCategories: string[];
  openToGigWork: boolean;
  /** hospitality | industrial — for existing readiness UI that only supports two industries */
  legacyTargetIndustriesSubset: ('hospitality' | 'industrial')[];
  /** full_time | part_time | gig — for UI chips that still use legacy schedule intent */
  legacyScheduleIntentOptions: string[];
}

/**
 * Single place to resolve preference fields for worker UI + readiness helpers (canonical-first).
 */
export function resolveWorkerPreferences(prefs: Record<string, unknown> | null | undefined): ResolvedWorkerPreferences {
  const p = prefs && typeof prefs === 'object' ? prefs : {};
  const targetWorkTypes = normalizeTargetWorkTypes(p);
  const schedulePreferences = normalizeSchedulePreferences(p);
  const experienceCategories = toStringList(p.experienceCategories).map((s) => s.toLowerCase());
  const gigWorkInterestCategories = toStringList(p.gigWorkInterestCategories).map((s) => s.toLowerCase());
  const openToGigWork = deriveOpenToGigWork(p, schedulePreferences);
  return {
    targetWorkTypes,
    schedulePreferences,
    experienceCategories,
    gigWorkInterestCategories,
    openToGigWork,
    legacyTargetIndustriesSubset: legacyTargetIndustriesSubsetFromTargetWorkTypes(targetWorkTypes),
    legacyScheduleIntentOptions: schedulePreferencesToScheduleIntentOptions(schedulePreferences),
  };
}
