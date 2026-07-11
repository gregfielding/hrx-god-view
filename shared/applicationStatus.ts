/**
 * Canonical application status vocabulary (Job Order / Assignment architecture).
 * Keep in sync with `src/utils/applicationStatusNormalize.ts` (CRA bundle) and `functions/src/utils/applicationStatusNormalize.ts`.
 *
 * @see docs/CANONICAL_JOB_ORDER_MODEL.md
 */

export const APPLICATION_STATUSES = [
  'submitted',
  'under_review',
  'interview',
  'offer_pending',
  'accepted',
  'rejected',
  'withdrawn',
  'waitlisted',
] as const;

export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

const CANONICAL_SET = new Set<string>(APPLICATION_STATUSES);

/** Terminal for duplicate-open prevention: accepted + rejected + withdrawn (locked architecture). */
export const TERMINAL_APPLICATION_STATUSES: readonly ApplicationStatus[] = [
  'accepted',
  'rejected',
  'withdrawn',
] as const;

const TERMINAL_SET = new Set<string>(TERMINAL_APPLICATION_STATUSES);

/**
 * Legacy / alternate strings observed in Firestore and types → canonical.
 * Extend during migration; unknown values fall through for reporting.
 */
const LEGACY_TO_CANONICAL: Record<string, ApplicationStatus> = {
  // Phase / recruiting labels
  new: 'submitted',
  applied: 'submitted',
  screening: 'under_review',
  screened: 'under_review',
  advanced: 'under_review',
  interviewed: 'interview',
  offer_pending: 'offer_pending',
  hired: 'accepted',
  selected: 'accepted',
  accepted: 'accepted',
  rejected: 'rejected',
  withdrawn: 'withdrawn',
  waitlisted: 'waitlisted',
  // Auto-released because it overlapped a shift the worker was assigned to
  // (placementsApi releaseOverlappingApplications, 2026-07-11). Withdrawn
  // semantics: terminal + excluded from applicant pools.
  released_overlap: 'withdrawn',
  // NewDataModel-style
  pending: 'submitted',
};

/**
 * Normalize raw Firestore/application status to canonical enum, or null if unmappable.
 */
export function normalizeApplicationStatus(raw: string | null | undefined): ApplicationStatus | null {
  const k = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (!k) return 'submitted';
  if (CANONICAL_SET.has(k)) return k as ApplicationStatus;
  return LEGACY_TO_CANONICAL[k] ?? null;
}

/** True if status is terminal for duplicate-open invariant (accepted | rejected | withdrawn). */
export function isTerminalApplicationStatus(raw: string | null | undefined): boolean {
  const n = normalizeApplicationStatus(raw);
  if (n == null) return false;
  return TERMINAL_SET.has(n);
}

/** True if this application counts toward “open” for duplicate detection (non-terminal canonical, or unknown legacy). */
export function isOpenApplicationStatusForInvariant(raw: string | null | undefined): boolean {
  const n = normalizeApplicationStatus(raw);
  if (n == null) return true;
  return !TERMINAL_SET.has(n);
}

/**
 * Placements / labor-pool filters: hide withdrawn, deleted, rejected, waitlisted (matches legacy string checks;
 * unknown legacy strings remain visible until mapped).
 */
export function isExcludedFromPlacementsApplicantPool(raw: string | null | undefined): boolean {
  const t = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (t === 'deleted') return true;
  const n = normalizeApplicationStatus(raw);
  if (n === 'withdrawn' || n === 'rejected' || n === 'waitlisted') return true;
  return false;
}
