/**
 * Firestore trigger: keep `worksiteAddress` on a JO doc in sync with
 * the worksite location doc it references.
 *
 * Why this exists (2026-06-03):
 * The submitTimesheetBatch pre-flight reads `jo.worksiteAddress`
 * (NOT the worksite location doc) when provisioning Everee work-
 * locations. If the JO has only `worksiteId` set but `worksiteAddress`
 * is missing any of {street, city, state, zip}, Everee returns 422
 * `"Validation failed: 'X' must not be blank"` and the entry is
 * stamped `everee.errorCode = 'work_location_provision_failed'`.
 *
 * Several JO creation paths historically forget to denormalize the
 * address alongside `worksiteId`:
 *   - The manual JO form (`JobOrderForm.tsx`)
 *   - `createJobOrder` / `createJobOrderFromDeal` in
 *     `src/services/jobOrderService.ts`
 *   - Indeed Flex inbound JO creation
 * Only `gigJobOrderFromChildAccount.ts` (auto-spawn from Gig calendar)
 * does it correctly today.
 *
 * Rather than touch every write path (and remember the same logic in
 * every future one), this trigger watches `job_orders/{joId}` writes
 * and back-fills `worksiteAddress` from the location doc whenever it
 * detects the denorm is missing or stale.
 *
 * **Field-name mapping** (worksite location doc → JO doc):
 *   address  / line1 / street → street
 *   city                       → city
 *   state                      → state
 *   zipCode / zip / postalCode → zip
 *
 * **Idempotency / no write-loop:** we compute the address that
 * SHOULD be on the JO and compare it field-for-field with what's
 * already there. If they match, the trigger is a no-op — its
 * own write back to the JO doc re-fires the trigger, but the second
 * firing sees an exact match and returns immediately.
 *
 * **Not a worksite-edit cascade.** If a recruiter edits the worksite
 * doc itself (e.g. fixes a typo in the street address), this trigger
 * does NOT propagate the new value to every JO that references it.
 * That cascade was intentionally disabled (see
 * `onCompanyLocationUpdatedDisabled.ts`) to avoid touching hundreds
 * of JOs on a single edit. The denorm happens at JO write time only —
 * accept the small drift risk in exchange for predictable write
 * costs.
 *
 * **No-op cases:**
 *   - Deletion (`after` is missing).
 *   - No `worksiteId` on the JO — nothing to denormalize against.
 *   - No `companyId` / `accountId` on the JO — can't resolve the
 *     location doc path.
 *   - Worksite location doc not found — log warn and skip.
 *   - Worksite doc itself is missing a required field — log warn and
 *     skip; better to leave the JO incomplete than to write a partial
 *     address that Everee will still reject.
 *   - Computed address equals existing — idempotent.
 */

import * as admin from 'firebase-admin';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions/v2';

interface DenormedAddress {
  street: string;
  city: string;
  state: string;
  zip: string;
}

function getStr(
  o: Record<string, unknown> | null | undefined,
  k: string,
): string {
  const v = o?.[k];
  return typeof v === 'string' ? v.trim() : '';
}

/**
 * Build a denormalized address from the worksite location doc.
 * Returns null if any required field is missing — better to leave
 * the JO untouched than to stamp a partial address.
 */
function buildAddressFromWorksite(
  worksite: Record<string, unknown> | undefined,
): DenormedAddress | null {
  if (!worksite) return null;
  const street =
    getStr(worksite, 'address') ||
    getStr(worksite, 'line1') ||
    getStr(worksite, 'street');
  const city = getStr(worksite, 'city');
  const state = getStr(worksite, 'state');
  const zip =
    getStr(worksite, 'zipCode') ||
    getStr(worksite, 'zip') ||
    getStr(worksite, 'postalCode');
  if (!street || !city || !state || !zip) return null;
  return { street, city, state, zip };
}

function addressEquals(
  a: Record<string, unknown> | undefined,
  b: DenormedAddress,
): boolean {
  if (!a) return false;
  return (
    getStr(a, 'street') === b.street &&
    getStr(a, 'city') === b.city &&
    getStr(a, 'state') === b.state &&
    getStr(a, 'zip') === b.zip
  );
}

export const onJobOrderWriteDenormWorksiteAddress = onDocumentWritten(
  'tenants/{tenantId}/job_orders/{jobOrderId}',
  async (event) => {
    const tenantId = event.params.tenantId as string;
    const jobOrderId = event.params.jobOrderId as string;

    const after = event.data?.after?.data() as
      | Record<string, unknown>
      | undefined;
    if (!after) return; // deleted

    const worksiteId = getStr(after, 'worksiteId');
    if (!worksiteId) return;

    // The location doc lives under the company's `locations` subcollection.
    // JO docs use `companyId` (preferred) or `accountId` (legacy).
    const companyId = getStr(after, 'companyId') || getStr(after, 'accountId');
    if (!companyId) {
      // Can't resolve the location path without the company id. Don't
      // warn every time — many older JOs lack companyId and live with
      // it. The pre-flight will catch any that try to go through Everee.
      return;
    }

    const db = admin.firestore();
    const wsRef = db.doc(
      `tenants/${tenantId}/crm_companies/${companyId}/locations/${worksiteId}`,
    );
    const wsSnap = await wsRef.get();
    if (!wsSnap.exists) {
      logger.warn('[onJobOrderWriteDenormWorksiteAddress] worksite missing', {
        tenantId,
        jobOrderId,
        worksiteId,
        companyId,
      });
      return;
    }
    const desired = buildAddressFromWorksite(wsSnap.data());
    if (!desired) {
      logger.warn(
        '[onJobOrderWriteDenormWorksiteAddress] worksite incomplete',
        { tenantId, jobOrderId, worksiteId, companyId },
      );
      return;
    }

    // Idempotency: if the JO already has the exact address we'd
    // compute, the trigger re-firing from our own write is a no-op.
    const existing = after.worksiteAddress as
      | Record<string, unknown>
      | undefined;
    if (addressEquals(existing, desired)) return;

    try {
      await db.doc(`tenants/${tenantId}/job_orders/${jobOrderId}`).update({
        worksiteAddress: desired,
        worksiteAddressDenormStampedAt:
          admin.firestore.FieldValue.serverTimestamp(),
      });
      logger.info('[onJobOrderWriteDenormWorksiteAddress] denormalized', {
        tenantId,
        jobOrderId,
        worksiteId,
      });
    } catch (e) {
      logger.error('[onJobOrderWriteDenormWorksiteAddress] update failed', {
        tenantId,
        jobOrderId,
        worksiteId,
        err: e instanceof Error ? e.message : String(e),
      });
    }
  },
);
