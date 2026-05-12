/**
 * Typed httpsCallable wrapper for the `adminCreateWorker` callable.
 *
 * Backend source: `functions/src/auth/adminCreateWorker.ts`. Used by
 * the "Create Worker on Behalf" wizard
 * (`src/components/users/AddWorkerManuallyWizard.tsx`) to create a
 * Firebase Auth account + `users/{uid}` doc + tenant claims +
 * (optional) entity_employments for a worker who can't self-signup.
 *
 * Permission gate is enforced server-side (mirrors `canManageEveree`).
 */

import { httpsCallable } from 'firebase/functions';
import { functions } from '../../firebase';

export type AdminCreateWorkerSecurityLevel = '1' | '2' | '3' | '4' | '5' | '6' | '7';
export type AdminCreateWorkerRole = 'Tenant' | 'HRX';
export type AdminCreateWorkerWorkerType = 'w2' | '1099' | 'entity_default';
export type AdminCreateWorkerPasswordMode = 'generate' | 'recruiter';
export type AdminCreateWorkerMergeMode = 'fail' | 'fill_missing_only' | 'overwrite_provided';

export interface AdminCreateWorkerAddress {
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state: string;
  postalCode: string;
  country?: string;
}

export interface AdminCreateWorkerRequest {
  tenantId: string;

  email: string;
  firstName: string;
  lastName: string;

  phone?: string;
  /** ISO `YYYY-MM-DD` */
  dateOfBirth?: string;
  preferredLanguage?: 'en' | 'es';

  address?: AdminCreateWorkerAddress;

  /** Required when `passwordMode === 'recruiter'`. */
  password?: string;
  passwordMode?: AdminCreateWorkerPasswordMode;

  role?: AdminCreateWorkerRole;
  securityLevel?: AdminCreateWorkerSecurityLevel;

  /** Optional: hire to entity in the same call (writes entity_employments). */
  entityId?: string;
  workerType?: AdminCreateWorkerWorkerType;

  /** How to handle a pre-existing user with this email. Default 'fail'. */
  mergeMode?: AdminCreateWorkerMergeMode;
}

export interface AdminCreateWorkerSummary {
  displayName: string;
  email: string;
  phoneE164: string | null;
  tenantRoleApplied: { role: string; securityLevel: string };
  entityHired: { entityId: string; entityName: string } | null;
}

export interface AdminCreateWorkerResult {
  ok: boolean;
  uid: string;
  alreadyExists: boolean;
  /** Returned only when `passwordMode === 'generate'` AND the auth user was newly created. */
  generatedPassword?: string;
  userDocWritten: boolean;
  claimsWritten: boolean;
  pipelineId?: string;
  evereeProvisionWarning?: string | null;
  preMergeProfile?: Record<string, unknown> | null;
  summary: AdminCreateWorkerSummary;
}

/** Calls the `adminCreateWorker` Cloud Function. */
export async function adminCreateWorkerCallable(
  request: AdminCreateWorkerRequest,
): Promise<{ data: AdminCreateWorkerResult }> {
  const callable = httpsCallable<AdminCreateWorkerRequest, AdminCreateWorkerResult>(
    functions,
    'adminCreateWorker',
  );
  const result = await callable(request);
  return { data: result.data };
}
