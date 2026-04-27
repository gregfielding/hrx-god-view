/**
 * **R.3** — server-side types for the generalized CSA readiness-item
 * action callables. Extends the runtime-neutral types in
 * `shared/csaReadinessActionTypes.ts` with the Firestore Timestamp typing
 * needed on the server (the shared file keeps the timestamp loose so the
 * React client doesn't have to import firebase-admin).
 *
 * The audit-history shape mirrors the AccuSource `adjudication.history[]`
 * pattern so consumers (Readiness tab UI, future popover deep-links, audit
 * scripts) can render both vendor-driven and CSA-driven action trails the
 * same way.
 *
 * @see shared/csaReadinessActionTypes.ts (runtime-neutral source of truth)
 * @see functions/src/integrations/accusource/accusourceAdjudication.ts (parallel pattern)
 * @see docs/READINESS_R3_HANDOFF.md
 */

import * as admin from 'firebase-admin';

export {
  CSA_READINESS_ACTION_EXCLUDED_TYPES,
  isCsaReadinessActionExcludedType,
} from '../../shared/csaReadinessActionTypes';
export type {
  CsaReadinessItemCollection,
  CsaReadinessActionKind,
  CsaReadinessResolutionMethod,
  CsaReadinessActionInput,
  CsaReadinessActionResult,
  CsaReadinessActionExcludedType,
} from '../../shared/csaReadinessActionTypes';
import type {
  CsaReadinessActionKind as ActionKind,
} from '../../shared/csaReadinessActionTypes';

/**
 * Server-side history entry — `at` upgraded to `admin.firestore.Timestamp`
 * (the runtime-neutral shape uses `unknown` so React clients can stay
 * SDK-agnostic).
 */
export interface CsaReadinessHistoryEntry {
  at: admin.firestore.Timestamp;
  kind: ActionKind;
  fromStatus: string;
  toStatus: string;
  by: string;
  reason: string | null;
}

/**
 * Persisted at `tenants/{tid}/(assignment|employee)ReadinessItems/{itemId}.csaActions`
 * — a parallel field to AccuSource's `adjudication`. Only populated once a
 * CSA has acted on the item; absence means the item has only been touched
 * by automated paths.
 */
export interface CsaReadinessActionsField {
  history: CsaReadinessHistoryEntry[];
}
