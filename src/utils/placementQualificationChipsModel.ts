/**
 * Placement worker tiles: entity-level employment chip + assignment-scoped red blockers from readinessSnapshotV1.
 *
 * Blocker policy (explicit allowlist — UI only; `readinessSnapshotV1` schema unchanged):
 * - Incomplete `hard_block` requirements (except keys on the payroll/tax/handbook/policies denylist).
 * - Incomplete screening rows whose **key** is `background_check` or `drug_screen` (not “all category === screening”).
 * - Incomplete `cert_*` rows only when the certification is **required by the job order** (see below), including
 *   backend-synthesized `cert_required_*` rows (JO demand with no `worker_compliance_items` row).
 * - `PLACEMENT_BLOCKER_EXPLICIT_EXTRA_KEYS` for future keys (e.g. E-Verify) when they appear in snapshots.
 *
 * ## Sourcing required certifications (A)
 * - **Primary:** `job_orders.requiredCertifications` and `job_orders.requiredLicenses` (human-readable requirement strings).
 * - **Optional explicit ids:** `job_orders.requiredCertificationComplianceIds` when present — Firestore `worker_compliance_items`
 *   document ids; must match the `cert_*` **suffix** in the snapshot (see B).
 * - **Assignments** do not need a separate field for this pass: placement is always in the context of one `jobOrder`; snapshot
 *   is already built per assignment with that job’s `jobOrderId`.
 *
 * ## Matching snapshot `cert_*` rows (B)
 * Snapshot rows use `key === 'cert_' + complianceItemDocId` (see `functions/src/readiness/hrxReadinessSnapshotLoadContext.ts`).
 * - If `requiredCertificationComplianceIds` is non-empty: allow a `cert_*` blocker only when the suffix is in that set.
 * - Additionally (or if ids list empty): for each incomplete `cert_*` row, allow only if `normalize(row.label)` **matches**
 *   any normalized string from `requiredCertifications` ∪ `requiredLicenses` (exact match, or substring when token length ≥ 4).
 *
 * ## Non-required certifications (D)
 * Worker compliance items that appear in the snapshot but are **not** JO-required produce **no** red placement chip, because
 * their `cert_<id>` suffix is not allowlisted and their label does not match a JO requirement string.
 */

import type { ReadinessSnapshotV1Requirement } from '../shared/readinessSnapshotV1';
import { stableCertRequiredSlug } from '../shared/jobOrderSyntheticCertificationDemands';
import type { JobOrder } from '../types/recruiter/jobOrder';

/** Keys never shown as red placement blockers (payroll / tax / handbook / policies). */
export const PLACEMENT_BLOCKER_EXCLUDED_REQUIREMENT_KEYS = new Set([
  'payroll_setup',
  'tax_form',
  'handbook',
  'policies',
]);

/** Screening requirements that may appear as placement blockers when incomplete. */
export const PLACEMENT_BLOCKER_SCREENING_KEYS = new Set(['background_check', 'drug_screen']);

/**
 * Additional requirement keys to treat as placement blockers when incomplete (extend when new rows land in snapshots).
 * Example future entry: `'e_verify'`.
 */
export const PLACEMENT_BLOCKER_EXPLICIT_EXTRA_KEYS = new Set<string>([]);

const CERT_KEY_PREFIX = 'cert_';

function normalizeCertToken(raw: string): string {
  return String(raw || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function certSuffixFromRequirementKey(key: string): string | null {
  if (!key.startsWith(CERT_KEY_PREFIX)) return null;
  const s = key.slice(CERT_KEY_PREFIX.length).trim();
  return s || null;
}

/**
 * Job-order strings + optional explicit compliance ids → set of `cert_*` key suffixes allowed for placement blockers
 * for this snapshot’s requirement list.
 */
export function buildPlacementRequiredCertSuffixAllowlist(
  jobOrder: JobOrder | null | undefined,
  requirements: ReadinessSnapshotV1Requirement[] | null | undefined
): Set<string> {
  const allow = new Set<string>();
  if (!jobOrder) return allow;

  const explicit = jobOrder.requiredCertificationComplianceIds;
  if (Array.isArray(explicit)) {
    for (const id of explicit) {
      const t = String(id || '').trim();
      if (t) {
        allow.add(t);
        allow.add(`required_${stableCertRequiredSlug(t)}`);
      }
    }
  }

  const rawCertAndLicense = [
    ...(Array.isArray(jobOrder.requiredCertifications) ? jobOrder.requiredCertifications : []),
    ...(Array.isArray(jobOrder.requiredLicenses) ? jobOrder.requiredLicenses : []),
  ]
    .map((x) => String(x || '').trim())
    .filter(Boolean);

  const reqStrings = rawCertAndLicense.map(normalizeCertToken).filter(Boolean);

  for (const raw of rawCertAndLicense) {
    allow.add(`required_${stableCertRequiredSlug(raw)}`);
  }

  if (!requirements?.length) return allow;
  if (reqStrings.length === 0) return allow;

  for (const r of requirements) {
    const suffix = certSuffixFromRequirementKey(r.key);
    if (!suffix) continue;
    const lab = normalizeCertToken(r.label || '');
    if (!lab) continue;
    for (const t of reqStrings) {
      if (!t) continue;
      if (t === lab) {
        allow.add(suffix);
        break;
      }
      if (t.length >= 4 && (lab.includes(t) || t.includes(lab))) {
        allow.add(suffix);
        break;
      }
    }
  }

  return allow;
}

export type PlacementBlockerFilterOptions = {
  /** Merged allowlist: `cert_<suffix>` is a blocker only if `suffix` is in this set (built from job order + snapshot). */
  requiredCertificationKeySuffixes: Set<string>;
};

/**
 * (C) Blocker filter: explicit allowlist for screening keys + cert suffixes; hard_block minus denylist; optional extra keys.
 */
export function selectPlacementBlockerLabelsFromSnapshot(
  requirements: ReadinessSnapshotV1Requirement[] | null | undefined,
  options?: PlacementBlockerFilterOptions | null
): string[] {
  if (!requirements?.length) return [];
  const certAllow = options?.requiredCertificationKeySuffixes ?? new Set<string>();
  const out: string[] = [];
  const seen = new Set<string>();

  for (const r of requirements) {
    if (r.status === 'complete') continue;
    if (PLACEMENT_BLOCKER_EXCLUDED_REQUIREMENT_KEYS.has(r.key)) continue;

    let include = false;
    if (r.severity === 'hard_block') include = true;
    else if (PLACEMENT_BLOCKER_SCREENING_KEYS.has(r.key)) include = true;
    else if (PLACEMENT_BLOCKER_EXPLICIT_EXTRA_KEYS.has(r.key)) include = true;
    else if (r.key.startsWith(CERT_KEY_PREFIX)) {
      const suffix = certSuffixFromRequirementKey(r.key);
      include = Boolean(suffix && certAllow.has(suffix));
    }

    if (!include) continue;
    const label = (r.label || '').trim() || r.key;
    if (seen.has(label)) continue;
    seen.add(label);
    out.push(label);
  }
  return out;
}

/** Build options for `selectPlacementBlockerLabelsFromSnapshot` from the active job order and that row’s snapshot requirements. */
export function placementBlockerOptionsForRow(
  jobOrder: JobOrder | null | undefined,
  requirements: ReadinessSnapshotV1Requirement[] | null | undefined
): PlacementBlockerFilterOptions {
  return {
    requiredCertificationKeySuffixes: buildPlacementRequiredCertSuffixAllowlist(jobOrder, requirements),
  };
}

export type PlacementEmploymentChipModel = {
  label: string;
  color: 'success' | 'warning' | 'default' | 'error';
  tooltip?: string;
};

/**
 * Placement tiles: one chip per hiring entity from `entity_employments`.
 * Colors: amber = onboarding / in progress / review-ish; green = active/ready; red = terminated/inactive; neutral = unknown.
 */
export function placementEmploymentChipFromEntityData(
  data: Record<string, unknown> | null | undefined
): PlacementEmploymentChipModel {
  if (!data) {
    return {
      label: 'No record',
      color: 'default',
      tooltip: 'No entity_employments document for this hiring entity.',
    };
  }

  const es = String(data.employmentState ?? '').trim().toLowerCase();
  const leg = String(data.status ?? '').trim().toLowerCase();
  // Match `userListEntityEmploymentStatus` / backend sync: treat placeholder `employmentState` as absent so
  // legacy `status` (e.g. `onboarding`) still drives the chip when canonical state was not denormalized yet.
  const esMeaningful = Boolean(es) && es !== 'not_started' && es !== 'none';
  const primary = esMeaningful ? es : leg;
  const hasCanon = esMeaningful;

  if (!primary || primary === 'not_started' || primary === 'none') {
    return {
      label: 'No record',
      color: 'default',
      tooltip: 'No employment state on file for this hiring entity.',
    };
  }

  if (primary === 'terminated') {
    return {
      label: 'Terminated',
      color: 'error',
      tooltip: 'Employment terminated for this entity.',
    };
  }
  if (primary === 'inactive') {
    return {
      label: 'Inactive',
      color: 'error',
      tooltip: 'Employment inactive for this entity.',
    };
  }

  if (
    (data.onboardingComplete === true || data.active === true) &&
    primary !== 'inactive' &&
    primary !== 'terminated'
  ) {
    return {
      label: 'Active',
      color: 'success',
      tooltip: 'Entity onboarding complete (employment record).',
    };
  }

  if (primary === 'active' || (!hasCanon && leg === 'ready')) {
    return { label: 'Active', color: 'success', tooltip: 'Entity employment active.' };
  }
  if (primary === 'employed' || leg === 'employed') {
    return { label: 'Active', color: 'success', tooltip: 'Entity employment active.' };
  }

  if (primary === 'onboarding') {
    return { label: 'Onboarding', color: 'warning', tooltip: 'Entity onboarding not complete.' };
  }
  if (primary === 'blocked') {
    return { label: 'Blocked', color: 'warning', tooltip: 'Employment is blocked for this entity.' };
  }

  if (
    primary === 'under_review' ||
    primary === 'pending_review' ||
    primary === 'in_review' ||
    primary.endsWith('_review')
  ) {
    return { label: 'Under review', color: 'warning', tooltip: 'Employment under review for this entity.' };
  }

  if (
    primary === 'in_progress' ||
    primary === 'onboarding_in_progress' ||
    leg === 'in_progress' ||
    leg === 'onboarding_in_progress'
  ) {
    return { label: 'In progress', color: 'warning', tooltip: 'Employment onboarding in progress.' };
  }

  return {
    label: 'Unknown',
    color: 'default',
    tooltip: `Employment state: ${primary || leg || 'unset'}`,
  };
}

/** Prefix hiring entity legal name for placement tiles: "Acme LLC — Onboarding". */
export function formatPlacementEmploymentChipWithEntityName(
  chip: PlacementEmploymentChipModel,
  hiringEntityName: string | null | undefined,
): PlacementEmploymentChipModel {
  const n = String(hiringEntityName || '').trim();
  if (!n) return chip;
  return {
    ...chip,
    label: `${n} — ${chip.label}`,
    tooltip: chip.tooltip ? `${n}: ${chip.tooltip}` : `${n} (${chip.label})`,
  };
}
