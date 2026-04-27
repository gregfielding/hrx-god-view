/**
 * **R.3** — barrel export for the generalized CSA readiness-item action
 * callables. Wired into `functions/src/index.ts` for deploy.
 *
 * @see docs/READINESS_R3_HANDOFF.md
 */

export { confirmReadinessItem } from './confirmReadinessItem';
export { waiveReadinessItem } from './waiveReadinessItem';
export { markReadinessItemFailed } from './markReadinessItemFailed';
export { applyCsaReadinessAction } from './applyCsaReadinessAction';
export { ensureReadinessCsaAdmin } from './ensureReadinessCsaAdmin';
export {
  CSA_READINESS_ACTION_EXCLUDED_TYPES,
  isCsaReadinessActionExcludedType,
} from './csaActionTypes';
export type {
  CsaReadinessActionInput,
  CsaReadinessActionResult,
  CsaReadinessActionKind,
  CsaReadinessActionsField,
  CsaReadinessHistoryEntry,
  CsaReadinessItemCollection,
  CsaReadinessResolutionMethod,
  CsaReadinessActionExcludedType,
} from './csaActionTypes';
