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
import { reconcileWorkerInternal } from './evereeReconcileWorker';
import { importEntryDocId, payableStatusDocId } from '../../timesheets/importEntryKeys';

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

      // E.2 — refresh the readiness snapshot regardless of event type.
      // The dedicated `processEvent` handlers cover the *known* events
      // (`worker.onboarding-completed` etc.) but Everee fires plenty of
      // others we don't yet have explicit handlers for (bank account
      // changes, file signatures, W-4 updates, etc.). Reconcile after
      // every event guarantees the snapshot is fresh whenever Everee
      // tells us anything happened, even if we can't classify the
      // event payload yet. Best-effort: reconcile failure must not
      // re-mark the event as `error` (the dedicated handler already
      // succeeded), so we swallow the error and log.
      const reconcileActions = await reconcileWorkerFromWebhookEvent(tenantId, data);
      const allActions = [...actions, ...reconcileActions];

      await ref.update({
        status: 'processed' as EvereeEventStatus,
        processedAt: admin.firestore.FieldValue.serverTimestamp(),
        actions: allActions,
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
 * E.2 — best-effort readiness-snapshot refresh after a webhook event.
 *
 * Resolves the affected worker tuple from the event body and calls
 * `reconcileWorkerInternal` so the `everee_workers/{eId__uId}.readinessMirror`
 * snapshot is fresh within seconds of any Everee event landing — not
 * just `worker.onboarding-completed`. When the worker can't be
 * resolved (no `workerId` in payload, no matching link doc) we return
 * a single audit-action string so the event doc still tells the
 * operator what happened.
 *
 * Never throws — the caller's `try/catch` will mark the event `error`
 * if it does, which is the wrong signal because `processEvent` already
 * succeeded.
 */
async function reconcileWorkerFromWebhookEvent(
  tenantId: string,
  data: StoredEvent,
): Promise<string[]> {
  try {
    const payload = parsePayload(data.rawBody);
    const evereeWorkerId =
      (typeof payload.workerId === 'string' && payload.workerId) ||
      (typeof payload.evereeWorkerId === 'string' && payload.evereeWorkerId) ||
      '';
    // The webhook envelope sometimes already carries an externalId of
    // `${entityId}__${userId}` — prefer that (O(1) doc lookup) over the
    // workerId scan.
    const externalId =
      (typeof payload.externalId === 'string' && payload.externalId) ||
      (typeof payload.externalWorkerId === 'string' && payload.externalWorkerId) ||
      '';

    let entityId = '';
    let userId = '';
    let resolvedEvereeWorkerId = evereeWorkerId;

    if (externalId && externalId.includes('__')) {
      const linkSnap = await db()
        .doc(`${evereePaths.workers(tenantId)}/${externalId}`)
        .get();
      if (linkSnap.exists) {
        const linkData = linkSnap.data() as {
          entityId?: string;
          userId?: string;
          evereeWorkerId?: string;
          externalWorkerId?: string;
        };
        entityId = linkData.entityId ?? '';
        userId = linkData.userId ?? '';
        resolvedEvereeWorkerId =
          resolvedEvereeWorkerId ||
          linkData.evereeWorkerId ||
          linkData.externalWorkerId ||
          '';
      }
    }

    if ((!entityId || !userId) && resolvedEvereeWorkerId) {
      const q = await db()
        .collection(evereePaths.workers(tenantId))
        .where('evereeWorkerId', '==', resolvedEvereeWorkerId)
        .limit(1)
        .get();
      if (q.empty) {
        // Fall back to the legacy field name some pilot rows still use.
        const q2 = await db()
          .collection(evereePaths.workers(tenantId))
          .where('externalWorkerId', '==', resolvedEvereeWorkerId)
          .limit(1)
          .get();
        if (!q2.empty) {
          const d = q2.docs[0].data() as { entityId?: string; userId?: string };
          entityId = d.entityId ?? '';
          userId = d.userId ?? '';
        }
      } else {
        const d = q.docs[0].data() as { entityId?: string; userId?: string };
        entityId = d.entityId ?? '';
        userId = d.userId ?? '';
      }
    }

    if (!entityId || !userId || !resolvedEvereeWorkerId) {
      return [
        `Reconcile skipped: could not resolve worker tuple (entityId=${entityId || '?'}, userId=${userId || '?'}, evereeWorkerId=${resolvedEvereeWorkerId || '?'}).`,
      ];
    }

    const result = await reconcileWorkerInternal({
      tenantId,
      entityId,
      userId,
      evereeWorkerId: resolvedEvereeWorkerId,
      syncSource: 'webhook',
    });

    if (result.ok) {
      return ['Refreshed readinessMirror via reconcileWorkerInternal (syncSource=webhook).'];
    }
    return [`Reconcile reported ok=false: reason=${result.reason ?? 'unknown'}.`];
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn('everee.webhook.reconcile_failed', {
      eventId: data.eventId,
      type: data.type,
      message: message.slice(0, 240),
    });
    return [`Reconcile failed: ${message.slice(0, 240)}`];
  }
}

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

    // TS.1.P4 Slice 5 — Payables / payment lifecycle.
    //
    // Each of these events references one or more `payableExternalIds`
    // we minted at orchestration time. Their format is documented in
    // `evereePayables.ts:buildPayableExternalId` (4-part) and
    // `buildAdjustmentExternalId` (2-part); the parser below recovers
    // the originating doc id without an explicit reverse-lookup table.
    //
    // Batch-level rollup (flipping `timesheet_batches.status` to
    // 'success' once every entry is terminal) is intentionally deferred
    // to Slice 7's reconciler cron, which is a better fit: it's
    // idempotent, doesn't race with concurrent webhook events, and is
    // already responsible for catching dropped webhooks.
    case 'payment.deposit-returned':
      return handlePaymentDepositReturned(tenantId, data, payload);
    case 'payment.paid':
      return handlePaymentPaid(tenantId, data, payload);
    case 'payment-payables.status-changed':
      return handlePayablesStatusChanged(tenantId, data, payload);

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

// ─────────────────────────────────────────────────────────────────────
// TS.1.P4 Slice 5 — Payables / payment-lifecycle handlers
// ─────────────────────────────────────────────────────────────────────

/**
 * Parse a payable externalId back to the originating doc reference. The
 * orchestrator mints externalIds via two pinned formats (see
 * `evereePayables.ts:buildPayableExternalId` and
 * `buildAdjustmentExternalId`):
 *
 *   Payable     — `{tenantId}::{assignmentId}::{workDate}::{KIND}`   (4 parts)
 *   Adjustment  — `{tenantId}::{adjustmentId}`                       (2 parts)
 *
 * The webhook handler uses this to recover the right Firestore doc
 * without an explicit reverse-lookup table. Pure helper; no Firestore
 * access here.
 */
export type ParsedPayableExternalId =
  | {
      kind: 'payable';
      tenantId: string;
      assignmentId: string;
      workDate: string;
      payableKind: string;
      /** Deterministic id of the `timesheet_entries` doc the payable was
       *  derived from — caller can `get` it directly. */
      entryDocId: string;
    }
  | { kind: 'adjustment'; tenantId: string; adjustmentId: string }
  | null;

export function parsePayableExternalId(externalId: string | null | undefined): ParsedPayableExternalId {
  if (!externalId || typeof externalId !== 'string') return null;
  const parts = externalId.split('::');
  if (parts.length === 4) {
    const [tenantId, assignmentId, workDate, payableKind] = parts;
    if (!tenantId || !assignmentId || !workDate || !payableKind) return null;
    return {
      kind: 'payable',
      tenantId,
      assignmentId,
      workDate,
      payableKind,
      entryDocId: `${assignmentId}_${workDate}`,
    };
  }
  if (parts.length === 2) {
    const [tenantId, adjustmentId] = parts;
    if (!tenantId || !adjustmentId) return null;
    return { kind: 'adjustment', tenantId, adjustmentId };
  }
  return null;
}

/**
 * Pull the externalIds out of an event payload. Accepts either the
 * documented array shape (`payableExternalIds: string[]`) or the
 * singular `externalId` that `payment-payables.status-changed` uses.
 * Returns an empty array if neither is present.
 */
function extractExternalIds(payload: Record<string, unknown>): string[] {
  const out: string[] = [];
  const arr = payload.payableExternalIds;
  if (Array.isArray(arr)) {
    for (const v of arr) if (typeof v === 'string' && v.trim()) out.push(v.trim());
  }
  const single = payload.externalId;
  if (typeof single === 'string' && single.trim()) out.push(single.trim());
  return out;
}

/**
 * Apply a per-entry status mutation. Idempotent — the per-event-id
 * dedup at the webhook entry point already prevents replay, but this
 * is additionally safe to re-call because the writes are unconditional
 * `set(..., { merge: true })`.
 */
async function applyEntryStatusUpdate(
  tenantId: string,
  entryDocId: string,
  patch: {
    status: 'paid' | 'error';
    evereeStatus?: string;
    errorCode?: string;
    errorMessage?: string;
    lastWebhookEventId: string;
  },
): Promise<boolean> {
  const ref = db().doc(`tenants/${tenantId}/timesheet_entries/${entryDocId}`);
  const snap = await ref.get();
  if (!snap.exists) return false;
  const now = admin.firestore.FieldValue.serverTimestamp();
  await ref.set(
    {
      status: patch.status,
      everee: {
        status: patch.evereeStatus,
        errorCode: patch.errorCode,
        errorMessage: patch.errorMessage,
        respondedAt: now,
      },
      lastWebhookEventId: patch.lastWebhookEventId,
      updatedAt: now,
    },
    { merge: true },
  );
  return true;
}

/**
 * CSV-import payables/worked-shifts don't map to an `{assignmentId}_{workDate}`
 * entry, so `applyEntryStatusUpdate` no-ops for them. Instead, recover the row
 * from its `timesheet_import_payables` ledger doc (keyed by the sanitized
 * externalId) and stamp BOTH the ledger doc and the canonical import entry as
 * paid — flipping the Timesheet Grid + Import tab from "submitted" to "paid".
 *
 * Returns an action string when this WAS an import row (handled), else null so
 * the caller continues with the normal entry/adjustment path.
 */
async function markImportEntryPaid(
  tenantId: string,
  externalId: string,
  eventId: string,
): Promise<string | null> {
  // Import externalIds are `{tenantId}::import-{customer}-{userId}::{date}::{kind}`.
  if (!externalId.includes('::import-')) return null;
  const ledgerRef = db().doc(
    `tenants/${tenantId}/timesheet_import_payables/${payableStatusDocId(externalId)}`,
  );
  const snap = await ledgerRef.get();
  if (!snap.exists) return null;
  const d = snap.data() || {};
  const now = admin.firestore.FieldValue.serverTimestamp();
  await ledgerRef.set(
    { status: 'paid', paidAt: now, updatedAt: now, lastWebhookEventId: eventId },
    { merge: true },
  );
  const customer = String(d.customer || '');
  const userId = String(d.externalWorkerId || '');
  const workDate = String(d.workDate || '');
  if (customer && userId && workDate) {
    await db()
      .doc(`tenants/${tenantId}/timesheet_entries/${importEntryDocId({ customer, userId, workDate })}`)
      .set(
        {
          status: 'paid',
          import: { matchStatus: 'paid' },
          everee: { status: 'PAID', respondedAt: now },
          lastWebhookEventId: eventId,
          updatedAt: now,
        },
        { merge: true },
      );
  }
  return `Marked import row ${externalId} paid`;
}

/**
 * Same shape as `applyEntryStatusUpdate` but for adjustments. Kept
 * separate so the field paths stay obvious (adjustment.everee vs
 * entry.everee — same nested shape, different parent collection).
 */
async function applyAdjustmentStatusUpdate(
  tenantId: string,
  adjustmentId: string,
  patch: {
    status: 'paid' | 'error';
    evereeStatus?: string;
    errorCode?: string;
    errorMessage?: string;
    lastWebhookEventId: string;
  },
): Promise<boolean> {
  const ref = db().doc(`tenants/${tenantId}/timesheet_adjustments/${adjustmentId}`);
  const snap = await ref.get();
  if (!snap.exists) return false;
  const now = admin.firestore.FieldValue.serverTimestamp();
  await ref.set(
    {
      status: patch.status,
      everee: {
        status: patch.evereeStatus,
        error: patch.errorMessage,
        respondedAt: now,
      },
      lastWebhookEventId: patch.lastWebhookEventId,
      updatedAt: now,
    },
    { merge: true },
  );
  return true;
}

/**
 * `payment.deposit-returned` — Everee initiated a payment but the bank
 * returned the ACH (bad routing/account, closed account, frozen, etc.).
 * The worker didn't get paid. Surface this as an `error` state on the
 * affected entries/adjustments so the recruiter is prompted to fix
 * banking info before re-batching.
 *
 * **Default-on event** per Everee — fires without requiring company-
 * instance enablement, unlike `payment.paid` and
 * `payment-payables.status-changed`.
 */
async function handlePaymentDepositReturned(
  tenantId: string,
  data: StoredEvent,
  payload: Record<string, unknown>,
): Promise<string[]> {
  const actions: string[] = [];
  const externalIds = extractExternalIds(payload);
  if (externalIds.length === 0) {
    actions.push('payment.deposit-returned: no payableExternalIds in payload — nothing to update.');
    return actions;
  }
  const reason =
    typeof payload.errorMessage === 'string' && payload.errorMessage
      ? payload.errorMessage
      : 'ACH deposit returned by bank';
  for (const externalId of externalIds) {
    const parsed = parsePayableExternalId(externalId);
    if (!parsed) {
      actions.push(`Skipped unparseable externalId: ${externalId}`);
      continue;
    }
    if (parsed.kind === 'payable') {
      const updated = await applyEntryStatusUpdate(parsed.tenantId, parsed.entryDocId, {
        status: 'error',
        evereeStatus: 'DEPOSIT_RETURNED',
        errorCode: 'deposit_returned',
        errorMessage: reason,
        lastWebhookEventId: data.eventId,
      });
      actions.push(
        updated
          ? `Marked entry ${parsed.entryDocId} as error (deposit_returned)`
          : `Entry ${parsed.entryDocId} not found; skipped.`,
      );
    } else {
      const updated = await applyAdjustmentStatusUpdate(parsed.tenantId, parsed.adjustmentId, {
        status: 'error',
        evereeStatus: 'DEPOSIT_RETURNED',
        errorCode: 'deposit_returned',
        errorMessage: reason,
        lastWebhookEventId: data.eventId,
      });
      actions.push(
        updated
          ? `Marked adjustment ${parsed.adjustmentId} as error (deposit_returned)`
          : `Adjustment ${parsed.adjustmentId} not found; skipped.`,
      );
    }
  }
  return actions;
}

/**
 * `payment.paid` — Everee successfully transferred funds to the worker.
 * Flip every referenced entry/adjustment to `paid`.
 *
 * **Requires Everee company-instance enablement** (see addendum §11
 * preconditions — Everee enabled this on all 3 C1 instances per
 * 2026-05-07 Piers email; webhook URLs still need to be configured in
 * each portal before events start arriving, Slice 5 operational task).
 *
 * Batch-level finalization (flipping `timesheet_batches.status` to
 * 'success' once every entry is terminal) is deferred to Slice 7's
 * reconciler cron — see comment in `processEvent`.
 */
async function handlePaymentPaid(
  tenantId: string,
  data: StoredEvent,
  payload: Record<string, unknown>,
): Promise<string[]> {
  const actions: string[] = [];
  const externalIds = extractExternalIds(payload);
  if (externalIds.length === 0) {
    actions.push('payment.paid: no payableExternalIds in payload — nothing to update.');
    return actions;
  }
  for (const externalId of externalIds) {
    // CSV-import rows first — they don't map to an assignment-keyed entry.
    const importAction = await markImportEntryPaid(tenantId, externalId, data.eventId);
    if (importAction) {
      actions.push(importAction);
      continue;
    }
    const parsed = parsePayableExternalId(externalId);
    if (!parsed) {
      actions.push(`Skipped unparseable externalId: ${externalId}`);
      continue;
    }
    if (parsed.kind === 'payable') {
      const updated = await applyEntryStatusUpdate(parsed.tenantId, parsed.entryDocId, {
        status: 'paid',
        evereeStatus: 'PAID',
        lastWebhookEventId: data.eventId,
      });
      actions.push(
        updated
          ? `Marked entry ${parsed.entryDocId} as paid`
          : `Entry ${parsed.entryDocId} not found; skipped.`,
      );
    } else {
      const updated = await applyAdjustmentStatusUpdate(parsed.tenantId, parsed.adjustmentId, {
        status: 'paid',
        evereeStatus: 'PAID',
        lastWebhookEventId: data.eventId,
      });
      actions.push(
        updated
          ? `Marked adjustment ${parsed.adjustmentId} as paid`
          : `Adjustment ${parsed.adjustmentId} not found; skipped.`,
      );
    }
  }
  return actions;
}

/**
 * `payment-payables.status-changed` — Everee updated the lifecycle
 * status of a single payable. Maps to:
 *
 *   PAID                → entry/adjustment.status = 'paid'
 *   ERROR               → entry/adjustment.status = 'error'
 *   UNPAYABLE_WORKER    → entry/adjustment.status = 'error' (worker
 *                         can't receive funds — typically blocked
 *                         banking info or compliance hold)
 *
 * Any other status is recorded on `everee.status` but doesn't flip our
 * top-level `status` — those are intermediate Everee states (PENDING,
 * IN_PROGRESS, etc.) that don't terminate the entry's lifecycle.
 *
 * Fires per-payable, so the payload carries a single `externalId` (not
 * an array). The extractor handles both forms defensively.
 */
async function handlePayablesStatusChanged(
  tenantId: string,
  data: StoredEvent,
  payload: Record<string, unknown>,
): Promise<string[]> {
  const actions: string[] = [];
  const externalIds = extractExternalIds(payload);
  const evereeStatus =
    typeof payload.paymentStatus === 'string'
      ? payload.paymentStatus
      : typeof payload.status === 'string'
        ? payload.status
        : '';
  const errorMessage =
    typeof payload.errorMessage === 'string' ? payload.errorMessage : undefined;
  if (externalIds.length === 0) {
    actions.push('payment-payables.status-changed: no externalIds in payload — nothing to update.');
    return actions;
  }

  // Map Everee status → our top-level entry/adjustment status. Anything
  // that isn't a terminal mapping just gets stamped onto everee.status
  // without flipping the local lifecycle.
  let nextLocalStatus: 'paid' | 'error' | null = null;
  let errorCode: string | undefined;
  const upperStatus = evereeStatus.toUpperCase();
  if (upperStatus === 'PAID') {
    nextLocalStatus = 'paid';
  } else if (upperStatus === 'ERROR' || upperStatus === 'UNPAYABLE_WORKER') {
    nextLocalStatus = 'error';
    errorCode = upperStatus === 'UNPAYABLE_WORKER' ? 'unpayable_worker' : 'payable_error';
  }

  for (const externalId of externalIds) {
    // CSV-import rows first — only the PAID terminal state is mirrored onto
    // the import entry (error/void corrections flow through the Import tab).
    if (nextLocalStatus === 'paid') {
      const importAction = await markImportEntryPaid(tenantId, externalId, data.eventId);
      if (importAction) {
        actions.push(importAction);
        continue;
      }
    }
    const parsed = parsePayableExternalId(externalId);
    if (!parsed) {
      actions.push(`Skipped unparseable externalId: ${externalId}`);
      continue;
    }
    if (!nextLocalStatus) {
      // Non-terminal Everee status — stamp everee.status only.
      actions.push(
        `Non-terminal Everee status '${evereeStatus}' for ${externalId} — no local status change.`,
      );
      continue;
    }
    if (parsed.kind === 'payable') {
      const updated = await applyEntryStatusUpdate(parsed.tenantId, parsed.entryDocId, {
        status: nextLocalStatus,
        evereeStatus: upperStatus,
        errorCode,
        errorMessage,
        lastWebhookEventId: data.eventId,
      });
      actions.push(
        updated
          ? `Marked entry ${parsed.entryDocId} as ${nextLocalStatus} (everee=${upperStatus})`
          : `Entry ${parsed.entryDocId} not found; skipped.`,
      );
    } else {
      const updated = await applyAdjustmentStatusUpdate(parsed.tenantId, parsed.adjustmentId, {
        status: nextLocalStatus,
        evereeStatus: upperStatus,
        errorCode,
        errorMessage,
        lastWebhookEventId: data.eventId,
      });
      actions.push(
        updated
          ? `Marked adjustment ${parsed.adjustmentId} as ${nextLocalStatus} (everee=${upperStatus})`
          : `Adjustment ${parsed.adjustmentId} not found; skipped.`,
      );
    }
  }
  return actions;
}
