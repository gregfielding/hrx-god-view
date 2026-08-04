/**
 * `addressInfo` has TWO writer schemas that coexisted blind to each other:
 *   - profile UI shape:  streetAddress / unitNumber / zip   (WorkerBasicIdentityCard,
 *     ProfileOverview AddressFormFields)
 *   - Everee/admin shape: addressLine1 / addressLine2 / postalCode
 *     (adminCreateWorker wizard)
 * The Everee extractor reads both, but the profile screens only read their own
 * shape — so wizard-created workers showed a half-blank address ("it didn't
 * save", 2026-08-04). Every writer now runs its payload through this mirror so
 * both shapes stay populated regardless of which surface edited last.
 */
export function mirrorAddressShapes(a: Record<string, unknown>): Record<string, unknown> {
  const street = (a.streetAddress ?? a.addressLine1 ?? '') as string;
  const unit = (a.unitNumber ?? a.addressLine2 ?? '') as string;
  const zip = (a.zip ?? a.zipCode ?? a.postalCode ?? '') as string;
  return {
    ...a,
    streetAddress: street,
    addressLine1: street,
    ...(unit ? { unitNumber: unit, addressLine2: unit } : {}),
    zip,
    postalCode: zip,
  };
}
