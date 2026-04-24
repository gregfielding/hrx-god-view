/**
 * Assignment Readiness — PER-SHIFT (per-assignment) readiness state.
 *
 * Scope: one `AssignmentReadinessItem` is one (assignment × requirement) tuple.
 * These are shift-specific requirements that may vary per job order / client —
 * e.g. CORT drug panel, warehouse background add-on, site-specific orientation.
 *
 * Employee Readiness items (per worker × entity) persist; Assignment Readiness
 * items live and die with the assignment.
 *
 * Runtime-neutral: no firebase imports. Callers convert to Firestore
 * Timestamp on write.
 *
 * @see shared/employeeReadinessItemV1.ts for the per-entity counterpart.
 * @see recruiter-ownership-model.md for ownership semantics.
 * @see readiness-onboarding-rethink.md for the overall data model.
 */

import type { ActionItemOwnership } from './actionItemOwnership';

export const ASSIGNMENT_READINESS_ITEM_V1_VERSION = 1;

/**
 * Requirement types scoped to the shift itself. Job-order-specific screens
 * / vendor orders / site-specific checks. Keep in sync with readiness rethink.
 */
export type AssignmentReadinessRequirementType =
  /** Background check ordered against this job order's required package. */
  | 'background_check'
  /** Drug screen ordered against this job order's required panel. */
  | 'drug_screen'
  /** E-Verify case for the specific assignment's hiring entity + job. */
  | 'e_verify'
  /** Certifications required by the job posting but not already on the worker's profile. */
  | 'required_certification'
  /** Client-specific orientation (CORT callback, warehouse walkthrough, etc.). */
  | 'orientation'
  /** Shift-specific PPE / uniform confirmation. */
  | 'ppe_acknowledgement'
  /** Shift-specific safety briefing acknowledgement. */
  | 'safety_briefing'
  /** Worker confirmation that they'll show up (YES / NO / HERE replies in cadence). */
  | 'shift_confirmation'
  /** Escape hatch for tenant-custom shift-scoped requirements. */
  | 'custom';

/** State for the item. Same semantics as EmployeeReadinessItemStatus. */
/**
 * Same vocabulary as `EmployeeReadinessItemStatus` — see the detailed doc
 * comment there. Split pass/fail per `readiness-onboarding-rethink.md §6e`.
 */
export type AssignmentReadinessItemStatus =
  | 'incomplete'
  | 'in_progress'
  | 'complete_pass'
  | 'complete_fail'
  | 'needs_review'
  | 'expired'
  | 'blocked'
  | 'not_applicable'
  /** @deprecated use `complete_pass` / `complete_fail`. Kept for pre-6e docs. */
  | 'complete';

export type AssignmentReadinessItemActor = 'worker' | 'recruiter' | 'vendor' | 'system';

/**
 * Persisted at `tenants/{tid}/assignmentReadinessItems/{itemId}`.
 * Item id pattern: `${assignmentId}__${requirementType}` (or `__${customKey}` for custom).
 */
export type AssignmentReadinessItem = {
  /** Firestore doc id. Deterministic per (assignment, requirement). */
  id: string;
  tenantId: string;
  /** The assignment this readiness item is bound to. */
  assignmentId: string;
  /** Denormalized for fast queries. */
  workerUid: string;
  jobOrderId: string;
  /** Denormalized shift id when the requirement is shift-specific (some tenants have multi-shift assignments). */
  shiftId?: string;
  /** Canonical requirement type. */
  requirementType: AssignmentReadinessRequirementType;
  /** Free-text label required when `requirementType === 'custom'`. */
  requirementLabel?: string;
  status: AssignmentReadinessItemStatus;
  actor: AssignmentReadinessItemActor;
  /**
   * Blocks worker confirmation / placement when `true`. The confirmation-time
   * gate (ownership doc §9 #4) reads this: if any blocking item is incomplete
   * when the worker tries to confirm, block the confirmation and surface the
   * blocker to `ownership.primaryRecruiterId`.
   */
  blocking: boolean;
  /** Optional deep-link surfaced on the action-queue card. */
  ctaTarget?: {
    kind: 'profileTab' | 'route' | 'external';
    path: string;
    label?: string;
  };
  /** Ownership — resolved at creation, maintained by triggers. */
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

/** Narrow key helper for id building + lookup. */
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
