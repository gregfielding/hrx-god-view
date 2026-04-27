/**
 * **R.3** — runtime-neutral types & constants for the generalized CSA
 * readiness-item action callables. **Mirror of `shared/csaReadinessActionTypes.ts`**
 * — CRA forbids imports outside `src/`, so the canonical shape lives at the
 * repo root for the Cloud Functions / scripts side and is duplicated here
 * verbatim for the client. Keep the two in lockstep — diverging the
 * excluded-type list silently breaks R.5 / R.6 routing.
 *
 * @see ../../shared/csaReadinessActionTypes.ts (canonical, server side)
 * @see docs/READINESS_R3_HANDOFF.md
 */

export type CsaReadinessItemCollection = 'assignment' | 'employee';

export type CsaReadinessActionKind = 'csa_confirm' | 'csa_waive' | 'csa_mark_failed';

export type CsaReadinessResolutionMethod = 'csa_confirmed' | 'csa_waived';

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
