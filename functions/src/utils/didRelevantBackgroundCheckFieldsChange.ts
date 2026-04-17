import _ from 'lodash';

/**
 * Fields that affect linkage resolution, readiness recompute, HRX screening signals, or
 * `backgroundCheckJustCompleted` / category score emission.
 */
const RELEVANT_BACKGROUND_CHECK_FIELDS = [
  'tenantId',
  'candidateId',
  'userId',
  'jobOrderId',
  'automationAssignmentId',
  'applicationId',
  'hrxStatus',
  'finalReportReady',
  'orderCompleted',
  'drugReportReady',
  'requestedPackageName',
] as const;

function pickRelevant(obj: unknown): Record<string, unknown> {
  if (!obj) return {};
  return RELEVANT_BACKGROUND_CHECK_FIELDS.reduce((acc, path) => {
    const value = _.get(obj, path);
    if (value !== undefined) _.set(acc, path, value);
    return acc;
  }, {} as Record<string, unknown>);
}

/**
 * True when before/after differ on any linkage or readiness-relevant background check field.
 * For creates/deletes, callers should not rely on this (use only when both snapshots exist).
 */
export function didRelevantBackgroundCheckFieldsChange(before: unknown, after: unknown): boolean {
  const beforeRelevant = pickRelevant(before);
  const afterRelevant = pickRelevant(after);

  return !_.isEqual(beforeRelevant, afterRelevant);
}
