/**
 * Client-side worker↔worksite distance helpers (Greg 2026-08-18: "7.1
 * miles away" on the JO applicants table). Mirrors the server's
 * jobOrderAutoMessagingRadius conventions:
 *  - worker coords: `homeAddress.coordinates.{lat,lng}` (canonical, apply
 *    wizard) or legacy `addressInfo.{homeLat,homeLng}`;
 *  - worksite coords: `jobOrder.worksiteCoordinates` (self-backfilled by
 *    the radius blast) with location-doc `coordinates` as fallback.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_MILES = 3958.8;

export function haversineMiles(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(s)));
}

function validLatLng(v: unknown): v is LatLng {
  const o = v as { lat?: unknown; lng?: unknown } | null | undefined;
  return Boolean(
    o &&
      typeof o === 'object' &&
      Number.isFinite(o.lat as number) &&
      Number.isFinite(o.lng as number) &&
      // (0,0) is the null island sentinel some geocoding failures leave behind
      !((o.lat as number) === 0 && (o.lng as number) === 0),
  );
}

/** First valid {lat,lng} among the candidates, else null. */
export function latLngFromCandidates(...candidates: unknown[]): LatLng | null {
  for (const c of candidates) {
    if (validLatLng(c)) return { lat: (c as LatLng).lat, lng: (c as LatLng).lng };
  }
  return null;
}

/** Worker home coordinates from a user doc (canonical then legacy shape). */
export function latLngFromUser(user: Record<string, unknown> | null | undefined): LatLng | null {
  if (!user) return null;
  const canonical = (user.homeAddress as Record<string, unknown> | undefined)?.coordinates;
  if (validLatLng(canonical)) return { lat: (canonical as LatLng).lat, lng: (canonical as LatLng).lng };
  const legacy = user.addressInfo as { homeLat?: unknown; homeLng?: unknown } | undefined;
  if (
    legacy &&
    Number.isFinite(legacy.homeLat as number) &&
    Number.isFinite(legacy.homeLng as number) &&
    !((legacy.homeLat as number) === 0 && (legacy.homeLng as number) === 0)
  ) {
    return { lat: legacy.homeLat as number, lng: legacy.homeLng as number };
  }
  return null;
}
