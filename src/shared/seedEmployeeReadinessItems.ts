/**
 * **Mirror of `shared/seedEmployeeReadinessItems.ts`** — CRA client/jest copy.
 * Keep byte-for-byte in sync.
 *
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
  // C1 Events 1099 — Independent Contractor Agreement signed via e-sign.
  ic_agreement: { actor: 'worker', blocking: true },
  // E.3 — IRS TIN check. Everee performs the verification; result blocks
  // payable status when MISMATCH. Worker can't act on it directly (CSA
  // resolves SSN mismatches), but it gates pay so we mark blocking.
  tin_verification: { actor: 'system', blocking: true },
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
 * Three explicit baselines — one per C1 hiring entity, keyed off the entity's
 * derived `entityKey` (`'select'` / `'workforce'` / `'events'`). See
 * `docs/READINESS_MODEL.md` §3.
 *
 * Profile basics (`profile_photo`, `phone_verified`, `emergency_contact`,
 * `address_confirmed`) appear here AND in Worker Profile Readiness — that's
 * intentional. The Profile bucket is a worker-app UX meter on the same
 * underlying fields; Employee Readiness gates payable work.
 *
 * Excludes `background_check` and `drug_screen` — those are per-job
 * (Assignment Readiness), defined on the JO's requirement package and
 * snapshotted to the assignment.
 */

/**
 * **C1 Select LLC (W-2 with E-Verify)** — Select runs every worker through
 * I-9 + E-Verify as one native, blocking onboarding track. See
 * `docs/EVerify_IMPLEMENTATION_SUMMARY.md` for why E-Verify is Select-only.
 */
export const BASELINE_SELECT_REQUIREMENTS: SeedEmployeeReadinessRequirementSpec[] = [
  { requirementType: 'i9_section_1' },
  { requirementType: 'i9_section_2' },
  { requirementType: 'e_verify' },
  { requirementType: 'tax_w4' },
  { requirementType: 'direct_deposit' },
  { requirementType: 'handbook_acknowledgement' },
  { requirementType: 'everee_profile' },
  { requirementType: 'tin_verification' },
  { requirementType: 'policy_acknowledgement' },
  { requirementType: 'profile_photo' },
  { requirementType: 'phone_verified' },
  { requirementType: 'emergency_contact' },
  { requirementType: 'address_confirmed' },
];

/**
 * **C1 Workforce LLC (W-2, no E-Verify)** — same legal compliance set as
 * Select minus the E-Verify case. I-9 only.
 */
export const BASELINE_WORKFORCE_REQUIREMENTS: SeedEmployeeReadinessRequirementSpec[] = [
  { requirementType: 'i9_section_1' },
  { requirementType: 'i9_section_2' },
  { requirementType: 'tax_w4' },
  { requirementType: 'direct_deposit' },
  { requirementType: 'handbook_acknowledgement' },
  { requirementType: 'everee_profile' },
  { requirementType: 'tin_verification' },
  { requirementType: 'policy_acknowledgement' },
  { requirementType: 'profile_photo' },
  { requirementType: 'phone_verified' },
  { requirementType: 'emergency_contact' },
  { requirementType: 'address_confirmed' },
];

/**
 * **C1 Events LLC (1099 contractor)** — W-9 + 1099 consent + IC agreement
 * instead of I-9 / E-Verify / W-4. Skips Everee onboarding (1099s use a
 * separate payment path).
 */
export const BASELINE_EVENTS_REQUIREMENTS: SeedEmployeeReadinessRequirementSpec[] = [
  { requirementType: 'ic_agreement' },
  { requirementType: 'tax_w9' },
  { requirementType: 'tax_1099_consent' },
  { requirementType: 'handbook_acknowledgement' },
  { requirementType: 'direct_deposit' },
  { requirementType: 'tin_verification' },
  { requirementType: 'policy_acknowledgement' },
  { requirementType: 'profile_photo' },
  { requirementType: 'phone_verified' },
  { requirementType: 'emergency_contact' },
  { requirementType: 'address_confirmed' },
];

/**
 * @deprecated Use `BASELINE_SELECT_REQUIREMENTS` (Select) or
 * `BASELINE_WORKFORCE_REQUIREMENTS` (Workforce) instead. Kept as an alias
 * pointing at the broader Select set so existing callers keep working
 * during the migration. Drop after no callers reference this name.
 */
export const BASELINE_W2_REQUIREMENTS: SeedEmployeeReadinessRequirementSpec[] = BASELINE_SELECT_REQUIREMENTS;

/**
 * @deprecated Use `BASELINE_EVENTS_REQUIREMENTS` instead.
 */
export const BASELINE_1099_REQUIREMENTS: SeedEmployeeReadinessRequirementSpec[] = BASELINE_EVENTS_REQUIREMENTS;

export const REQUIREMENT_DEFAULTS = DEFAULT_REQUIREMENT_DEFAULTS;
