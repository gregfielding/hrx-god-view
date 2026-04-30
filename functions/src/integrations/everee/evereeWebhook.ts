/**
 * Everee webhook handler (HRX Everee Master Plan §6).
 *
 * Pipeline:
 *   1. Public POST endpoint `evereeWebhook` receives events from Everee.
 *   2. Verifies the signature per Everee's documented spec
 *      (https://developer.everee.com/docs/authenticating-events):
 *        - Header `x-everee-webhook-signature` carries one or more
 *          comma-separated values of the form `v1=<hex>`. Each value is an
 *          HMAC-SHA256 hex digest of the message
 *          `${x-everee-webhook-timestamp}.${rawBody}`. Multiple signatures
 *          may be present when more than one signing key is active for a
 *          company (e.g. mid-rotation). Any single matching signature
 *          authenticates the event.
 *        - Algorithm: **HMAC-SHA256**, **hex-encoded**.
 *        - Replay protection: timestamp must be within
 *          `EVEREE_WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS` (default 120) of
 *          the current server clock per Everee's "Securing your handler"
 *          guide.
 *      Secrets are resolved tenant-first: `EVEREE_WEBHOOK_SECRET_<companyId>`
 *      env var, with `EVEREE_WEBHOOK_SECRET` as a global fallback. Returns
 *      401 on signature failure, 408-style 401 on timestamp drift.
 *   3. Dedups by `eventId` into `tenants/{tid}/everee_webhook_events/{eventId}`
 *      using a transactional create-or-skip. Repeat deliveries are ack'd 200
 *      without reprocessing.
 *   4. ACKs 2xx immediately after persisting the event. Actual processing is
 *      decoupled via a Firestore onDocumentCreated trigger
 *      (`onEvereeWebhookEventCreated`) which updates downstream collections and
 *      records a processing status on the event doc. This satisfies the master
 *      plan's "async processing" requirement without the Cloud Tasks
 *      queue-provisioning overhead; Cloud Tasks can be added later if/when
 *      peak throughput or ordering guarantees demand it.
 *
 * Event dispatch is extensible — new event types add a branch in `processEvent`.
 * Current mappings:
 *   - `worker.onboarding-completed` → everee_workers.status = 'onboarding_complete'
 *     plus onboardingCompletedAt timestamps on user_employments /
 *     onboarding_instances when the worker can be resolved.
 *
 * Envelope shape (per https://developer.everee.com/docs/events-overview):
 *   {
 *     version: "1",
 *     id: "<event uuid>",
 *     companyId: 10011,             // ← Everee tenant id (numeric); we coerce to string
 *     type: "worker.onboarding-completed",
 *     timestamp: 1720011002,        // epoch seconds (in-body; signature uses header timestamp)
 *     data: { object: { ... } }     // event-specific payload nested under `data.object`
 *   }
 */

import * as admin from 'firebase-admin';
import * as crypto from 'crypto';
import { onRequest } from 'firebase-functions/v2/https';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { defineSecret } from 'firebase-functions/params';
import { logger } from 'firebase-functions/v2';
import { evereePaths } from './evereeConfig';

/**
 * Per-tenant Everee webhook secrets. Bound at deploy time so Cloud
 * Functions Gen2 mounts them into `process.env` for the function
 * runtime — without this binding the env vars are empty even when
 * `firebase functions:secrets:set` has been run, which is exactly the
 * "secretSource: none" failure mode WH.1 was tracking.
 *
 * Rotation: add a new `defineSecret('EVEREE_WEBHOOK_SECRET_<companyId>')`
 * line and append it to the `secrets:` array on `evereeWebhook` below,
 * then redeploy. The verifier already accepts multiple `v1=` signatures
 * per request so a key swap can land without a flap.
 *
 * The global fallback (`EVEREE_WEBHOOK_SECRET`) stays unbound here
 * because it ships through standard env vars / functions config and is
 * only ever a back-stop; tenant-scoped secrets are the production path.
 */
const EVEREE_WEBHOOK_SECRET_3133 = defineSecret('EVEREE_WEBHOOK_SECRET_3133');
const EVEREE_WEBHOOK_SECRET_3138 = defineSecret('EVEREE_WEBHOOK_SECRET_3138');

const db = () => admin.firestore();

type EvereeEventStatus = 'received' | 'processing' | 'processed' | 'error' | 'ignored';

interface EvereeEventEnvelope {
  /** Everee's event id — used as the Firestore doc id for dedup. */
  id?: string;
  eventId?: string;
  /** Event type, e.g. `worker.onboarding-completed`. */
  type?: string;
  event?: string;
  /**
   * Everee company / tenant id. Per Everee's events-overview spec the
   * canonical field is `companyId` (numeric). Some legacy / pilot
   * envelopes used `tenantId` instead — both are accepted.
   */
  companyId?: string | number;
  tenantId?: string;
  /** ISO8601 publish time (rare). */
  occurredAt?: string;
  /** In-body epoch seconds — distinct from `x-everee-webhook-timestamp` (header) used for signing. */
  timestamp?: number | string;
  /** Event payload — shape varies per event type, nested under `data.object`. */
  data?: Record<string, unknown>;
  payload?: Record<string, unknown>;
}

interface StoredEvent {
  eventId: string;
  evereeTenantId: string | null;
  type: string;
  receivedAt: admin.firestore.FieldValue;
  occurredAt: string | null;
  rawBody: string;
  signature: string | null;
  status: EvereeEventStatus;
  /** Our internal tenantId, resolved from evereeTenantId. Set during receive or first-process. */
  tenantId: string | null;
  /** Our internal entityId, resolved from evereeTenantId. */
  entityId: string | null;
  /** Filled in by the processor. */
  processedAt?: admin.firestore.FieldValue;
  processingError?: string;
  /** Opaque log of actions the processor took — helps audit without re-running. */
  actions?: string[];
}

/**
 * Verify Everee webhook signature per the canonical spec at
 * https://developer.everee.com/docs/authenticating-events.
 *
 *   Headers (both required):
 *     x-everee-webhook-signature: "v1=<sig1>,v1=<sig2>,..."
 *     x-everee-webhook-timestamp: "<unix-seconds>"
 *
 *   Multiple comma-separated signatures support concurrent signing keys
 *   for an account (e.g. mid-rotation). Each is `v1=<hex>` per Everee's
 *   spec; the only currently-valid version is `v1`. Any single matching
 *   signature authenticates the request.
 *
 *   Signed message: `<timestamp>.<rawBody>` — the literal bytes Everee
 *   signed. Algorithm: HMAC-SHA256, hex-encoded.
 *
 *   We resolve the secret tenant-first (`EVEREE_WEBHOOK_SECRET_<companyId>`)
 *   with a global `EVEREE_WEBHOOK_SECRET` fallback. Returning `false`
 *   when no secret is configured prevents a misconfigured deploy from
 *   silently accepting unauthenticated traffic.
 *
 *   Replay protection (timestamp-window check) is enforced separately at
 *   the call site so a signature failure and a timestamp drift produce
 *   distinct log lines.
 */
export function verifySignature(
  rawBody: string,
  signatureHeader: string | null,
  webhookTimestamp: string | null,
  evereeTenantId: string | null,
): boolean {
  if (!signatureHeader || !webhookTimestamp) return false;

  const tenantScopedSecret =
    evereeTenantId && process.env[`EVEREE_WEBHOOK_SECRET_${evereeTenantId}`];
  const globalSecret = process.env.EVEREE_WEBHOOK_SECRET;
  const secret = tenantScopedSecret || globalSecret;
  if (!secret) return false;

  const message = `${webhookTimestamp}.${rawBody}`;
  const expectedHex = crypto.createHmac('sha256', secret).update(message).digest('hex');
  const expectedBuf = Buffer.from(expectedHex, 'hex');

  // Per spec, the header is a comma-separated list of `<version>=<sig>`
  // entries. Discard any entry whose version is not `v1` (Everee may add
  // a `v2` later, but until they do we must not silently accept it).
  const candidates: string[] = [];
  for (const entry of signatureHeader.split(',')) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx <= 0) continue;
    const version = trimmed.slice(0, eqIdx);
    const sig = trimmed.slice(eqIdx + 1);
    if (version !== 'v1' || !sig) continue;
    candidates.push(sig);
  }

  for (const candidate of candidates) {
    // Reject obviously-invalid hex up front so `Buffer.from('zz', 'hex')`
    // doesn't silently produce a length-1 buffer that happens to match
    // by accident on a degenerate secret.
    if (!/^[0-9a-fA-F]+$/.test(candidate) || candidate.length % 2 !== 0) continue;
    let candidateBuf: Buffer;
    try {
      candidateBuf = Buffer.from(candidate, 'hex');
    } catch {
      continue;
    }
    if (candidateBuf.length !== expectedBuf.length) continue;
    try {
      if (crypto.timingSafeEqual(candidateBuf, expectedBuf)) return true;
    } catch {
      /* try the next candidate */
    }
  }

  return false;
}

/**
 * Replay-protection window for `x-everee-webhook-timestamp` (epoch
 * seconds). Per Everee's "Securing your handler" guide, 2 minutes is the
 * recommended ceiling. Override via env for backfill / replay tooling.
 */
const EVEREE_WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS = (() => {
  const raw = process.env.EVEREE_WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS;
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 120;
})();

/**
 * Returns true when `webhookTimestamp` (epoch seconds, as a string) is
 * within the configured tolerance of `nowSeconds`. Exposed for the unit
 * tests so they can pin "expired" / "future-skew" branches without
 * mocking Date.now everywhere.
 */
export function isWebhookTimestampWithinTolerance(
  webhookTimestamp: string | null,
  nowSeconds: number,
  toleranceSeconds: number = EVEREE_WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS,
): boolean {
  if (!webhookTimestamp) return false;
  const ts = Number(webhookTimestamp);
  if (!Number.isFinite(ts)) return false;
  return Math.abs(nowSeconds - ts) <= toleranceSeconds;
}

/**
 * Pull the Everee tenant id from an event envelope. Per Everee's
 * events-overview spec the canonical field is `companyId` at the root of
 * the body (numeric); we coerce to a string so it lines up with our
 * `EVEREE_WEBHOOK_SECRET_<companyId>` env-var lookup. We also accept a
 * handful of legacy shapes (`tenantId`, `accountId`, nested under `data`
 * / `payload`) so pilot envelopes Everee may have sent during private
 * preview don't silently fail.
 *
 * Exported for unit testing — the envelope-shape variability is the
 * main source of historical bugs (most recently the `tenantId`-vs-
 * `companyId` mismatch that produced the WH.1 401 storm).
 */
export function pickEvereeTenantIdFromEnvelope(
  envelope: EvereeEventEnvelope,
): string | null {
  const candidates: unknown[] = [
    // Everee canonical (root). Numeric in practice.
    envelope.companyId,
    // Legacy / pilot shapes — kept defensive so a back-fill of older
    // events still routes correctly during replay.
    envelope.tenantId,
    (envelope as Record<string, unknown>).evereeTenantId,
    (envelope as Record<string, unknown>).accountId,
    envelope.data?.companyId,
    envelope.data?.tenantId,
    envelope.data?.evereeTenantId,
    envelope.data?.accountId,
    envelope.payload?.companyId,
    envelope.payload?.tenantId,
    envelope.payload?.evereeTenantId,
    envelope.payload?.accountId,
    (envelope as Record<string, unknown>).tenant &&
      ((envelope as Record<string, unknown>).tenant as Record<string, unknown>)?.id,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim();
    if (typeof c === 'number' && Number.isFinite(c)) return String(c);
  }
  return null;
}

/**
 * Resolve an HRX tenantId + entityId pair for the Everee tenant reported on the event.
 * We lookup entities by `evereeTenantId`; if Everee ever billed a single HRX tenant across
 * multiple entities sharing the same Everee tenant, we return the first active one (the
 * caller logs all matches for investigation).
 */
async function resolveTenantEntityFromEvereeTenant(
  evereeTenantId: string | null,
): Promise<{ tenantId: string; entityId: string } | null> {
  if (!evereeTenantId) return null;
  const snap = await db()
    .collectionGroup('entities')
    .where('evereeTenantId', '==', evereeTenantId)
    .where('payrollProvider', '==', 'everee')
    .limit(5)
    .get();
  if (snap.empty) return null;
  if (snap.size > 1) {
    logger.warn('everee.webhook.multiple_entity_matches', {
      evereeTenantId,
      matches: snap.docs.map((d) => d.ref.path),
    });
  }
  const doc = snap.docs[0];
  // Path is `tenants/{tenantId}/entities/{entityId}`.
  const parts = doc.ref.path.split('/');
  if (parts.length < 4) return null;
  return { tenantId: parts[1], entityId: parts[3] };
}

/**
 * Webhook ingress. Fast path: verify signature → dedup → persist → ack. The
 * `rawBody` field is preserved so the async processor can re-verify signatures
 * if the shared secret is ever rotated mid-flight.
 */
export const evereeWebhook = onRequest(
  {
    cors: false,
    invoker: 'public',
    timeoutSeconds: 30,
    memory: '512MiB',
    // Bind the per-tenant secrets so Cloud Functions Gen2 mounts them
    // into the runtime's `process.env`. Without this list the
    // `EVEREE_WEBHOOK_SECRET_*` lookups in `verifySignature` resolve to
    // empty strings even after `firebase functions:secrets:set` — the
    // exact failure mode WH.1 was tracking.
    secrets: [EVEREE_WEBHOOK_SECRET_3133, EVEREE_WEBHOOK_SECRET_3138],
  },
  async (req, res) => {
    // Everee will POST JSON. Anything else is noise.
    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }
    // We need the literal bytes Everee signed. Firebase Functions v2 exposes
    // the raw body via `req.rawBody` for onRequest; fall back to re-stringifying
    // when the emulator strips it.
    const rawBuf: Buffer | undefined = (req as any).rawBody;
    const rawBody = rawBuf ? rawBuf.toString('utf8') : JSON.stringify(req.body ?? {});

    let envelope: EvereeEventEnvelope = {};
    try {
      envelope = rawBody ? (JSON.parse(rawBody) as EvereeEventEnvelope) : {};
    } catch (err) {
      logger.warn('everee.webhook.invalid_json', { err: (err as Error)?.message });
      // Everee retries on 5xx; 400 tells it the body will never parse.
      res.status(400).send('Invalid JSON');
      return;
    }

    const eventId = String(envelope.eventId || envelope.id || '').trim();
    const type = String(envelope.type || envelope.event || '').trim();
    // Some integrations URL-route the webhook with `?tenantId=3138`; honour
    // that as a last-resort hint so per-tenant secrets work even when the body
    // shape changes.
    const tenantQueryParam =
      typeof req.query?.tenantId === 'string' ? (req.query.tenantId as string).trim() : '';
    const evereeTenantId =
      pickEvereeTenantIdFromEnvelope(envelope) || tenantQueryParam || null;
    const occurredAt = typeof envelope.occurredAt === 'string' ? envelope.occurredAt : null;
    // Canonical Everee headers per https://developer.everee.com/docs/authenticating-events.
    const signatureHeader =
      (req.header('x-everee-webhook-signature') as string | null) || null;
    const webhookTimestamp =
      (req.header('x-everee-webhook-timestamp') as string | null) || null;

    if (!eventId || !type) {
      logger.warn('everee.webhook.missing_fields', { eventId, type });
      res.status(400).send('Missing eventId or type');
      return;
    }

    // Replay protection: per Everee's "Securing your handler" guide, reject
    // if the timestamp is outside the configured tolerance window. This is
    // enforced before the signature check so a clock-skew failure produces
    // a distinct log line.
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (
      !isWebhookTimestampWithinTolerance(webhookTimestamp, nowSeconds)
    ) {
      logger.warn('everee.webhook.timestamp_out_of_window', {
        eventId,
        type,
        evereeTenantId,
        hasSignature: !!signatureHeader,
        hasTimestamp: !!webhookTimestamp,
        toleranceSeconds: EVEREE_WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS,
      });
      res.status(401).send('Timestamp out of tolerance window');
      return;
    }

    if (!verifySignature(rawBody, signatureHeader, webhookTimestamp, evereeTenantId)) {
      // WH.1 trim: the verbose discovery diagnostics
      // (sigPrefix/sigLen/expectedHexPrefix/etc.) lived here previously
      // and were the entire reason we figured out the canonical spec.
      // They're intentionally gone now — production-level fields only.
      // Restore the verbose block from git history (commit prior to WH.1)
      // if a fresh signature failure surfaces and we need to re-discover.
      logger.warn('everee.webhook.bad_signature', {
        eventId,
        type,
        evereeTenantId,
        hasSignature: !!signatureHeader,
        hasTimestamp: !!webhookTimestamp,
      });
      // 401 discourages replay; Everee treats it as a permanent failure per webhook best practice.
      res.status(401).send('Bad signature');
      return;
    }

    // Resolve HRX tenant/entity so the event doc lives under the right tenant.
    const resolved = await resolveTenantEntityFromEvereeTenant(evereeTenantId);
    if (!resolved) {
      // Still ack 200 so Everee stops retrying; drop into an "unknown" tenant
      // bucket for manual triage. Without this we'd spam retries on every pilot
      // account that hasn't been wired up yet.
      logger.warn('everee.webhook.unknown_tenant', { eventId, type, evereeTenantId });
      await db()
        .collection('tenants')
        .doc('_unrouted_everee')
        .collection('everee_webhook_events')
        .doc(eventId)
        .set(
          {
            eventId,
            evereeTenantId,
            type,
            receivedAt: admin.firestore.FieldValue.serverTimestamp(),
            occurredAt,
            rawBody,
            signature: signatureHeader,
            status: 'ignored',
            tenantId: null,
            entityId: null,
            processingError: 'Unknown evereeTenantId — no entity match.',
          } satisfies StoredEvent,
          { merge: false },
        );
      res.status(200).send('OK (unrouted)');
      return;
    }

    const { tenantId, entityId } = resolved;
    const eventRef = db().doc(`${evereePaths.webhookEvents(tenantId)}/${eventId}`);

    // Transactional create-or-skip for dedup.
    const createResult = await db().runTransaction(async (tx) => {
      const existing = await tx.get(eventRef);
      if (existing.exists) return { created: false };
      tx.set(eventRef, {
        eventId,
        evereeTenantId,
        type,
        receivedAt: admin.firestore.FieldValue.serverTimestamp(),
        occurredAt,
        rawBody,
        signature: signatureHeader,
        status: 'received',
        tenantId,
        entityId,
      } satisfies StoredEvent);
      return { created: true };
    });

    if (!createResult.created) {
      logger.info('everee.webhook.duplicate', { eventId, type, tenantId });
    }
    res.status(200).send('OK');
  },
);

/**
 * Async processor. Fires on `everee_webhook_events/{eventId}` doc create and
 * dispatches by event type. Kept idempotent: reads the event's `status` and
 * short-circuits if it's already `processed` / `ignored`. On error, writes the
 * message back so we can fix + re-enqueue without replaying the original HTTP
 * delivery (`status: error` rows are our retry queue).
 */
export const onEvereeWebhookEventCreated = onDocumentCreated(
  {
    document: 'tenants/{tenantId}/everee_webhook_events/{eventId}',
    retry: false,
  },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const tenantId = event.params.tenantId;
    const eventId = event.params.eventId;
    const ref = snap.ref;
    const data = snap.data() as StoredEvent;

    if (data.status === 'processed' || data.status === 'ignored') return;

    await ref.update({
      status: 'processing' as EvereeEventStatus,
    });

    try {
      const actions = await processEvent(tenantId, data);
      await ref.update({
        status: 'processed' as EvereeEventStatus,
        processedAt: admin.firestore.FieldValue.serverTimestamp(),
        actions,
      });
    } catch (err) {
      const msg = (err as Error)?.message || String(err);
      logger.error('everee.webhook.process_error', {
        tenantId,
        eventId,
        type: data.type,
        err: msg,
      });
      await ref.update({
        status: 'error' as EvereeEventStatus,
        processingError: msg,
      });
    }
  },
);

/**
 * Route a stored event to the right handler. Returns a short list of
 * human-readable actions we performed, for audit trails on the event doc.
 * Extend with new branches as Everee adds event types.
 */
async function processEvent(tenantId: string, data: StoredEvent): Promise<string[]> {
  const payload = parsePayload(data.rawBody);
  switch (data.type) {
    case 'worker.onboarding-completed':
    case 'worker.onboarding_completed':
      return handleWorkerOnboardingCompleted(tenantId, data, payload);
    default:
      return [`Unhandled event type: ${data.type}`];
  }
}

function parsePayload(rawBody: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(rawBody) as EvereeEventEnvelope;
    return (parsed.data || parsed.payload || {}) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * worker.onboarding-completed:
 *   - Mark everee_workers.status = 'onboarding_complete'
 *   - Mirror onboardingCompletedAt onto user_employments row(s) for this
 *     entity+user so downstream readiness snapshots flip exactly like they
 *     do when a recruiter checks the manual "payroll complete" box.
 *   - Same treatment for onboarding_instances — these feed the per-shift
 *     readiness calculation.
 *
 * Payload shape (expected, to be confirmed against sandbox):
 *   { workerId: string (Everee's), externalId?: string (our everee_worker doc id),
 *     userId?: string, entityId?: string }
 */
async function handleWorkerOnboardingCompleted(
  tenantId: string,
  data: StoredEvent,
  payload: Record<string, unknown>,
): Promise<string[]> {
  const actions: string[] = [];
  const evereeWorkerId =
    (payload.workerId as string | undefined) ||
    (payload.evereeWorkerId as string | undefined) ||
    null;
  // externalId is where we stashed `${entityId}__${userId}` when we created the worker.
  const externalId =
    (payload.externalId as string | undefined) ||
    (payload.externalWorkerId as string | undefined) ||
    null;

  // Resolve the everee_workers doc. Prefer externalId lookup (O(1)), fall
  // back to query by externalWorkerId (O(entity workers)).
  let workerRef: admin.firestore.DocumentReference | null = null;
  let workerDoc: admin.firestore.DocumentSnapshot | null = null;
  if (externalId) {
    const tryRef = db().doc(`${evereePaths.workers(tenantId)}/${externalId}`);
    const tryDoc = await tryRef.get();
    if (tryDoc.exists) {
      workerRef = tryRef;
      workerDoc = tryDoc;
    }
  }
  if (!workerRef && evereeWorkerId) {
    const q = await db()
      .collection(evereePaths.workers(tenantId))
      .where('externalWorkerId', '==', evereeWorkerId)
      .limit(1)
      .get();
    if (!q.empty) {
      workerRef = q.docs[0].ref;
      workerDoc = q.docs[0];
    }
  }
  if (!workerRef || !workerDoc) {
    actions.push(
      `Worker not found (externalId=${externalId}, evereeWorkerId=${evereeWorkerId}); skipped downstream updates.`,
    );
    return actions;
  }

  const now = admin.firestore.FieldValue.serverTimestamp();
  await workerRef.set(
    {
      status: 'onboarding_complete',
      onboardingCompletedAt: now,
      updatedAt: now,
      lastWebhookEventId: data.eventId,
    },
    { merge: true },
  );
  actions.push('Set everee_workers.status=onboarding_complete');

  // Mirror onto user_employments and onboarding_instances so readiness snapshots flip.
  const workerData = workerDoc.data() as { userId?: string; entityId?: string };
  const userId = workerData?.userId;
  const entityId = workerData?.entityId;
  if (!userId || !entityId) {
    actions.push('everee_workers row missing userId/entityId — no employment mirror performed.');
    return actions;
  }

  const empQuery = await db()
    .collection(`tenants/${tenantId}/user_employments`)
    .where('userId', '==', userId)
    .where('entityId', '==', entityId)
    .limit(5)
    .get();
  for (const empDoc of empQuery.docs) {
    await empDoc.ref.set(
      {
        payrollOnboardingCompletedAt: now,
        evereeOnboardingStatus: 'complete',
        updatedAt: now,
      },
      { merge: true },
    );
    actions.push(`Updated user_employments/${empDoc.id}`);
  }

  const instQuery = await db()
    .collection(`tenants/${tenantId}/onboarding_instances`)
    .where('userId', '==', userId)
    .where('entityId', '==', entityId)
    .limit(10)
    .get();
  for (const instDoc of instQuery.docs) {
    await instDoc.ref.set(
      {
        payrollOnboardingCompletedAt: now,
        evereeOnboardingStatus: 'complete',
        updatedAt: now,
      },
      { merge: true },
    );
    actions.push(`Updated onboarding_instances/${instDoc.id}`);
  }

  return actions;
}
