/**
 * Pure builder for `EmployeeReadinessItem` docs to write when a worker first
 * associates with a hiring entity (new `entity_employments` row created, or
 * manual seed by a recruiter).
 *
 * No I/O, no firebase imports. Caller resolves ownership ONCE (with
 * `resolveOwnership`) and passes it in — Employee Readiness items for the
 * same (worker × entity) all share the same ownership snapshot at creation.
 *
 * Sensible defaults per requirement type (actor + blocking) come from
 * `DEFAULT_REQUIREMENT_DEFAULTS` below; callers can override per-item.
 *
 * @see recruiter-ownership-model.md §9 #3 (per-entity onboarding decision)
 * @see shared/employeeReadinessItemV1.ts (the item type itself)
 */

import type { ActionItemOwnership } from './actionItemOwnership';
import {
  buildEmployeeReadinessItemId,
  type EmployeeReadinessItem,
  type EmployeeReadinessItemActor,
  type EmployeeReadinessItemStatus,
  type EmployeeReadinessRequirementType,
} from './employeeReadinessItemV1';

/** What the caller asks to seed — one entry per item. */
export type SeedEmployeeReadinessRequirementSpec = {
  requirementType: EmployeeReadinessRequirementType;
  /** Required when `requirementType === 'custom'`. */
  requirementLabel?: string;
  /** Required when `requirementType === 'custom'` (so two custom items per worker × entity don't collide on id). */
  customKey?: string;
  /** Override the default actor (worker / recruiter / vendor / system). */
  actor?: EmployeeReadinessItemActor;
  /** Override the default `blocking` flag. */
  blocking?: boolean;
  /** Optional deep-link surfaced on the action-queue card. */
  ctaTarget?: EmployeeReadinessItem['ctaTarget'];
  /** Override the default starting status (`incomplete`). Useful for migrations / backfills. */
  status?: EmployeeReadinessItemStatus;
  /** Vendor reference — e.g. AccuSource `providerOrderId`. */
  externalRef?: string;
};

export type SeedEmployeeReadinessItemsInput = {
  tenantId: string;
  workerUid: string;
  hiringEntityId: string;
  /** Optional human-readable name; denormalized onto every item for fast labels. */
  hiringEntityName?: string;
  /** What to seed. */
  requirements: SeedEmployeeReadinessRequirementSpec[];
  /** Already-resolved ownership for these items. Same snapshot applied to all. */
  ownership: ActionItemOwnership;
  /** ISO-8601 — used for `createdAt` and `updatedAt` so the whole seed batch is consistent. */
  nowIso: string;
  /** Audit source attribution. */
  source: EmployeeReadinessItem['source'];
};

/** Default `actor` + `blocking` per requirement type. Mirrors §13a discussion in the rethink doc. */
type RequirementDefault = {
  actor: EmployeeReadinessItemActor;
  blocking: boolean;
};

const DEFAULT_REQUIREMENT_DEFAULTS: Record<EmployeeReadinessRequirementType, RequirementDefault> = {
  // I-9 — Section 1 is worker, Section 2 is recruiter; both block hire/activation.
  i9_section_1: { actor: 'worker', blocking: true },
  i9_section_2: { actor: 'recruiter', blocking: true },
  // Federal forms / payroll setup — worker-driven, blocking for first paid shift.
  handbook_acknowledgement: { actor: 'worker', blocking: true },
  direct_deposit: { actor: 'worker', blocking: false },
  tax_w4: { actor: 'worker', blocking: true },
  tax_w9: { actor: 'worker', blocking: true },
  tax_1099_consent: { actor: 'worker', blocking: true },
  // Vendor-driven — fire-and-forget, vendor callback updates status.
  e_verify: { actor: 'system', blocking: true },
  everee_profile: { actor: 'worker', blocking: true },
  background_check: { actor: 'vendor', blocking: true },
  drug_screen: { actor: 'vendor', blocking: true },
  // Acknowledgements + profile completeness — worker-driven, mostly non-blocking.
  policy_acknowledgement: { actor: 'worker', blocking: true },
  profile_photo: { actor: 'worker', blocking: false },
  phone_verified: { actor: 'worker', blocking: false },
  emergency_contact: { actor: 'worker', blocking: false },
  address_confirmed: { actor: 'worker', blocking: false },
  // Escape hatch — caller MUST pass actor + blocking when using `custom`.
  custom: { actor: 'worker', blocking: false },
};

/**
 * Build the `EmployeeReadinessItem` docs (no Firestore writes; pure).
 *
 * @throws when `requirements` is empty or when a `custom` spec lacks
 *   `requirementLabel` + `customKey` (caught early so we don't write
 *   undifferentiated junk to Firestore).
 */
export function seedEmployeeReadinessItems(input: SeedEmployeeReadinessItemsInput): EmployeeReadinessItem[] {
  if (!input.requirements || input.requirements.length === 0) {
    throw new Error('seedEmployeeReadinessItems: requirements list is empty — nothing to seed');
  }
  return input.requirements.map((spec, index) => buildItem(input, spec, index));
}

function buildItem(
  input: SeedEmployeeReadinessItemsInput,
  spec: SeedEmployeeReadinessRequirementSpec,
  index: number,
): EmployeeReadinessItem {
  if (spec.requirementType === 'custom' && (!spec.requirementLabel || !spec.customKey)) {
    throw new Error(
      `seedEmployeeReadinessItems[${index}]: custom requirement requires both requirementLabel and customKey`,
    );
  }

  const defaults = DEFAULT_REQUIREMENT_DEFAULTS[spec.requirementType];
  const id = buildEmployeeReadinessItemId({
    workerUid: input.workerUid,
    hiringEntityId: input.hiringEntityId,
    requirementType: spec.requirementType,
    customKey: spec.customKey,
  });

  const item: EmployeeReadinessItem = {
    id,
    tenantId: input.tenantId,
    workerUid: input.workerUid,
    hiringEntityId: input.hiringEntityId,
    requirementType: spec.requirementType,
    status: spec.status ?? 'incomplete',
    actor: spec.actor ?? defaults.actor,
    blocking: spec.blocking ?? defaults.blocking,
    ownership: input.ownership,
    createdAt: input.nowIso,
    updatedAt: input.nowIso,
  };

  if (input.hiringEntityName) item.hiringEntityName = input.hiringEntityName;
  if (spec.requirementLabel) item.requirementLabel = spec.requirementLabel;
  if (spec.ctaTarget) item.ctaTarget = spec.ctaTarget;
  if (input.source) item.source = input.source;
  if (spec.externalRef) item.externalRef = spec.externalRef;

  return item;
}

/**
 * Convenience: a baseline W-2 onboarding requirement set. Many tenants will
 * want exactly this on first entity association; tenants with custom flows
 * pass their own `requirements` array instead.
 *
 * Excludes `background_check` and `drug_screen` because those are typically
 * shift-specific (Assignment Readiness), not always required at entity onboarding.
 */
export const BASELINE_W2_REQUIREMENTS: SeedEmployeeReadinessRequirementSpec[] = [
  { requirementType: 'i9_section_1' },
  { requirementType: 'i9_section_2' },
  { requirementType: 'handbook_acknowledgement' },
  { requirementType: 'tax_w4' },
  { requirementType: 'direct_deposit' },
  { requirementType: 'e_verify' },
  { requirementType: 'everee_profile' },
  { requirementType: 'policy_acknowledgement' },
  { requirementType: 'profile_photo' },
  { requirementType: 'phone_verified' },
  { requirementType: 'emergency_contact' },
  { requirementType: 'address_confirmed' },
];

/**
 * Convenience: 1099 contractor flow — W-9 + 1099 consent instead of W-4 +
 * E-Verify. Skips Everee onboarding (1099s use a separate payment path).
 */
export const BASELINE_1099_REQUIREMENTS: SeedEmployeeReadinessRequirementSpec[] = [
  { requirementType: 'tax_w9' },
  { requirementType: 'tax_1099_consent' },
  { requirementType: 'policy_acknowledgement' },
  { requirementType: 'profile_photo' },
  { requirementType: 'phone_verified' },
  { requirementType: 'emergency_contact' },
  { requirementType: 'address_confirmed' },
];

export const REQUIREMENT_DEFAULTS = DEFAULT_REQUIREMENT_DEFAULTS;
