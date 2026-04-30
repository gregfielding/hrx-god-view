/**
 * Everee webhook handler (HRX Everee Master Plan §6).
 *
 * Pipeline:
 *   1. Public POST endpoint `evereeWebhook` receives events from Everee.
 *   2. Verifies `X-Everee-Signature` HMAC-SHA256 of the raw body against a shared
 *      secret (`EVEREE_WEBHOOK_SECRET` env var, or `EVEREE_WEBHOOK_SECRET_<evereeTenantId>`
 *      for per-tenant secrets during pilot). Returns 401 on failure.
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
 */

import * as admin from 'firebase-admin';
import * as crypto from 'crypto';
import { onRequest } from 'firebase-functions/v2/https';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions/v2';
import { evereePaths } from './evereeConfig';

const db = () => admin.firestore();

type EvereeEventStatus = 'received' | 'processing' | 'processed' | 'error' | 'ignored';

interface EvereeEventEnvelope {
  /** Everee's event id — used as the Firestore doc id for dedup. */
  id?: string;
  eventId?: string;
  /** Event type, e.g. `worker.onboarding-completed`. */
  type?: string;
  event?: string;
  /** Everee tenant that produced the event — maps to our entity.evereeTenantId. */
  tenantId?: string;
  /** ISO8601 publish time. */
  occurredAt?: string;
  /** Event payload — shape varies per event type. */
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
 * Constant-time HMAC-SHA256 check of the raw request body against an optional
 * tenant-scoped secret, falling back to a global secret. Returning false when
 * no secret is configured keeps accidental prod traffic from slipping through
 * a misconfigured deploy.
 *
 * Everee's published header is `x-everee-webhook-signature`. We accept the
 * legacy `x-everee-signature` and the `x-hub-signature-256` forms so a future
 * provider rotation doesn't silently start dropping events.
 *
 * Format: bare lowercase hex. We also accept `sha256=<hex>` (GitHub-style) and
 * pure base64 just in case Everee changes encoding mid-rotation — both forms
 * are normalized into a hex buffer before the constant-time compare.
 */
function verifySignature(
  rawBody: string,
  signatureHeader: string | null,
  evereeTenantId: string | null,
): boolean {
  if (!signatureHeader) return false;
  const tenantScopedSecret =
    evereeTenantId && process.env[`EVEREE_WEBHOOK_SECRET_${evereeTenantId}`];
  const globalSecret = process.env.EVEREE_WEBHOOK_SECRET;
  const secret = tenantScopedSecret || globalSecret;
  if (!secret) return false;

  // Strip optional `sha256=` prefix.
  const stripped = signatureHeader.startsWith('sha256=')
    ? signatureHeader.slice('sha256='.length)
    : signatureHeader;

  const expectedHex = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

  const candidates: Buffer[] = [];
  // Hex form (Everee's documented default).
  if (/^[0-9a-fA-F]+$/.test(stripped) && stripped.length % 2 === 0) {
    try {
      candidates.push(Buffer.from(stripped, 'hex'));
    } catch {
      /* ignore */
    }
  }
  // Base64 fallback in case Everee rotates encoding.
  if (/^[A-Za-z0-9+/=_-]+$/.test(stripped)) {
    try {
      const normalized = stripped.replace(/-/g, '+').replace(/_/g, '/');
      candidates.push(Buffer.from(normalized, 'base64'));
    } catch {
      /* ignore */
    }
  }

  const expectedBuf = Buffer.from(expectedHex, 'hex');
  for (const c of candidates) {
    if (c.length !== expectedBuf.length) continue;
    try {
      if (crypto.timingSafeEqual(c, expectedBuf)) return true;
    } catch {
      /* try next encoding */
    }
  }
  return false;
}

/** Pull Everee tenant id from common envelope shapes (root, nested data, payload). */
function pickEvereeTenantIdFromEnvelope(envelope: EvereeEventEnvelope): string | null {
  const candidates: unknown[] = [
    envelope.tenantId,
    (envelope as Record<string, unknown>).evereeTenantId,
    (envelope as Record<string, unknown>).accountId,
    envelope.data?.tenantId,
    envelope.data?.evereeTenantId,
    envelope.data?.accountId,
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
  { cors: false, invoker: 'public', timeoutSeconds: 30, memory: '512MiB' },
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
    // Everee's documented header is `x-everee-webhook-signature`; we accept the
    // legacy `x-everee-signature` and the GitHub-style `x-hub-signature-256`
    // for resilience against provider rotation.
    const signatureHeader =
      (req.header('x-everee-webhook-signature') as string | null) ||
      (req.header('x-everee-signature') as string | null) ||
      (req.header('x-everee-signature-256') as string | null) ||
      (req.header('x-hub-signature-256') as string | null) ||
      null;

    if (!eventId || !type) {
      logger.warn('everee.webhook.missing_fields', { eventId, type });
      res.status(400).send('Missing eventId or type');
      return;
    }

    if (!verifySignature(rawBody, signatureHeader, evereeTenantId)) {
      // DIAGNOSTIC — temporary: surface enough detail to figure out why
      // signature checks are failing in pilot, without leaking the secret
      // itself. Remove once the format is locked in.
      const tenantSecret =
        evereeTenantId && process.env[`EVEREE_WEBHOOK_SECRET_${evereeTenantId}`];
      const globalSecret = process.env.EVEREE_WEBHOOK_SECRET;
      const secret = tenantSecret || globalSecret || '';
      const provided = signatureHeader
        ? signatureHeader.startsWith('sha256=')
          ? signatureHeader.slice('sha256='.length)
          : signatureHeader
        : '';
      const expectedHex = secret
        ? crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
        : '';
      const expectedB64 = secret
        ? crypto.createHmac('sha256', secret).update(rawBody).digest('base64')
        : '';
      logger.warn('everee.webhook.bad_signature', {
        eventId,
        type,
        evereeTenantId,
        hasSignature: !!signatureHeader,
        // Which header(s) Everee actually sent.
        headerNames: Object.keys(req.headers).filter(
          (h) =>
            h.toLowerCase().includes('signature') ||
            h.toLowerCase().includes('hub') ||
            h.toLowerCase().startsWith('x-everee'),
        ),
        rawBodyLen: rawBody.length,
        // First 240 chars of body so we can see shape (and locate tenantId)
        // without dumping PII. Shapes are documented in the Everee dashboard
        // event reference, but their pilot envelopes have varied historically.
        bodyPreview: rawBody.slice(0, 240),
        secretSource: tenantSecret ? 'tenant' : globalSecret ? 'global' : 'none',
        secretLen: secret.length,
        // First/last 6 chars of header + format diagnostics — safe to log.
        sigPrefix: provided.slice(0, 6),
        sigSuffix: provided.slice(-6),
        sigLen: provided.length,
        sigLooksHex: /^[0-9a-f]+$/i.test(provided),
        sigLooksBase64: /^[A-Za-z0-9+/=_-]+$/.test(provided),
        // First/last 6 of computed values so we can eyeball matches.
        expectedHexPrefix: expectedHex.slice(0, 6),
        expectedHexSuffix: expectedHex.slice(-6),
        expectedB64Prefix: expectedB64.slice(0, 6),
        expectedB64Suffix: expectedB64.slice(-6),
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
