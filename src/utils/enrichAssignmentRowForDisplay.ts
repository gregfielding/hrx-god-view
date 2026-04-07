/**
 * Resolve human-readable job order, account (company), and worksite strings for assignment rows.
 * Used by User Profile Assignments + Readiness tabs.
 */

import {
  collection,
  doc,
  getDoc,
  type QueryDocumentSnapshot,
  type DocumentData,
} from 'firebase/firestore';

import { db } from '../firebase';
import { p } from '../data/firestorePaths';
import { mergeAssignmentScreeningFromJobOrder } from '../shared/assignmentScreeningSignals';

/** Enriched assignment field: minimal job-order inputs for readiness cert synthesis (not the full job order). */
export const JOB_ORDER_CERT_DEMAND_KEY = 'jobOrderCertDemand' as const;

export type JobOrderCertDemandPayload = {
  requiredCertifications: unknown[];
  requiredLicenses: unknown[];
  requiredCertificationComplianceIds: unknown[];
};

function buildJobOrderCertDemandPayload(jo: Record<string, unknown>): JobOrderCertDemandPayload {
  return {
    requiredCertifications: Array.isArray(jo.requiredCertifications) ? [...jo.requiredCertifications] : [],
    requiredLicenses: Array.isArray(jo.requiredLicenses) ? [...jo.requiredLicenses] : [],
    requiredCertificationComplianceIds: Array.isArray(jo.requiredCertificationComplianceIds)
      ? [...jo.requiredCertificationComplianceIds]
      : [],
  };
}

export function looksLikeDocId(s: unknown): boolean {
  if (typeof s !== 'string' || !s) return false;
  const t = s.trim();
  return t.length >= 15 && t.length <= 30 && /^[a-zA-Z0-9_-]+$/.test(t);
}

/** Resolve recruiter account / CRM company / location + job order title for list display. */
export async function enrichUserAssignmentRow(
  tenantId: string,
  docSnap: QueryDocumentSnapshot<DocumentData>
): Promise<Record<string, unknown>> {
  const data = docSnap.data() as Record<string, unknown>;
  const id = docSnap.id;

  let companyDisplayName =
    (data.companyName as string) ||
    (data.customerName as string) ||
    (data.agencyName as string) ||
    '';

  let worksiteDisplayName =
    (data.worksiteName as string) ||
    (data.worksiteNickname as string) ||
    (data.worksiteTitle as string) ||
    (data.location as string) ||
    '';

  let jobOrderDisplayName =
    String(data.jobOrderName || data.jobOrderTitle || data.postTitle || '').trim() || '';

  const recruiterAccountId =
    (data.recruiterAccountId as string) || (data.accountId as string) || undefined;
  const crmCompanyId = (data.companyId as string) || undefined;
  const worksiteId =
    (data.worksiteId as string) ||
    (data.locationId as string) ||
    (Array.isArray(data.locationIds) && data.locationIds.length
      ? String((data.locationIds as string[])[0])
      : undefined) ||
    undefined;

  if (recruiterAccountId && (!companyDisplayName || looksLikeDocId(companyDisplayName))) {
    try {
      const snap = await getDoc(doc(db, p.recruiterAccount(tenantId, recruiterAccountId)));
      if (snap.exists()) {
        const d = snap.data() as Record<string, unknown>;
        const n = (d.name || d.legalName || d.accountName) as string | undefined;
        if (n && !looksLikeDocId(n)) companyDisplayName = n;
      }
    } catch {
      /* ignore */
    }
  }

  if (crmCompanyId && (!companyDisplayName || looksLikeDocId(companyDisplayName))) {
    try {
      const snap = await getDoc(doc(db, p.account(tenantId, crmCompanyId)));
      if (snap.exists()) {
        const d = snap.data() as Record<string, unknown>;
        const n = (d.name || d.companyName) as string | undefined;
        if (n && !looksLikeDocId(n)) companyDisplayName = n;
      }
    } catch {
      /* ignore */
    }
  }

  if (!companyDisplayName || looksLikeDocId(companyDisplayName)) {
    try {
      const snap = await getDoc(doc(db, 'tenants', tenantId));
      if (snap.exists()) {
        const n = snap.data().name as string | undefined;
        if (n && !looksLikeDocId(n)) companyDisplayName = n;
      }
    } catch {
      /* ignore */
    }
  }

  if (worksiteId && (!worksiteDisplayName || looksLikeDocId(worksiteDisplayName))) {
    try {
      let locSnap = null;
      if (crmCompanyId) {
        locSnap = await getDoc(doc(collection(db, p.accountLocations(tenantId, crmCompanyId)), worksiteId));
      }
      if (!locSnap?.exists()) {
        locSnap = await getDoc(doc(db, 'tenants', tenantId, 'locations', worksiteId));
      }
      if (locSnap?.exists()) {
        const loc = locSnap.data() as Record<string, unknown>;
        const n = (loc.nickname || loc.title || loc.name || loc.locationName) as string | undefined;
        if (n && !looksLikeDocId(n)) worksiteDisplayName = n;
      }
    } catch {
      /* ignore */
    }
  }

  const jobOrderId = data.jobOrderId as string | undefined;
  let jobOrderData: Record<string, unknown> | null = null;
  if (jobOrderId) {
    try {
      let joSnap = await getDoc(doc(collection(db, p.jobOrders(tenantId)), jobOrderId));
      if (!joSnap.exists()) {
        joSnap = await getDoc(doc(db, 'tenants', tenantId, 'recruiter_jobOrders', jobOrderId));
      }
      if (joSnap.exists()) {
        const jo = joSnap.data() as Record<string, unknown>;
        jobOrderData = jo;
        const joTitle = String(
          jo.jobOrderName || jo.jobTitle || jo.title || jo.postTitle || jo.shiftTitle || '',
        ).trim();
        if (joTitle) jobOrderDisplayName = joTitle;

        const joRecruiterAccount =
          (jo.recruiterAccountId as string) || (jo.accountId as string) || undefined;
        const joCrmCompany = (jo.companyId as string) || undefined;
        const joLoc = (jo.worksiteId as string) || (jo.locationId as string) || undefined;

        if ((!companyDisplayName || looksLikeDocId(companyDisplayName)) && joRecruiterAccount) {
          const snap = await getDoc(doc(db, p.recruiterAccount(tenantId, joRecruiterAccount)));
          if (snap.exists()) {
            const d = snap.data() as Record<string, unknown>;
            const n = (d.name || d.legalName || d.accountName) as string | undefined;
            if (n && !looksLikeDocId(n)) companyDisplayName = n;
          }
        }
        if ((!companyDisplayName || looksLikeDocId(companyDisplayName)) && joCrmCompany) {
          const snap = await getDoc(doc(db, p.account(tenantId, joCrmCompany)));
          if (snap.exists()) {
            const d = snap.data() as Record<string, unknown>;
            const n = (d.name || d.companyName) as string | undefined;
            if (n && !looksLikeDocId(n)) companyDisplayName = n;
          }
        }
        if ((!worksiteDisplayName || looksLikeDocId(worksiteDisplayName)) && joLoc) {
          const cid = joCrmCompany || crmCompanyId;
          let locSnap = null;
          if (cid) {
            locSnap = await getDoc(doc(collection(db, p.accountLocations(tenantId, cid)), joLoc));
          }
          if (!locSnap?.exists()) {
            locSnap = await getDoc(doc(db, 'tenants', tenantId, 'locations', joLoc));
          }
          if (locSnap?.exists()) {
            const loc = locSnap.data() as Record<string, unknown>;
            const n = (loc.nickname || loc.title || loc.name || loc.locationName) as string | undefined;
            if (n && !looksLikeDocId(n)) worksiteDisplayName = n;
          }
        }
      }
    } catch {
      /* ignore */
    }
  }

  const screening = mergeAssignmentScreeningFromJobOrder(data, jobOrderData);

  const jobOrderCertDemand = jobOrderData ? buildJobOrderCertDemandPayload(jobOrderData) : undefined;

  return {
    id,
    ...data,
    ...screening,
    companyDisplayName,
    worksiteDisplayName,
    jobOrderDisplayName: jobOrderDisplayName || undefined,
    jobOrderId: data.jobOrderId,
    ...(jobOrderCertDemand ? { [JOB_ORDER_CERT_DEMAND_KEY]: jobOrderCertDemand } : {}),
  };
}
