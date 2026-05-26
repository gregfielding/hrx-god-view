/**
 * Shared address extractor for Everee provisioning.
 *
 * Lives in `shared/` (byte-mirrored to `src/shared/`) because both the
 * Cloud Functions side (`functions/src/integrations/everee/evereeUserAddress.ts`
 * re-exports from here) AND the client need the same logic:
 *
 *   - Functions calls it when provisioning / repairing an Everee worker
 *     record so the `homeAddress` POST/PUT body is well-formed.
 *   - Client calls it from the User Details header to render the
 *     "Everee blocked: missing home address" chip — recruiters can see
 *     at a glance which workers need their profile address collected
 *     before sync.
 *
 * **Two-pass extraction** (2026-05-26): the audit that produced this
 * shared version found workers whose `addressInfo` block had fields
 * typed into wrong slots (e.g. `addressInfo.state = "Calhoun"`,
 * `addressInfo.zip = "Kansas City"`). The original cascade fell to junk
 * values from the first block even when the legacy `address.*` block
 * held a clean equivalent. The two-pass strategy tries each block as a
 * self-contained candidate and returns the first complete one.
 *
 * Required for a non-null return: line1, city, 2-letter alpha state,
 * 5-digit ZIP. No coordinate requirement — Everee resolves coords
 * server-side from the structured address.
 */

/** Address shape per Everee API spec. */
export interface EvereeAddress {
  line1: string;
  line2?: string;
  city: string;
  state: string;
  postalCode: string;
}

/**
 * Read `addressInfo` (worker-UI shape with `streetAddress`/`zip`) AND
 * the alternative `addressInfo` shape that `adminCreateWorker` writes
 * (`addressLine1`/`postalCode`) AND the top-level `address` block (used
 * by some older flows). Returns the Everee payload shape when complete,
 * or `null` when any required field is missing.
 *
 * The three field-name conventions in the wild:
 *
 *   Field that exists on the doc  | Written by
 *   ------------------------------|----------------------------------------
 *   `addressInfo.streetAddress`   | Worker self-serve UI (Google Places + geocode)
 *   `addressInfo.addressLine1`    | `adminCreateWorker` (admin-create flow)
 *   `address.street`              | Legacy onboarding flows
 *
 * Unit numbers may live as `addressInfo.unitNumber`, `addressInfo.unit`,
 * `addressInfo.line2`, `addressInfo.addressLine2`, or the same keys on
 * the legacy `address.*` block. We pick the first non-empty.
 */
export function extractEvereeHomeAddressFromUserDoc(
  u: Record<string, unknown> | undefined,
): EvereeAddress | null {
  if (!u || typeof u !== 'object') return null;
  const addr = (u.addressInfo as Record<string, unknown>) || {};
  const altAddr = (u.address as Record<string, unknown>) || {};
  return (
    tryExtractFromBlock(addr, addr) ?? // addressInfo first (newer UI shape)
    tryExtractFromBlock(altAddr, addr) // address fallback, keep addressInfo line2 if present
  );
}

/**
 * Single-pass extraction over one address block. The `unitBlock`
 * parameter lets the caller try `addressInfo` for line2 even when the
 * primary block is the legacy `address.*` — unit numbers are often
 * only stored on the worker-UI block and we don't want to lose them
 * just because the rest of that block was junk.
 */
function tryExtractFromBlock(
  block: Record<string, unknown>,
  unitBlock: Record<string, unknown>,
): EvereeAddress | null {
  const line1 = String(
    block.streetAddress ?? block.street ?? block.addressLine1 ?? '',
  ).trim();
  const city = String(block.city ?? '').trim();
  const stateRaw = String(block.state ?? '').trim();
  // Guard against the user typing a 5-digit ZIP into the state slot
  // (Terrance Edgar shape). A 2-letter US state code is always letters,
  // so reject any digit-only state.
  const stateLooksValid = /^[A-Za-z]{2,}/.test(stateRaw);
  const state = stateLooksValid ? stateRaw.slice(0, 2).toUpperCase() : '';
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
