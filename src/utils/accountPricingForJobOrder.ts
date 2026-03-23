/**
 * Resolve account Pricing tab positions for gig job orders:
 * standalone / national → that account's positions;
 * child → child's positions if any, else parent's (national) positions;
 * if none, caller falls back to O*NET / free entry.
 */

import { collection, doc, getDoc, getDocs, limit, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { p } from '../data/firestorePaths';
import type { AccountPositionPricing } from '../types/recruiter/account';

export function extractAccountPricingPositions(data: any): AccountPositionPricing[] {
  const raw = data?.pricing?.positions;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((row: any) => row && String(row.jobTitle || '').trim())
    .map((row: any) => ({
      ...row,
      jobTitle: String(row.jobTitle).trim(),
    }));
}

/** First recruiter account that lists this CRM company. */
export async function findRecruiterAccountIdByCompanyId(
  tenantId: string,
  companyId: string | null | undefined
): Promise<string | null> {
  if (!tenantId || !companyId) return null;
  try {
    const q = query(
      collection(db, p.recruiterAccounts(tenantId)),
      where('associations.companyIds', 'array-contains', companyId),
      limit(1)
    );
    const snap = await getDocs(q);
    return snap.empty ? null : snap.docs[0].id;
  } catch {
    return null;
  }
}

/**
 * Child account: use local pricing.positions if non-empty; else national parent.
 * Standalone / national: use local only.
 */
export async function fetchResolvedAccountPricingPositions(
  tenantId: string,
  opts: { recruiterAccountId?: string | null; companyId?: string | null }
): Promise<AccountPositionPricing[]> {
  if (!tenantId) return [];

  let accountId = (opts.recruiterAccountId || '').trim() || null;
  if (!accountId && opts.companyId) {
    accountId = await findRecruiterAccountIdByCompanyId(tenantId, opts.companyId);
  }
  if (!accountId) return [];

  const accRef = doc(db, p.recruiterAccounts(tenantId), accountId);
  const accSnap = await getDoc(accRef);
  if (!accSnap.exists()) return [];

  const d = accSnap.data() as any;
  const rawType = d.accountType;
  const accountType =
    rawType === 'national' || rawType === 'child' || rawType === 'standalone'
      ? rawType
      : d.parentAccountId
        ? 'child'
        : Array.isArray(d.childAccountIds) && d.childAccountIds.length > 0
          ? 'national'
          : 'standalone';

  const local = extractAccountPricingPositions(d);
  if (local.length > 0) return local;

  if (accountType === 'child' && d.parentAccountId) {
    const parentRef = doc(db, p.recruiterAccounts(tenantId), d.parentAccountId);
    const parentSnap = await getDoc(parentRef);
    if (parentSnap.exists()) {
      const parentPos = extractAccountPricingPositions(parentSnap.data());
      if (parentPos.length > 0) return parentPos;
    }
  }

  return [];
}

/** Map job title (trimmed) → first matching row (for Autocomplete fill). */
export function buildPricingByJobTitle(positions: AccountPositionPricing[]): Map<string, AccountPositionPricing> {
  const map = new Map<string, AccountPositionPricing>();
  for (const row of positions) {
    const key = String(row.jobTitle || '').trim();
    if (!key) continue;
    if (!map.has(key)) map.set(key, row);
  }
  return map;
}
