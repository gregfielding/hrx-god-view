/**
 * Resolves AccuSource screening package defaults for a candidate (job → location_defaults → account).
 * Same layering as mergeScreeningPackageFromLayers; used by Backgrounds tab preview + order modal.
 */
import { collection, doc, getDoc, getDocs, limit, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { p } from '../data/firestorePaths';
import {
  mergeScreeningPackageFromLayers,
  screeningLocationKeyCandidates,
  type ScreeningPackageMergeResult,
} from '../pages/UserProfile/components/backgroundsComplianceModel';

export interface MergedScreeningPackageLoadResult {
  merged: ScreeningPackageMergeResult;
  trace: string;
  defaultJobOrderId: string;
  defaultWorksiteId: string;
  defaultAccountId: string;
  defaultAccountName: string;
}

export async function fetchMergedScreeningPackageForCandidate(
  tenantId: string,
  candidateUid: string
): Promise<MergedScreeningPackageLoadResult> {
  const empty: MergedScreeningPackageLoadResult = {
    merged: {
      packageName: '',
      packageId: '',
      nameSource: null,
      idSource: null,
    },
    trace: 'No assignment found — choose a package from the synced catalog.',
    defaultJobOrderId: '',
    defaultWorksiteId: '',
    defaultAccountId: '',
    defaultAccountName: '',
  };

  const aq = query(collection(db, 'tenants', tenantId, 'assignments'), where('candidateId', '==', candidateUid), limit(3));
  const asnap = await getDocs(aq);
  if (asnap.empty) return empty;

  const a = asnap.docs[0].data() as Record<string, unknown>;
  const jobOrderId = String(a.jobOrderId || '');
  const worksiteId = String(a.worksiteId || a.locationId || '');

  let jd: Record<string, unknown> | undefined;
  if (jobOrderId) {
    const jo = await getDoc(doc(db, 'tenants', tenantId, 'job_orders', jobOrderId));
    jd = jo.exists() ? (jo.data() as Record<string, unknown>) : undefined;
  }

  const accountIdForPath =
    String(jd?.entityId || jd?.accountId || a.accountId || a.companyId || '').trim() || '';
  const locationId = String(a.worksiteId || a.locationId || jd?.locationId || jd?.worksiteId || '').trim();
  const companyId = String(jd?.companyId || jd?.crmCompanyId || a.companyId || '').trim();

  let locationDoc: Record<string, unknown> | undefined;
  if (jd && accountIdForPath) {
    const keys = screeningLocationKeyCandidates(jd, accountIdForPath, locationId, companyId);
    for (const key of keys) {
      const locSnap = await getDoc(doc(db, p.recruiterAccountLocationDefaults(tenantId, accountIdForPath, key)));
      if (locSnap.exists()) {
        locationDoc = locSnap.data() as Record<string, unknown>;
        break;
      }
    }
  }

  let accountDoc: Record<string, unknown> | undefined;
  if (accountIdForPath) {
    const accSnap = await getDoc(doc(db, p.recruiterAccount(tenantId, accountIdForPath)));
    if (accSnap.exists()) accountDoc = accSnap.data() as Record<string, unknown>;
  }

  const merged = mergeScreeningPackageFromLayers(jd, locationDoc, accountDoc);

  const traceParts: string[] = [];
  if (merged.nameSource) traceParts.push(`package name ← ${merged.nameSource}`);
  if (merged.idSource) traceParts.push(`package id ← ${merged.idSource}`);
  const trace =
    traceParts.length > 0
      ? `Resolved: ${traceParts.join(' · ')}`
      : 'No package fields on job order, location, or account — choose from the synced catalog.';

  let defaultAccountId = accountIdForPath;
  let defaultAccountName = '';
  if (jd) {
    defaultAccountId = String(jd.entityId || jd.accountId || accountIdForPath || '');
    defaultAccountName = String(jd.accountName || jd.entityName || '');
  }

  return {
    merged,
    trace,
    defaultJobOrderId: jobOrderId,
    defaultWorksiteId: worksiteId,
    defaultAccountId,
    defaultAccountName,
  };
}
