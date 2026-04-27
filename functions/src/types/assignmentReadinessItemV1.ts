/** Keep in sync with `shared/assignmentReadinessItemV1.ts`. */

import type { ActionItemOwnership } from './actionItemOwnership';

export const ASSIGNMENT_READINESS_ITEM_V1_VERSION = 1;

export type AssignmentReadinessRequirementType =
  | 'background_check'
  | 'drug_screen'
  | 'e_verify'
  | 'required_certification'
  | 'orientation'
  | 'ppe_acknowledgement'
  | 'safety_briefing'
  | 'shift_confirmation'
  // R.2 — willingness self-attestations (see canonical type for full docs).
  | 'physical_willingness'
  | 'uniform_willingness'
  | 'ppe_willingness'
  | 'language_willingness'
  | 'custom';

export type AssignmentReadinessItemStatus =
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

export type AssignmentReadinessItemActor = 'worker' | 'recruiter' | 'vendor' | 'system';

export type AssignmentReadinessItem = {
  id: string;
  tenantId: string;
  assignmentId: string;
  workerUid: string;
  jobOrderId: string;
  shiftId?: string;
  requirementType: AssignmentReadinessRequirementType;
  requirementLabel?: string;
  status: AssignmentReadinessItemStatus;
  actor: AssignmentReadinessItemActor;
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
    kind: 'evereeEvent' | 'accusourceEvent' | 'everifyEvent' | 'jobOrderAssignment' | 'recruiterManual' | 'migration';
    ref?: string;
  };
  externalRef?: string;
  completedAt?: string;
  blockedAt?: string;
};

export type AssignmentReadinessItemKey = {
  assignmentId: string;
  requirementType: AssignmentReadinessRequirementType;
  customKey?: string;
};

export function buildAssignmentReadinessItemId(key: AssignmentReadinessItemKey): string {
  const base = `${key.assignmentId}__${key.requirementType}`;
  if (key.requirementType === 'custom') {
    const custom = (key.customKey || '').replace(/[^A-Za-z0-9_]+/g, '_');
    if (!custom) {
      throw new Error('buildAssignmentReadinessItemId: customKey required when requirementType === "custom"');
    }
    return `${base}__${custom}`;
  }
  return base;
}
