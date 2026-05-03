/**
 * Merge recruiter account order defaults: national (parent) → child account → optional location_defaults.
 * Same rules as Account Order Details UI so job orders inherit unless overridden locally.
 *
 * Per-position rows (`pricing.positions[].orderDetails`) overlay after account + location merge when
 * `jobTitle` is passed (new job orders — matches selected title).
 */

import { doc, getDoc } from 'firebase/firestore';

import { db } from '../firebase';
import { p } from '../data/firestorePaths';
import type { AccountPositionPricing } from '../types/recruiter/account';
import type { RecruiterAccount } from '../types/recruiter/account';
import {
  extractAccountPricingPositions,
  mergeParentAndChildPricingPositions,
} from './accountPricingForJobOrder';
import {
  mergeRecruiterOrderDetails,
  type RecruiterOrderDetailsData,
} from './recruiterOrderDetailsMergePure';

export type { RecruiterOrderDetailsData };
export { mergeRecruiterOrderDetails, EMPTY_RECRUITER_ORDER_DETAILS } from './recruiterOrderDetailsMergePure';

function trimStr(v: unknown): string {
  return String(v ?? '').trim();
}

/** `orderDefaults` object from an account, parent account, or location_defaults doc (Firestore-shaped). */
function readOrderDefaultsBlock(src: unknown): Record<string, unknown> | undefined {
  if (!src || typeof src !== 'object') return undefined;
  const od = (src as Record<string, unknown>).orderDefaults;
  if (!od || typeof od !== 'object') return undefined;
  return od as Record<string, unknown>;
}

/**
 * Merge screening package id/name: location overrides child overrides parent.
 */
export function mergeScreeningPackageFromOrderDefaultLayers(
  locationOd: Record<string, unknown> | undefined,
  childOd: Record<string, unknown> | undefined,
  parentOd: Record<string, unknown> | undefined,
): { id: string; name: string } {
  const childId = trimStr(childOd?.screeningPackageId);
  const parentId = trimStr(parentOd?.screeningPackageId);
  const childName = trimStr(childOd?.screeningPackageName);
  const parentName = trimStr(parentOd?.screeningPackageName);
  const mergedChildParent = {
    id: childId || parentId,
    name: childId ? childName : parentName,
  };
  const locId = trimStr(locationOd?.screeningPackageId);
  if (!locId) return mergedChildParent;
  return {
    id: locId,
    name: trimStr(locationOd?.screeningPackageName),
  };
}

function resolveEverifyRequired(child: RecruiterAccount | null, parent: RecruiterAccount | null): boolean {
  const c = child?.defaults?.eVerify?.eVerifyRequired;
  if (c !== undefined && c !== null) return Boolean(c);
  const p = parent?.defaults?.eVerify?.eVerifyRequired;
  if (p !== undefined && p !== null) return Boolean(p);
  if (child?.eVerifyRequired !== undefined && child?.eVerifyRequired !== null) return Boolean(child.eVerifyRequired);
  if (parent?.eVerifyRequired !== undefined && parent?.eVerifyRequired !== null) return Boolean(parent.eVerifyRequired);
  return false;
}

function inferParentId(accountData: unknown): string | null {
  if (!accountData || typeof accountData !== 'object') return null;
  const d = accountData as Record<string, unknown>;
  const rawType = d.accountType;
  const accountType =
    rawType === 'national' || rawType === 'child' || rawType === 'standalone'
      ? rawType
      : d.parentAccountId
        ? 'child'
        : Array.isArray(d.childAccountIds) && d.childAccountIds.length > 0
          ? 'national'
          : 'standalone';
  const pid = d.parentAccountId;
  if (accountType === 'child' && typeof pid === 'string' && pid.trim()) return pid.trim();
  return null;
}

/** Resolved pricing positions (national + child venue merge when applicable). Same rules as job-order title picker. */
function mergedPricingPositionsForAccount(
  raw: Record<string, unknown>,
  parent: RecruiterAccount | null,
): AccountPositionPricing[] {
  const localPos = extractAccountPricingPositions(raw);
  if (!parent) return localPos;

  const parentPos = extractAccountPricingPositions(parent);
  if (parentPos.length > 0 && localPos.length > 0) {
    return mergeParentAndChildPricingPositions(parentPos, localPos);
  }
  if (parentPos.length > 0) return parentPos;
  return localPos;
}

export interface MergedRecruiterOrderDefaultsForJobOrder {
  orderDetails: RecruiterOrderDetailsData;
  screeningPackageId: string;
  screeningPackageName: string;
  eVerifyRequired: boolean;
}

/**
 * Loads child (selected) recruiter account, optional national parent, optional location_defaults doc.
 *
 * @param opts.jobTitle When set (e.g. career `jobTitle` or gig primary position title), overlays
 *          matching `pricing.positions[]` row `orderDetails` / screening package on top of merged account defaults.
 */
export async function fetchMergedRecruiterOrderDefaultsForJobOrder(
  tenantId: string,
  opts: {
    recruiterAccountId: string;
    companyId?: string | null;
    worksiteId?: string | null;
    /** Match `pricing.positions[].jobTitle` (case-insensitive trim) for per-position compliance. */
    jobTitle?: string | null;
  },
): Promise<MergedRecruiterOrderDefaultsForJobOrder | null> {
  const rid = String(opts.recruiterAccountId || '').trim();
  if (!tenantId || !rid) return null;

  const accRef = doc(db, p.recruiterAccounts(tenantId), rid);
  const accSnap = await getDoc(accRef);
  if (!accSnap.exists()) return null;

  const raw = accSnap.data() as Record<string, unknown>;
  const child = raw as unknown as RecruiterAccount;
  const parentId = inferParentId(raw);

  let parent: RecruiterAccount | null = null;
  if (parentId) {
    const pSnap = await getDoc(doc(db, p.recruiterAccounts(tenantId), parentId));
    if (pSnap.exists()) parent = pSnap.data() as unknown as RecruiterAccount;
  }

  const childDetails = readOrderDefaultsBlock(raw)?.orderDetails as RecruiterOrderDetailsData | undefined;
  const parentDetails = parent
    ? (readOrderDefaultsBlock(parent)?.orderDetails as RecruiterOrderDetailsData | undefined)
    : undefined;

  const nationalPlusChild = mergeRecruiterOrderDetails(childDetails, parentDetails);

  let locationOd: Record<string, unknown> | undefined;
  const cid = String(opts.companyId || '').trim();
  const wid = String(opts.worksiteId || '').trim();
  if (cid && wid) {
    const locationKey = `${cid}_${wid}`.replace(/\//g, '_');
    const locRef = doc(db, p.recruiterAccountLocationDefaults(tenantId, rid, locationKey));
    const locSnap = await getDoc(locRef);
    if (locSnap.exists()) {
      locationOd = readOrderDefaultsBlock(locSnap.data());
    }
  }

  const locDetails = locationOd?.orderDetails as RecruiterOrderDetailsData | undefined;
  let orderDetails = mergeRecruiterOrderDetails(locDetails, nationalPlusChild);

  const childOd = readOrderDefaultsBlock(raw);
  const parentOd = parent ? readOrderDefaultsBlock(parent) : undefined;
  let screeningPkg = mergeScreeningPackageFromOrderDefaultLayers(locationOd, childOd, parentOd);

  const jt = String(opts.jobTitle || '').trim();
  if (jt) {
    const mergedPositions = mergedPricingPositionsForAccount(raw, parent);
    const norm = (t: string) => t.trim().toLowerCase();
    const pos = mergedPositions.find((p) => norm(p.jobTitle) === norm(jt));
    if (pos?.orderDetails && typeof pos.orderDetails === 'object') {
      orderDetails = mergeRecruiterOrderDetails(
        pos.orderDetails as RecruiterOrderDetailsData,
        orderDetails,
      );
    }
    const pid = trimStr(pos?.screeningPackageId);
    if (pid) {
      screeningPkg = {
        id: pid,
        name: trimStr(pos?.screeningPackageName),
      };
    }
  }

  return {
    orderDetails,
    screeningPackageId: screeningPkg.id,
    screeningPackageName: screeningPkg.name,
    eVerifyRequired: resolveEverifyRequired(child, parent),
  };
}
