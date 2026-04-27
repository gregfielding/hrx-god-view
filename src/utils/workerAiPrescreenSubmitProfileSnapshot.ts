/**
 * Fields sent with prescreen submit so the server can merge a session-true profile snapshot
 * with a fresh Firestore read (see `mergeEnrichedUserDocForPrescreenSubmit` in functions).
 */
export type PrescreenSessionProfileEnhancements = {
  skills?: unknown;
  resume?: Record<string, unknown>;
  phone?: string;
  phoneE164?: string;
  phoneVerified?: boolean;
  phoneVerifiedAt?: unknown;
  addressInfo?: Record<string, unknown>;
  city?: string;
  state?: string;
  zip?: string;
  resumeUrl?: string;
  resumeStoragePath?: string;
};

/** Build a callable-safe payload from the latest client user doc (e.g. onSnapshot). Omits empty objects. */
export function buildPrescreenSessionProfileEnhancements(
  userDoc: Record<string, unknown> | null | undefined,
): PrescreenSessionProfileEnhancements | undefined {
  if (!userDoc || typeof userDoc !== 'object') return undefined;
  const o: PrescreenSessionProfileEnhancements = {};

  if (userDoc.skills !== undefined) o.skills = userDoc.skills;
  if (userDoc.resume !== undefined && userDoc.resume !== null && typeof userDoc.resume === 'object') {
    o.resume = userDoc.resume as Record<string, unknown>;
  }
  if (typeof userDoc.phone === 'string' && userDoc.phone.trim()) o.phone = userDoc.phone.trim();
  if (typeof userDoc.phoneE164 === 'string' && userDoc.phoneE164.trim()) o.phoneE164 = userDoc.phoneE164.trim();
  if (typeof userDoc.phoneVerified === 'boolean') o.phoneVerified = userDoc.phoneVerified;
  if (userDoc.phoneVerifiedAt !== undefined) o.phoneVerifiedAt = userDoc.phoneVerifiedAt;

  if (userDoc.addressInfo !== undefined && userDoc.addressInfo !== null && typeof userDoc.addressInfo === 'object') {
    o.addressInfo = userDoc.addressInfo as Record<string, unknown>;
  }
  if (typeof userDoc.city === 'string' && userDoc.city.trim()) o.city = userDoc.city.trim();
  if (typeof userDoc.state === 'string' && userDoc.state.trim()) o.state = userDoc.state.trim();
  if (typeof userDoc.zip === 'string' && userDoc.zip.trim()) o.zip = userDoc.zip.trim();
  if (typeof userDoc.resumeUrl === 'string' && userDoc.resumeUrl.trim()) o.resumeUrl = userDoc.resumeUrl.trim();
  if (typeof userDoc.resumeStoragePath === 'string' && userDoc.resumeStoragePath.trim()) {
    o.resumeStoragePath = userDoc.resumeStoragePath.trim();
  }

  return Object.keys(o).length > 0 ? o : undefined;
}
