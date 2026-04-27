/**
 * **R.3** — runtime-neutral types & constants for the generalized CSA
 * readiness-item action callables.
 *
 * Lives in `shared/` so both the Cloud Functions backend (which adds
 * Firestore-Timestamp-bearing variants on top) and the React frontend (which
 * needs the excluded-type list + the kind / resolutionMethod unions for
 * UI gating) can import the same source of truth. No firebase imports — the
 * server-side file (`functions/src/readiness/csaActions/csaActionTypes.ts`)
 * extends this with `admin.firestore.Timestamp` typing for the audit entry.
 *
 * @see docs/READINESS_R3_HANDOFF.md
 */

/** Which readiness-item collection the action targets. */
export type CsaReadinessItemCollection = 'assignment' | 'employee';

/** Identifies the CSA action that produced a history entry. */
export type CsaReadinessActionKind = 'csa_confirm' | 'csa_waive' | 'csa_mark_failed';

/**
 * R.1 `resolutionMethod` slice that R.3 callables can stamp. Other values
 * (`auto`, `external`, `self_attest`, `null`) are produced by the matchers /
 * worker / vendor flows and never written by these callables.
 */
export type CsaReadinessResolutionMethod = 'csa_confirmed' | 'csa_waived';

/**
 * Requirement types that R.3 callables refuse to act on. Each routes
 * through a dedicated callable instead — see the server-side type file
 * for the routing hints surfaced in error messages.
 */
export const CSA_READINESS_ACTION_EXCLUDED_TYPES = [
  'e_verify',
  'background_check',
  'drug_screen',
  'screening_package_match',
] as const;

export type CsaReadinessActionExcludedType =
  (typeof CSA_READINESS_ACTION_EXCLUDED_TYPES)[number];

export function isCsaReadinessActionExcludedType(t: string): t is CsaReadinessActionExcludedType {
  return (CSA_READINESS_ACTION_EXCLUDED_TYPES as readonly string[]).includes(t);
}

/** Common input shape across the three callables. */
export interface CsaReadinessActionInput {
  tenantId: string;
  itemId: string;
  collection: CsaReadinessItemCollection;
  /** Mandatory for waive / markFailed; optional for confirm. */
  note?: string | null;
}

export interface CsaReadinessActionResult {
  ok: true;
  /** True when the item already matched target state + note — no write fired. */
  unchanged: boolean;
  collection: CsaReadinessItemCollection;
  itemId: string;
  status: string;
  resolutionMethod: CsaReadinessResolutionMethod;
}

/**
 * Runtime-neutral form of `CsaReadinessHistoryEntry` — the server-side type
 * upgrades `at` to a real Firestore `Timestamp`. UI consumers receive an
 * `unknown` shape (Firestore web-SDK Timestamps; conversion handled by
 * callers). Kept generic to avoid coupling `shared/` to the Firebase SDK.
 */
export interface CsaReadinessHistoryEntryShape {
  at: unknown;
  kind: CsaReadinessActionKind;
  fromStatus: string;
  toStatus: string;
  by: string;
  reason: string | null;
}

export interface CsaReadinessActionsFieldShape {
  history: CsaReadinessHistoryEntryShape[];
}
