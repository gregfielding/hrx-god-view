/**
 * Career (ongoing) placement weekly schedules.
 *
 * A career placement is a standing role, so its assignment's
 * `weeklySchedule` must describe the worker's WEEK. When the placement lands
 * on a shift that carries no recurring schedule of its own — a single-date
 * shift, e.g. a Fieldglass auto-created one (`shiftMode: 'single'` +
 * `shiftDate`) — the only day-of-week anywhere is the shift's date. The
 * denorm trigger used to synthesize a ONE-weekday schedule from it, so the
 * timesheet grid (rows only for enabled weekdays) and
 * createDraftTimesheetEntryCallable (rejects other days) gave a full-time
 * worker one timecard row per week (JO #404 Prairie View A&M / JO #479
 * Pembroke Hill, 2026-09-11).
 *
 * Default = Mon–Fri with the shift's times, plus the start date's own
 * weekday when it falls on a weekend (so the start day never loses the row it
 * had before). The recruiter can override it in the Placements workdays
 * prompt (`placementsCreateAssignments` `weeklySchedule` payload) or later in
 * the AssignmentDrawer edit.
 *
 * NEVER model these as open shifts (`isOpenShift`/`noFixedTimes`) instead —
 * see docs/claude/project_open_shift_feature.md.
 *
 * Pure: no Firestore, no firebase imports (safe to import from triggers,
 * callables and the resolver without module-init cycles).
 */

export type CareerWeeklyScheduleDay = {enabled: boolean; startTime: string; endTime: string};
export type CareerWeeklySchedule = Record<string, CareerWeeklyScheduleDay>;

const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Mon–Fri (0 = Sun … 6 = Sat). */
export const CAREER_DEFAULT_WORKDAYS: readonly number[] = [1, 2, 3, 4, 5];

/** Day of week (0 = Sun) of a YYYY-MM-DD date, timezone-independent. */
export function dowFromIsoDate(iso: string): number | null {
  const v = String(iso ?? "").trim().slice(0, 10);
  if (!ISO_DATE_RE.test(v)) return null;
  const d = new Date(`${v}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d.getUTCDay();
}

/** True when the shift has at least one enabled weekday with real times —
 *  i.e. a recurring schedule the assignment should copy instead. */
export function shiftHasUsableWeeklySchedule(shift: Record<string, unknown> | null | undefined): boolean {
  const ws = shift?.weeklySchedule;
  if (!ws || typeof ws !== "object" || Array.isArray(ws)) return false;
  return Object.values(ws as Record<string, unknown>).some((day) => {
    if (!day || typeof day !== "object") return false;
    const d = day as Record<string, unknown>;
    return (
      d.enabled === true &&
      typeof d.startTime === "string" &&
      typeof d.endTime === "string" &&
      HHMM_RE.test(d.startTime.trim()) &&
      HHMM_RE.test(d.endTime.trim())
    );
  });
}

/**
 * Default career schedule: Mon–Fri at `startTime`–`endTime`, plus the
 * `startDate` weekday when it is a Saturday/Sunday. Null when the times
 * aren't HH:mm (nothing sane to stamp — callers leave the field unset).
 */
export function buildCareerDefaultWeeklySchedule(
  startDate: string,
  startTime: string,
  endTime: string,
): CareerWeeklySchedule | null {
  const start = String(startTime ?? "").trim();
  const end = String(endTime ?? "").trim();
  if (!HHMM_RE.test(start) || !HHMM_RE.test(end)) return null;
  const days = new Set<number>(CAREER_DEFAULT_WORKDAYS);
  const startDow = dowFromIsoDate(startDate);
  if (startDow !== null) days.add(startDow);
  const out: CareerWeeklySchedule = {};
  for (const d of [...days].sort()) out[String(d)] = {enabled: true, startTime: start, endTime: end};
  return out;
}

/**
 * Validate a recruiter-supplied schedule (Placements workdays prompt). Keeps
 * only enabled '0'..'6' entries with HH:mm times; null when nothing usable
 * survives, so callers fall back to the default.
 */
export function sanitizeCareerWeeklyScheduleInput(raw: unknown): CareerWeeklySchedule | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: CareerWeeklySchedule = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^[0-6]$/.test(k) || !v || typeof v !== "object") continue;
    const e = v as Record<string, unknown>;
    if (e.enabled !== true) continue;
    const startTime = typeof e.startTime === "string" ? e.startTime.trim() : "";
    const endTime = typeof e.endTime === "string" ? e.endTime.trim() : "";
    if (!HHMM_RE.test(startTime) || !HHMM_RE.test(endTime)) continue;
    out[k] = {enabled: true, startTime, endTime};
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** First enabled day's times (for the assignment's top-level start/end). */
export function firstEnabledTimes(
  schedule: CareerWeeklySchedule,
): {startTime: string; endTime: string} | null {
  const key = Object.keys(schedule).sort()[0];
  return key ? {startTime: schedule[key].startTime, endTime: schedule[key].endTime} : null;
}
