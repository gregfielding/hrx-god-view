/**
 * Single source of truth for "what URL goes in the SMS / template that
 * tells a worker to complete their onboarding for a given entity".
 *
 * Logic — read this twice before changing it; it powers the resend button,
 * the automated R1–R5 reminder cadence, the Everee restart callable, AND
 * the initial on_call / pipeline started welcome SMS:
 *
 *   1. If the hiring entity has an `evereeTenantId` configured (resolved
 *      via `getEvereeConfigForEntity`), the worker is sent **directly to
 *      that tenant's Everee onboarding embed**:
 *        https://hrxone.com/c1/workers/payroll/{evereeTenantId}
 *      Everee handles I-9, W-4, W-9, banking, and tax documents inside
 *      the iframe for both W2 employees and 1099 contractors, so this is
 *      strictly fewer hops than the My Employment hub for any
 *      Everee-enabled entity.
 *   2. Otherwise (entity isn't on Everee at all), the worker falls back
 *      to the standard My Employment hub URL keyed by pipelineId.
 *
 * SMS body wording is decided separately (see
 * `buildOnboardingReminderSmsBody`) — body wording stays gated on
 * `entityKey === 'events'` so 1099 copy doesn't mention I-9. Both copies
 * are still accurate when pointed at the Everee direct URL because Everee
 * surfaces I-9 + W-4 + banking on its tenant page for W2 employees and
 * surfaces W-9 + banking for 1099 contractors.
 */
import { logger } from 'firebase-functions/v2';
import {
  buildWorkerEntityEmploymentUrl,
  buildWorkerPayrollEvereeTenantUrl,
} from '../../utils/workerUrls';
import { getEvereeConfigForEntity } from './evereeConfig';

export type ResolvedWorkerOnboardingLink = {
  /** Final URL to embed in the SMS / template. Never empty when pipelineId is non-empty. */
  link: string;
  /** True when the URL is the direct Everee payroll embed; false when it's the My Employment hub fallback. */
  isEvereeDirect: boolean;
  /** Resolved Everee tenant id (e.g. `3133` for C1 Select, `3138` for C1 Events) or null if the entity isn't Everee-enabled. */
  evereeTenantId: string | null;
};

export async function resolveWorkerOnboardingLink(args: {
  tenantId: string;
  entityId: string | null | undefined;
  pipelineId: string;
  /** Tag for the warn log if the Everee config lookup throws. Lets us
   *  trace which surface (manual resend vs scheduler vs restart vs welcome
   *  SMS) hit the failure. */
  context?: string;
}): Promise<ResolvedWorkerOnboardingLink> {
  const { tenantId, entityId, pipelineId, context } = args;
  let evereeTenantId: string | null = null;
  const eid = String(entityId || '').trim();
  if (eid) {
    try {
      const cfg = await getEvereeConfigForEntity(tenantId, eid);
      evereeTenantId = cfg?.evereeTenantId?.trim() || null;
    } catch (e: unknown) {
      logger.warn(
        `${context || 'resolveWorkerOnboardingLink'}: evereeTenantId resolve failed`,
        {
          tenantId,
          entityId: eid,
          error: e instanceof Error ? e.message : String(e),
        },
      );
    }
  }
  if (evereeTenantId) {
    return {
      link: buildWorkerPayrollEvereeTenantUrl(evereeTenantId),
      isEvereeDirect: true,
      evereeTenantId,
    };
  }
  return {
    link: buildWorkerEntityEmploymentUrl(pipelineId),
    isEvereeDirect: false,
    evereeTenantId: null,
  };
}
