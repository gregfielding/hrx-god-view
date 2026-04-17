/**
 * Mirrors `src/utils/workerPreferencesCanonical.ts` for Cloud Functions (separate TS project).
 * Keep logic aligned when changing canonical preference resolution.
 */

function toStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => String(v || '').trim()).filter(Boolean);
}

const LEGACY_SCHEDULE_TO_CANONICAL: Record<string, string> = {
  full_time: 'full_time',
  part_time: 'part_time',
  gig: 'gig_work',
};

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

export function normalizeTargetWorkTypes(prefs: Record<string, unknown>): string[] {
  const canonical = toStringList(prefs.targetWorkTypes).map((s) => s.toLowerCase());
  if (canonical.length > 0) return [...new Set(canonical)];
  const legacy = toStringList(prefs.targetIndustries)
    .map((v) => v.toLowerCase())
    .filter((v) => v === 'hospitality' || v === 'industrial');
  return [...new Set(legacy)];
}

export function legacyTargetIndustriesSubsetFromTargetWorkTypes(
  targetWorkTypes: string[],
): ('hospitality' | 'industrial')[] {
  const out: ('hospitality' | 'industrial')[] = [];
  const set = new Set(targetWorkTypes.map((x) => x.toLowerCase()));
  if (set.has('hospitality')) out.push('hospitality');
  if (set.has('industrial')) out.push('industrial');
  return out;
}
