import _ from 'lodash';

import { NO_SHOW_RISK_ASSIGNMENT_WATCH_KEYS } from '../readiness/noShowRiskAssignmentWriteGate';

/** Extra top-level fields used by assignment readiness derive, HRX snapshot loader, or category emitters. */
const EXTRA_ASSIGNMENT_READINESS_FIELDS = [
  'userId',
  'candidateId',
  'onboardingInstanceId',
  'entityKey',
  'shiftTitle',
  'jobTitle',
  'roleTitle',
  'companyDisplayName',
  'companyName',
  'customerName',
  'assignmentStatus',
  'confirmationStatus',
] as const;

const ASSIGNMENT_READINESS_RELEVANT_FIELD_PATHS = [
  ...NO_SHOW_RISK_ASSIGNMENT_WATCH_KEYS,
  ...EXTRA_ASSIGNMENT_READINESS_FIELDS,
] as const;

function pickRelevant(obj: unknown): Record<string, unknown> {
  if (!obj) return {};
  return ASSIGNMENT_READINESS_RELEVANT_FIELD_PATHS.reduce((acc, path) => {
    const value = _.get(obj, path);
    if (value !== undefined) _.set(acc, path, value);
    return acc;
  }, {} as Record<string, unknown>);
}

/**
 * True when before/after differ on any field that affects assignment readiness recompute,
 * HRX snapshot, no-show risk, or category-score domain emitters.
 */
export function didRelevantAssignmentFieldsChange(before: unknown, after: unknown): boolean {
  const beforeRelevant = pickRelevant(before);
  const afterRelevant = pickRelevant(after);

  return !_.isEqual(beforeRelevant, afterRelevant);
}
