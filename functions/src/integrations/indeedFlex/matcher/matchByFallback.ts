/**
 * **Slice 3 matcher — venue + role + date + time fallback.**
 *
 * Used when the parsed event has NO `jobId` (Indeed Flex's
 * `cancel_booking` and `change_headcount` notifications today
 * unfortunately omit it). Resolves to a shift by:
 *
 *   1. Lookup the worksite by `event.venueName` (case-insensitive
 *      contains against `tenants/{tid}/locations`).
 *   2. List shifts on `event.workDate` at that worksite.
 *   3. Narrow by start/end time when both sides have them (within a
 *      30-minute window in either direction to tolerate Indeed/HRX
 *      timezone or rounding drift).
 *   4. If exactly one shift survives → `fuzzy`. If multiple →
 *      `multiple`. If zero → `none`.
 *
 * The result also stamps `matchedJobOrderId` whenever we resolved a
 * unique shift (from the shift's `jobOrderId` field).
 */

import type { MatchResult, Reader, ReaderDoc } from './types';

interface FallbackInput {
  tenantId: string;
  venueName?: string;
  workDate?: string;
  startTime?: string;
  endTime?: string;
  /** Role / position to disambiguate when one venue has multiple
   *  concurrent shifts. Optional. */
  roleName?: string;
}

/** Match window when comparing event start/end against shift
 *  defaultStartTime/defaultEndTime, in minutes. */
const TIME_TOLERANCE_MIN = 30;

export async function matchByFallback(
  reader: Reader,
  args: FallbackInput,
): Promise<MatchResult> {
  if (!args.venueName || !args.workDate) {
    return {
      matchConfidence: 'none',
      matchNotes: 'fallback requires venueName + workDate',
    };
  }

  const worksite = await reader.findWorksiteByName({
    tenantId: args.tenantId,
    venueName: args.venueName,
  });
  if (!worksite) {
    return {
      matchConfidence: 'none',
      matchNotes: `no HRX worksite matches venue '${args.venueName}'`,
    };
  }

  const shifts = await reader.listShiftsByWorksiteDate({
    tenantId: args.tenantId,
    worksiteId: worksite.id,
    workDate: args.workDate,
  });
  if (shifts.length === 0) {
    return {
      matchConfidence: 'none',
      matchNotes: `worksite '${worksite.id}' has no shifts on ${args.workDate}`,
    };
  }

  // Narrow by time window if both sides have one.
  let candidates = shifts;
  if (args.startTime || args.endTime) {
    candidates = shifts.filter((s) => timeWithin(s, args.startTime, args.endTime, TIME_TOLERANCE_MIN));
    if (candidates.length === 0) {
      // No shift matched the time window — but we did find shifts on
      // that worksite/date. Surface as multiple so the recruiter picks.
      return {
        matchConfidence: 'multiple',
        matchNotes: `${shifts.length} shift(s) at venue on ${args.workDate} but none within ${TIME_TOLERANCE_MIN}min of ${args.startTime ?? '?'}-${args.endTime ?? '?'}`,
      };
    }
  }

  // Optionally narrow by role.
  if (args.roleName && candidates.length > 1) {
    const roleLower = args.roleName.toLowerCase();
    const byRole = candidates.filter((s) => {
      const title = String((s.data.jobTitle as string) ?? (s.data.role as string) ?? '').toLowerCase();
      return title.length > 0 && (title === roleLower || title.includes(roleLower));
    });
    if (byRole.length > 0) candidates = byRole;
  }

  if (candidates.length === 1) {
    return {
      matchedShiftId: candidates[0].id,
      matchedJobOrderId: String(candidates[0].data.jobOrderId ?? '') || undefined,
      matchConfidence: 'fuzzy',
      matchNotes: `venue+date+time narrowed ${shifts.length} → 1`,
    };
  }
  return {
    matchConfidence: 'multiple',
    matchNotes: `${candidates.length} candidate shifts at '${args.venueName}' on ${args.workDate}`,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function timeWithin(
  shift: ReaderDoc,
  startWanted: string | undefined,
  endWanted: string | undefined,
  toleranceMin: number,
): boolean {
  const startActual = String(
    (shift.data.defaultStartTime as string) ?? (shift.data.startTime as string) ?? '',
  );
  const endActual = String(
    (shift.data.defaultEndTime as string) ?? (shift.data.endTime as string) ?? '',
  );

  const startOk = !startWanted || withinTolerance(startActual, startWanted, toleranceMin);
  const endOk = !endWanted || withinTolerance(endActual, endWanted, toleranceMin);
  return startOk && endOk;
}

function withinTolerance(actual: string, wanted: string, toleranceMin: number): boolean {
  const a = parseHHmm(actual);
  const w = parseHHmm(wanted);
  if (a === null || w === null) return false;
  return Math.abs(a - w) <= toleranceMin;
}

function parseHHmm(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (h < 0 || h > 23 || mm < 0 || mm > 59) return null;
  return h * 60 + mm;
}
