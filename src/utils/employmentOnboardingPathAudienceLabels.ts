/**
 * Worker/admin parity for TempWorks-backed onboarding rows: same machine `status` and `effectiveSourceType`;
 * only `statusLabel` (and narrative copy) differs by audience.
 */

import type { EmploymentOnboardingRowStatus } from '../pages/UserProfile/components/employment-v2/employmentV2Types';
import type { ExternalOnboardingStepRecord } from '../types/externalOnboardingSteps';
import { mapExternalOnboardingStepToPathStatus } from './externalOnboardingSteps';

export interface ExternalOnboardingPathLabels {
  status: EmploymentOnboardingRowStatus;
  statusLabel: string;
}

export function labelsForExternalOnboardingRecord(
  record: ExternalOnboardingStepRecord,
  audience: 'admin' | 'worker' = 'admin'
): ExternalOnboardingPathLabels {
  return mapExternalOnboardingStepToPathStatus(record, audience);
}
