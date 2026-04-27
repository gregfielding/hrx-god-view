/**
 * Auto-add apply wizard users to tenant user groups from job posting config and/or signup group link.
 * Used after step 0 (account + personal save) and on final submit; addUsersToGroups uses arrayUnion (idempotent).
 */

import { collection, getDocs, limit, query, where } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { db } from '../firebase';

export type ApplyPostingGroupSource = {
  autoAddToUserGroups?: string[];
  autoAddToUserGroup?: string;
  jobOrderId?: string;
} | null | undefined;

function collectGroupIdsFromPosting(posting: ApplyPostingGroupSource): string[] {
  const out: string[] = [];
  if (posting?.autoAddToUserGroups && Array.isArray(posting.autoAddToUserGroups) && posting.autoAddToUserGroups.length > 0) {
    out.push(...posting.autoAddToUserGroups);
  } else if (posting?.autoAddToUserGroup && typeof posting.autoAddToUserGroup === 'string' && posting.autoAddToUserGroup.trim()) {
    out.push(posting.autoAddToUserGroup.trim());
  }
  return out;
}

/**
 * Resolves group IDs (signup link + posting + optional Firestore fallback by jobOrderId).
 */
export async function resolveApplyWizardAutoGroupIds(params: {
  tenantId: string;
  posting: ApplyPostingGroupSource;
  signupGroupId?: string | null;
}): Promise<string[]> {
  const { tenantId, posting, signupGroupId } = params;
  const groupIdsToAdd: string[] = [];
  if (signupGroupId && String(signupGroupId).trim()) {
    groupIdsToAdd.push(String(signupGroupId).trim());
  }
  groupIdsToAdd.push(...collectGroupIdsFromPosting(posting));

  if (groupIdsToAdd.length === 0) {
    try {
      const paramsSearch =
        typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
      const jobOrderIdOverride = paramsSearch?.get('jobOrderId')?.trim() || '';
      const joid =
        jobOrderIdOverride ||
        (posting?.jobOrderId && String(posting.jobOrderId).trim()) ||
        '';
      if (joid && tenantId) {
        const q = query(
          collection(db, 'tenants', tenantId, 'job_postings'),
          where('jobOrderId', '==', joid),
          limit(1)
        );
        const qsnap = await getDocs(q);
        if (!qsnap.empty) {
          const p = qsnap.docs[0].data() as ApplyPostingGroupSource;
          groupIdsToAdd.push(...collectGroupIdsFromPosting(p));
        }
      }
    } catch {
      // ignore fallback errors
    }
  }

  return [...new Set(groupIdsToAdd.map((id) => String(id).trim()).filter(Boolean))];
}

export async function autoAddUserToApplyConfiguredGroups(params: {
  userId: string;
  tenantId: string;
  posting: ApplyPostingGroupSource;
  signupGroupId?: string | null;
}): Promise<void> {
  const { userId, tenantId, posting, signupGroupId } = params;
  if (!userId || !tenantId) return;

  const groupIds = await resolveApplyWizardAutoGroupIds({ tenantId, posting, signupGroupId });
  if (groupIds.length === 0) return;

  const functions = getFunctions();
  const addUsersToGroups = httpsCallable(functions as any, 'addUsersToGroups');
  await addUsersToGroups({ userId, groupIds, tenantId });
}
