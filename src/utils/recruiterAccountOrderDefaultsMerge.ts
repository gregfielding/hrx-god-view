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

function isNonEmptyStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.length > 0;
}

function isNonEmptyTrimmedString(v: unknown): v is string {
  return typeof v === 'string' && v.trim() !== '';
}

/**
 * Empty-array / empty-string fallthrough — R.16.2c hotfix.
 *
 * Why this exists:
 *   The original merge used `??`, which only treats `null` /
 *   `undefined` as "no override". An explicit `[]` or `''` on the
 *   child account therefore *suppressed* the parent's value, leaving
 *   child-account forms blank even when the parent had real data.
 *   The auto-save path on `AccountOrderDetailsForm` has been known to
 *   persist `physicalRequirements: []` on a child whenever the user
 *   touched any other field — instantly cutting that child off from
 *   the parent's chips.
 *
 *   Concretely, that broke two things:
 *     1. Display — the child-account multi-selects rendered empty
 *        even though the JO snapshots (and the parent doc) had the
 *        right values.
 *     2. R.16.3-interim Sync — the sync button reads
 *        `formRef.current.<field>`, so it would happily push the
 *        empty array out to active job orders, blanking their
 *        snapshots in one click.
 *
 *   Treating empty as "no override" closes both holes for the multi-
 *   select array fields and the one snapshot-policy text field
 *   (`customUniformRequirements`).
 *
 * Trade-off:
 *   A child account can no longer express "explicitly override the
 *   parent's list to nothing" via these fields. In practice that's
 *   an extremely rare semantic and the UX (auto-save instantly
 *   reverting any clear) is worse than the lost capability. Other
 *   string fields (`experienceRequired`, `educationRequired`,
 *   `ppeProvidedBy`, contact IDs, etc.) keep their existing spread
 *   semantics — they're not snapshot-policy and the "clear to blank"
 *   semantic still has legitimate use cases there.
 *
 * @param overrideLayer — wins when set (e.g. child account or location_defaults)
 * @param baseLayer — fallback (e.g. parent national account)
 */
export function mergeRecruiterOrderDetails(
  overrideLayer: RecruiterOrderDetailsData | undefined,
  baseLayer: RecruiterOrderDetailsData | undefined
): RecruiterOrderDetailsData {
  const arrayPick = (
    overrideValue: string[] | undefined,
    baseValue: string[] | undefined
  ): string[] => {
    if (isNonEmptyStringArray(overrideValue)) return overrideValue;
    if (isNonEmptyStringArray(baseValue)) return baseValue;
    return [];
  };
  return {
    ...EMPTY_RECRUITER_ORDER_DETAILS,
    ...baseLayer,
    ...overrideLayer,
    backgroundCheckPackages: arrayPick(overrideLayer?.backgroundCheckPackages, baseLayer?.backgroundCheckPackages),
    drugScreeningPanels: arrayPick(overrideLayer?.drugScreeningPanels, baseLayer?.drugScreeningPanels),
    additionalScreenings: arrayPick(overrideLayer?.additionalScreenings, baseLayer?.additionalScreenings),
    licensesCerts: arrayPick(overrideLayer?.licensesCerts, baseLayer?.licensesCerts),
    languagesRequired: arrayPick(overrideLayer?.languagesRequired, baseLayer?.languagesRequired),
    skillsRequired: arrayPick(overrideLayer?.skillsRequired, baseLayer?.skillsRequired),
    physicalRequirements: arrayPick(overrideLayer?.physicalRequirements, baseLayer?.physicalRequirements),
    ppeRequirements: arrayPick(overrideLayer?.ppeRequirements, baseLayer?.ppeRequirements),
    dressCode: arrayPick(overrideLayer?.dressCode, baseLayer?.dressCode),
    customUniformRequirements: isNonEmptyTrimmedString(overrideLayer?.customUniformRequirements)
      ? overrideLayer!.customUniformRequirements
      : isNonEmptyTrimmedString(baseLayer?.customUniformRequirements)
        ? baseLayer!.customUniformRequirements
        : '',
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
