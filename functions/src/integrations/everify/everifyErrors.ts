/**
 * E-Verify normalized error codes.
 * HRX E-Verify Master Plan §3.5
 */

export const EverifyErrorCode = {
  INVALID_INPUT: 'EVERIFY_INVALID_INPUT',
  NOT_ELIGIBLE: 'EVERIFY_NOT_ELIGIBLE',
  ENTITY_NOT_FOUND: 'EVERIFY_ENTITY_NOT_FOUND',
  ENTITY_EVERIFY_DISABLED: 'EVERIFY_ENTITY_EVERIFY_DISABLED',
  ASSIGNMENT_NOT_FOUND: 'EVERIFY_ASSIGNMENT_NOT_FOUND',
  USER_EMPLOYMENT_NOT_FOUND: 'EVERIFY_USER_EMPLOYMENT_NOT_FOUND',
  I9_NOT_COMPLETED: 'EVERIFY_I9_NOT_COMPLETED',
  NOT_W2: 'EVERIFY_NOT_W2',
  OUTSIDE_WINDOW: 'EVERIFY_OUTSIDE_WINDOW',
  DUPLICATE_CASE: 'EVERIFY_DUPLICATE_CASE',
  PROVIDER_ERROR: 'EVERIFY_PROVIDER_ERROR',
  UNAUTHORIZED: 'EVERIFY_UNAUTHORIZED',
} as const;

export type EverifyErrorCode = (typeof EverifyErrorCode)[keyof typeof EverifyErrorCode];

/** In-flight statuses — duplicate-by-employment uses this same set. */
export const OPEN_EVERIFY_CASE_STATUSES = [
  'draft',
  'ready',
  'submitted',
  'pending',
  'tnc',
  'dhs_verification_in_process',
  'further_action_required',
] as const;

/**
 * `requestHash` idempotency: block only if the existing row is still active or already succeeded.
 * Rows in `error` / `closed` / `final_nonconfirmation` do not block — allows retry after a failed run.
 */
export function requestHashCollisionBlocksCreate(existingStatus: unknown): boolean {
  const s = typeof existingStatus === 'string' ? existingStatus : '';
  if (!s) return true;
  if (s === 'employment_authorized') return true;
  return (OPEN_EVERIFY_CASE_STATUSES as readonly string[]).includes(s);
}
