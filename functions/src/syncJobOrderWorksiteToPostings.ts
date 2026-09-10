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
  /** Where the coordinates came from when this run had to fill them in. */
  coordinatesSource: string;
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

  // Coordinates (2026-09-09, Greg: "job orders all have worksite addresses
  // with coords — make this work"). Precedence: JO.worksiteAddress.coordinates
  // → JO.worksiteCoordinates (self-backfilled by the recruiter JO page) →
  // location doc → server geocode of the street address. Without this every
  // posting converted from a JO landed on the board with no coordinates and
  // "Nearest" could not place it (127 of 207 active postings, 2026-09-09).
  let coordinatesSource = '';
  if (!hasLatLng(worksiteAddress.coordinates)) {
    const joCoords = normalizeLatLng(jo.worksiteCoordinates);
    if (joCoords) {
      worksiteAddress = { ...worksiteAddress, coordinates: joCoords };
      coordinatesSource = 'job_order.worksiteCoordinates';
    }
  }
  if (!hasLatLng(worksiteAddress.coordinates) && worksiteId) {
    try {
      const locSnap = await db.doc(`tenants/${tenantId}/locations/${worksiteId}`).get();
      const loc = (locSnap.data() || {}) as Record<string, any>;
      const locCoords = normalizeLatLng(loc.address?.coordinates ?? loc.coordinates);
      if (locCoords) {
        worksiteAddress = { ...worksiteAddress, coordinates: locCoords };
        coordinatesSource = 'location_doc';
      }
    } catch {
      /* best-effort */
    }
  }
  if (!hasLatLng(worksiteAddress.coordinates)) {
    const geo = await serverGeocodeAddress(worksiteAddress);
    if (geo) {
      worksiteAddress = { ...worksiteAddress, coordinates: geo };
      coordinatesSource = 'server_geocode';
    }
  }

  return {
    worksiteId,
    worksiteName,
    worksiteAddress,
    coordinatesSource,
    companyId: String(jo.companyId ?? '').trim(),
    companyName: String(jo.companyName ?? '').trim(),
  };
}

function normalizeLatLng(v: unknown): { lat: number; lng: number } | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const lat = Number(o.lat ?? o.latitude);
  const lng = Number(o.lng ?? o.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) return null;
  return { lat, lng };
}

function hasLatLng(v: unknown): boolean {
  return normalizeLatLng(v) !== null;
}

/** Geocode a street address with the server key (Geocoding API only, no
 *  referrer restriction — same key the Fieldglass parser uses). Rejects hits
 *  whose state disagrees with the address (partial matches elsewhere). */
async function serverGeocodeAddress(
  addr: Record<string, unknown>,
): Promise<{ lat: number; lng: number } | null> {
  const key = String(process.env.GOOGLE_MAPS_SERVER_KEY ?? '').trim();
  const city = String(addr.city ?? '').trim();
  const state = String(addr.state ?? '').trim();
  if (!key || !city || !state) return null;
  const q = [addr.street, city, state, addr.zipCode ?? addr.zip]
    .map((v) => String(v ?? '').trim())
    .filter(Boolean)
    .join(', ');
  try {
    const res = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(q)}&region=us&key=${key}`,
    );
    const json = (await res.json()) as {
      status?: string;
      results?: Array<{ geometry?: { location?: { lat: number; lng: number } }; address_components?: Array<{ short_name?: string; types?: string[] }> }>;
    };
    const hit = json.results?.[0];
    const loc = hit?.geometry?.location;
    if (!loc) return null;
    const hitState = hit?.address_components?.find((c) => c.types?.includes('administrative_area_level_1'))?.short_name;
    if (hitState && state.length === 2 && hitState.toUpperCase() !== state.toUpperCase()) return null;
    return { lat: loc.lat, lng: loc.lng };
  } catch (e) {
    logger.warn('syncJobOrderWorksiteToPostings.geocode_failed', { q, err: String(e) });
    return null;
  }
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
    const coordsChanged =
      JSON.stringify(before?.worksiteCoordinates ?? null) !==
      JSON.stringify(after?.worksiteCoordinates ?? null);
    // A JO whose address still carries no coordinates gets them resolved on
    // any write (once stamped, this stops firing).
    const joLacksCoords =
      !hasLatLng((after?.worksiteAddress as Record<string, unknown> | undefined)?.coordinates) &&
      Boolean((after?.worksiteAddress as Record<string, unknown> | undefined)?.city);
    if (before && !fieldChanged && !addrChanged && !coordsChanged && !joLacksCoords) return;

    const { tenantId, jobOrderId } = event.params as {
      tenantId: string;
      jobOrderId: string;
    };

    const resolved = await resolveWorksite(tenantId, after as Record<string, any>);

    // Stamp the JO itself when this run had to find the coordinates: the
    // recruiter "post to board" path copies JO.worksiteAddress verbatim, so
    // the JO must carry them. The write re-fires this trigger once; the
    // second pass finds coordinates present and does not write again.
    if (resolved.coordinatesSource && hasLatLng(resolved.worksiteAddress.coordinates)) {
      await event.data!.after!.ref.set(
        {
          worksiteAddress: { coordinates: resolved.worksiteAddress.coordinates },
          worksiteCoordinates: resolved.worksiteAddress.coordinates,
          worksiteCoordinatesSource: resolved.coordinatesSource,
        },
        { merge: true },
      );
    }
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
