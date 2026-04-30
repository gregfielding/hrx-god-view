/**
 * Canonical "home address" object written to `users/{uid}.homeAddress` and
 * the application doc by the apply wizard / quick-apply path.
 *
 * Single source of truth so we don't fork the shape across surfaces. Any new
 * reader should point at `homeAddress` (this exact shape) rather than the
 * historical `addressInfo.{streetAddress,city,state,zip,homeLat,homeLng}`
 * grab-bag — the apply wizard keeps writing both for backward compat with
 * existing readers, but new code should prefer the structured object.
 */

export interface CanonicalHomeAddress {
  /** Full one-line string from Google Places `formatted_address`. */
  formattedAddress: string;
  /** Number + route. */
  street: string;
  city: string;
  /** Two-letter state code (e.g. "CA"). */
  state: string;
  /** ZIP / postal code. */
  postalCode: string;
  /** ISO country code when available ("US"); long name otherwise. */
  country: string;
  coordinates: { lat: number; lng: number };
  /** Google Places `place_id` — the verification marker for the apply gate. */
  placeId: string;
  /** ISO timestamp for when the address was selected from the Place picker. */
  geocodedAt: string;
}

/**
 * Pull a wizard `personal` blob (or any object that exposes the same flat
 * field names the wizard writes) into the canonical structured object. Returns
 * `null` if the input is missing any required field — callers should treat
 * the wizard's `addressValid` gate as the authoritative pre-check.
 */
export function buildCanonicalHomeAddressFromWizardPersonal(
  personal: Record<string, unknown> | null | undefined,
): CanonicalHomeAddress | null {
  if (!personal || typeof personal !== 'object') return null;
  const street = String(personal.street ?? '').trim();
  const city = String(personal.city ?? '').trim();
  const state = String(personal.state ?? '').trim();
  const postalCode = String(personal.zip ?? personal.postalCode ?? '').trim();
  const placeId = String(personal.placeId ?? '').trim();
  const formattedAddress =
    String(personal.formattedAddress ?? '').trim() ||
    [street, [city, state].filter(Boolean).join(', '), postalCode].filter(Boolean).join(', ');
  const country = String(personal.country ?? '').trim();
  const lat = Number(personal.homeLat);
  const lng = Number(personal.homeLng);
  const geocodedAtRaw =
    typeof personal.addressGeocodedAt === 'string' && personal.addressGeocodedAt.trim()
      ? personal.addressGeocodedAt.trim()
      : new Date().toISOString();

  if (!street || !city || !state || !postalCode || !placeId) return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;

  return {
    formattedAddress,
    street,
    city,
    state,
    postalCode,
    country,
    coordinates: { lat, lng },
    placeId,
    geocodedAt: geocodedAtRaw,
  };
}
