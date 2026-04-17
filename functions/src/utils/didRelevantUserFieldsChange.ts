import _ from 'lodash';

const RELEVANT_USER_FIELDS = [
  'addressInfo',
  'city',
  'state',
  'zip',
  'skills',
  'resume',
  'workHistory',
  'workExperience',
  'workerProfile.preferences',
  'workAuthorization',
  'workEligibility',
  'workEligibilityAttestation',
  'phone',
  'phoneE164',
  'phoneVerified',
  'availability',
];

function pickRelevant(obj: unknown): Record<string, unknown> {
  if (!obj) return {};
  return RELEVANT_USER_FIELDS.reduce((acc, path) => {
    const value = _.get(obj, path);
    if (value !== undefined) _.set(acc, path, value);
    return acc;
  }, {} as Record<string, unknown>);
}

export function didRelevantUserFieldsChange(before: unknown, after: unknown): boolean {
  const beforeRelevant = pickRelevant(before);
  const afterRelevant = pickRelevant(after);

  return !_.isEqual(beforeRelevant, afterRelevant);
}
