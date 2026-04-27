/**
 * **Mirror of `shared/seedAssignmentReadinessItems.ts`** — CRA client/jest copy.
 * Keep byte-for-byte in sync.
 *
 * Pure builder for `AssignmentReadinessItem` docs — created when a worker is
 * placed on a specific shift / job order and has shift-scoped readiness
 * requirements (background check per-JO package, drug screen per-panel, site
 * orientation, shift confirmation, etc.).
 *
 * Parallel to `shared/seedEmployeeReadinessItems.ts` — same shape, different
 * collection. Pure: no Firestore I/O. Caller resolves ownership and writes.
 *
 * @see shared/assignmentReadinessItemV1.ts
 * @see shared/seedEmployeeReadinessItems.ts (sibling for per-entity items)
 */

import type { ActionItemOwnership } from './actionItemOwnership';
import {
  buildAssignmentReadinessItemId,
  type AssignmentReadinessItem,
  type AssignmentReadinessItemActor,
  type AssignmentReadinessItemStatus,
  type AssignmentReadinessRequirementType,
  type AssignmentReadinessResolutionMethod,
  type AssignmentReadinessSeverity,
} from './assignmentReadinessItemV1';

export const SEED_ASSIGNMENT_READINESS_VERSION = 1;

export type SeedAssignmentReadinessRequirementSpec = {
  requirementType: AssignmentReadinessRequirementType;
  requirementLabel?: string;
  customKey?: string;
  actor?: AssignmentReadinessItemActor;
  blocking?: boolean;
  ctaTarget?: AssignmentReadinessItem['ctaTarget'];
  status?: AssignmentReadinessItemStatus;
  externalRef?: string;
  /**
   * **Phase C** — milliseconds since epoch when the underlying record expires.
   * Stamped through to the seeded item. Only meaningful for `license_match`,
   * `screening_package_match`, and (after B.5.1) `cert_match`. Daily reconciler
   * uses this to flip `complete_pass` items to `expired`. See
   * `shared/assignmentReadinessItemV1.ts` for the field's full doc.
   */
  expiresAtMs?: number;
  /**
   * **R.1** — Hard / soft. Resolved by callers per the three-insertion-point
   * rule (D4.R1):
   *   1. per-instance on the JO requirement object (e.g. `RequiredLicenseV1.severity`)
   *   2. parallel override map keyed by skill slug (`skillsRequiredSeverityOverrides`)
   *   3. per-type override on the JO (`requirementSeverityOverrides`)
   *   4. fall through to `DEFAULT_REQUIREMENT_SEVERITY` table below.
   *
   * The seeder doesn't perform that resolution itself — callers do, then pass
   * the final value through. When omitted, the seeder falls through to the
   * type default (or throws for `'custom'`, which has no default).
   */
  severity?: AssignmentReadinessSeverity;
  /**
   * **R.1** — Pathway by which this item gets resolved. Stamped by callers
   * who know the source: matcher-fed items pass `'auto'`, willingness items
   * (R.2) pass `'self_attest'`, external-fed items pass `'external'`. CSA
   * actions (R.3) override to `'csa_confirmed'` / `'csa_waived'` post-seed.
   * Omit to default to `null` (unresolved pathway / pending seed-time
   * resolution).
   */
  resolutionMethod?: AssignmentReadinessResolutionMethod;
};

export type SeedAssignmentReadinessItemsInput = {
  tenantId: string;
  assignmentId: string;
  workerUid: string;
  jobOrderId: string;
  shiftId?: string;
  requirements: SeedAssignmentReadinessRequirementSpec[];
  ownership: ActionItemOwnership;
  nowIso: string;
  source: AssignmentReadinessItem['source'];
};

/** Defaults per requirement type. Shift-scoped work has slightly different defaults than entity-scoped. */
type RequirementDefault = {
  actor: AssignmentReadinessItemActor;
  blocking: boolean;
};

const DEFAULT_REQUIREMENT_DEFAULTS: Record<AssignmentReadinessRequirementType, RequirementDefault> = {
  // Screenings — vendor-driven, almost always blocking for first shift start.
  background_check: { actor: 'vendor', blocking: true },
  drug_screen: { actor: 'vendor', blocking: true },
  e_verify: { actor: 'system', blocking: true },
  // Shift-specific qualifications — worker-owned, blocking.
  required_certification: { actor: 'worker', blocking: true }, // @deprecated — see type doc; replaced by cert_match
  orientation: { actor: 'worker', blocking: true },
  // Phase B match items — initial status computed at seed time via the matchers
  // in shared/jobRequirementMatchers/. The actor reflects who'd resolve a
  // complete_fail: cert/license/edu/lang are worker-supplied; skill is
  // recruiter-adjudicated; screening_package is vendor-fulfilled.
  cert_match: { actor: 'worker', blocking: true },
  license_match: { actor: 'worker', blocking: true },
  skill_match: { actor: 'recruiter', blocking: true },
  education_match: { actor: 'worker', blocking: true },
  language_match: { actor: 'worker', blocking: true },
  screening_package_match: { actor: 'vendor', blocking: true },
  // Acknowledgements — worker-owned, typically blocking for first shift.
  ppe_acknowledgement: { actor: 'worker', blocking: true },
  safety_briefing: { actor: 'worker', blocking: true },
  // Confirmation = the cadence "YES / HERE" flow; blocks activation.
  shift_confirmation: { actor: 'worker', blocking: true },
  // R.2 — Willingness self-attestations. Worker-owned, soft by default
  // (`blocking: false` derives from `severity: 'soft'`). Each item only
  // seeds when the JO declares the corresponding requirement field
  // (D9.R2 — see `buildPhaseBMatchSpecs`). The table value documents the
  // pre-derivation default; runtime `blocking` is recomputed from severity
  // in `buildItem` (D5.R1).
  physical_willingness: { actor: 'worker', blocking: false },
  uniform_willingness: { actor: 'worker', blocking: false },
  ppe_willingness: { actor: 'worker', blocking: false },
  language_willingness: { actor: 'worker', blocking: false },
  // Escape hatch.
  custom: { actor: 'worker', blocking: false },
};

/**
 * **R.1 (D3.R1)** — Hard/soft default per requirement type. The chip
 * aggregator (R.4) treats hard items as red contributors when not passing,
 * soft items as yellow. Per-instance and per-JO overrides take precedence
 * (resolved upstream by the matcher caller; passed in via
 * `SeedAssignmentReadinessRequirementSpec.severity`).
 *
 * `'custom'` is intentionally absent — custom requirements have no
 * type-level default. Callers MUST pass `severity` explicitly on the spec.
 *
 * @see docs/READINESS_R1_R2_HANDOFF.md §R.1 for the rationale per row.
 */
export const DEFAULT_REQUIREMENT_SEVERITY: Record<
  Exclude<AssignmentReadinessRequirementType, 'custom'>,
  AssignmentReadinessSeverity
> = {
  // Hard — failure blocks the worker from doing the job.
  background_check: 'hard',
  drug_screen: 'hard',
  e_verify: 'hard',
  required_certification: 'hard',
  orientation: 'hard',
  cert_match: 'hard',
  license_match: 'hard',
  screening_package_match: 'hard',
  safety_briefing: 'hard',
  // `ppe_acknowledgement` is the per-shift "did you bring / wear your PPE?"
  // confirmation — distinct from R.2's `ppe_willingness` (the worker's standing
  // answer at application time, which is soft). The acknowledgement gates the
  // shift, so it stays hard. See docs/READINESS_R1_R2_HANDOFF.md §D3.R1.
  ppe_acknowledgement: 'hard',
  // Soft — failure is informational; CSA can waive. Skill / edu / language
  // matches are soft by default but each is per-JO-overridable to hard
  // (some skills are nice-to-have, some are genuinely required).
  skill_match: 'soft',
  education_match: 'soft',
  language_match: 'soft',
  shift_confirmation: 'soft',
  // R.2 — Willingness self-attestations are always soft. They surface "no"
  // / "maybe" answers as yellow on the chip; a CSA can flip a specific JO's
  // requirement to hard via `requirementSeverityOverrides` if a particular
  // role makes the willingness genuinely blocking.
  physical_willingness: 'soft',
  uniform_willingness: 'soft',
  ppe_willingness: 'soft',
  language_willingness: 'soft',
};

/**
 * Build `AssignmentReadinessItem` docs. Pure — no Firestore writes.
 */
export function seedAssignmentReadinessItems(
  input: SeedAssignmentReadinessItemsInput,
): AssignmentReadinessItem[] {
  if (!input.requirements || input.requirements.length === 0) {
    throw new Error('seedAssignmentReadinessItems: requirements list is empty — nothing to seed');
  }
  return input.requirements.map((spec, index) => buildItem(input, spec, index));
}

function buildItem(
  input: SeedAssignmentReadinessItemsInput,
  spec: SeedAssignmentReadinessRequirementSpec,
  index: number,
): AssignmentReadinessItem {
  if (spec.requirementType === 'custom' && (!spec.requirementLabel || !spec.customKey)) {
    throw new Error(
      `seedAssignmentReadinessItems[${index}]: custom requirement requires both requirementLabel and customKey`,
    );
  }

  const defaults = DEFAULT_REQUIREMENT_DEFAULTS[spec.requirementType];

  // R.1 — Resolve severity. Custom requirements have no type-default and MUST
  // pass `spec.severity` explicitly (mirrors how custom requires
  // `requirementLabel` and `customKey`). All other types fall through to the
  // DEFAULT_REQUIREMENT_SEVERITY table; callers (e.g. matcher helpers) resolve
  // the per-instance / override-map / type-default chain upstream and hand the
  // final value through the spec.
  let severity: AssignmentReadinessSeverity;
  if (spec.requirementType === 'custom') {
    if (spec.severity !== 'hard' && spec.severity !== 'soft') {
      throw new Error(
        `seedAssignmentReadinessItems[${index}]: custom requirement requires severity ('hard' | 'soft')`,
      );
    }
    severity = spec.severity;
  } else {
    severity = spec.severity ?? DEFAULT_REQUIREMENT_SEVERITY[spec.requirementType];
  }

  // R.1 (D5.R1) — `blocking` derives from severity unless a caller explicitly
  // overrides. The two fields stay separate on the item so future logic can
  // diverge (e.g. a hard item that's already passed → blocking:false). The
  // audit script (`scripts/auditAssignmentReadinessStatuses.ts`) reports the
  // population-level divergence in legacy data.
  const blocking = spec.blocking ?? (severity === 'hard');

  const id = buildAssignmentReadinessItemId({
    assignmentId: input.assignmentId,
    requirementType: spec.requirementType,
    customKey: spec.customKey,
  });

  const item: AssignmentReadinessItem = {
    id,
    tenantId: input.tenantId,
    assignmentId: input.assignmentId,
    workerUid: input.workerUid,
    jobOrderId: input.jobOrderId,
    requirementType: spec.requirementType,
    status: spec.status ?? 'incomplete',
    actor: spec.actor ?? defaults.actor,
    blocking,
    severity,
    resolutionMethod: spec.resolutionMethod ?? null,
    ownership: input.ownership,
    createdAt: input.nowIso,
    updatedAt: input.nowIso,
  };

  if (input.shiftId) item.shiftId = input.shiftId;
  if (spec.requirementLabel) item.requirementLabel = spec.requirementLabel;
  if (spec.ctaTarget) item.ctaTarget = spec.ctaTarget;
  if (input.source) item.source = input.source;
  if (spec.externalRef) item.externalRef = spec.externalRef;
  // Phase C: stamp expiration when caller supplied it. Reconciler queries on
  // this; absent → item is not subject to time-based expiry sweeps.
  if (typeof spec.expiresAtMs === 'number' && spec.expiresAtMs > 0) {
    item.expiresAtMs = spec.expiresAtMs;
  }

  return item;
}

/**
 * Convenience: the baseline shift-level requirements you'd seed for a generic
 * W-2 assignment where the job order requires background + drug + orientation
 * + confirmation. Tenants with heavier compliance add to this list.
 */
export const BASELINE_SHIFT_REQUIREMENTS: SeedAssignmentReadinessRequirementSpec[] = [
  { requirementType: 'shift_confirmation' },
  { requirementType: 'background_check' },
  { requirementType: 'drug_screen' },
  { requirementType: 'orientation' },
  { requirementType: 'safety_briefing' },
  { requirementType: 'ppe_acknowledgement' },
];

export const ASSIGNMENT_REQUIREMENT_DEFAULTS = DEFAULT_REQUIREMENT_DEFAULTS;
