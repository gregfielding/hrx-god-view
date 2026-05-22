/**
 * Everee work-locations bootstrap — ensures every HRX worksite has a
 * matching Everee `workLocationId` cached locally.
 *
 * **Why this is its own helper**: every worked-shift POST and most
 * payables require `workLocationId` (Everee-side numeric id). The
 * orchestrator (Slice 6) calls this lazily before composing each shift
 * payload; it memoizes per-run so a 500-shift batch makes at most
 * N-unique-worksite lookups, not 500.
 *
 * **Idempotency** is layered:
 *
 *   - **Local fast path** — `tenants/{tid}/everee_work_locations/
 *     {evereeTenantId}__{worksiteId}` caches the Everee-assigned numeric
 *     id. Read once; second call is free.
 *   - **Everee dedup** — POST /api/v2/work-locations carries an
 *     `externalId` (the HRX worksite id). Everee returns the existing
 *     location id when externalId collides, so even a cleared Firestore
 *     cache produces the same Everee workLocationId on re-POST.
 *
 * **Doc id format**: `{evereeTenantId}__{worksiteId}`. The same HRX
 * worksite gets a different Everee workLocationId in each company
 * instance (C1 Select = 3133, C1 Events = 3138, C1 Workforce = unset),
 * so the cache must be scoped by Everee tenant.
 */

import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';

import { evereeRequest } from './evereeHttp';
import type { EvereeEntityConfig } from './evereeConfig';

const FieldValue = admin.firestore.FieldValue;

if (!admin.apps.length) {
  admin.initializeApp();
}

/**
 * Worksite descriptor the orchestrator passes in. The cache key is
 * `worksiteId` alone (combined with `evereeTenantId` from config) —
 * other fields are only needed for the create-on-miss path.
 */
export interface WorksiteDescriptor {
  /** Stable HRX id (e.g. CRM location id). Used as Everee externalId. */
  worksiteId: string;
  /** Human-readable name shown on Everee admin UI + worker pay stubs. */
  name: string;
  address?: {
    street?: string;
    city?: string;
    state?: string;
    zip?: string;
  };
}

/**
 * Cached document shape under
 * `tenants/{tid}/everee_work_locations/{evereeTenantId}__{worksiteId}`.
 *
 * `worksiteId` + `evereeTenantId` are denormalized so a collectionGroup
 * read can answer "which Everee locations exist for tenant X?" without
 * parsing the doc id.
 */
interface EvereeWorkLocationCacheDoc {
  worksiteId: string;
  evereeTenantId: string;
  evereeWorkLocationId: number;
  /** Snapshot from the time we provisioned — useful for ops triage. */
  snapshot?: {
    name?: string;
    state?: string;
  };
  createdAt: admin.firestore.FieldValue | admin.firestore.Timestamp;
  updatedAt: admin.firestore.FieldValue | admin.firestore.Timestamp;
}

/**
 * Build the cache doc id. Pure helper exposed for tests.
 *
 *   `tenants/{tid}/everee_work_locations/{evereeTenantId}__{worksiteId}`
 *
 * Matches the `{entityId}__{userId}` pattern used by `everee_workers`
 * so ops queries can reuse the same parsing logic.
 */
export function buildEvereeWorkLocationDocId(
  evereeTenantId: string,
  worksiteId: string,
): string {
  return `${evereeTenantId}__${worksiteId}`;
}

/**
 * The Everee POST body shape (verified against the live sandbox on
 * 2026-05-22). `externalId` is what makes the call idempotent on the
 * Everee side — repeated POSTs with the same externalId return the
 * existing location instead of creating a new one.
 *
 * **Wire shape gotcha** (discovered via Slice 6b sandbox smoke):
 * address fields are FLAT at the top level — NOT nested under an
 * `address` key — and the street-line field is `line1` (not
 * `addressLine1`, despite what other Everee endpoints accept). Both
 * shapes were tried; only this one is accepted as of May 2026.
 */
interface CreateWorkLocationBody {
  externalId: string;
  name: string;
  line1?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
}

/**
 * Look up — or create + cache — the Everee `workLocationId` for an HRX
 * worksite.
 *
 * **Call pattern**: orchestrator iterates entries, accumulates unique
 * worksite ids, calls this for each (memoized per-run with a small
 * in-memory map to avoid even the Firestore round-trip on repeats).
 *
 * @throws when neither the cache hit nor the Everee response yields a
 *         numeric id. The orchestrator's pre-flight should fail fast
 *         when this happens — composing a worked-shift without a valid
 *         workLocationId is an error Everee will reject anyway.
 */
export async function ensureEvereeWorkLocation(
  tenantId: string,
  config: EvereeEntityConfig,
  worksite: WorksiteDescriptor,
): Promise<number> {
  const db = admin.firestore();
  const evereeTenantId = config.evereeTenantId;
  if (!evereeTenantId) {
    throw new Error('ensureEvereeWorkLocation: config.evereeTenantId is empty');
  }
  if (!worksite.worksiteId) {
    throw new Error('ensureEvereeWorkLocation: worksite.worksiteId is empty');
  }

  const docId = buildEvereeWorkLocationDocId(evereeTenantId, worksite.worksiteId);
  const ref = db.doc(`tenants/${tenantId}/everee_work_locations/${docId}`);

  // Fast path: cached hit.
  const snap = await ref.get();
  if (snap.exists) {
    const cached = snap.data() as EvereeWorkLocationCacheDoc | undefined;
    if (cached?.evereeWorkLocationId && Number.isFinite(cached.evereeWorkLocationId)) {
      return cached.evereeWorkLocationId;
    }
    logger.warn(
      '[everee.workLocations] cache doc exists but has no usable evereeWorkLocationId; re-provisioning',
      { tenantId, evereeTenantId, worksiteId: worksite.worksiteId },
    );
  }

  // Create on miss. Address fields are FLAT on this endpoint (see
  // CreateWorkLocationBody docstring above — verified against the
  // live sandbox).
  const body: CreateWorkLocationBody = {
    externalId: worksite.worksiteId,
    name: worksite.name,
  };
  if (worksite.address) {
    if (worksite.address.street) body.line1 = worksite.address.street;
    if (worksite.address.city) body.city = worksite.address.city;
    if (worksite.address.state) body.state = worksite.address.state;
    if (worksite.address.zip) body.postalCode = worksite.address.zip;
    body.country = 'US';
  }

  const raw = await evereeRequest<Record<string, unknown>>(
    config,
    'POST',
    '/api/v2/work-locations',
    body,
  );
  const evereeWorkLocationId =
    typeof raw?.id === 'number'
      ? raw.id
      : typeof raw?.workLocationId === 'number'
        ? raw.workLocationId
        : 0;
  if (!Number.isFinite(evereeWorkLocationId) || evereeWorkLocationId <= 0) {
    throw new Error(
      `ensureEvereeWorkLocation: Everee returned no usable id (externalId=${worksite.worksiteId}, raw=${JSON.stringify(raw).slice(0, 200)})`,
    );
  }

  const cacheDoc: EvereeWorkLocationCacheDoc = {
    worksiteId: worksite.worksiteId,
    evereeTenantId,
    evereeWorkLocationId,
    snapshot: {
      name: worksite.name,
      state: worksite.address?.state,
    },
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
  await ref.set(cacheDoc, { merge: true });
  logger.info('[everee.workLocations] provisioned new Everee work location', {
    tenantId,
    evereeTenantId,
    worksiteId: worksite.worksiteId,
    evereeWorkLocationId,
  });
  return evereeWorkLocationId;
}
