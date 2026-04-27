/**
 * Client-side re-export. Canonical shape lives at `shared/csaReadinessActionTypes.ts`
 * (root, used by Cloud Functions); CRA can't import outside `src/`, so the
 * mirror at `src/shared/csaReadinessActionTypes.ts` is the in-tree source.
 * Keep both in lockstep — see the file-header note in the mirror.
 */

export type {
  CsaReadinessItemCollection,
  CsaReadinessActionKind,
  CsaReadinessResolutionMethod,
  CsaReadinessActionInput,
  CsaReadinessActionResult,
  CsaReadinessActionExcludedType,
  CsaReadinessHistoryEntryShape,
  CsaReadinessActionsFieldShape,
} from '../shared/csaReadinessActionTypes';

export {
  CSA_READINESS_ACTION_EXCLUDED_TYPES,
  isCsaReadinessActionExcludedType,
} from '../shared/csaReadinessActionTypes';
