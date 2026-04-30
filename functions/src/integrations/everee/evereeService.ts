/**
 * Everee service: worker, onboarding, pay history, shifts, payout (HRX Everee Master Plan §4).
 *
 * `createWorkerIfNeeded` is the first surface that makes a real outbound call to
 * the Everee sandbox; it intentionally logs request + response payloads under
 * structured Cloud Logging fields (`surface: 'everee.createWorker'`) while we
 * lock in the actual API contract. Once stable, downgrade the body logs to
 * debug or feature-flag them.
 */

import { randomBytes } from 'crypto';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';
import {
  evereePaths,
  getEvereeConfigForEntity,
  sanitizeEvereeEmbedHandlerName,
} from './evereeConfig';
import { evereeRequest } from './evereeHttp';
import type { EvereePayHistoryItem, EvereePayStatementSummary } from './evereeSchemas';

/**
 * Money shape per Everee API spec — `amount` is a decimal string (e.g.
 * "20.00"), `currency` is always "USD" today.
 */
export interface EvereeMoney {
  amount: string;
  currency: 'USD';
}

/**
 * Address shape per Everee API spec. `line2` is optional; `state` is the
 * two-letter ISO 3166:2 code (e.g. "CA"); `postalCode` is 5 digits.
 */
export interface EvereeAddress {
  line1: string;
  line2?: string;
  city: string;
  state: string;
  postalCode: string;
}

export interface CreateWorkerInput {
  tenantId: string;
  entityId: string;
  userId: string;
  firebaseUid: string;
  /**
   * Routes to the corresponding embedded-onboarding endpoint:
   *   employee   → POST /api/v2/embedded/workers/employee  (W2)
   *   contractor → POST /api/v2/embedded/workers/contractor (1099)
   */
  workerType: 'employee' | 'contractor';
  email?: string;
  firstName?: string;
  lastName?: string;
  /** 10-digit phone number, no formatting (Everee strips non-digits anyway). */
  phone?: string;
  /**
   * The remaining fields are REQUIRED by the Everee
   * `/api/v2/embedded/workers/employee` endpoint (W2). Callers may omit them —
   * `createWorkerIfNeeded` injects conservative stub defaults so sandbox /
   * exploratory sync works with identity fields only. Production callers should
   * thread real worker address + compensation from profile / assignment data.
   *
   * **1099 contractors** use `POST /api/v2/onboarding/contractor` instead —
   * minimal fields; optional `approvalGroupId` may also be set on the entity
   * doc (`evereeApprovalGroupId`).
   */
  payType?: 'HOURLY' | 'SALARY';
  payRate?: EvereeMoney;
  typicalWeeklyHours?: number;
  /** ISO 8601 date (YYYY-MM-DD); defaults to today when omitted. */
  hireDate?: string;
  homeAddress?: EvereeAddress;
  /** Contractor onboarding — overrides entity `evereeApprovalGroupId` when set. */
  approvalGroupId?: number;
}

/**
 * Everee Embed Components (developer.everee.com/docs/everee-embed). Sandbox docs
 * use `experience` as the API body field; we expose `experienceType` on our
 * public surface (matches the docs) and map it to `experience` on the wire.
 */
export type EvereeEmbedExperienceType =
  | 'ONBOARDING'
  | 'WORKER_HOME'
  | 'PAYMENT_HISTORY'
  | 'TAX_DOCUMENTS'
  | 'PAYMENT_DEPOSIT'
  | 'HOME_ADDRESS';

export const EVEREE_EMBED_EXPERIENCE_VERSION_DEFAULTS: Record<EvereeEmbedExperienceType, string> = {
  ONBOARDING: 'V2_0',
  WORKER_HOME: 'V1_0',
  PAYMENT_HISTORY: 'V1_0',
  TAX_DOCUMENTS: 'V1_0',
  PAYMENT_DEPOSIT: 'V1_0',
  HOME_ADDRESS: 'V1_0',
};

export interface CreateOnboardingSessionInput {
  tenantId: string;
  entityId: string;
  userId: string;
  evereeWorkerId: string;
  returnUrl?: string;
  /**
   * Optional per-call override of the embed handler name. Validated by
   * `sanitizeEvereeEmbedHandlerName`; invalid values are dropped (and logged)
   * so the resolution falls through to the entity / default. Normally left
   * unset — the entity-level `evereeEmbedEventHandlerName` (or the
   * `hrx_default` fallback the host bridge auto-registers) is what you want.
   */
  eventHandlerName?: string;
  /** Defaults to `ONBOARDING`. Use `WORKER_HOME` (etc.) for post-onboarding embeds. */
  experienceType?: EvereeEmbedExperienceType;
  /** Defaults per `EVEREE_EMBED_EXPERIENCE_VERSION_DEFAULTS`. */
  experienceVersion?: string;
}

/**
 * Create worker in Everee if not already linked; create/update everee_workers doc
 * AND mirror the new worker id onto `users/{firebaseUid}.evereeWorkerIds`.
 *
 * Multi-Everee-tenant model: every C1 entity points at its own Everee tenant
 * (Sandbox=2320, future Select=X, Events=Y, ...). A single HRX worker can
 * therefore accumulate multiple `evereeWorkerId`s — one per Everee tenant they
 * are provisioned in. We model this with a map on the user record:
 *   `users/{firebaseUid}.evereeWorkerIds = { [evereeTenantId]: workerId }`
 * `merge: true` on this map lets new entries land without disturbing existing
 * keys (other Everee tenants the worker is already linked to).
 *
 * Idempotency is two-layered:
 *   (1) Fast path: read `users/{firebaseUid}.evereeWorkerIds[evereeTenantId]`.
 *       Most repeat clicks resolve here without touching `everee_workers`.
 *   (2) Canonical fallback: read `everee_workers/{entityId}__{userId}` —
 *       still the source of truth, kept as belt-and-suspenders in case the
 *       user-record map ever drifts (e.g. partial writes, manual edits).
 * Either hit returns the existing id without re-POSTing to Everee.
 */
export async function createWorkerIfNeeded(input: CreateWorkerInput): Promise<{
  evereeWorkerId: string;
  created: boolean;
}> {
  const config = await getEvereeConfigForEntity(input.tenantId, input.entityId);
  if (!config) {
    throw new Error('Everee not configured for this entity');
  }
  const db = getFirestore();
  const linkRef = db.doc(evereePaths.worker(input.tenantId, input.entityId, input.userId));
  const userRef = db.doc(`users/${input.firebaseUid}`);
  const logCtx = {
    surface: 'everee.createWorker' as const,
    tenantId: input.tenantId,
    entityId: input.entityId,
    userId: input.userId,
    firebaseUid: input.firebaseUid,
    evereeTenantId: config.evereeTenantId,
  };

  // (1) Fast-path idempotency via the user-record map.
  try {
    const userSnap = await userRef.get();
    const userMap = (userSnap.data()?.evereeWorkerIds ?? null) as
      | Record<string, string>
      | null;
    const existingForTenant = userMap?.[config.evereeTenantId];
    if (existingForTenant) {
      logger.info('[everee.createWorker] skipping — user-map already linked', {
        ...logCtx,
        evereeWorkerId: existingForTenant,
        source: 'users.evereeWorkerIds',
      });
      return {
        evereeWorkerId: existingForTenant,
        created: false,
      };
    }
  } catch (err) {
    // Don't block on the fast-path read — fall through to the canonical check.
    logger.warn('[everee.createWorker] user-map fast-path read failed', {
      ...logCtx,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // (2) Canonical idempotency via the linkage doc.
  const linkSnap = await linkRef.get();
  const existing = linkSnap.data() as { externalWorkerId?: string } | undefined;
  if (existing?.externalWorkerId) {
    logger.info('[everee.createWorker] skipping — linkage doc already linked', {
      ...logCtx,
      evereeWorkerId: existing.externalWorkerId,
      source: 'everee_workers',
    });
    // Backfill the user-record map so the next call hits the fast path.
    await mirrorEvereeWorkerIdToUser(userRef, config.evereeTenantId, existing.externalWorkerId, logCtx);
    return {
      evereeWorkerId: existing.externalWorkerId,
      created: false,
    };
  }

  // W2 (employee): POST /api/v2/embedded/workers/employee — full compensation +
  // address per Everee embedded onboarding spec.
  //
  // 1099 (contractor): POST /api/v2/onboarding/contractor — minimal payload;
  // **not** `/embedded/workers/contractor` (that path does not exist in the
  // published OpenAPI). See developer.everee.com "Kick off onboarding for a
  // contractor".
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const phoneDigits = (input.phone ?? '').replace(/\D/g, '').slice(-10);
  const baseUrl = config.evereeApiBaseUrl ?? 'https://api.everee.com';

  let path: string;
  let requestBody: Record<string, unknown>;

  if (input.workerType === 'contractor') {
    path = '/api/v2/onboarding/contractor';
    const approvalGroupId =
      input.approvalGroupId ?? config.evereeApprovalGroupId;
    requestBody = {
      firstName: input.firstName,
      lastName: input.lastName,
      phoneNumber: phoneDigits,
      email: input.email,
      hireDate: input.hireDate ?? today,
      legalWorkAddress: { useHomeAddress: true },
      externalWorkerId: input.firebaseUid,
    };
    if (input.homeAddress) {
      (requestBody as Record<string, unknown>).homeAddress = input.homeAddress;
    }
    if (approvalGroupId !== undefined && Number.isFinite(approvalGroupId)) {
      requestBody.approvalGroupId = approvalGroupId;
    }
  } else {
    path = '/api/v2/embedded/workers/employee';
    const homeAddress = input.homeAddress ?? {
      line1: '1 Sandbox Way',
      city: 'San Francisco',
      state: 'CA',
      postalCode: '94105',
    };
    requestBody = {
      firstName: input.firstName,
      lastName: input.lastName,
      phoneNumber: phoneDigits,
      email: input.email,
      payType: input.payType ?? 'HOURLY',
      payRate: input.payRate ?? { amount: '20.00', currency: 'USD' },
      typicalWeeklyHours: input.typicalWeeklyHours ?? 40,
      hireDate: input.hireDate ?? today,
      legalWorkAddress: { useHomeAddress: true },
      homeAddress,
      externalWorkerId: input.firebaseUid,
    };
  }

  const fullUrl = `${baseUrl.replace(/\/$/, '')}${path}`;

  logger.info('[everee.createWorker] outgoing', {
    ...logCtx,
    method: 'POST',
    url: fullUrl,
    headers: {
      authorization: 'Basic <redacted>',
      'x-everee-tenant-id': config.evereeTenantId,
      'content-type': 'application/json',
    },
    bodyKeys: Object.keys(requestBody),
    bodyJson: requestBody,
  });

  const startedAt = Date.now();
  let response: unknown;
  try {
    response = await evereeRequest<unknown>(config, 'POST', path, requestBody);
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const errAny = err as { message?: string; status?: number; responseBody?: unknown };
    logger.error('[everee.createWorker] error', {
      ...logCtx,
      durationMs,
      errorMessage: errAny?.message ?? String(err),
      errorStatus: errAny?.status,
      errorBody: errAny?.responseBody,
    });
    throw err;
  }
  const durationMs = Date.now() - startedAt;
  logger.info('[everee.createWorker] response', {
    ...logCtx,
    durationMs,
    status: 200,
    responseBodyJson: response,
  });

  const evereeWorkerId = extractEvereeWorkerId(response);
  if (!evereeWorkerId) {
    logger.error('[everee.createWorker] no worker id in response', {
      ...logCtx,
      responseBodyJson: response,
    });
    throw new Error(
      `Everee POST ${path} returned no worker ID. Response: ${JSON.stringify(response)}`,
    );
  }

  const nowIso = new Date().toISOString();
  await linkRef.set(
    {
      tenantId: input.tenantId,
      entityId: input.entityId,
      userId: input.userId,
      firebaseUid: input.firebaseUid,
      externalWorkerId: evereeWorkerId,
      evereeTenantId: config.evereeTenantId,
      evereeWorkerId,
      workerType: input.workerType,
      status: 'created',
      createdAt: nowIso,
      updatedAt: nowIso,
    },
    { merge: true }
  );

  // Mirror onto the user-record map (dot-path update preserves sibling Everee tenants).
  await mirrorEvereeWorkerIdToUser(userRef, config.evereeTenantId, evereeWorkerId, logCtx);

  return {
    evereeWorkerId,
    created: true,
  };
}

/**
 * Write `users/{firebaseUid}.evereeWorkerIds[evereeTenantId] = workerId`.
 * Best-effort: never fail the parent sync over a user-doc write.
 */
async function mirrorEvereeWorkerIdToUser(
  userRef: FirebaseFirestore.DocumentReference,
  evereeTenantId: string,
  evereeWorkerId: string,
  logCtx: Record<string, unknown>,
): Promise<void> {
  try {
    // Prefer `update` with dot paths so we merge a single map key. `set` with
    // `{ evereeWorkerIds: { [k]: v } }` and merge:true can replace the whole
    // `evereeWorkerIds` object in some cases, dropping other Everee tenants.
    await userRef.update({
      [`evereeWorkerIds.${evereeTenantId}`]: evereeWorkerId,
      updatedAt: FieldValue.serverTimestamp(),
    });
    logger.info('[everee.createWorker] mirrored to users.evereeWorkerIds', {
      ...logCtx,
      evereeWorkerId,
    });
  } catch (err) {
    const code = (err as { code?: string | number })?.code;
    const isNotFound =
      code === 5 ||
      code === 'not-found' ||
      (typeof code === 'string' && code.toLowerCase() === 'not_found');
    if (isNotFound) {
      try {
        await userRef.set(
          {
            evereeWorkerIds: { [evereeTenantId]: evereeWorkerId },
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
        logger.info('[everee.createWorker] mirrored to users.evereeWorkerIds (set, new user doc)', {
          ...logCtx,
          evereeWorkerId,
        });
        return;
      } catch (err2) {
        logger.error('[everee.createWorker] users.evereeWorkerIds mirror failed (set after NOT_FOUND)', {
          ...logCtx,
          error: err2 instanceof Error ? err2.message : String(err2),
        });
        return;
      }
    }
    logger.error('[everee.createWorker] users.evereeWorkerIds mirror failed', {
      ...logCtx,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Extract Everee's worker id from create/onboarding responses.
 * Confirmed shapes (sandbox 2026-04): top-level `workerId` (UUID) on employee
 * embedded worker create; same field name on contractor onboarding. Also try
 * `id` and nested `data.*` for forward compatibility.
 */
function extractEvereeWorkerId(response: unknown): string | null {
  if (!response || typeof response !== 'object') return null;
  const r = response as Record<string, unknown>;
  if (typeof r.id === 'string' && r.id) return r.id;
  if (typeof r.workerId === 'string' && r.workerId) return r.workerId;
  const data = r.data;
  if (data && typeof data === 'object') {
    const d = data as Record<string, unknown>;
    if (typeof d.id === 'string' && d.id) return d.id;
    if (typeof d.workerId === 'string' && d.workerId) return d.workerId;
  }
  return null;
}

function parseEmbedSessionResponse(response: unknown): {
  url: string;
  origin: string;
  expiresInMs: number;
  sessionId: string;
} {
  const r = (response && typeof response === 'object' ? response : {}) as Record<string, unknown>;
  const nested = r.data && typeof r.data === 'object' ? (r.data as Record<string, unknown>) : {};
  const sessionObj =
    r.session && typeof r.session === 'object' ? (r.session as Record<string, unknown>) : {};
  const urlRaw = [
    r.url,
    r.embedUrl,
    r.sessionUrl,
    r.link,
    nested.url,
    nested.embedUrl,
    nested.sessionUrl,
    sessionObj.url,
    sessionObj.embedUrl,
  ].find((x) => typeof x === 'string' && String(x).trim());
  const url = typeof urlRaw === 'string' ? urlRaw.trim() : '';
  if (!url) {
    logger.error('[everee.embedSession] response missing url', {
      responseKeys: response && typeof response === 'object' ? Object.keys(response as object) : [],
      sample:
        typeof response === 'object' && response !== null
          ? JSON.stringify(response).slice(0, 1200)
          : String(response).slice(0, 400),
    });
    throw new Error('Everee embed session response missing url');
  }
  const originRaw = [r.origin, nested.origin].find((x) => typeof x === 'string' && String(x).trim());
  let origin = typeof originRaw === 'string' ? originRaw.trim() : '';
  if (!origin) {
    try {
      origin = new URL(url).origin;
    } catch {
      origin = '';
    }
  }
  let expiresInMs = 3600000;
  const msCand = [r.expiresInMs, nested.expiresInMs].find(
    (x) => typeof x === 'number' && Number.isFinite(x),
  ) as number | undefined;
  const secCand = [r.expiresIn, nested.expiresIn].find(
    (x) => typeof x === 'number' && Number.isFinite(x),
  ) as number | undefined;
  if (msCand != null) {
    expiresInMs = msCand;
  } else if (secCand != null) {
    expiresInMs = secCand * 1000;
  }
  const sessionIdRaw = [r.sessionId, nested.sessionId, r.id, nested.id].find(
    (x) => typeof x === 'string' && String(x).trim(),
  );
  const sessionId =
    typeof sessionIdRaw === 'string' && sessionIdRaw.trim()
      ? sessionIdRaw.trim()
      : `sess_${randomBytes(8).toString('hex')}`;
  return { url, origin, expiresInMs, sessionId };
}

/** Create an Everee Embed Component session (short-lived URL for iframe / WebView). */
export async function createOnboardingSession(input: CreateOnboardingSessionInput): Promise<{
  url: string;
  origin: string;
  expiresInMs: number;
  sessionId: string;
  experienceType: EvereeEmbedExperienceType;
  experienceVersion: string;
  /**
   * Echo of the bridge name we sent to Everee. The host (web/Flutter) MUST
   * register `window[eventHandlerName].postMessage` BEFORE the embed boots —
   * V2_0 embeds otherwise stall on `EMB-102` ("No event handler has been
   * registered…") and never dispatch UI events.
   */
  eventHandlerName: string;
}> {
  const config = await getEvereeConfigForEntity(input.tenantId, input.entityId);
  if (!config) throw new Error('Everee not configured for this entity');
  // Everee's session-create endpoint requires `eventHandlerName`; the embed's
  // V2_0 routing layer (`EmbeddedRouter`) then attempts three transports to
  // deliver UI events back to the host, in order:
  //   1. `window[eventHandlerName].postMessage(envelope)`  ← web hosts
  //   2. `window.webkit.messageHandlers[eventHandlerName].postMessage(envelope)`
  //                                                         ← iOS WKWebView
  //   3. a host-transferred `MessagePort`                  ← legacy V1_0 path
  // If none succeed the iframe renders the EMB-102 toast and never starts.
  // The HRX host registers (1) via `src/utils/everee/hostMessageBridge.ts`.
  //
  // Resolution order for the name we hand Everee (first **valid** non-empty
  // wins; invalid candidates are rejected by `sanitizeEvereeEmbedHandlerName`
  // and logged at warn level):
  //   1. explicit per-call `input.eventHandlerName`
  //   2. entity-level `evereeEmbedEventHandlerName` from Firestore
  //      (already pre-validated inside `getEvereeConfigForEntity`)
  //   3. stable fallback: `hrx_default` (the host bridge auto-registers this)
  //
  // Whatever we send is also returned in the response so the host can register
  // the matching bridge name (entity overrides keep working end-to-end). The
  // log line below records the final resolved value so EMB-102 regressions are
  // diagnosable from Cloud Logging without re-deploying.
  const eventHandlerName =
    sanitizeEvereeEmbedHandlerName(input.eventHandlerName, {
      source: 'createOnboardingSession.input.eventHandlerName',
      tenantId: input.tenantId,
      entityId: input.entityId,
      evereeTenantId: config.evereeTenantId,
    }) ||
    config.evereeEmbedEventHandlerName ||
    'hrx_default';
  const experienceType: EvereeEmbedExperienceType = input.experienceType || 'ONBOARDING';
  const experienceVersion =
    input.experienceVersion?.trim() ||
    EVEREE_EMBED_EXPERIENCE_VERSION_DEFAULTS[experienceType] ||
    'V1_0';
  // Wire field is `experience` (confirmed working in sandbox); docs render `experienceType`.
  const body: Record<string, unknown> = {
    workerId: input.evereeWorkerId,
    experience: experienceType,
    experienceVersion,
    eventHandlerName,
  };
  if (input.returnUrl) body.returnUrl = input.returnUrl;

  const logCtx = {
    surface: 'everee.embedSession' as const,
    tenantId: input.tenantId,
    entityId: input.entityId,
    userId: input.userId,
    evereeTenantId: config.evereeTenantId,
    experienceType,
    experienceVersion,
  };
  logger.info('[everee.embedSession] outgoing', {
    ...logCtx,
    path: '/api/v2/embedded/session',
    bodyKeys: Object.keys(body),
  });

  const response = await evereeRequest<unknown>(config, 'POST', '/api/v2/embedded/session', body);
  const parsed = parseEmbedSessionResponse(response);
  logger.info('[everee.embedSession] response', {
    ...logCtx,
    sessionId: parsed.sessionId,
    expiresInMs: parsed.expiresInMs,
    eventHandlerName,
  });
  return { ...parsed, experienceType, experienceVersion, eventHandlerName };
}

/** Get pay history (list). Stub. */
export async function getPayHistory(
  tenantId: string,
  entityId: string,
  userId: string
): Promise<EvereePayHistoryItem[]> {
  const config = await getEvereeConfigForEntity(tenantId, entityId);
  if (!config) return [];
  return [];
}

/** Get single pay statement. Stub. */
export async function getPayStatement(
  tenantId: string,
  entityId: string,
  userId: string,
  statementId: string
): Promise<EvereePayStatementSummary | null> {
  const config = await getEvereeConfigForEntity(tenantId, entityId);
  if (!config) return null;
  return null;
}

/** Admin: push shift to Everee. Stub. */
export async function pushShift(
  tenantId: string,
  entityId: string,
  payload: { evereeWorkerId: string; shiftStart: string; shiftEnd: string; [k: string]: unknown }
): Promise<{ id: string }> {
  const config = await getEvereeConfigForEntity(tenantId, entityId);
  if (!config) throw new Error('Everee not configured for this entity');
  // TODO: confirm exact Everee shifts path against the API docs before this
  // stub is wired to a real callable. `/api/v2/` prefix added preemptively;
  // adjust once we read the docs.
  await evereeRequest(config, 'POST', '/api/v2/shifts', payload);
  return { id: 'stub-shift-id' };
}

/** Admin: prepare payout. Stub. */
export async function preparePayout(
  tenantId: string,
  entityId: string,
  payload: { payPeriodId?: string; [k: string]: unknown }
): Promise<{ id: string }> {
  const config = await getEvereeConfigForEntity(tenantId, entityId);
  if (!config) throw new Error('Everee not configured for this entity');
  // TODO: confirm exact Everee payouts path against the API docs.
  await evereeRequest(config, 'POST', '/api/v2/payouts/prepare', payload);
  return { id: 'stub-payout-id' };
}

/** Ping: validate config and credentials. Stub returns ok when config present. */
export async function ping(tenantId: string, entityId: string): Promise<{ ok: boolean; message?: string }> {
  const config = await getEvereeConfigForEntity(tenantId, entityId);
  if (!config) return { ok: false, message: 'Everee not configured for this entity' };
  // TODO: confirm the right Everee health/me endpoint. Once embedded
  // worker create succeeds we can probe this.
  await evereeRequest(config, 'GET', '/api/v2/tenants/me');
  return { ok: true };
}
