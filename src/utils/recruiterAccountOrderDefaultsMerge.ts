/**
 * Merge recruiter account order defaults: national (parent) → child account → optional location_defaults.
 * Same rules as Account Order Details UI so job orders inherit unless overridden locally.
 */

import { doc, getDoc } from 'firebase/firestore';

import { db } from '../firebase';
import { p } from '../data/firestorePaths';
import type { RecruiterAccount } from '../types/recruiter/account';

export interface RecruiterOrderDetailsData {
  backgroundCheckPackages?: string[];
  drugScreeningPanels?: string[];
  additionalScreenings?: string[];
  licensesCerts?: string[];
  experienceRequired?: string;
  educationRequired?: string;
  languagesRequired?: string[];
  skillsRequired?: string[];
  physicalRequirements?: string[];
  ppeRequirements?: string[];
  ppeProvidedBy?: string;
  requirementPackId?: string;
  dressCode?: string[];
  customUniformRequirements?: string;
  decisionMaker?: string;
  hrContactId?: string;
  operationsContactId?: string;
  procurementContactId?: string;
  billingContactId?: string;
  safetyContactId?: string;
  invoiceContactId?: string;
}

export const EMPTY_RECRUITER_ORDER_DETAILS: RecruiterOrderDetailsData = {
  backgroundCheckPackages: [],
  drugScreeningPanels: [],
  additionalScreenings: [],
  licensesCerts: [],
  experienceRequired: '',
  educationRequired: '',
  languagesRequired: [],
  skillsRequired: [],
  physicalRequirements: [],
  ppeRequirements: [],
  ppeProvidedBy: 'company',
  requirementPackId: '',
  dressCode: [],
  customUniformRequirements: '',
  decisionMaker: '',
  hrContactId: '',
  operationsContactId: '',
  procurementContactId: '',
  billingContactId: '',
  safetyContactId: '',
  invoiceContactId: '',
};

/**
 * @param overrideLayer — wins when set (e.g. child account or location_defaults)
 * @param baseLayer — fallback (e.g. parent national account)
 */
export function mergeRecruiterOrderDetails(
  overrideLayer: RecruiterOrderDetailsData | undefined,
  baseLayer: RecruiterOrderDetailsData | undefined
): RecruiterOrderDetailsData {
  return {
    ...EMPTY_RECRUITER_ORDER_DETAILS,
    ...baseLayer,
    ...overrideLayer,
    backgroundCheckPackages: overrideLayer?.backgroundCheckPackages ?? baseLayer?.backgroundCheckPackages ?? [],
    drugScreeningPanels: overrideLayer?.drugScreeningPanels ?? baseLayer?.drugScreeningPanels ?? [],
    additionalScreenings: overrideLayer?.additionalScreenings ?? baseLayer?.additionalScreenings ?? [],
    licensesCerts: overrideLayer?.licensesCerts ?? baseLayer?.licensesCerts ?? [],
    languagesRequired: overrideLayer?.languagesRequired ?? baseLayer?.languagesRequired ?? [],
    skillsRequired: overrideLayer?.skillsRequired ?? baseLayer?.skillsRequired ?? [],
    physicalRequirements: overrideLayer?.physicalRequirements ?? baseLayer?.physicalRequirements ?? [],
    ppeRequirements: overrideLayer?.ppeRequirements ?? baseLayer?.ppeRequirements ?? [],
    dressCode: overrideLayer?.dressCode ?? baseLayer?.dressCode ?? [],
  };
}

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
  parentOd: Record<string, unknown> | undefined
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

export interface MergedRecruiterOrderDefaultsForJobOrder {
  orderDetails: RecruiterOrderDetailsData;
  screeningPackageId: string;
  screeningPackageName: string;
  eVerifyRequired: boolean;
}

/**
 * Loads child (selected) recruiter account, optional national parent, optional location_defaults doc.
 */
export async function fetchMergedRecruiterOrderDefaultsForJobOrder(
  tenantId: string,
  opts: { recruiterAccountId: string; companyId?: string | null; worksiteId?: string | null }
): Promise<MergedRecruiterOrderDefaultsForJobOrder | null> {
  const rid = String(opts.recruiterAccountId || '').trim();
  if (!tenantId || !rid) return null;

  const accRef = doc(db, p.recruiterAccounts(tenantId), rid);
  const accSnap = await getDoc(accRef);
  if (!accSnap.exists()) return null;

  const raw = accSnap.data();
  const child = raw as RecruiterAccount;
  const parentId = inferParentId(raw);

  let parent: RecruiterAccount | null = null;
  if (parentId) {
    const pSnap = await getDoc(doc(db, p.recruiterAccounts(tenantId), parentId));
    if (pSnap.exists()) parent = pSnap.data() as RecruiterAccount;
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
  const orderDetails = mergeRecruiterOrderDetails(locDetails, nationalPlusChild);

  const childOd = readOrderDefaultsBlock(raw);
  const parentOd = parent ? readOrderDefaultsBlock(parent) : undefined;
  const { id: screeningPackageId, name: screeningPackageName } = mergeScreeningPackageFromOrderDefaultLayers(
    locationOd,
    childOd,
    parentOd
  );

  return {
    orderDetails,
    screeningPackageId,
    screeningPackageName,
    eVerifyRequired: resolveEverifyRequired(child, parent),
  };
}
