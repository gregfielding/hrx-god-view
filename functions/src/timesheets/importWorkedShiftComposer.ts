/**
 * **CSV-import worked-shift composer — real windows, breaks, weekly OT.**
 *
 * Fixes two defects in the original import→Everee W-2 path (reported
 * 2026-07-06, Zirick Brooks stub, C1 Select period 6/22–6/26):
 *
 *   1. The worked shift was synthesized as noon-UTC start + net hours with
 *      no break, even though the Indeed Flex CSV carries real clock in/out
 *      and break duration — stubs showed "8:00am–5:08pm, 9.13 hrs, 0.00
 *      break" instead of "~7:00am–4:35pm with a 30-min break".
 *   2. Hours shipped as a single REGULAR_TIME segment — Everee's endpoint
 *      REQUIRES fullyClassifiedHours and does NOT auto-classify, so a
 *      44.6-hour week paid zero overtime (FLSA §207 violation).
 *
 * Design invariants:
 *   - **Pay is anchored to the CSV's net `Hours` column** (Indeed's own
 *     computation, minute-aligned) — exactly as before. The window is
 *     derived: `end = start + netSeconds + unpaidBreakSeconds`, so
 *     window − unpaid breaks ≡ classified seconds and Everee's
 *     minute-floored validation can never reject the shift. The derived
 *     end may drift a minute or two from the CSV's raw clock-out (Indeed
 *     rounds their net hours); the start and break are real.
 *   - **Weekly-40 cascade only** (FLSA). Indeed Flex sites are Maryland
 *     (no daily-OT state rules). CA daily-8/DT needs the full multistate
 *     engine — deliberately out of scope until a CA site appears.
 *   - All portions minute-aligned (Everee floors to the minute; see the
 *     `minuteAlignedDay` history in submitImportTimesheetBatch.ts).
 *
 * Pure: no IO. Unit-testable with ts-node against real CSV samples.
 */

// ─────────────────────────────────────────────────────────────────────
// Timezones
// ─────────────────────────────────────────────────────────────────────

/** Dominant IANA zone per US state — good enough for worksite clock
 *  conversion (split-zone states get their majority zone; a wrong guess
 *  shifts the stub's display window, never the pay, which is anchored to
 *  net hours). */
const STATE_TO_TZ: Record<string, string> = {
  AL: 'America/Chicago', AK: 'America/Anchorage', AZ: 'America/Phoenix',
  AR: 'America/Chicago', CA: 'America/Los_Angeles', CO: 'America/Denver',
  CT: 'America/New_York', DC: 'America/New_York', DE: 'America/New_York',
  FL: 'America/New_York', GA: 'America/New_York', HI: 'Pacific/Honolulu',
  ID: 'America/Boise', IL: 'America/Chicago', IN: 'America/Indiana/Indianapolis',
  IA: 'America/Chicago', KS: 'America/Chicago', KY: 'America/New_York',
  LA: 'America/Chicago', ME: 'America/New_York', MD: 'America/New_York',
  MA: 'America/New_York', MI: 'America/Detroit', MN: 'America/Chicago',
  MS: 'America/Chicago', MO: 'America/Chicago', MT: 'America/Denver',
  NE: 'America/Chicago', NV: 'America/Los_Angeles', NH: 'America/New_York',
  NJ: 'America/New_York', NM: 'America/Denver', NY: 'America/New_York',
  NC: 'America/New_York', ND: 'America/Chicago', OH: 'America/New_York',
  OK: 'America/Chicago', OR: 'America/Los_Angeles', PA: 'America/New_York',
  RI: 'America/New_York', SC: 'America/New_York', SD: 'America/Chicago',
  TN: 'America/Chicago', TX: 'America/Chicago', UT: 'America/Denver',
  VT: 'America/New_York', VA: 'America/New_York', WA: 'America/Los_Angeles',
  WV: 'America/New_York', WI: 'America/Chicago', WY: 'America/Denver',
};

export function timezoneForState(state: string | null | undefined): string | null {
  const key = String(state ?? '').trim().toUpperCase();
  return STATE_TO_TZ[key] ?? null;
}

/** "6:56 AM" / "06:56" / "16:35" / "4:35 pm" → minutes since midnight. */
export function parseClockTime(raw: string | null | undefined): number | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const m = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?$/i);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min) || min > 59) return null;
  const ampm = (m[3] ?? '').toLowerCase();
  if (ampm === 'pm' && h < 12) h += 12;
  if (ampm === 'am' && h === 12) h = 0;
  if (h > 23) return null;
  return h * 60 + min;
}

/**
 * Epoch seconds for a wall-clock time in an IANA zone on a YYYY-MM-DD date.
 * Two-pass Intl offset resolution — DST-safe without a tz library.
 */
export function zonedEpochSeconds(
  workDate: string,
  minutesSinceMidnight: number,
  zone: string,
): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(workDate ?? ''));
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const h = Math.floor(minutesSinceMidnight / 60);
  const min = minutesSinceMidnight % 60;

  const wallAsUtcMs = Date.UTC(y, mo - 1, d, h, min, 0);
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
  const wallInZone = (ms: number): number => {
    const parts: Record<string, string> = {};
    for (const p of fmt.formatToParts(new Date(ms))) parts[p.type] = p.value;
    return Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour === '24' ? '0' : parts.hour),
      Number(parts.minute),
      Number(parts.second),
    );
  };
  // First pass: how far off is the naive guess in this zone?
  let guess = wallAsUtcMs - (wallInZone(wallAsUtcMs) - wallAsUtcMs);
  // Second pass tightens across DST boundaries.
  guess = guess - (wallInZone(guess) - wallAsUtcMs);
  return Math.floor(guess / 1000);
}

// ─────────────────────────────────────────────────────────────────────
// Shift window + breaks
// ─────────────────────────────────────────────────────────────────────

export interface ComposedImportWindow {
  startEpochSeconds: number;
  endEpochSeconds: number;
  /** Net payable seconds (minute-aligned) — the sum of classified segments. */
  netSeconds: number;
  /** One synthetic-placement break when the CSV carried a duration. */
  breaks: Array<{ startEpochSeconds: number; endEpochSeconds: number; paid: boolean }>;
  /** True when the start came from a real CSV clock-in (vs noon-UTC synthetic). */
  usedRealClock: boolean;
}

/** Noon-UTC synthetic start (legacy behavior) — avoids TZ off-by-one on the
 *  stub's calendar date when no clock detail is available. */
function syntheticStartEpoch(workDate: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(workDate ?? ''));
  if (!m) return 0;
  return Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0) / 1000);
}

export function composeImportWindow(input: {
  workDate: string;
  netHours: number;
  clockIn?: string | null;
  worksiteState?: string | null;
  breakMinutes?: number;
  breakPaid?: boolean;
}): ComposedImportWindow {
  // Net seconds minute-aligned — same rule as the original minuteAlignedDay.
  const netSeconds = Math.max(60, Math.round(Number(input.netHours) * 60) * 60);
  const breakSeconds = Math.max(0, Math.round(Number(input.breakMinutes ?? 0))) * 60;
  const breakPaid = input.breakPaid === true;

  const zone = timezoneForState(input.worksiteState);
  const clockMinutes = parseClockTime(input.clockIn);
  const realStart =
    zone !== null && clockMinutes !== null
      ? zonedEpochSeconds(input.workDate, clockMinutes, zone)
      : null;
  const start = realStart ?? syntheticStartEpoch(input.workDate);

  // Paid breaks count toward worked time (net already includes them per the
  // CSV), so they sit inside a net-sized window. Unpaid breaks extend it.
  const windowSeconds = breakPaid ? netSeconds : netSeconds + breakSeconds;
  const end = start + windowSeconds;

  const breaks: ComposedImportWindow['breaks'] = [];
  if (breakSeconds > 0 && windowSeconds > breakSeconds + 120) {
    // Mid-window placement, minute-aligned — the CSV has duration only.
    const mid = start + Math.round((windowSeconds - breakSeconds) / 2 / 60) * 60;
    breaks.push({
      startEpochSeconds: mid,
      endEpochSeconds: mid + breakSeconds,
      paid: breakPaid,
    });
  }

  return {
    startEpochSeconds: start,
    endEpochSeconds: end,
    netSeconds,
    breaks,
    usedRealClock: realStart !== null,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Weekly-40 overtime cascade
// ─────────────────────────────────────────────────────────────────────

/** Sunday (YYYY-MM-DD, UTC date math) of the workweek containing the date —
 *  matches C1's Sun–Sat weekly periods. */
export function weekKeyFor(workDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(workDate ?? ''));
  if (!m) return '';
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  dt.setUTCDate(dt.getUTCDate() - dt.getUTCDay());
  return dt.toISOString().slice(0, 10);
}

export interface WeeklyOtDayInput {
  /** Stable key for joining the result back (e.g. the plan's externalId). */
  key: string;
  userId: string;
  workDate: string;
  netHours: number;
  /** Worksite state (e.g. 'CA') — selects the daily OT/DT thresholds.
   *  Absent/unknown states get federal weekly-40 only (prior behavior). */
  stateCode?: string | null;
}

export interface WeeklyOtDaySplit {
  key: string;
  regularSeconds: number;
  overtimeSeconds: number;
  doubleTimeSeconds: number;
}

const WEEKLY_THRESHOLD_SECONDS = 40 * 3600;

/** Daily reg/OT caps in seconds by state. CA: over 8h/day = OT, over
 *  12h/day = DT (Labor Code §510). States absent here have no daily OT —
 *  federal weekly-40 only. Mirrors the payRules registry (rules/): the
 *  import path can't run the full engine (no punch-level breaks for the
 *  meal/rest premium rules, no 7th-consecutive-day context across
 *  partial uploads), so it applies the hour-classification subset.
 *  §226.7 premiums for import weeks remain a manual review item. */
const DAILY_CAPS_BY_STATE: Record<string, { regCapSeconds: number; otCapSeconds: number }> = {
  CA: { regCapSeconds: 8 * 3600, otCapSeconds: 12 * 3600 },
};

/**
 * State-aware hour classification for imported (daily-total) rows:
 * a per-day split against the state's daily thresholds, then the weekly
 * cascade — hours past 40 cumulative REGULAR hours demote to overtime.
 * Counting only regular hours toward the 40 is CA's no-pyramiding rule
 * and is identity for states without daily OT (all hours are regular).
 *
 * `priorSecondsByWorkerWeek` (key `${userId}__${weekKey}`) carries net
 * seconds already submitted to Everee in earlier batches for the same
 * week — those consume the 40-hour threshold first (chronology caveat:
 * prior hours are assumed earlier in the week, the normal partial-upload
 * case).
 *
 * Was FLSA-weekly-only until 2026-07-16: Brian Battles' 47.33-hour CA
 * week (four 11.5–12.5h days) shipped as 40 reg + 7.33 OT instead of
 * 32 reg + 14.83 OT + 0.5 DT — a $106.55 underpayment.
 */
export function classifyWeeklyOt(
  days: WeeklyOtDayInput[],
  priorSecondsByWorkerWeek: Map<string, number>,
): Map<string, WeeklyOtDaySplit> {
  const out = new Map<string, WeeklyOtDaySplit>();
  const groups = new Map<string, WeeklyOtDayInput[]>();
  for (const d of days) {
    const gk = `${d.userId}__${weekKeyFor(d.workDate)}`;
    (groups.get(gk) ?? groups.set(gk, []).get(gk)!).push(d);
  }
  for (const [gk, group] of groups) {
    group.sort((a, b) => a.workDate.localeCompare(b.workDate));
    let cumulativeRegular = Math.max(0, Math.round(priorSecondsByWorkerWeek.get(gk) ?? 0));
    for (const d of group) {
      const netSeconds = Math.max(60, Math.round(Number(d.netHours) * 60) * 60);
      const caps = DAILY_CAPS_BY_STATE[String(d.stateCode ?? '').trim().toUpperCase()];

      // 1. Daily split (minute-aligned; caps are whole hours already).
      let regularSeconds = caps ? Math.min(netSeconds, caps.regCapSeconds) : netSeconds;
      let overtimeSeconds = caps
        ? Math.min(netSeconds - regularSeconds, caps.otCapSeconds - caps.regCapSeconds)
        : 0;
      const doubleTimeSeconds = netSeconds - regularSeconds - overtimeSeconds;

      // 2. Weekly cascade over the regular portion.
      const remainingRegular = Math.max(0, WEEKLY_THRESHOLD_SECONDS - cumulativeRegular);
      const keepRegular = Math.min(regularSeconds, Math.floor(remainingRegular / 60) * 60);
      overtimeSeconds += regularSeconds - keepRegular;
      regularSeconds = keepRegular;

      out.set(d.key, { key: d.key, regularSeconds, overtimeSeconds, doubleTimeSeconds });
      cumulativeRegular += regularSeconds;
    }
  }
  return out;
}
