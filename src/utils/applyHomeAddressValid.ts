/**
 * Apply-wizard home-address gate. An address counts as valid when it is complete
 * (street/city/state/zip) AND geocoded to valid coordinates (homeLat/homeLng) —
 * matching the `addressComplete` rule the wizard uses to skip the address step
 * for returning users. We deliberately do NOT require a Google `placeId`: a
 * worker whose address is already on file (geocoded, no placeId persisted) must
 * not be blocked. On the AddressStep itself, free-typed text clears the
 * coordinates, so a NEW entry still has to be picked from the Google dropdown
 * (which geocodes it) to pass — the cause of new users landing without an
 * address. Shared by the wizard's Next-button gate / `handleNext` / submit
 * backstop and the prescreen address gate (`PrescreenAddressGate`).
 */
export function isApplyHomeAddressValid(personal: any): boolean {
  const str = (v: unknown): string => (typeof v === 'string' ? v : String(v ?? '')).trim();
  const street = str(personal?.street);
  const city = str(personal?.city);
  const state = str(personal?.state);
  const zip = str(personal?.zip);
  const homeLat = personal?.homeLat;
  const homeLng = personal?.homeLng;
  if (!street || !city || !state || !zip) return false;
  if (homeLat === undefined || homeLng === undefined) return false;
  if (
    typeof homeLat !== 'number' ||
    typeof homeLng !== 'number' ||
    isNaN(homeLat) ||
    isNaN(homeLng) ||
    homeLat < -90 ||
    homeLat > 90 ||
    homeLng < -180 ||
    homeLng > 180
  ) {
    return false;
  }
  return true;
}
