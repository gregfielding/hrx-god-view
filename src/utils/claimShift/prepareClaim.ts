/**
 * `respondToAssignment` decision `claim_prepare` (step 5, 2026-09-11): runs the
 * payroll-readiness gate for a claim-enabled posting and books nothing. Starts
 * C1 Events onboarding for a worker never hired there and confirms a
 * finished-in-Everee worker live. Refusals (not hired / ended) throw the same
 * typed errors as a claim — see formatClaimShiftError.
 */
import { httpsCallable } from 'firebase/functions';

import { functions } from '../../firebase';

export interface ClaimPrepareResult {
  success: boolean;
  ready: boolean;
  stage: 'ready' | 'started' | 'in_progress';
  entityId: string | null;
}

export async function prepareClaim(args: {
  tenantId: string;
  jobOrderId: string;
  jobPostId?: string | null;
}): Promise<ClaimPrepareResult> {
  const fn = httpsCallable(functions, 'respondToAssignment');
  const res = await fn({
    tenantId: args.tenantId,
    decision: 'claim_prepare',
    jobOrderId: args.jobOrderId,
    jobPostId: args.jobPostId ?? null,
  });
  return res.data as ClaimPrepareResult;
}
