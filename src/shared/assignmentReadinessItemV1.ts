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
 *
 * **Phase B addition (2026-04):** the six `*_match` types are seeded once per
 * applicable JO requirement category at assignment creation. Initial status is
 * computed via the matchers in `shared/jobRequirementMatchers/`. The seed
 * runner expects per-requirement instances (e.g. one `cert_match` item per
 * cert in `JobOrder.requiredCertifications`).
 */
export type AssignmentReadinessRequirementType =
  /** Background check ordered against this job order's required package. */
  | 'background_check'
  /** Drug screen ordered against this job order's required panel. */
  | 'drug_screen'
  /** E-Verify case for the specific assignment's hiring entity + job. */
  | 'e_verify'
  /**
   * Certifications required by the job posting but not already on the worker's profile.
   * @deprecated Phase B replaces this single rolled-up item with N×`cert_match` items
   * (one per required cert). Kept compiling so legacy seed data and UI consumers
   * don't break during the cutover. New seeds should use `cert_match`. Removal
   * scheduled after the Phase B.5 wire-up lands and any UI consumers migrate.
   */
  | 'required_certification'
  /** One per required cert in `JobOrder.requiredCertifications`. Matched via `matchCertifications`. */
  | 'cert_match'
  /** One per required license in `JobOrder.requiredLicensesV2`. Matched via `matchLicenses`. */
  | 'license_match'
  /** One per required skill in `JobOrder.skillsRequired`. Matched via `matchSkills`. */
  | 'skill_match'
  /** Single item: JO's `educationLevelRequiredV2` vs worker's `educationLevelV2`. Matched via `matchEducation`. */
  | 'education_match'
  /** One per required language in `JobOrder.languagesRequiredV2`. Matched via `matchLanguages`. */
  | 'language_match'
  /** Single item: JO's `screeningPackageId` vs worker's existing background-check records. Matched via `matchScreeningPackage`. */
  | 'screening_package_match'
  /** Client-specific orientation (CORT callback, warehouse walkthrough, etc.). */
  | 'orientation'
  /** Shift-specific PPE / uniform confirmation. */
  | 'ppe_acknowledgement'
  /** Shift-specific safety briefing acknowledgement. */
  | 'safety_briefing'
  /** Worker confirmation that they'll show up (YES / NO / HERE replies in cadence). */
  | 'shift_confirmation'
  /**
   * **R.2** — Worker self-attestation: comfortable with the JO's physical
   * requirements (lifting, standing, etc.). Reads
   * `workerAttestations.physicalRequirementWillingness`. Soft severity by
   * default. Distinct from any `*_match` type — there is no objective
   * worker-record source to compare against, only the worker's own answer.
   */
  | 'physical_willingness'
  /**
   * **R.2** — Worker self-attestation: comfortable with the JO's uniform
   * requirements. Reads
   * `workerAttestations.uniformRequirementWillingness` and
   * `workerAttestations.customUniformRequirementWillingness` — matcher takes
   * the worse-of when both apply. Soft severity by default.
   */
  | 'uniform_willingness'
  /**
   * **R.2** — Worker self-attestation: comfortable wearing the JO's required
   * PPE. Reads `workerAttestations.requiredPpeWillingness`. Distinct from
   * `ppe_acknowledgement` — that is the per-shift "did you bring it" gate
   * (hard); this is the standing willingness answer (soft).
   */
  | 'ppe_willingness'
  /**
   * **R.2** — Worker self-attestation: comfortable working in the JO's
   * required language(s). Reads
   * `workerAttestations.languageRequirementWillingness`. Distinct from
   * `language_match` — that is a proficiency check against typed records;
   * this is the worker's standing comfort answer (soft).
   */
  | 'language_willingness'
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
 * **R.1** — How the item's current status was resolved. Drives the placement
 * tile chip's hard/soft bucketing alongside `severity` (R.4).
 *
 * Distinct axis from `status` — a `complete_pass` item could have arrived via
 * any of `'auto'` (matcher found a worker record), `'external'` (AccuSource
 * webhook), `'self_attest'` (worker said "yes" on the application), or
 * `'csa_confirmed'` (recruiter manually marked passed).
 *
 *   - `'auto'`           — Phase B matcher consumed the worker's profile / records
 *   - `'external'`       — third-party result (AccuSource verdict, USCIS E-Verify status)
 *   - `'self_attest'`    — worker answered the application (R.2 willingness items) or future R.9 profile edit
 *   - `'csa_confirmed'`  — recruiter manually marked passed/failed (R.3 future endpoints)
 *   - `'csa_waived'`     — recruiter bypassed a soft requirement with a mandatory note (R.3)
 *   - `null`             — unresolved (status is `'incomplete'` / `'in_progress'`)
 *
 * Field is `null` (not absent) when intentionally unresolved — gives the chip
 * aggregator a clean `null`-check.
 */
export type AssignmentReadinessResolutionMethod =
  | 'auto'
  | 'external'
  | 'self_attest'
  | 'csa_confirmed'
  | 'csa_waived'
  | null;

/**
 * **R.1** — Static property of the requirement (denormalized onto each item at
 * seed time). Drives the R.4 placement chip color:
 *
 *   - `'hard'` — failure / pending blocks the worker from doing the job (cert,
 *     license, screening, e-verify). Contributes red to the chip when not
 *     `complete_pass` / `csa_waived`.
 *   - `'soft'` — failure / pending is informational; the worker can still do
 *     the job and a CSA can waive. Contributes yellow when not green.
 *
 * Default per-type table lives in `seedAssignmentReadinessItems.ts`
 * (`DEFAULT_REQUIREMENT_SEVERITY`). Per-instance and per-JO overrides flow
 * through the spec.
 */
export type AssignmentReadinessSeverity = 'hard' | 'soft';

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
   *
   * **R.1 (D5.R1)** — for new items the seeder derives this as
   * `blocking = severity === 'hard'`, but the field stays separate so future
   * logic can diverge (e.g. a `severity: 'hard'` item with
   * `status: 'complete_pass'` might still be `blocking: false` for some other
   * gate). Existing (pre-R.1) items keep whatever value they were seeded with;
   * the R.1 backfill sets `severity` from the type-default table without
   * touching `blocking`, so historical inconsistencies surface in the audit
   * script (`scripts/auditAssignmentReadinessStatuses.ts`) rather than getting
   * silently rewritten.
   */
  blocking: boolean;
  /**
   * **R.1** — Hard / soft. Denormalized from the requirement at seed time so
   * the R.4 chip aggregator never has to round-trip to the JO doc. Required on
   * all new items; backfilled to existing items by
   * `backfillAssignmentReadinessItemsCallable`.
   */
  severity: AssignmentReadinessSeverity;
  /**
   * **R.1** — How the current `status` was resolved. See
   * `AssignmentReadinessResolutionMethod` for semantics. `null` for unresolved
   * items. Optional in the type for back-compat with pre-R.1 items; backfill
   * promotes it to `null` (explicit) for items that have no derivable method.
   */
  resolutionMethod?: AssignmentReadinessResolutionMethod;
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
  /**
   * **Phase C** — milliseconds since epoch when the underlying record this item
   * derives from goes stale and needs re-verification. Only stamped for items
   * whose source data carries an expiration:
   *   - `license_match` — from `LicenseRecordV1.expirationDate`
   *   - `screening_package_match` — from the BG check eval's `expiresAtMs`
   *   - `cert_match` — from `CertificationRecordV1.expirationDate` (Phase B.5.1)
   *
   * Other types (skills, education, languages, shift_confirmation, etc.) leave
   * this undefined — they don't have a meaningful expiration.
   *
   * Daily reconciler queries on this field to flip ripe items to `expired`.
   * Convention: when set, `expiresAtMs > 0`. Reconciler index:
   * `(expiresAtMs ASC, status ASC)` on the `assignmentReadinessItems`
   * collection group.
   */
  expiresAtMs?: number;
};

/**
 * Requirement types that are seeded **multiple times per assignment** — one
 * item per JO requirement entry. Each instance MUST carry a `customKey`
 * (e.g. cert catalog id, license class slug, skill slug, language code) so the
 * doc id is unique.
 *
 * Single-instance types (`education_match`, `screening_package_match`) and
 * the screening / orientation / acknowledgement / confirmation types omit the
 * key. `'custom'` also requires it but for tenant-extension reasons.
 *
 * @see docs/READINESS_EXECUTION_MATRIX.md §4 (per-requirement cardinality)
 */
export const MULTI_INSTANCE_ASSIGNMENT_REQUIREMENT_TYPES = [
  'cert_match',
  'license_match',
  'skill_match',
  'language_match',
] as const satisfies readonly AssignmentReadinessRequirementType[];

export type MultiInstanceAssignmentRequirementType =
  (typeof MULTI_INSTANCE_ASSIGNMENT_REQUIREMENT_TYPES)[number];

/** True if the type requires a `customKey` to disambiguate multiple instances per assignment. */
export function isMultiInstanceAssignmentRequirementType(
  t: AssignmentReadinessRequirementType,
): t is MultiInstanceAssignmentRequirementType {
  return (MULTI_INSTANCE_ASSIGNMENT_REQUIREMENT_TYPES as readonly string[]).includes(t);
}

/** Narrow key helper for id building + lookup. */
export type AssignmentReadinessItemKey = {
  assignmentId: string;
  requirementType: AssignmentReadinessRequirementType;
  /**
   * Required for `'custom'` and for the multi-instance match types
   * (`cert_match`, `license_match`, `skill_match`, `language_match`). Optional
   * for single-instance types — supplying it is harmless (it'll be appended).
   */
  customKey?: string;
};

/**
 * Deterministic doc id for an `AssignmentReadinessItem`.
 *
 * Layout:
 *   - Single-instance types:  `${assignmentId}__${requirementType}`
 *   - Multi-instance types:   `${assignmentId}__${requirementType}__${normalizedCustomKey}`
 *   - `'custom'`:             same as multi-instance — customKey required.
 *
 * `customKey` is normalized to alphanumeric + underscore (`[^A-Za-z0-9_]` →
 * `_`) to keep ids safe in Firestore doc paths.
 *
 * Throws when a multi-instance type or `'custom'` is missing `customKey`.
 */
export function buildAssignmentReadinessItemId(key: AssignmentReadinessItemKey): string {
  const base = `${key.assignmentId}__${key.requirementType}`;
  const requiresKey = key.requirementType === 'custom' || isMultiInstanceAssignmentRequirementType(key.requirementType);
  if (requiresKey) {
    const custom = (key.customKey || '').replace(/[^A-Za-z0-9_]+/g, '_');
    if (!custom) {
      throw new Error(
        `buildAssignmentReadinessItemId: customKey required when requirementType === "${key.requirementType}"`,
      );
    }
    return `${base}__${custom}`;
  }
  // Single-instance — append customKey if the caller supplied one (rare; harmless).
  if (key.customKey) {
    const safe = key.customKey.replace(/[^A-Za-z0-9_]+/g, '_');
    if (safe) return `${base}__${safe}`;
  }
  return base;
}
