/** Keep in sync with `shared/employeeReadinessItemV1.ts`. */

import type { ActionItemOwnership } from './actionItemOwnership';

export const EMPLOYEE_READINESS_ITEM_V1_VERSION = 1;

export type EmployeeReadinessRequirementType =
  | 'i9_section_1'
  | 'i9_section_2'
  | 'handbook_acknowledgement'
  | 'direct_deposit'
  | 'tax_w4'
  | 'tax_w9'
  | 'tax_1099_consent'
  | 'e_verify'
  | 'everee_profile'
  | 'background_check'
  | 'drug_screen'
  | 'policy_acknowledgement'
  | 'profile_photo'
  | 'phone_verified'
  | 'emergency_contact'
  | 'address_confirmed'
  /** C1 Events 1099 only — Independent Contractor Agreement signed. */
  | 'ic_agreement'
  /** **E.3** — IRS TIN / SSN verification. Mirrored from Everee snapshot. */
  | 'tin_verification'
  | 'custom';

export type EmployeeReadinessItemStatus =
  | 'incomplete'
  | 'in_progress'
  | 'complete_pass'
  | 'complete_fail'
  | 'needs_review'
  | 'expired'
  | 'blocked'
  | 'not_applicable'
  /** @deprecated pre-§6e; treat as complete_pass. Kept so old docs validate. */
  | 'complete';

export type EmployeeReadinessItemActor = 'worker' | 'recruiter' | 'vendor' | 'system';

export type EmployeeReadinessItem = {
  id: string;
  tenantId: string;
  workerUid: string;
  hiringEntityId: string;
  hiringEntityName?: string;
  requirementType: EmployeeReadinessRequirementType;
  requirementLabel?: string;
  status: EmployeeReadinessItemStatus;
  actor: EmployeeReadinessItemActor;
  blocking: boolean;
  ctaTarget?: {
    kind: 'profileTab' | 'route' | 'external';
    path: string;
    label?: string;
  };
  ownership: ActionItemOwnership;
  createdAt: string;
  updatedAt: string;
  source?: {
    kind: 'evereeEvent' | 'accusourceEvent' | 'everifyEvent' | 'workerApply' | 'recruiterManual' | 'migration';
    ref?: string;
  };
  externalRef?: string;
  completedAt?: string;
  blockedAt?: string;
};

export type EmployeeReadinessItemKey = {
  workerUid: string;
  hiringEntityId: string;
  requirementType: EmployeeReadinessRequirementType;
  customKey?: string;
};

export function buildEmployeeReadinessItemId(key: EmployeeReadinessItemKey): string {
  const base = `${key.workerUid}__${key.hiringEntityId}__${key.requirementType}`;
  if (key.requirementType === 'custom') {
    const custom = (key.customKey || '').replace(/[^A-Za-z0-9_]+/g, '_');
    if (!custom) {
      throw new Error('buildEmployeeReadinessItemId: customKey required when requirementType === "custom"');
    }
    return `${base}__${custom}`;
  }
  return base;
}
