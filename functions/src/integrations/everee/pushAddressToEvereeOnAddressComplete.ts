/**
 * pushAddressToEvereeOnAddressComplete
 * ------------------------------------
 * Closes the "auto-hired but never finished their home address" gap.
 *
 * Background: auto-hire (group / application auto-onboard) provisions the
 * worker into Everee. But `createWorkerIfNeeded` / `evereeEnsureWorker`
 * THROW when the worker has no complete home address — Everee's anti-fraud
 * engine locks accounts created with an empty/placeholder address (see the
 * 2026-05-23 lockout incident). So a worker who was auto-hired before
 * filling in their address has NO Everee worker yet (provisioning bailed
 * before writing the `everee_workers` linkage).
 *
 * When the worker later completes their address (the dashboard nudges them
 * via the `confirm_home_address` action item), this trigger fires and, for
 * each entity the worker is mid-onboarding into:
 *   - If already provisioned in Everee (linkage has an evereeWorkerId) →
 *     silently PATCH the address (`updateEvereeWorkerAddress`).
 *   - If NOT yet provisioned → re-run provisioning via
 *     `runStartOnCallEmploymentFlow({ suppressNotifications: true })`, which
 *     resolves worker type (W-2 / 1099) from the entity and now succeeds
 *     because the address is present — WITHOUT re-sending any onboarding
 *     SMS/email (idempotent, side-effect-minimal — "Option 1").
 *
 * Loop-safe: only acts on an incomplete→complete address transition, so the
 * `evereeWorkerIds` writeback that provisioning performs on `users/{uid}`
 * does not re-fire the address logic (address is already complete on both
 * sides of that later write).
 */

import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';

import { DEFAULT_FIRESTORE_TRIGGER_MEMORY } from '../../utils/functionRuntimeDefaults';
import { extractEvereeHomeAddressFromUserDoc } from './evereeUserAddress';
import { updateEvereeWorkerAddress } from './evereeService';
import { runStartOnCallEmploymentFlow } from '../../onboarding/startOnCallEmployment';

const REGION = 'us-central1' as const;
const MAX_INSTANCES = 5 as const;

const db = admin.firestore();

/** True when the user doc has a complete Everee-shaped home address. */
function hasCompleteEvereeAddress(u: Record<string, unknown> | null | undefined): boolean {
  if (!u) return false;
  return extractEvereeHomeAddressFromUserDoc(u) != null;
}

/** Linkage doc states that mean onboarding is already done — skip. */
function linkageOnboardingComplete(ld: Record<string, unknown> | undefined): boolean {
  if (!ld) return false;
  return (
    ld.onboardingComplete === true ||
    String(ld.status || '').toLowerCase() === 'onboarding_complete' ||
    String(ld.onboardingStatus || '').toUpperCase() === 'COMPLETE'
  );
}

export const pushAddressToEvereeOnAddressComplete = onDocumentWritten(
  {
    document: 'users/{uid}',
    region: REGION,
    maxInstances: MAX_INSTANCES,
    retry: false,
    memory: DEFAULT_FIRESTORE_TRIGGER_MEMORY,
  },
  async (event) => {
    const before = event.data?.before?.exists
      ? (event.data.before.data() as Record<string, unknown>)
      : null;
    const after = event.data?.after?.exists
      ? (event.data.after.data() as Record<string, unknown>)
      : null;
    if (!after) return;
    const uid = event.params.uid as string;

    // Only act on the incomplete → complete transition.
    if (hasCompleteEvereeAddress(before) || !hasCompleteEvereeAddress(after)) return;

    const address = extractEvereeHomeAddressFromUserDoc(after);
    if (!address) return;

    // Tenants the worker belongs to (membership map on the user doc).
    const tenantIds = new Set<string>();
    const tmap = after.tenantIds as Record<string, unknown> | undefined;
    if (tmap && typeof tmap === 'object') {
      for (const k of Object.keys(tmap)) if (k) tenantIds.add(k);
    }
    if (typeof after.tenantId === 'string' && after.tenantId.trim()) {
      tenantIds.add(after.tenantId.trim());
    }
    if (tenantIds.size === 0) return;

    for (const tenantId of tenantIds) {
      let pipelines;
      try {
        pipelines = await db
          .collection(`tenants/${tenantId}/worker_onboarding`)
          .where('userId', '==', uid)
          .get();
      } catch (err) {
        logger.warn('everee.address_backfill.pipeline_query_failed', {
          uid,
          tenantId,
          error: err instanceof Error ? err.message : String(err),
        });
        continue;
      }

      for (const p of pipelines.docs) {
        const pd = p.data() as Record<string, unknown>;
        const entityId = String(pd.entityId || '').trim();
        if (!entityId) continue;

        // Already provisioned? Patch the address. Else re-provision.
        let linkSnap;
        try {
          linkSnap = await db
            .doc(`tenants/${tenantId}/everee_workers/${entityId}__${uid}`)
            .get();
        } catch {
          linkSnap = null;
        }
        const ld = linkSnap?.exists ? (linkSnap.data() as Record<string, unknown>) : undefined;

        // Fully onboarded already — leave it alone.
        if (linkageOnboardingComplete(ld)) continue;

        const evereeWorkerId = String(ld?.evereeWorkerId || ld?.externalWorkerId || '').trim();

        try {
          if (evereeWorkerId) {
            // Provisioned but onboarding not complete → push the now-complete
            // address so Everee has it (anti-fraud + accurate tax records).
            await updateEvereeWorkerAddress({ tenantId, entityId, evereeWorkerId, address });
            logger.info('everee.address_backfill.patched', {
              uid,
              tenantId,
              entityId,
              evereeWorkerId,
            });
          } else {
            // Never provisioned (auto-hire bailed on the missing address) →
            // re-run provisioning with notifications suppressed. Idempotent;
            // resolves W-2/1099 from the entity; now succeeds with the address.
            const result = await runStartOnCallEmploymentFlow({
              tenantId,
              userId: uid,
              entityId,
              triggerSource: 'address_backfill',
              initiatedByUid: 'system:address_backfill',
              suppressNotifications: true,
            });
            logger.info('everee.address_backfill.reprovisioned', {
              uid,
              tenantId,
              entityId,
              evereeProvisionWarning: result?.evereeProvisionWarning ?? null,
            });
          }
        } catch (err) {
          logger.warn('everee.address_backfill.failed', {
            uid,
            tenantId,
            entityId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
  },
);
