/**
 * **Slice 3 matcher — Indeed Job ID → HRX JO + Shift.**
 *
 * Strategy when the parsed event has a `jobId` (Indeed Flex's
 * external job number, which we mirror onto `JobOrder.poNumber`):
 *
 *   1. Look up the JO by `poNumber == jobId`.
 *   2. If a `workDate` is also present, list shifts under that JO
 *      filtered by `shiftDate == workDate`. Exactly one match →
 *      `exact`; multiple → `multiple`.
 *   3. If no `workDate` (e.g. `new_request` may omit it on
 *      re-broadcasts), return just `matchedJobOrderId` with `exact`
 *      confidence and let the recruiter UI pick the shift.
 *
 * Used by `new_request`, `change_time`, `no_show` (always has a
 * jobId), and the per-row dispatch inside `daily_digest_expired`.
 */

import type { MatchResult, Reader } from './types';

export async function matchByJobId(
  reader: Reader,
  args: {
    tenantId: string;
    jobId: string;
    workDate?: string;
  },
): Promise<MatchResult> {
  const jo = await reader.findJobOrderByPoNumber({
    tenantId: args.tenantId,
    jobId: args.jobId,
  });
  if (!jo) {
    return {
      matchConfidence: 'none',
      matchNotes: `no JobOrder with poNumber=${args.jobId}`,
    };
  }

  // No workDate → return the JO alone. The recruiter picks the shift
  // in the review UI.
  if (!args.workDate) {
    return {
      matchedJobOrderId: jo.id,
      matchConfidence: 'exact',
      matchNotes: 'jobId matched JO; no workDate to narrow the shift',
    };
  }

  const shifts = await reader.listShiftsForJobOrder({
    tenantId: args.tenantId,
    jobOrderId: jo.id,
    workDate: args.workDate,
  });
  if (shifts.length === 0) {
    return {
      matchedJobOrderId: jo.id,
      matchConfidence: 'exact',
      matchNotes: `jobId matched JO ${jo.id} but no shift on ${args.workDate}`,
    };
  }
  if (shifts.length === 1) {
    return {
      matchedJobOrderId: jo.id,
      matchedShiftId: shifts[0].id,
      matchConfidence: 'exact',
    };
  }
  return {
    matchedJobOrderId: jo.id,
    matchConfidence: 'multiple',
    matchNotes: `jobId matched JO ${jo.id}; ${shifts.length} shifts on ${args.workDate}`,
  };
}
