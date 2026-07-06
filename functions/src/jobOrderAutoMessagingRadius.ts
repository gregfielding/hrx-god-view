/**
 * **Smart-radius recipient resolver for JO auto-messaging (FG Slice 7,
 * Greg 2026-07-07: "send that same message to every hrx user within a 30
 * mile radius of the worksite address").**
 *
 * Resolves worker uids within N miles of a worksite, nearest first,
 * hard-capped (Greg: 200). Used by `runJobOrderAutoMessagingForShift`
 * when the JO carries `autoMessagingSmartRadius` — the same send
 * pipeline (opt-out, cooldown, bilingual template, posting link) then
 * treats these uids exactly like group members.
 *
 * Coordinates: workers carry geocoded home coordinates at
 * `homeAddress.coordinates.{lat,lng}` (canonical, apply wizard) or
 * legacy `addressInfo.{homeLat,homeLng}` — ~5k of 11.7k tenant users
 * have one of the two (2026-07-07 probe). No geo index exists, so this
 * is a field-masked collection scan + in-memory haversine — ~12k
 * lightweight partial docs per call, which is fine at Fieldglass order
 * volume (a few JOs/day, message send is the expensive part anyway).
 *
 * Staff exclusion: securityLevel >= 5 (recruiters/managers/admins)
 * never get blasted.
 */

import * as admin from 'firebase-admin';

export interface SmartRadiusConfig {
  miles: number;
  maxRecipients?: number;
}

export interface RadiusCenter {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_MILES = 3958.8;

export function haversineMiles(a: RadiusCenter, b: RadiusCenter): number {
  const toRad = (d: number): number => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(s)));
}

function workerCoords(u: Record<string, unknown>): RadiusCenter | null {
  const canonical = (u.homeAddress as Record<string, unknown> | undefined)?.coordinates as
    | { lat?: unknown; lng?: unknown }
    | undefined;
  if (
    canonical &&
    Number.isFinite(canonical.lat as number) &&
    Number.isFinite(canonical.lng as number)
  ) {
    return { lat: canonical.lat as number, lng: canonical.lng as number };
  }
  const legacy = u.addressInfo as { homeLat?: unknown; homeLng?: unknown } | undefined;
  if (legacy && Number.isFinite(legacy.homeLat as number) && Number.isFinite(legacy.homeLng as number)) {
    return { lat: legacy.homeLat as number, lng: legacy.homeLng as number };
  }
  return null;
}

function isTenantWorker(u: Record<string, unknown>, tenantId: string): boolean {
  const t = (u.tenantIds as Record<string, unknown> | undefined)?.[tenantId] as
    | Record<string, unknown>
    | undefined;
  if (!t) return false;
  const secRaw = t.securityLevel ?? u.securityLevel ?? '0';
  const sec = parseInt(String(secRaw), 10);
  // Staff (recruiter/manager/admin, sec >= 5) are never blast targets.
  if (!Number.isNaN(sec) && sec >= 5) return false;
  return true;
}

export async function resolveRadiusRecipientUids(
  db: admin.firestore.Firestore,
  params: {
    tenantId: string;
    center: RadiusCenter;
    miles: number;
    maxRecipients: number;
  },
): Promise<{ uids: string[]; scanned: number; inRadius: number }> {
  const { tenantId, center, miles, maxRecipients } = params;

  // Field mask keeps the 12k-doc scan lightweight (a few hundred bytes
  // per doc instead of full profiles).
  const snap = await db
    .collection('users')
    .select('homeAddress', 'addressInfo', 'tenantIds', 'securityLevel')
    .get();

  const hits: Array<{ uid: string; distance: number }> = [];
  for (const d of snap.docs) {
    const u = d.data() as Record<string, unknown>;
    if (!isTenantWorker(u, tenantId)) continue;
    const coords = workerCoords(u);
    if (!coords) continue;
    const distance = haversineMiles(center, coords);
    if (distance <= miles) hits.push({ uid: d.id, distance });
  }
  hits.sort((a, b) => a.distance - b.distance);
  return {
    uids: hits.slice(0, Math.max(1, maxRecipients)).map((h) => h.uid),
    scanned: snap.size,
    inRadius: hits.length,
  };
}
