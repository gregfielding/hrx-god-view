/**
 * Nearby opportunities for one worker (Greg 2026-07-28): "we have a
 * great worker — find them a job." Uses the worker's geocoded home
 * coordinates to rank, by distance:
 *
 *   1. openJobs — active, publicly-visible job POSTINGS (same corpus as
 *      the public jobs board: tenants/{t}/job_postings, status 'active',
 *      visibility public/restricted) that carry backfilled coordinates.
 *   2. nearbyCompanies — CRM company LOCATIONS
 *      (tenants/{t}/crm_companies/{id}/locations with geocoded
 *      `coordinates`) — prospects/customers near the worker even when
 *      no job order is open. One row per company (its nearest location).
 *
 * Worker coordinates come from the same two shapes the radius-blast
 * uses: canonical `homeAddress.coordinates.{lat,lng}` (apply wizard)
 * or legacy `addressInfo.{homeLat,homeLng}`. Roughly 5k of 11.7k tenant
 * users have one of the two — the tab explains itself when a worker
 * doesn't.
 *
 * Corpus sizes (2026-07-28 probe): 156 active postings; 1,153 location
 * docs across ALL collectionGroup roots — both fine to scan per call.
 *
 * Gate: staff (hrx claim, admin role, or securityLevel >= 4) — this is
 * recruiter tooling, not books access.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

const trim = (v: unknown): string => String(v ?? '').trim();
const numOrNull = (v: unknown): number | null => (Number.isFinite(Number(v)) ? Number(v) : null);

const RESULT_LIMIT = 10;

interface LatLng {
  lat: number;
  lng: number;
}

/** Great-circle distance in miles. */
function haversineMiles(a: LatLng, b: LatLng): number {
  const R = 3958.8;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const sa =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(sa), Math.sqrt(1 - sa));
}

function extractCoords(v: unknown): LatLng | null {
  const o = (v ?? {}) as { lat?: unknown; lng?: unknown };
  const lat = numOrNull(o.lat);
  const lng = numOrNull(o.lng);
  return lat != null && lng != null ? { lat, lng } : null;
}

/** Same canonical→legacy chain as jobOrderAutoMessagingRadius. */
function workerHomeCoords(u: Record<string, unknown>): LatLng | null {
  const canonical = extractCoords(
    (u.homeAddress as Record<string, unknown> | undefined)?.coordinates,
  );
  if (canonical) return canonical;
  const legacy = u.addressInfo as { homeLat?: unknown; homeLng?: unknown } | undefined;
  const lat = numOrNull(legacy?.homeLat);
  const lng = numOrNull(legacy?.homeLng);
  return lat != null && lng != null ? { lat, lng } : null;
}

async function ensureStaffAccess(
  uid: string | undefined,
  token: Record<string, unknown> | undefined,
  tenantId: string,
): Promise<void> {
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  if (token?.hrx === true) return;
  const data = ((await db.collection('users').doc(uid).get()).data() ?? {}) as Record<string, unknown>;
  const role = String(data.role ?? '').toLowerCase();
  const level = Number.parseInt(String(data.securityLevel ?? '0'), 10) || 0;
  const tenantLevel =
    Number.parseInt(
      String(
        (data.tenantIds as Record<string, Record<string, unknown>> | undefined)?.[tenantId]
          ?.securityLevel ?? '0',
      ),
      10,
    ) || 0;
  if (role === 'admin' || role === 'super_admin' || level >= 4 || tenantLevel >= 4) return;
  throw new HttpsError('permission-denied', 'Staff access required.');
}

export const getWorkerNearbyOpportunities = onCall(
  { region: 'us-central1', memory: '512MiB', timeoutSeconds: 60 },
  async (request) => {
    const tenantId = trim(request.data?.tenantId);
    const workerId = trim(request.data?.workerId);
    if (!tenantId || !workerId) {
      throw new HttpsError('invalid-argument', 'tenantId and workerId are required.');
    }
    await ensureStaffAccess(request.auth?.uid, request.auth?.token as never, tenantId);

    const workerSnap = await db.collection('users').doc(workerId).get();
    if (!workerSnap.exists) throw new HttpsError('not-found', 'Worker not found.');
    const worker = workerSnap.data() as Record<string, unknown>;
    const home = workerHomeCoords(worker);
    if (!home) {
      return { noCoordinates: true, openJobs: [], nearbyCompanies: [] };
    }

    // ── Open jobs: active + publicly visible postings with coordinates ──
    const postingsSnap = await db
      .collection(`tenants/${tenantId}/job_postings`)
      .where('status', '==', 'active')
      .get();
    const openJobs = postingsSnap.docs
      .map((d) => {
        const v = d.data();
        const visibility = trim(v.jobsBoardVisibility) || trim(v.visibility) || 'public';
        if (visibility !== 'public' && visibility !== 'restricted') return null;
        const coords = extractCoords(v.coordinates);
        if (!coords) return null;
        return {
          postingId: d.id,
          jobOrderId: trim(v.jobOrderId) || null,
          title: trim(v.postTitle) || trim(v.title) || trim(v.jobTitle) || '(untitled)',
          companyName: trim(v.companyName) || null,
          worksiteName: trim(v.worksiteName) || null,
          city: trim(v.city) || null,
          state: trim(v.state) || null,
          jobType: trim(v.jobType) || null,
          payRate: numOrNull(v.payRate),
          distanceMi: Math.round(haversineMiles(home, coords) * 10) / 10,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => a.distanceMi - b.distanceMi)
      .slice(0, RESULT_LIMIT);

    // ── Nearby companies: CRM company locations with coordinates ──
    // The locations collectionGroup spans other roots (agencies/,
    // customers/) and has no tenantId field, so scan-and-filter by path
    // — the whole group is ~1.2k docs.
    const prefix = `tenants/${tenantId}/crm_companies/`;
    const locsSnap = await db.collectionGroup('locations').get();
    const perCompany = new Map<
      string,
      { locationName: string | null; city: string | null; state: string | null; distanceMi: number }
    >();
    locsSnap.forEach((d) => {
      if (!d.ref.path.startsWith(prefix)) return;
      const v = d.data();
      const coords = extractCoords(v.coordinates);
      if (!coords) return;
      const accountId = d.ref.path.slice(prefix.length).split('/')[0];
      const distanceMi = Math.round(haversineMiles(home, coords) * 10) / 10;
      const prev = perCompany.get(accountId);
      if (!prev || distanceMi < prev.distanceMi) {
        perCompany.set(accountId, {
          locationName: trim(v.name) || null,
          city: trim(v.city) || null,
          state: trim(v.state) || null,
          distanceMi,
        });
      }
    });
    const nearest = [...perCompany.entries()]
      .sort((a, b) => a[1].distanceMi - b[1].distanceMi)
      .slice(0, RESULT_LIMIT);
    const companyDocs = nearest.length
      ? await db.getAll(
          ...nearest.map(([id]) => db.doc(`tenants/${tenantId}/crm_companies/${id}`)),
        )
      : [];
    const nameById = new Map<string, string>();
    companyDocs.forEach((s) => {
      if (s.exists) {
        const v = s.data() as Record<string, unknown>;
        nameById.set(s.id, trim(v.companyName) || trim(v.name) || s.id);
      }
    });
    const nearbyCompanies = nearest.map(([accountId, loc]) => ({
      accountId,
      companyName: nameById.get(accountId) ?? accountId,
      ...loc,
    }));

    return { noCoordinates: false, home, openJobs, nearbyCompanies };
  },
);
