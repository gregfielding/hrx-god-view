/**
 * Job titles from profile work experience for recruiter list tables.
 * Reads `workExperience` / `workHistory` and `workerProfile.experience.workExperience`.
 */

const DEFAULT_MAX = 10;

function coerceWorkExperienceArray(userData: Record<string, unknown>): unknown[] {
  const primary = userData.workExperience ?? userData.workHistory;
  if (Array.isArray(primary) && primary.length > 0) return primary;

  const wp = userData.workerProfile;
  if (wp && typeof wp === 'object') {
    const exp = (wp as Record<string, unknown>).experience;
    if (exp && typeof exp === 'object') {
      const nested = (exp as Record<string, unknown>).workExperience;
      if (Array.isArray(nested)) return nested;
    }
  }

  return Array.isArray(primary) ? primary : [];
}

function parseRoughDateMs(value: unknown): number | null {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'object' && value !== null && typeof (value as { toDate?: () => Date }).toDate === 'function') {
    try {
      return (value as { toDate: () => Date }).toDate().getTime();
    } catch {
      return null;
    }
  }
  if (typeof value === 'object' && value !== null && typeof (value as { _seconds?: number })._seconds === 'number') {
    return (value as { _seconds: number })._seconds * 1000;
  }
  if (typeof value === 'string') {
    const s = value.trim().toLowerCase();
    if (s === 'present' || s === 'current') return Date.now();
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function sortKeyForEntry(entry: Record<string, unknown>, index: number, len: number): number {
  const endRaw = entry.endDate;
  const startRaw = entry.startDate;
  const endStr = typeof endRaw === 'string' ? endRaw.trim().toLowerCase() : '';
  const endPresent = endStr === 'present' || endStr === 'current';
  if (endPresent) return Date.now();

  const endMs = parseRoughDateMs(endRaw);
  const startMs = parseRoughDateMs(startRaw);
  if (endMs != null) return endMs;
  if (startMs != null) return startMs;
  // No dates: higher index = later in stored list (often most recently added)
  return len + index;
}

function entryJobTitle(entry: unknown): string {
  if (!entry || typeof entry !== 'object') return '';
  const e = entry as Record<string, unknown>;
  const t = e.jobTitle ?? e.title;
  return typeof t === 'string' ? t.trim() : '';
}

/** Same title at different employers → one line; casing from the most recent entry. */
function dedupeTitlesByRecencyOrder(titles: string[], max: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of titles) {
    const key = raw.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(raw.trim());
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Up to `max` unique job titles, most recent first (by end/start date when present, else list order).
 */
export function buildWorkHistoryJobTitles(userData: unknown, max: number = DEFAULT_MAX): string[] {
  if (!userData || typeof userData !== 'object') return [];
  const row = userData as Record<string, unknown>;
  const raw = coerceWorkExperienceArray(row);
  if (!Array.isArray(raw) || raw.length === 0) return [];

  const len = raw.length;
  const decorated = raw
    .map((entry, index) => {
      const title = entryJobTitle(entry);
      if (!title) return null;
      const sk =
        entry && typeof entry === 'object'
          ? sortKeyForEntry(entry as Record<string, unknown>, index, len)
          : len + index;
      return { title, sortKey: sk };
    })
    .filter((x): x is { title: string; sortKey: number } => x !== null);

  decorated.sort((a, b) => b.sortKey - a.sortKey);
  const orderedTitles = decorated.map((d) => d.title);
  return dedupeTitlesByRecencyOrder(orderedTitles, max);
}

/** Prefer mapper-populated `workHistoryJobTitles` when present. */
export function workHistoryTitlesForRecruiterTableRow(row: Record<string, unknown>): string[] {
  const pre = row.workHistoryJobTitles;
  if (Array.isArray(pre) && pre.length > 0 && pre.every((x) => typeof x === 'string')) {
    return dedupeTitlesByRecencyOrder(pre as string[], DEFAULT_MAX);
  }
  return buildWorkHistoryJobTitles(row);
}
