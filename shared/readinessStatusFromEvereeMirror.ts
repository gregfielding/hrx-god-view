/**
 * **E.3** — Pure translator from the denormalized Everee readiness snapshot
 * (`tenants/{tid}/everee_workers/{externalId}.readinessMirror`) to canonical
 * `EmployeeReadinessItemStatus` values for the seven readiness items Everee
 * owns.
 *
 * Sister to `readinessStatusFromEveree.ts` — that file translates the
 * legacy `everee_workers.status` + `bankAccount.verified` fields (which
 * the webhook handler still maintains as the high-level worker state). This
 * file translates the richer `readinessMirror` snapshot populated by
 * `computeEvereeReadinessMirror` (E.1+E.2). When both are present, the
 * mirror wins for `direct_deposit` because it considers Everee's
 * `availablePaymentMethods.directDeposit` flag — bank-account-verified
 * alone isn't enough (e.g. a worker with a verified bank but Everee hasn't
 * enabled DD yet for some other reason).
 *
 * Runtime-neutral: no firebase imports. The functions-side
 * `EvereeReadinessMirror` interface (timestamp fields typed as
 * `Timestamp | null`) is structurally a superset of
 * `EvereeReadinessMirrorLike` below — callers in `functions/` can pass it
 * directly, while tests can construct plain JS objects with `null` /
 * `Date` / `Timestamp` placeholders for the date fields (the translator
 * only checks `!= null`).
 *
 * Per-entity applicability comes from the mirror itself
 * (`i9Applicable` / `w4Applicable` / `w9Applicable`) — the translator
 * does NOT hard-code worker-type → item mappings. The applicability
 * flags are stamped by `computeEvereeReadinessMirror` based on Everee's
 * `employmentType` (W-2 vs CONTRACTOR), which is the authoritative
 * per-tenant policy.
 *
 * Status enum convention (matches `EmployeeReadinessItemStatus` in
 * `employeeReadinessItemV1.ts` §6e):
 *   - `complete_pass` — satisfied with a positive verdict.
 *   - `incomplete` — applies, not yet started/done.
 *   - `in_progress` — submitted, waiting on vendor result.
 *   - `not_applicable` — doesn't apply for this (worker × entity).
 *   - `blocked` — terminal-failed; needs manual intervention (TIN MISMATCH).
 *   - `needs_review` — vendor returned a signal needing CSA adjudication.
 *
 * @see functions/src/integrations/everee/evereeReadinessMirror.ts (snapshot writer)
 * @see functions/src/readiness/onEvereeWorkerWriteUpdateReadiness.ts (consumer trigger)
 * @see shared/readinessStatusFromEveree.ts (legacy translator — still used for `everee_profile`)
 */

import type {
  EmployeeReadinessItemStatus,
  EmployeeReadinessRequirementType,
} from './employeeReadinessItemV1';

/** Everee's TIN-verification states. Mirrors `EvereeTinVerificationStatus`. */
export type EvereeMirrorTinStatus =
  | 'NEEDS_VERIFICATION'
  | 'SENT_FOR_VERIFICATION'
  | 'VERIFIED'
  | 'MISMATCH';

/**
 * Runtime-neutral subset of `EvereeReadinessMirror` the translator reads.
 *
 * Date fields use `unknown | null` so callers can pass `Timestamp | null`
 * (functions side), `Date | null` (tests), or `string | null` (rare
 * direct-from-API path) — the translator only checks `!= null`.
 *
 * `tinVerificationStatus` is widened to `string` to absorb any future
 * Everee value Everee adds without breaking the translator. Unknown
 * values fall through the `default` branch in `mapTinVerificationStatus`.
 */
export interface EvereeReadinessMirrorLike {
  // ── Direct deposit ──
  directDepositReady: boolean;

  // ── I-9 (W-2 only) ──
  i9SignedAt: unknown | null;
  i9Applicable: boolean;

  // ── W-4 (W-2 only) ──
  w4SignedAt: unknown | null;
  w4Applicable: boolean;

  // ── W-9 (1099 only) ──
  w9SignedAt: unknown | null;
  w9Applicable: boolean;

  // ── Handbook + policies ──
  handbookSignedAt: unknown | null;
  policiesSignedCount: number;

  // ── TIN ──
  tinVerificationStatus: EvereeMirrorTinStatus | string | null;
}

// ─────────────────────────────────────────────────────────────────────────
// Per-item mappers. One pure function each — easy to test.
// ─────────────────────────────────────────────────────────────────────────

/**
 * `direct_deposit` — `complete_pass` iff Everee says the worker has a
 * bank account AND `availablePaymentMethods.directDeposit === true`.
 * Otherwise `incomplete`. This item is always applicable (Everee runs
 * payroll for both W-2 and 1099 workers).
 */
export function mapDirectDepositStatus(
  mirror: EvereeReadinessMirrorLike,
): EmployeeReadinessItemStatus {
  return mirror.directDepositReady ? 'complete_pass' : 'incomplete';
}

/**
 * `i9_section_1` — worker portion of I-9. Applicable for W-2 only;
 * 1099 contractors don't sign I-9 (they sign W-9 instead).
 */
export function mapI9WorkerStatus(
  mirror: EvereeReadinessMirrorLike,
): EmployeeReadinessItemStatus {
  if (!mirror.i9Applicable) return 'not_applicable';
  return mirror.i9SignedAt != null ? 'complete_pass' : 'incomplete';
}

/**
 * `tax_w4` — federal income tax withholding form. Applicable for W-2
 * only; 1099 contractors skip W-4 (income tax is self-reported).
 */
export function mapW4Status(
  mirror: EvereeReadinessMirrorLike,
): EmployeeReadinessItemStatus {
  if (!mirror.w4Applicable) return 'not_applicable';
  return mirror.w4SignedAt != null ? 'complete_pass' : 'incomplete';
}

/**
 * `tax_w9` — request for taxpayer identification number. Applicable
 * for 1099 contractors only; W-2 employees use I-9 + W-4 instead.
 */
export function mapW9Status(
  mirror: EvereeReadinessMirrorLike,
): EmployeeReadinessItemStatus {
  if (!mirror.w9Applicable) return 'not_applicable';
  return mirror.w9SignedAt != null ? 'complete_pass' : 'incomplete';
}

/**
 * `handbook_acknowledgement` — worker has signed the company handbook.
 * Always applicable (Everee delivers the handbook to every worker).
 */
export function mapHandbookStatus(
  mirror: EvereeReadinessMirrorLike,
): EmployeeReadinessItemStatus {
  return mirror.handbookSignedAt != null ? 'complete_pass' : 'incomplete';
}

/**
 * `policy_acknowledgement` — worker has signed at least one company
 * policy doc (separate from the handbook). For now, threshold is "any
 * policy signed = complete." A configurable per-tenant
 * "required-policy-count" threshold is a future enhancement (see E.3
 * spec "Out of scope").
 */
export function mapPoliciesStatus(
  mirror: EvereeReadinessMirrorLike,
): EmployeeReadinessItemStatus {
  return mirror.policiesSignedCount > 0 ? 'complete_pass' : 'incomplete';
}

/**
 * `tin_verification` — IRS TIN / SSN verification. Maps Everee's 4-state
 * machine to the readiness enum. `MISMATCH` is a hard-block: the IRS
 * rejected the SSN, payroll can't run, and a CSA must intervene to
 * resolve. `null` (Everee hasn't reported a TIN status yet) maps to
 * `incomplete` rather than `not_applicable` — every Everee-provisioned
 * worker is expected to eventually carry a TIN status.
 */
export function mapTinVerificationStatus(
  mirror: EvereeReadinessMirrorLike,
): EmployeeReadinessItemStatus {
  switch (mirror.tinVerificationStatus) {
    case 'VERIFIED':
      return 'complete_pass';
    case 'SENT_FOR_VERIFICATION':
      return 'in_progress';
    case 'NEEDS_VERIFICATION':
      return 'incomplete';
    case 'MISMATCH':
      return 'blocked';
    default:
      return 'incomplete';
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Aggregate — returns a map from requirement type to status for every
// Everee-owned readiness item. Unused items by the caller are simply
// ignored. Caller dispatches the map to `updateReadinessItemStatus` per
// entry (or skips entries when the existing item carries the same status).
// ─────────────────────────────────────────────────────────────────────────

/** Item types the Everee mirror is the source of truth for. */
export const EVEREE_MIRROR_OWNED_ITEM_TYPES: ReadonlyArray<EmployeeReadinessRequirementType> = [
  'direct_deposit',
  'i9_section_1',
  'tax_w4',
  'tax_w9',
  'handbook_acknowledgement',
  'policy_acknowledgement',
  'tin_verification',
];

/**
 * Translate the snapshot to the per-item status map. Returns one entry
 * for every type in `EVEREE_MIRROR_OWNED_ITEM_TYPES`. The caller decides
 * which to apply (typically: dispatch all of them and let
 * `updateReadinessItemStatus` no-op on items that don't exist or that
 * already carry the same status).
 */
export function evereeMirrorToReadinessStatuses(
  mirror: EvereeReadinessMirrorLike,
): Record<
  Extract<
    EmployeeReadinessRequirementType,
    | 'direct_deposit'
    | 'i9_section_1'
    | 'tax_w4'
    | 'tax_w9'
    | 'handbook_acknowledgement'
    | 'policy_acknowledgement'
    | 'tin_verification'
  >,
  EmployeeReadinessItemStatus
> {
  return {
    direct_deposit: mapDirectDepositStatus(mirror),
    i9_section_1: mapI9WorkerStatus(mirror),
    tax_w4: mapW4Status(mirror),
    tax_w9: mapW9Status(mirror),
    handbook_acknowledgement: mapHandbookStatus(mirror),
    policy_acknowledgement: mapPoliciesStatus(mirror),
    tin_verification: mapTinVerificationStatus(mirror),
  };
}
