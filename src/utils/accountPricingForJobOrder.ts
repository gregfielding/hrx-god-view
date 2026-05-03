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
import type { RecruiterOrderDetailsData } from './recruiterOrderDetailsMergePure';

/** Lazy require — avoids rare dev/HMR cases where a top-level named import is not a function yet. */
function mergeOrderDetailsForPricingRow(
  childRowOd: RecruiterOrderDetailsData | undefined,
  nationalOd: RecruiterOrderDetailsData | undefined,
): RecruiterOrderDetailsData | undefined {
  const hasNat = nationalOd != null && typeof nationalOd === 'object';
  const hasChild = childRowOd != null && typeof childRowOd === 'object';
  if (!hasNat && !hasChild) return undefined;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { mergeRecruiterOrderDetails } = require('./recruiterOrderDetailsMergePure') as {
    mergeRecruiterOrderDetails: (
      c: RecruiterOrderDetailsData | undefined,
      n: RecruiterOrderDetailsData | undefined,
    ) => RecruiterOrderDetailsData;
  };
  return mergeRecruiterOrderDetails(childRowOd, nationalOd);
}

export function extractAccountPricingPositions(data: any): AccountPositionPricing[] {
  const raw = data?.pricing?.positions;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((row: any) => row && String(row.jobTitle || '').trim())
    .map((row: any) => ({
      ...row,
      jobTitle: String(row.jobTitle).trim(),
      jobDescriptionFromClient:
        row.jobDescriptionFromClient != null && String(row.jobDescriptionFromClient).trim()
          ? String(row.jobDescriptionFromClient).trim()
          : undefined,
    }));
}

const normPricingTitle = (t: string) => String(t || '').trim().toLowerCase();

/** Treat blank WC codes like missing so national `{ workersCompCode: '' }` does not wipe stored child values. */
function emptyStringToUndefined(s: string | null | undefined): string | undefined {
  if (s == null) return undefined;
  const t = String(s).trim();
  return t === '' ? undefined : t;
}

/**
 * Merge one national template row with an optional child row (same title).
 * National drives job title + JD/uniform precedence; child owns venue economics (pay, WC, payroll taxes).
 * Important: parent snapshots may include `workersCompCode: ''` — without this, `{ ...nat, ...child }` keeps
 * national empty when the child doc omits the field, which cleared WC on children after national edits.
 */
export function mergeNationalTemplateWithChildVenueRow(
  nat: AccountPositionPricing,
  childRow: AccountPositionPricing | undefined,
): AccountPositionPricing {
  if (!childRow) {
    return { ...nat };
  }

  const jobDescriptionFromClient =
    nat.jobDescriptionFromClient ?? childRow.jobDescriptionFromClient ?? null;
  const uniformRequirements =
    nat.uniformRequirements ?? childRow.uniformRequirements ?? null;

  const hasNatOd = nat.orderDetails != null && typeof nat.orderDetails === 'object';
  const hasChildOd = childRow.orderDetails != null && typeof childRow.orderDetails === 'object';
  const mergedOrderDetails =
    hasNatOd || hasChildOd
      ? mergeOrderDetailsForPricingRow(
          childRow.orderDetails as RecruiterOrderDetailsData | undefined,
          nat.orderDetails as RecruiterOrderDetailsData | undefined,
        )
      : undefined;

  const natSp = nat.screeningPackageId != null ? String(nat.screeningPackageId).trim() : '';
  const childSp = childRow.screeningPackageId != null ? String(childRow.screeningPackageId).trim() : '';
  const screeningPackageId = childSp || natSp || undefined;
  const screeningPackageName = childSp
    ? childRow.screeningPackageName != null
      ? String(childRow.screeningPackageName)
      : ''
    : natSp
      ? nat.screeningPackageName != null
        ? String(nat.screeningPackageName)
        : ''
      : undefined;

  return {
    ...nat,
    ...childRow,
    jobTitle: nat.jobTitle,
    ...(mergedOrderDetails !== undefined ? { orderDetails: mergedOrderDetails } : {}),
    screeningPackageId,
    screeningPackageName,
    jobDescriptionFromClient,
    uniformRequirements,
    id: childRow.id ?? nat.id,
    payRate: childRow.payRate,
    billRate: childRow.billRate,
    markupPercent:
      childRow.markupPercent !== undefined ? childRow.markupPercent : nat.markupPercent,
    workersCompCode:
      emptyStringToUndefined(childRow.workersCompCode) ??
      emptyStringToUndefined(nat.workersCompCode),
    workersCompRate:
      childRow.workersCompRate !== undefined && childRow.workersCompRate !== null
        ? childRow.workersCompRate
        : nat.workersCompRate,
    sutaRate:
      childRow.sutaRate !== undefined && childRow.sutaRate !== null ? childRow.sutaRate : nat.sutaRate,
    futaRate:
      childRow.futaRate !== undefined && childRow.futaRate !== null ? childRow.futaRate : nat.futaRate,
  };
}

/**
 * Same merge semantics as Cascading Data → Default Positions on child accounts:
 * national templates first (title/description/uniform from parent unless child overrides text),
 * child rows overlay pay/bill/WC/taxes by matching job title; child-only titles appended after.
 */
export function mergeParentAndChildPricingPositions(
  parentPositions: AccountPositionPricing[],
  childPositions: AccountPositionPricing[],
): AccountPositionPricing[] {
  const childByTitle = new Map<string, AccountPositionPricing>();
  for (const r of childPositions) {
    const k = normPricingTitle(r.jobTitle);
    if (k) childByTitle.set(k, r);
  }
  const nationalKeys = new Set(
    parentPositions.map((p) => normPricingTitle(p.jobTitle)).filter(Boolean),
  );
  const out: AccountPositionPricing[] = [];

  for (const nat of parentPositions) {
    const k = normPricingTitle(nat.jobTitle);
    if (!k) continue;
    const childRow = childByTitle.get(k);
    out.push(mergeNationalTemplateWithChildVenueRow(nat, childRow));
  }

  for (const r of childPositions) {
    const k = normPricingTitle(r.jobTitle);
    if (k && !nationalKeys.has(k)) {
      out.push(r);
    }
  }
  return out;
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
 * Resolved positions for job-order UI (title picker, rate defaults):
 * - Standalone / national: `pricing.positions` on that account.
 * - Child: **merge** parent national templates with child `pricing.positions` by job title
 *   (same rules as Cascading Data on the account page). Child-only titles are included.
 *   If the child has no rows but the parent does, parent templates are used.
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

  if (accountType === 'child' && d.parentAccountId) {
    const parentRef = doc(db, p.recruiterAccounts(tenantId), d.parentAccountId);
    const parentSnap = await getDoc(parentRef);
    const parentPos = parentSnap.exists() ? extractAccountPricingPositions(parentSnap.data()) : [];

    if (parentPos.length > 0 && local.length > 0) {
      return mergeParentAndChildPricingPositions(parentPos, local);
    }
    if (parentPos.length > 0) return parentPos;
    return local;
  }

  return local;
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
