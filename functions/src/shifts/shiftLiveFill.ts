/**
 * Worker-facing spots-remaining for a shift (2026-09-06). Pure — no
 * Firestore — so mocha covers it and the backfill script reuses it.
 *
 * Separate from the recruiter `assignmentsCount` / `status: 'filled'`
 * automation in shiftFillAutomation.ts on purpose: that one counts
 * proposed/confirmed/active only (a pending offer does NOT flip a shift to
 * filled), while a worker looking at the board should see a spot as taken
 * the moment ANY live assignment holds it — the same set the placement
 * overlap guard and the Claim Shift capacity transaction use
 * (`ASSIGNMENT_STATUS_QUERY_LIVE`, pending included). Per-day counts serve
 * multi-day gigs (one assignment per day; `dateSchedule[day].workersNeeded`
 * is the per-day target). Written as `shift.liveFill`; clients fall back to
 * the headcount when it's absent (`resolveShiftSpots` on web, the gig rows
 * provider in the app).
 */

export interface ShiftLiveFillCore {
  /** Live assignments on the shift (all days). */
  total: number;
  /** Live assignments per `YYYY-MM-DD` (day-scoped docs; legacy no-date docs land on shiftDate). */
  byDay: Record<string, number>;
  /** Shift-level headcount incl. overstaff (same math as the fill automation). */
  target: number;
  /** Per-day headcount for multi-day gigs (dateSchedule days with hours). */
  targetByDay: Record<string, number>;
  /**
   * Spots left for the shift ROW the clients render. Per-day gigs: the best
   * day (any free day → not full; day rows use `remainingByDay`). Otherwise
   * the shift's OWN date only — a recurring shift's other occurrences never
   * count against it (the first backfill dry-run showed a 2-headcount weekly
   * shift reading Full from one hire on Aug 18 plus one on Aug 25).
   */
  remaining: number;
  /** Spots left per `YYYY-MM-DD` for dateSchedule days. */
  remainingByDay: Record<string, number>;
}

/** Mirror of shiftFillAutomation's assignments target (overstaff count / percent). */
export function computeAssignmentsTarget(shift: Record<string, any>): number {
  const base = Number(shift?.totalStaffRequested ?? 1) || 1;
  const overstaffCount = Number(shift?.overstaffCount ?? 0) || 0;
  const overstaffPercent = Number(shift?.overstaffPercent ?? 0) || 0;
  const pctExtra = overstaffPercent > 0 ? Math.ceil((base * overstaffPercent) / 100) : 0;
  const extra = Math.max(0, overstaffCount, pctExtra);
  return Math.max(1, base + extra);
}

export function toShiftDayKey(value: unknown): string {
  if (!value) return '';
  if (typeof value === 'string') return value.split('T')[0];
  const maybe = value as { toDate?: () => Date };
  if (typeof maybe?.toDate === 'function') {
    try {
      return maybe.toDate().toISOString().split('T')[0];
    } catch {
      return '';
    }
  }
  if (value instanceof Date) return value.toISOString().split('T')[0];
  return '';
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function computeLiveFill(
  shift: Record<string, any>,
  liveAssignments: Array<Record<string, any>>,
): ShiftLiveFillCore {
  const target = computeAssignmentsTarget(shift);
  const shiftDate = toShiftDayKey(shift?.shiftDate);
  const byDay: Record<string, number> = {};
  for (const a of liveAssignments) {
    const day = toShiftDayKey(a?.startDate) || shiftDate;
    if (!day) continue;
    byDay[day] = (byDay[day] ?? 0) + 1;
  }
  const targetByDay: Record<string, number> = {};
  const dateSchedule =
    shift?.dateSchedule && typeof shift.dateSchedule === 'object'
      ? (shift.dateSchedule as Record<
          string,
          { startTime?: string; endTime?: string; workersNeeded?: unknown; overstaff?: unknown }
        >)
      : null;
  if (dateSchedule) {
    for (const [day, cfg] of Object.entries(dateSchedule)) {
      if (!DAY_RE.test(day) || !cfg?.startTime || !cfg?.endTime) continue;
      const perDay = Number(cfg.workersNeeded);
      const over = Number(cfg.overstaff);
      targetByDay[day] =
        Number.isFinite(perDay) && perDay > 0
          ? perDay + (Number.isFinite(over) && over > 0 ? over : 0)
          : target;
    }
  }
  const remainingByDay: Record<string, number> = {};
  for (const [day, t] of Object.entries(targetByDay)) {
    remainingByDay[day] = Math.max(0, t - (byDay[day] ?? 0));
  }
  let remaining: number;
  const dayValues = Object.values(remainingByDay);
  if (dayValues.length > 0) {
    remaining = Math.max(...dayValues);
  } else if (shiftDate) {
    remaining = Math.max(0, target - (byDay[shiftDate] ?? 0));
  } else {
    remaining = Math.max(0, target - liveAssignments.length);
  }
  return { total: liveAssignments.length, byDay, target, targetByDay, remaining, remainingByDay };
}

/** True when the stored `liveFill` differs from a fresh computation (skip no-op writes). */
export function liveFillChanged(prev: unknown, next: ShiftLiveFillCore): boolean {
  if (!prev || typeof prev !== 'object') return true;
  const p = prev as Record<string, unknown>;
  const same = (a: unknown, b: unknown) => JSON.stringify(a ?? {}) === JSON.stringify(b ?? {});
  return (
    Number(p.total) !== next.total ||
    Number(p.target) !== next.target ||
    Number(p.remaining) !== next.remaining ||
    !same(p.byDay, next.byDay) ||
    !same(p.targetByDay, next.targetByDay) ||
    !same(p.remainingByDay, next.remainingByDay)
  );
}
