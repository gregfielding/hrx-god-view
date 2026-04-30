/**
 * Map HRX `users/{uid}` profile fields → Everee address payload.
 */

import type { EvereeAddress } from './evereeService';

/**
 * Reads `addressInfo` + legacy top-level fallbacks (same intent as
 * `isWorkerHomeAddressComplete` in the web app, but **without** requiring
 * geocoordinates — Everee needs structured street/city/state/ZIP only.
 */
export function extractEvereeHomeAddressFromUserDoc(
  u: Record<string, unknown> | undefined,
): EvereeAddress | null {
  if (!u || typeof u !== 'object') return null;
  const addr = (u.addressInfo as Record<string, unknown>) || {};
  const line1 = String(addr.streetAddress ?? '').trim();
  const city = String(addr.city ?? u.city ?? '').trim();
  const stateRaw = String(addr.state ?? u.state ?? '').trim();
  const state = stateRaw.length >= 2 ? stateRaw.slice(0, 2).toUpperCase() : '';
  const zipRaw = String(addr.zip ?? addr.zipCode ?? u.zip ?? '').trim().replace(/\D/g, '');
  const postalCode = zipRaw.length >= 5 ? zipRaw.slice(0, 5) : '';
  if (!line1 || !city || !state || postalCode.length !== 5) return null;
  const line2Raw = String(addr.unit ?? addr.line2 ?? '').trim();
  return {
    line1,
    ...(line2Raw ? { line2: line2Raw } : {}),
    city,
    state,
    postalCode,
  };
}
