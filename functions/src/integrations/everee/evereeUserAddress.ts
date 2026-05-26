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

  // 2026-05-26 — two-pass extraction.
  //
  // The pre-existing extractor used a flat `addr.field ?? altAddr.field`
  // cascade, which lost to corrupt data in `addressInfo`. The audit
  // (`auditEvereeMissingAddresses.ts`) surfaced workers whose
  // `addressInfo` block had fields typed into the wrong slots
  // (e.g. `addressInfo.state = "Calhoun"`, `addressInfo.zip =
  // "Kansas City"`) — the cascade would pull those junk values from
  // the first block even when the second block (`address.*`) had a
  // clean equivalent.
  //
  // Strategy: try each block as a standalone, well-formed candidate.
  // Return the first one that produces a complete EvereeAddress. If
  // neither does, return null.
  return (
    tryExtractFromBlock(addr, addr) ?? // addressInfo first (newer UI shape)
    tryExtractFromBlock(altAddr, addr) // address fallback, but keep addressInfo line2 if present
  );
}

/**
 * Single-pass extraction over one address block. The `unitBlock`
 * parameter lets the caller try `addr` for line2 even when the
 * primary block is `altAddr` — unit numbers are often only stored
 * on the worker-UI block (`addressInfo.unitNumber`) and we don't
 * want to lose them just because the rest of the block was junk.
 */
function tryExtractFromBlock(
  block: Record<string, unknown>,
  unitBlock: Record<string, unknown>,
): EvereeAddress | null {
  const line1 = String(block.streetAddress ?? block.street ?? block.addressLine1 ?? '').trim();
  const city = String(block.city ?? '').trim();
  const stateRaw = String(block.state ?? '').trim();
  // 2026-05-26 — guard against the user typing a 5-digit ZIP into the
  // state slot (Terrance Edgar shape). A 2-letter code that happens to
  // be digits is technically possible nowhere (US states are letters),
  // so reject any digit-only state.
  const stateLooksValid = /^[A-Za-z]{2,}/.test(stateRaw);
  const state = stateLooksValid
    ? stateRaw.slice(0, 2).toUpperCase()
    : '';
  const zipRaw = String(block.zip ?? block.zipCode ?? block.postalCode ?? '')
    .trim()
    .replace(/\D/g, '');
  const postalCode = zipRaw.length >= 5 ? zipRaw.slice(0, 5) : '';
  if (!line1 || !city || !state || postalCode.length !== 5) return null;
  const line2Raw = String(
    unitBlock.unit ??
      unitBlock.unitNumber ??
      unitBlock.line2 ??
      unitBlock.addressLine2 ??
      block.unit ??
      block.unitNumber ??
      block.line2 ??
      block.addressLine2 ??
      '',
  ).trim();
  return {
    line1,
    ...(line2Raw ? { line2: line2Raw } : {}),
    city,
    state,
    postalCode,
  };
}
