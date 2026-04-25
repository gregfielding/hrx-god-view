/**
 * Employee Readiness — PER-ENTITY readiness state for a worker.
 *
 * Scope: one `EmployeeReadinessItem` is one (worker × hiring entity × requirement)
 * tuple. A worker who moves from C1 Workforce to C1 Select gets a fresh set of
 * items for the new entity — they do NOT inherit handbook / I-9 / etc. from the
 * previous entity. (Ownership doc §9 #3 decision, 2026-04-23.)
 *
 * Unlike `AssignmentReadinessItem` (which is per-shift), Employee Readiness
 * items persist across shifts within the same entity. They're reset only when
 * the worker leaves that entity's employment.
 *
 * Runtime-neutral: no firebase imports. Callers convert to Firestore
 * Timestamp on write.
 *
 * @see recruiter-ownership-model.md §2 (scope) and §3a (ownership fields).
 * @see readiness-onboarding-rethink.md for the event-mapping design.
 */

import type { ActionItemOwnership } from './actionItemOwnership';

export const EMPLOYEE_READINESS_ITEM_V1_VERSION = 1;

/** The requirement a single EmployeeReadinessItem tracks. Keep in sync with `docs/READINESS_MODEL.md` §3. */
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
  /** Escape hatch for tenant-custom requirements not in the canonical list. */
  | 'custom';

/**
 * Current state of the requirement. Per `readiness-onboarding-rethink.md §6e`
 * we avoid an ambiguous "complete" value for anything with a pass/fail
 * dimension — vendor-driven items (background, drug, E-Verify) routinely come
 * back "done" with a failing verdict, and collapsing that to "complete" hides
 * the recruiter's actual work.
 */
export type EmployeeReadinessItemStatus =
  /** The requirement applies and the worker / recruiter hasn't started it. */
  | 'incomplete'
  /** Worker submitted / vendor order placed; waiting on the vendor/system result. */
  | 'in_progress'
  /** Satisfied with a positive verdict (e-verify authorized, handbook signed, bank attached). */
  | 'complete_pass'
  /** Satisfied with a negative verdict (e-verify FNC, background FAIL). Terminal or retryable per item. */
  | 'complete_fail'
  /** Vendor returned a signal needing recruiter adjudication (AccuSource DISCREPANCY, E-Verify TNC). */
  | 'needs_review'
  /** Previously complete_pass but the `expiresAt` has passed — needs re-verification. */
  | 'expired'
  /** Something upstream blocks the worker from starting this item (missing prereq, worker terminated). */
  | 'blocked'
  /** Doesn't apply for this worker × entity (e.g. 1099 contractor skips W-4). */
  | 'not_applicable'
  /**
   * Legacy "done" state for items created before we split pass/fail. New writes
   * must use `complete_pass` / `complete_fail`; readers should treat `complete`
   * as `complete_pass` with an implicit "pre-6e" caveat. Keep in the union so
   * existing docs validate.
   * @deprecated
   */
  | 'complete';

/** Who owns moving this item forward. Independent from `ownership.primaryRecruiterId` — a
 *  recruiter still "owns" a worker-actor item for follow-up, but doesn't do the action itself. */
export type EmployeeReadinessItemActor = 'worker' | 'recruiter' | 'vendor' | 'system';

/**
 * Persisted at `tenants/{tid}/employeeReadinessItems/{itemId}`.
 * Item id pattern: `${workerUid}__${hiringEntityId}__${requirementType}`.
 */
export type EmployeeReadinessItem = {
  /** Firestore doc id. Deterministic per (worker, entity, requirement). */
  id: string;
  tenantId: string;
  /** The worker this item concerns. */
  workerUid: string;
  /** The hiring entity scope — a worker moving entities gets fresh items. */
  hiringEntityId: string;
  /** Denormalized for fast queries / labels. */
  hiringEntityName?: string;
  /** Canonical requirement type. */
  requirementType: EmployeeReadinessRequirementType;
  /** Free-text label for custom requirements. Required when `requirementType === 'custom'`. */
  requirementLabel?: string;
  /** Current state. Drives the action-queue filters. */
  status: EmployeeReadinessItemStatus;
  /** Who the system expects to move this forward. UI routes the CTA accordingly. */
  actor: EmployeeReadinessItemActor;
  /**
   * Is this item blocking worker activation / next-confirmation? Per §9 #4
   * escalation is event-driven — we read this flag when a shift confirmation
   * is about to fire and block it if any blocking item is incomplete.
   */
  blocking: boolean;
  /** Optional deep-link surfaced on the action-queue card. */
  ctaTarget?: {
    kind: 'profileTab' | 'route' | 'external';
    path: string;
    label?: string;
  };
  /** Ownership — resolved at creation time, maintained by triggers. */
  ownership: ActionItemOwnership;
  /** ISO-8601 timestamp of creation. */
  createdAt: string;
  /** ISO-8601 timestamp of last state change (status / blocking / ownership / actor). */
  updatedAt: string;
  /** Source document / event that generated this item (audit / debug). */
  source?: {
    kind: 'evereeEvent' | 'accusourceEvent' | 'everifyEvent' | 'workerApply' | 'recruiterManual' | 'migration';
    ref?: string;
  };
  /** Vendor reference — e.g. AccuSource `providerOrderId`, Everee `onboardingFlowId`. */
  externalRef?: string;
  /** When the status last changed to `complete` — used by later reporting. */
  completedAt?: string;
  /** When the status last changed to `blocked` — starts the recruiter review clock. */
  blockedAt?: string;
};

/** Narrow helper: keys that drive the item id. Keeping it typed + centralized prevents drift. */
export type EmployeeReadinessItemKey = {
  workerUid: string;
  hiringEntityId: string;
  requirementType: EmployeeReadinessRequirementType;
  /** Required when `requirementType === 'custom'` so two custom items per (worker, entity) don't collide. */
  customKey?: string;
};

/** Canonical id builder — deterministic, safe in Firestore doc ids (alphanumeric + `__`). */
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
