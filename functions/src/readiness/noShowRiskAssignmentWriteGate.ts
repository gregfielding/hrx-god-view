/**
 * Pure gate for whether to recompute assignment no-show risk (no Firebase imports).
 */

export const NO_SHOW_RISK_ASSIGNMENT_WATCH_KEYS = [
  'startDate',
  'endDate',
  'startTime',
  'endTime',
  'shiftId',
  'jobOrderId',
  'locationId',
  'latitude',
  'longitude',
  'status',
  'applicationId',
  'readinessSnapshotV1',
  'confirmedAt',
  'declinedAt',
] as const;

const WATCH_KEYS = new Set<string>(NO_SHOW_RISK_ASSIGNMENT_WATCH_KEYS);

export function shouldRecomputeNoShowRiskForAssignmentWrite(args: {
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}): boolean {
  const { before, after } = args;
  if (!after) return false;
  if (!before) return true;

  for (const k of WATCH_KEYS) {
    if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) return true;
  }
  return false;
}
