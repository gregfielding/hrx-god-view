/**
 * syncJobOrderWorksiteToPostings — keep job-board postings' worksite in
 * lockstep with their job order.
 *
 * Bug class this kills: a posting's worksite is denormalized at creation
 * and was never re-synced when the JO's worksite changed. The recruiter
 * form's worksite picker is locked to the JO, so there's no UI path to
 * repair a stale post — and the WORKER apply wizard reads the posting's
 * worksite, so a stale post sent applicants to the wrong venue (the
 * 2026-05-09 FIFA KC → Riviera → reverted incident). The client-side
 * `syncJobOrderToLinkedPostings` only runs on shift edits, so a JO
 * worksite change on the Overview tab never propagated.
 *
 * This Firestore trigger fires on any job_order write and, when a
 * worksite/company field actually changed, re-stamps every linked
 * job_posting with the JO's authoritative worksite (resolving the
 * address from the location doc when the JO only carries an id). The JO
 * is the source of truth for linked postings.
 */

import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions/v2';
import * as admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

const WORKSITE_KEYS = ['worksiteId', 'worksiteName', 'companyId', 'companyName'] as const;

interface ResolvedWorksite {
  worksiteId: string;
  worksiteName: string;
  worksiteAddress: Record<string, unknown>;
  companyId: string;
  companyName: string;
}

/** Resolve the JO's authoritative worksite, filling the address from the
 *  location doc when the JO carries an id but an incomplete address. */
async function resolveWorksite(
  tenantId: string,
  jo: Record<string, any>,
): Promise<ResolvedWorksite> {
  const worksiteId = String(jo.worksiteId ?? '').trim();
  let worksiteName = String(jo.worksiteName ?? '').trim();
  let worksiteAddress: Record<string, unknown> =
    jo.worksiteAddress && typeof jo.worksiteAddress === 'object'
      ? { ...(jo.worksiteAddress as Record<string, unknown>) }
      : {};

  const needsAddr =
    worksiteId && (!worksiteAddress.city || !worksiteAddress.state);
  if (needsAddr) {
    try {
      const locSnap = await db.doc(`tenants/${tenantId}/locations/${worksiteId}`).get();
      if (locSnap.exists) {
        const loc = (locSnap.data() || {}) as Record<string, any>;
        const addr = (loc.address as Record<string, any>) || {};
        // Existing (JO) values win; the location fills the gaps.
        worksiteAddress = {
          street: worksiteAddress.street ?? addr.street ?? '',
          city: worksiteAddress.city ?? addr.city ?? '',
          state: worksiteAddress.state ?? addr.state ?? '',
          zipCode: worksiteAddress.zipCode ?? addr.zipCode ?? '',
          ...(addr.coordinates ? { coordinates: addr.coordinates } : {}),
          ...worksiteAddress,
        };
        if (!worksiteName) {
          worksiteName = String(loc.nickname || loc.title || loc.name || '');
        }
      }
    } catch {
      /* best-effort */
    }
  }

  return {
    worksiteId,
    worksiteName,
    worksiteAddress,
    companyId: String(jo.companyId ?? '').trim(),
    companyName: String(jo.companyName ?? '').trim(),
  };
}

export const syncJobOrderWorksiteToPostings = onDocumentWritten(
  { document: 'tenants/{tenantId}/job_orders/{jobOrderId}', memory: '512MiB' },
  async (event) => {
    const before = event.data?.before?.exists ? event.data.before.data() : undefined;
    const after = event.data?.after?.exists ? event.data.after.data() : undefined;
    if (!after) return; // deleted

    // Only act when a worksite/company field actually changed (so we don't
    // touch postings on every unrelated JO edit).
    const fieldChanged = WORKSITE_KEYS.some(
      (k) => String(before?.[k] ?? '') !== String(after?.[k] ?? ''),
    );
    const addrChanged =
      JSON.stringify(before?.worksiteAddress ?? null) !==
      JSON.stringify(after?.worksiteAddress ?? null);
    if (before && !fieldChanged && !addrChanged) return;

    const { tenantId, jobOrderId } = event.params as {
      tenantId: string;
      jobOrderId: string;
    };

    const resolved = await resolveWorksite(tenantId, after as Record<string, any>);
    if (!resolved.worksiteId && !resolved.worksiteName) return; // nothing authoritative to stamp

    const snap = await db
      .collection(`tenants/${tenantId}/job_postings`)
      .where('jobOrderId', '==', jobOrderId)
      .get();
    if (snap.empty) return;

    const batch = db.batch();
    let updated = 0;
    snap.forEach((d) => {
      const patch: Record<string, unknown> = {
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      if (resolved.worksiteId) patch.worksiteId = resolved.worksiteId;
      if (resolved.worksiteName) patch.worksiteName = resolved.worksiteName;
      if (resolved.worksiteAddress && Object.keys(resolved.worksiteAddress).length > 0) {
        patch.worksiteAddress = resolved.worksiteAddress;
      }
      if (resolved.companyId) patch.companyId = resolved.companyId;
      if (resolved.companyName) patch.companyName = resolved.companyName;
      batch.set(d.ref, patch, { merge: true });
      updated += 1;
    });
    await batch.commit();

    logger.info('syncJobOrderWorksiteToPostings', {
      tenantId,
      jobOrderId,
      worksiteName: resolved.worksiteName,
      postingsUpdated: updated,
    });
  },
);
