/**
 * Sprint 4 PR2: optional fields written onto application docs when soft-retiring
 * duplicates (nested under job_orders/.../applications or tenants/.../applications).
 *
 * Prefer leaving `status` unchanged; reads should honor retirement flags first.
 *
 * @see docs/APPLICATION_SPRINT4_EXECUTION.md
 */

export type ApplicationConsolidationRetirementFields = {
  mergedIntoApplicationId: string;
  consolidationRetiredAt: unknown;
  consolidationRetiredReason: string;
  consolidationBatchId: string;
};

/** String keys written to Firestore (for scripts / tooling). */
export const APPLICATION_CONSOLIDATION_RETIREMENT_FIELD_KEYS = {
  mergedIntoApplicationId: 'mergedIntoApplicationId',
  consolidationRetiredAt: 'consolidationRetiredAt',
  consolidationRetiredReason: 'consolidationRetiredReason',
  consolidationBatchId: 'consolidationBatchId',
} as const;
