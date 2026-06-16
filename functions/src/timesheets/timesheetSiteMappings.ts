/**
 * Per-customer "Site → job order" mappings for the timesheet importer.
 *
 * Indeed-placed crews often have no HRX assignment, so an imported row
 * can't thread to a job order for its pay rate / WC / worksite. The
 * recruiter maps the CSV `Site` string (e.g. "WBI (Hanover, MD) -
 * Maryland Warehouse") to an HRX job order under the child account once;
 * the mapping is remembered and applied to every future import of that
 * site (mirrors the Indeed venue_aliases pattern).
 *
 * Doc: tenants/{t}/timesheet_site_mappings/{customer}__{normalizedSite}
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

/** Lowercase + collapse whitespace — the comparison key for a site string. */
export function normalizeSite(site: string): string {
  return String(site || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Deterministic, Firestore-safe doc id for a (customer, site) pair. */
export function siteMappingDocId(customer: string, site: string): string {
  const c = String(customer || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
  const s = normalizeSite(site).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return `${c}__${s}`.slice(0, 480);
}

/** Walk the JO doc-path candidates (same order the rest of the codebase uses). */
export async function loadJobOrderDoc(
  tenantId: string,
  jobOrderId: string,
): Promise<Record<string, any> | null> {
  for (const path of [
    `tenants/${tenantId}/job_orders/${jobOrderId}`,
    `tenants/${tenantId}/jobOrders/${jobOrderId}`,
    `tenants/${tenantId}/recruiter_jobOrders/${jobOrderId}`,
  ]) {
    try {
      const snap = await db.doc(path).get();
      if (snap.exists) return snap.data() as Record<string, any>;
    } catch {
      /* walk next */
    }
  }
  return null;
}

async function assertTimesheetEditor(
  uid: string,
  token: Record<string, unknown> | undefined,
  tenantId: string,
): Promise<void> {
  if (token?.hrx === true) return;
  const userSnap = await db.collection('users').doc(uid).get();
  const data = (userSnap.data() || {}) as Record<string, any>;
  const nested = data.tenantIds?.[tenantId]?.securityLevel;
  const level = Number.parseInt(String(nested ?? data.securityLevel ?? '0'), 10) || 0;
  if (level >= 5 && level <= 7) return;
  throw new HttpsError('permission-denied', 'Mapping sites requires tenant security level 5–7.');
}

export const saveTimesheetSiteMapping = onCall(
  { cors: true },
  async (request): Promise<{ ok: true; docId: string; accountName: string | null }> => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Authentication required');
    }
    const { tenantId, customer, site, jobOrderId } = (request.data || {}) as {
      tenantId?: string;
      customer?: string;
      site?: string;
      jobOrderId?: string;
    };
    if (!tenantId || !customer || !site || !jobOrderId) {
      throw new HttpsError(
        'invalid-argument',
        'tenantId, customer, site, and jobOrderId are required',
      );
    }
    await assertTimesheetEditor(
      request.auth.uid,
      request.auth.token as Record<string, unknown>,
      tenantId,
    );

    const jo = await loadJobOrderDoc(tenantId, jobOrderId);
    if (!jo) throw new HttpsError('not-found', 'Job order not found');

    const accountName =
      (typeof jo.recruiterAccountName === 'string' && jo.recruiterAccountName) ||
      (typeof jo.accountName === 'string' && jo.accountName) ||
      (typeof jo.companyName === 'string' && jo.companyName) ||
      null;
    const accountId =
      (typeof jo.recruiterAccountId === 'string' && jo.recruiterAccountId) ||
      (typeof jo.accountId === 'string' && jo.accountId) ||
      null;

    const docId = siteMappingDocId(customer, site);
    await db.doc(`tenants/${tenantId}/timesheet_site_mappings/${docId}`).set(
      {
        tenantId,
        customer,
        site,
        normalizedSite: normalizeSite(site),
        jobOrderId,
        accountId,
        accountName,
        jobTitle: typeof jo.jobTitle === 'string' ? jo.jobTitle : null,
        mappedBy: request.auth.uid,
        mappedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    return { ok: true, docId, accountName };
  },
);
