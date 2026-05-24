/**
 * Map HRX `users/{uid}` profile fields → Everee address payload.
 */

import type { EvereeAddress } from './evereeService';

/**
 * Reads `addressInfo` (worker-UI shape with geocoded coords + `streetAddress`/`zip`)
 * AND the alternative `addressInfo` shape that `adminCreateWorker` writes
 * (`addressLine1` / `postalCode`) AND the top-level `address` block (used by some
 * older flows). Returns the Everee `line1` / `city` / `state` / `postalCode` payload
 * shape when complete, or `null` when any required field is missing.
 *
 * **2026-05-24 fix (Greg's repeat lockout report)** — there were three
 * field-name conventions in the wild for storing the worker's home address,
 * and the previous extractor only recognized one of them:
 *
 *   Field that exists on the doc  | Written by
 *   ------------------------------|----------------------------------------
 *   `addressInfo.streetAddress`   | Worker self-serve UI (Google Places + geocode)
 *   `addressInfo.addressLine1`    | `adminCreateWorker` (admin-create flow)
 *   `address.street`              | Legacy onboarding flows
 *
 * When admins created workers via `adminCreateWorker` with the
 * `addressLine1`/`postalCode` shape, the extractor returned `null`, the
 * contractor path silently omitted `homeAddress`, and Everee's anti-fraud
 * engine locked the new accounts. Reading all three shapes here is a single
 * touch-point fix that doesn't require rewriting every caller.
 *
 * Required for a non-null return: line1, city, 2-char state, 5-digit ZIP.
 * No coordinate requirement — Everee resolves coords server-side from the
 * structured address.
 */
export function extractEvereeHomeAddressFromUserDoc(
  u: Record<string, unknown> | undefined,
): EvereeAddress | null {
  if (!u || typeof u !== 'object') return null;
  const addr = (u.addressInfo as Record<string, unknown>) || {};
  const altAddr = (u.address as Record<string, unknown>) || {};
  const line1 = String(
    addr.streetAddress ??
      addr.addressLine1 ??
      altAddr.street ??
      altAddr.addressLine1 ??
      '',
  ).trim();
  const city = String(addr.city ?? altAddr.city ?? u.city ?? '').trim();
  const stateRaw = String(addr.state ?? altAddr.state ?? u.state ?? '').trim();
  const state = stateRaw.length >= 2 ? stateRaw.slice(0, 2).toUpperCase() : '';
  const zipRaw = String(
    addr.zip ??
      addr.zipCode ??
      addr.postalCode ??
      altAddr.zip ??
      altAddr.zipCode ??
      altAddr.postalCode ??
      u.zip ??
      '',
  )
    .trim()
    .replace(/\D/g, '');
  const postalCode = zipRaw.length >= 5 ? zipRaw.slice(0, 5) : '';
  if (!line1 || !city || !state || postalCode.length !== 5) return null;
  const line2Raw = String(
    addr.unit ?? addr.line2 ?? addr.addressLine2 ?? altAddr.line2 ?? altAddr.addressLine2 ?? '',
  ).trim();
  return {
    line1,
    ...(line2Raw ? { line2: line2Raw } : {}),
    city,
    state,
    postalCode,
  };
}
