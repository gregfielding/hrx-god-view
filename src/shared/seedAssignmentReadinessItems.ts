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
  required_certification: { actor: 'worker', blocking: true },
  orientation: { actor: 'worker', blocking: true },
  // Acknowledgements — worker-owned, typically blocking for first shift.
  ppe_acknowledgement: { actor: 'worker', blocking: true },
  safety_briefing: { actor: 'worker', blocking: true },
  // Confirmation = the cadence "YES / HERE" flow; blocks activation.
  shift_confirmation: { actor: 'worker', blocking: true },
  // Escape hatch.
  custom: { actor: 'worker', blocking: false },
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
    blocking: spec.blocking ?? defaults.blocking,
    ownership: input.ownership,
    createdAt: input.nowIso,
    updatedAt: input.nowIso,
  };

  if (input.shiftId) item.shiftId = input.shiftId;
  if (spec.requirementLabel) item.requirementLabel = spec.requirementLabel;
  if (spec.ctaTarget) item.ctaTarget = spec.ctaTarget;
  if (input.source) item.source = input.source;
  if (spec.externalRef) item.externalRef = spec.externalRef;

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
