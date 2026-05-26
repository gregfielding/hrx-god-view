/**
 * Everee callable Cloud Functions (HRX Everee Master Plan §4).
 * Stub implementations; real logic in evereeService.
 */

import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import {
  createWorkerIfNeeded,
  createOnboardingSession,
  getPayHistory,
  getPayStatement,
  pushShift,
  preparePayout,
  ping,
  type EvereeEmbedExperienceType,
} from './evereeService';
import { mirrorWorkEligibilityFromAuthoritativeSource } from '../../utils/workEligibilityMirror';
import { extractEvereeHomeAddressFromUserDoc } from './evereeUserAddress';

if (!admin.apps.length) {
  admin.initializeApp();
}

/**
 * Pull worker identity (firstName / lastName / email / phone) from the
 * `users/{uid}` doc as a defensive fallback when the caller didn't pass
 * those fields.
 *
 * Why this exists (May 2026):
 *   The worker-facing "Complete payroll setup" dialog
 *   (`EvereePayrollSetupEmbed.tsx`) launches without a `prefill` prop —
 *   so the client's `evereeEnsureWorker` call arrives with `firstName /
 *   lastName / email / phone` undefined. Everee's contractor endpoint
 *   responds with 422 `Validation failed: 'firstName' must not be null`
 *   (and the same for lastName), and the user sees a generic "Server
 *   error (internal)" toast.
 *
 *   Rather than fix every caller individually (admin card already
 *   pre-fetches; restart callable already pre-fetches; embed dialog
 *   doesn't), we centralize the fallback here so any caller that omits
 *   these fields still gets a working POST. Caller-supplied values
 *   always win — the only fields the helper fills are the ones missing.
 */
/**
 * **2026-05-23, anti-fraud lockout fix** — `evereeEnsureWorker` was
 * provisioning every new W-2 worker with the same sandbox stub home
 * address ("1 Sandbox Way, San Francisco, CA 94105") because the
 * callable never read `users/{uid}.addressInfo` before posting. Result:
 * dozens of newly-provisioned production workers had identical home
 * addresses, and Everee's anti-fraud engine flagged the pattern as
 * synthetic-identity / account-takeover and locked the accounts.
 *
 * This helper centralizes the address read. Returns `null` when the
 * profile is incomplete; the callable then throws a clear
 * `failed-precondition` error so the recruiter sees a useful message
 * (instead of a generic 500 from the lower-level
 * `createWorkerIfNeeded` guard, which now also refuses to use the
 * stub on production tenants).
 */
async function fetchEvereeHomeAddressFromUserDoc(
  userId: string,
): Promise<import('./evereeService').EvereeAddress | null> {
  try {
    const snap = await admin.firestore().doc(`users/${userId}`).get();
    if (!snap.exists) return null;
    return extractEvereeHomeAddressFromUserDoc(snap.data());
  } catch (err) {
    logger.warn('[evereeEnsureWorker] homeAddress fetch failed', {
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

async function fillEvereeIdentityFromUserDoc(
  userId: string,
  current: {
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
  },
): Promise<{ firstName?: string; lastName?: string; email?: string; phone?: string }> {
  const has = (v: unknown) => typeof v === 'string' && v.trim().length > 0;
  // Caller already provided everything — skip the read.
  if (
    has(current.firstName) &&
    has(current.lastName) &&
    has(current.email) &&
    has(current.phone)
  ) {
    return current;
  }
  try {
    const snap = await admin.firestore().doc(`users/${userId}`).get();
    if (!snap.exists) return current;
    const u = (snap.data() ?? {}) as Record<string, unknown>;
    const pick = (...keys: string[]): string | undefined => {
      for (const k of keys) {
        const v = u[k];
        if (typeof v === 'string' && v.trim()) return v.trim();
      }
      return undefined;
    };
    // displayName fallback: split on whitespace once. We don't try to be
    // smart about middle names — Everee just needs *something* non-null
    // for first/last so the contractor record can be created. If the
    // worker types a different name into the embed itself, Everee wins.
    const displayName = pick('displayName');
    let displayFirst: string | undefined;
    let displayLast: string | undefined;
    if (displayName) {
      const parts = displayName.split(/\s+/).filter(Boolean);
      if (parts.length >= 1) displayFirst = parts[0];
      if (parts.length >= 2) displayLast = parts.slice(1).join(' ');
    }
    return {
      firstName: has(current.firstName) ? current.firstName : pick('firstName') ?? displayFirst,
      lastName: has(current.lastName) ? current.lastName : pick('lastName') ?? displayLast,
      email: has(current.email) ? current.email : pick('email'),
      phone: has(current.phone) ? current.phone : pick('phoneE164', 'phone', 'phoneNumber'),
    };
  } catch (err) {
    logger.warn('[evereeEnsureWorker] user-doc fallback failed', {
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
    return current;
  }
}

const ALLOWED_EMBED_EXPERIENCE_TYPES = new Set<EvereeEmbedExperienceType>([
  'ONBOARDING',
  'WORKER_HOME',
  'PAYMENT_HISTORY',
  'TAX_DOCUMENTS',
  'PAYMENT_DEPOSIT',
  'HOME_ADDRESS',
]);

function coerceEmbedExperienceType(value: unknown): EvereeEmbedExperienceType | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim().toUpperCase();
  if (!trimmed) return undefined;
  if (ALLOWED_EMBED_EXPERIENCE_TYPES.has(trimmed as EvereeEmbedExperienceType)) {
    return trimmed as EvereeEmbedExperienceType;
  }
  throw new HttpsError('invalid-argument', `Unsupported experienceType: ${value}`);
}

function coerceEmbedExperienceVersion(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  // Everee versions are short (e.g., V1_0, V2_0); reject anything obviously wrong.
  if (!/^V\d+(_\d+)?$/i.test(trimmed)) {
    throw new HttpsError('invalid-argument', `Unsupported experienceVersion: ${value}`);
  }
  return trimmed.toUpperCase();
}
import { getEvereeConfigForEntity, requireEvereeEnabledEntity } from './evereeConfig';
import { evereeRequest } from './evereeHttp';
import { updateEvereeWorkerAddress } from './evereeService';
import { getFirestore } from 'firebase-admin/firestore';

function requireAuth(request: { auth?: { uid: string; token?: Record<string, unknown> } | null }) {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Must be authenticated');
  }
  return request.auth;
}

function requireTenantEntity(data: unknown): { tenantId: string; entityId: string } {
  const d = data as Record<string, unknown> | null;
  const tenantId = typeof d?.tenantId === 'string' ? d.tenantId : '';
  const entityId = typeof d?.entityId === 'string' ? d.entityId : '';
  if (!tenantId || !entityId) {
    throw new HttpsError('invalid-argument', 'tenantId and entityId required');
  }
  return { tenantId, entityId };
}

/**
 * Recruiter/admin gate for Everee management surfaces.
 *
 * **History:** the original sync `canManageEveree` here read only Firebase
 * Auth custom claims (`auth.token.roles[tenantId].role`). In production
 * the claim-sync pipeline had not run for most tenant admins — every C1
 * admin (sL=7 in Firestore) had `customClaims = {}`, so this gate denied
 * all of them. Greg was the only person able to use any Everee admin
 * callable because his `hrx: true` claim was set manually.
 *
 * Replaced with the async predicate in `./evereeAccessGate.ts`, which
 * mirrors the AccuSource pattern: Firestore-first (tenant-scoped role +
 * securityLevel), with the legacy custom-claims path kept as a fast-path
 * for users whose claims DO get synced. Re-exported here so existing
 * importers (`evereeAdminRecreateWorkerOnboarding.ts`) keep their
 * `from './evereeCallables'` import.
 *
 * **Migration note for callers:** the gate is now async — every call
 * site needs `await`. The caller still throws its own
 * `HttpsError('permission-denied')` so error messages stay specific to
 * the surface (e.g. "Not allowed to view pay history" vs the generic
 * "Not allowed").
 */
import { canManageEveree, canSelfOrManageEveree } from './evereeAccessGate';
export { canManageEveree, canSelfOrManageEveree };

export const evereePing = onCall(async (request) => {
  requireAuth(request);
  const { tenantId, entityId } = requireTenantEntity(request.data);
  if (!(await canManageEveree(request.auth as any, tenantId))) {
    throw new HttpsError('permission-denied', 'Not allowed to manage Everee for this tenant');
  }
  await requireEvereeEnabledEntity(tenantId, entityId);
  return ping(tenantId, entityId);
});

export const evereeEnsureWorker = onCall(async (request) => {
  requireAuth(request);
  const d = request.data as Record<string, unknown> | null;
  const tenantId = typeof d?.tenantId === 'string' ? d.tenantId : '';
  const entityId = typeof d?.entityId === 'string' ? d.entityId : '';
  const userId = typeof d?.userId === 'string' ? d.userId : '';
  if (!tenantId || !entityId || !userId) {
    throw new HttpsError('invalid-argument', 'tenantId, entityId, userId required');
  }
  if (!(await canSelfOrManageEveree(request.auth as any, tenantId, userId))) {
    throw new HttpsError('permission-denied', 'Not allowed');
  }
  await requireEvereeEnabledEntity(tenantId, entityId);
  // `firebaseUid` is forwarded to Everee as the partner-side external id (custom
  // field). Use the *worker's* uid (== user doc id), not the caller's, so a
  // recruiter-initiated sync still tags the worker correctly in Everee.
  // Per-call approval group override (string per Everee API). Coerce a legacy
  // numeric input to string so older clients that pass `approvalGroupId: 7900`
  // still work after the May 2026 type migration.
  const approvalGroupRaw = d?.approvalGroupId;
  const approvalGroupId =
    typeof approvalGroupRaw === 'string' && approvalGroupRaw.trim()
      ? approvalGroupRaw.trim()
      : typeof approvalGroupRaw === 'number' && Number.isFinite(approvalGroupRaw)
        ? String(approvalGroupRaw)
        : undefined;

  // May 2026 — fall back to `users/{uid}` for any identity field the
  // caller didn't pass. Worker-facing surfaces (e.g. the "Complete
  // payroll setup" embed) launch without a prefill, so without this
  // fallback Everee's contractor endpoint rejects with
  // 422 'firstName must not be null' and the user sees a generic
  // "Server error (internal)" toast. See the helper docstring above.
  const identity = await fillEvereeIdentityFromUserDoc(userId, {
    email: typeof d?.email === 'string' ? d.email : undefined,
    firstName: typeof d?.firstName === 'string' ? d.firstName : undefined,
    lastName: typeof d?.lastName === 'string' ? d.lastName : undefined,
    phone: typeof d?.phone === 'string' ? d.phone : undefined,
  });

  /**
   * **2026-05-23, anti-fraud lockout fix** — fetch the worker's real
   * home address from `users/{uid}.addressInfo` and pass it to
   * `createWorkerIfNeeded`. Without this, every newly-provisioned
   * production worker was getting Everee's sandbox stub address
   * ("1 Sandbox Way, San Francisco, CA 94105") and the resulting
   * identical-address pattern across W-2 records was tripping
   * Everee's anti-fraud lockout. See `fetchEvereeHomeAddressFromUserDoc`
   * docstring + the guard added in `evereeService.createWorkerIfNeeded`.
   *
   * **2026-05-26 follow-up — Pamela McDonald (Contractor) lockout** —
   * the original comment here claimed contractors didn't need the
   * fetch because `legalWorkAddress: { useHomeAddress: true }` was
   * enough. That was wrong: the contractor path in `createWorkerIfNeeded`
   * silently OMITS `homeAddress` from the request body when the input
   * is missing it (line ~330 of evereeService.ts), so Everee receives
   * a contractor record with `useHomeAddress: true` pointing at an
   * EMPTY `homeAddress.current`. Anti-fraud then locks the account
   * the same way it locks empty-stub W-2s.
   *
   * The downstream guard in `createWorkerIfNeeded` does throw in this
   * case — but `startOnCallEmployment` and similar callers wrap the
   * call in a `try/catch ... logger.warn` that classifies the failure
   * as "non-blocking", which means we'd see the lockout in production
   * and the recruiter only sees a soft warning toast. Failing at the
   * callable layer (with a typed HttpsError) surfaces the issue to
   * the UI directly + blocks the bad provision before it hits Everee.
   *
   * So: fetch the home address for BOTH paths. Fail-fast on missing.
   */
  const workerType: 'employee' | 'contractor' =
    (d?.workerType as 'employee' | 'contractor') || 'employee';
  const fetchedAddress = await fetchEvereeHomeAddressFromUserDoc(userId);
  if (!fetchedAddress) {
    throw new HttpsError(
      'failed-precondition',
      "Worker home address is incomplete. Set the worker's profile address " +
        '(street, city, state, ZIP) before provisioning to Everee — sending ' +
        'an empty or placeholder address tripped Everee’s anti-fraud lockout ' +
        'on previous attempts (for both W-2 and 1099 records).',
    );
  }
  const homeAddress: import('./evereeService').EvereeAddress = fetchedAddress;

  return createWorkerIfNeeded({
    tenantId,
    entityId,
    userId,
    firebaseUid: userId,
    workerType,
    email: identity.email,
    firstName: identity.firstName,
    lastName: identity.lastName,
    phone: identity.phone,
    homeAddress,
    ...(approvalGroupId !== undefined ? { approvalGroupId } : {}),
  });
});

/**
 * Push the worker's current HRX home address to Everee for an
 * ALREADY-PROVISIONED worker.
 *
 * Use case (2026-05-26): `evereeEnsureWorker` is a no-op when the
 * worker is already linked — it returns the existing evereeWorkerId
 * without re-POSTing anything. So if the recruiter later fixes a
 * worker's HRX address, there's no first-class action to push that
 * fix to Everee. This callable closes the gap, mirroring the wire
 * call the patch-existing-addresses scratch script makes.
 *
 * Same auth/permission gate as `evereeEnsureWorker`.
 */
export const evereeUpdateWorkerAddress = onCall(async (request) => {
  requireAuth(request);
  const d = request.data as Record<string, unknown> | null;
  const tenantId = typeof d?.tenantId === 'string' ? d.tenantId : '';
  const entityId = typeof d?.entityId === 'string' ? d.entityId : '';
  const userId = typeof d?.userId === 'string' ? d.userId : '';
  if (!tenantId || !entityId || !userId) {
    throw new HttpsError('invalid-argument', 'tenantId, entityId, userId required');
  }
  if (!(await canSelfOrManageEveree(request.auth as any, tenantId, userId))) {
    throw new HttpsError('permission-denied', 'Not allowed');
  }
  await requireEvereeEnabledEntity(tenantId, entityId);

  // 1. Resolve the Everee worker UUID for THIS entity's Everee tenant.
  //    Reads `users/{uid}.evereeWorkerIds[evereeTenantId]` (the live
  //    user-map) first, then falls back to the linkage doc if needed.
  const entityCfg = await getEvereeConfigForEntity(tenantId, entityId);
  if (!entityCfg) {
    throw new HttpsError(
      'failed-precondition',
      `Entity ${entityId} has no Everee config; cannot push address.`,
    );
  }
  const evereeTenantId = entityCfg.evereeTenantId;
  const userSnap = await getFirestore().doc(`users/${userId}`).get();
  if (!userSnap.exists) {
    throw new HttpsError('not-found', `users/${userId} not found`);
  }
  const userData = userSnap.data() ?? {};
  const idsMap = (userData.evereeWorkerIds ?? {}) as Record<string, unknown>;
  const evereeWorkerIdRaw = idsMap[evereeTenantId];
  const evereeWorkerId =
    typeof evereeWorkerIdRaw === 'string' && evereeWorkerIdRaw.trim()
      ? evereeWorkerIdRaw.trim()
      : '';
  if (!evereeWorkerId) {
    throw new HttpsError(
      'failed-precondition',
      `Worker ${userId} is not linked to Everee tenant ${evereeTenantId}. ` +
        `Provision via Sync to Everee first.`,
    );
  }

  // 2. Extract the HRX home address. Same shared extractor the chip uses,
  //    so the surface that flags the issue and the surface that fixes it
  //    can never disagree.
  const homeAddress = extractEvereeHomeAddressFromUserDoc(
    userData as Record<string, unknown>,
  );
  if (!homeAddress) {
    throw new HttpsError(
      'failed-precondition',
      "Worker home address is incomplete. Set the worker's profile address " +
        '(street, city, state, ZIP) before pushing to Everee.',
    );
  }

  // 3. PUT /api/v2/workers/{id}/address — see evereeService doc-comment
  //    + memory/feedback_everee_wire_gotchas.md §6 for the wire shape.
  await updateEvereeWorkerAddress({
    tenantId,
    entityId,
    evereeWorkerId,
    address: homeAddress,
  });

  return {
    ok: true as const,
    evereeWorkerId,
    address: homeAddress,
  };
});

/**
 * Reuse-window for embed sessions, in milliseconds. When a callable invocation
 * arrives within this window of the previous session-creation for the same
 * (tenant, entity, user) triple AND the cached URL still has at least
 * `EMBED_SESSION_MIN_REMAINING_MS` of life left, we hand back the cached URL
 * instead of asking Everee to mint a fresh one.
 *
 * Why this exists (May 14, 2026 incident — Andrew Freeman):
 *   The worker payroll page (`WorkerPayrollEvereeTenant.tsx`) calls this
 *   callable on every component mount. A worker who refreshes the page,
 *   navigates away and back, or has a flaky connection that causes React to
 *   re-render can easily generate 3+ session-creates in 30s. Everee's
 *   anti-fraud engine flags rapid session-create activity from one
 *   externalWorkerId as account-takeover and flips
 *   `accountAccessPermitted: false` on the worker, which then renders the
 *   "Your onboarding has been locked due to a possible security risk"
 *   message inside the iframe — a state we cannot remediate without
 *   contacting Everee support.
 *
 * The cache is server-side only (linkage doc fields, see below) so it
 * works across devices, doesn't require client cookies, and never hands
 * out a pre-existing URL to a different user.
 */
const EMBED_SESSION_REUSE_WINDOW_MS = 60 * 1000; // 60s
/**
 * Minimum remaining lifetime on a cached URL before we'll reuse it. Everee's
 * embed sessions live ~5min today; we reuse only when the cached one still has
 * over a minute left so the worker doesn't get a near-expired URL.
 */
const EMBED_SESSION_MIN_REMAINING_MS = 60 * 1000; // 60s

interface CachedEmbedSession {
  url: string;
  origin: string;
  sessionId: string;
  experienceType: EvereeEmbedExperienceType;
  experienceVersion: string;
  eventHandlerName: string;
  expiresAtMs: number;
  createdAtMs: number;
  experienceCacheKey: string;
}

function buildExperienceCacheKey(
  experienceType: EvereeEmbedExperienceType | null,
  experienceVersion: string | null,
): string {
  return `${experienceType ?? 'DEFAULT'}__${experienceVersion ?? 'DEFAULT'}`;
}

function readCachedEmbedSession(
  data: FirebaseFirestore.DocumentData | undefined,
): CachedEmbedSession | null {
  if (!data) return null;
  const cache = data.embedSessionCache as Record<string, unknown> | undefined;
  if (!cache || typeof cache !== 'object') return null;
  const url = typeof cache.url === 'string' ? cache.url : null;
  const origin = typeof cache.origin === 'string' ? cache.origin : null;
  const sessionId = typeof cache.sessionId === 'string' ? cache.sessionId : null;
  const eventHandlerName =
    typeof cache.eventHandlerName === 'string' ? cache.eventHandlerName : null;
  const experienceType = (
    typeof cache.experienceType === 'string' ? cache.experienceType : null
  ) as EvereeEmbedExperienceType | null;
  const experienceVersion =
    typeof cache.experienceVersion === 'string' ? cache.experienceVersion : null;
  const expiresAtMs =
    typeof cache.expiresAtMs === 'number' && Number.isFinite(cache.expiresAtMs)
      ? cache.expiresAtMs
      : null;
  const createdAtMs =
    typeof cache.createdAtMs === 'number' && Number.isFinite(cache.createdAtMs)
      ? cache.createdAtMs
      : null;
  if (
    !url ||
    !origin ||
    !sessionId ||
    !eventHandlerName ||
    !experienceType ||
    !experienceVersion ||
    expiresAtMs === null ||
    createdAtMs === null
  ) {
    return null;
  }
  return {
    url,
    origin,
    sessionId,
    eventHandlerName,
    experienceType,
    experienceVersion,
    expiresAtMs,
    createdAtMs,
    experienceCacheKey: buildExperienceCacheKey(experienceType, experienceVersion),
  };
}

export const evereeCreateOnboardingSession = onCall(async (request) => {
  requireAuth(request);
  const d = request.data as Record<string, unknown> | null;
  const tenantId = typeof d?.tenantId === 'string' ? d.tenantId : '';
  const entityId = typeof d?.entityId === 'string' ? d.entityId : '';
  const userId = typeof d?.userId === 'string' ? d.userId : '';
  const evereeWorkerId = typeof d?.evereeWorkerId === 'string' ? d.evereeWorkerId : '';
  if (!tenantId || !entityId || !userId || !evereeWorkerId) {
    throw new HttpsError('invalid-argument', 'tenantId, entityId, userId, evereeWorkerId required');
  }
  if (!(await canSelfOrManageEveree(request.auth as any, tenantId, userId))) {
    throw new HttpsError('permission-denied', 'Not allowed');
  }
  await requireEvereeEnabledEntity(tenantId, entityId);
  const experienceType = coerceEmbedExperienceType(d?.experienceType);
  const experienceVersion = coerceEmbedExperienceVersion(d?.experienceVersion);
  const requestedKey = buildExperienceCacheKey(
    experienceType ?? null,
    experienceVersion ?? null,
  );

  // Reuse a cached embed session if one was minted very recently for the
  // same (tenant, entity, user, experience) tuple. Prevents the
  // burst-of-session-creates pattern that triggers Everee's account-access
  // lock (see EMBED_SESSION_REUSE_WINDOW_MS comment).
  const linkRef = admin
    .firestore()
    .doc(`tenants/${tenantId}/everee_workers/${entityId}__${userId}`);
  const linkSnap = await linkRef.get().catch(() => null);
  const cached = readCachedEmbedSession(linkSnap?.data());
  const nowMs = Date.now();
  if (
    cached &&
    cached.experienceCacheKey === requestedKey &&
    nowMs - cached.createdAtMs <= EMBED_SESSION_REUSE_WINDOW_MS &&
    cached.expiresAtMs - nowMs >= EMBED_SESSION_MIN_REMAINING_MS
  ) {
    logger.info('[evereeCreateOnboardingSession] reusing cached session', {
      tenantId,
      entityId,
      userId,
      sessionId: cached.sessionId,
      ageMs: nowMs - cached.createdAtMs,
      remainingMs: cached.expiresAtMs - nowMs,
      experienceCacheKey: cached.experienceCacheKey,
      reason: 'within_reuse_window',
    });
    // Best-effort reuse-counter bump for ops visibility — never block the
    // response on a counter write.
    linkRef
      .set(
        {
          embedSessionCache: {
            lastReusedAtMs: nowMs,
            reuseCount: admin.firestore.FieldValue.increment(1),
          },
        },
        { merge: true },
      )
      .catch(() => undefined);
    return {
      url: cached.url,
      origin: cached.origin,
      sessionId: cached.sessionId,
      expiresInMs: cached.expiresAtMs - nowMs,
      experienceType: cached.experienceType,
      experienceVersion: cached.experienceVersion,
      eventHandlerName: cached.eventHandlerName,
      embedUrl: cached.url,
      expiresAt: new Date(cached.expiresAtMs).toISOString(),
      reusedFromCache: true,
    };
  }

  try {
    const session = await createOnboardingSession({
      tenantId,
      entityId,
      userId,
      evereeWorkerId,
      returnUrl: typeof d?.returnUrl === 'string' ? d.returnUrl : undefined,
      ...(experienceType ? { experienceType } : {}),
      ...(experienceVersion ? { experienceVersion } : {}),
    });
    const expiresAtMs = nowMs + session.expiresInMs;
    // Persist the freshly-minted session for the reuse window. Best-effort —
    // a failed cache write should not block the response.
    linkRef
      .set(
        {
          embedSessionCache: {
            url: session.url,
            origin: session.origin,
            sessionId: session.sessionId,
            experienceType: session.experienceType,
            experienceVersion: session.experienceVersion,
            eventHandlerName: session.eventHandlerName,
            expiresAtMs,
            createdAtMs: nowMs,
            createCount: admin.firestore.FieldValue.increment(1),
          },
        },
        { merge: true },
      )
      .catch((err) => {
        logger.warn('[evereeCreateOnboardingSession] cache write failed', {
          tenantId,
          entityId,
          userId,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    return {
      ...session,
      embedUrl: session.url,
      expiresAt: new Date(expiresAtMs).toISOString(),
      reusedFromCache: false,
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error('[evereeCreateOnboardingSession] failed', {
      tenantId,
      entityId,
      userId,
      message: msg,
    });
    const safe =
      msg.length > 480 ? `${msg.slice(0, 480)}…` : msg || 'Could not create Everee embed session';
    throw new HttpsError('failed-precondition', safe);
  }
});

export const evereeGetPayHistory = onCall(async (request) => {
  requireAuth(request);
  const d = request.data as Record<string, unknown> | null;
  const tenantId = typeof d?.tenantId === 'string' ? d.tenantId : '';
  const entityId = typeof d?.entityId === 'string' ? d.entityId : '';
  const userId = typeof d?.userId === 'string' ? d.userId : request.auth?.uid ?? '';
  if (!tenantId || !entityId) {
    throw new HttpsError('invalid-argument', 'tenantId, entityId required');
  }
  if (!(await canSelfOrManageEveree(request.auth as any, tenantId, userId))) {
    throw new HttpsError('permission-denied', 'Not allowed to view pay history for this user');
  }
  await requireEvereeEnabledEntity(tenantId, entityId);
  // Service returns { items, nextCursor } — matches the client's
  // EvereeGetPayHistoryResult envelope, no transformation needed.
  return getPayHistory(tenantId, entityId, userId);
});

export const evereeGetPayStatement = onCall(async (request) => {
  requireAuth(request);
  const d = request.data as Record<string, unknown> | null;
  const tenantId = typeof d?.tenantId === 'string' ? d.tenantId : '';
  const entityId = typeof d?.entityId === 'string' ? d.entityId : '';
  const userId = typeof d?.userId === 'string' ? d.userId : request.auth?.uid ?? '';
  const statementId = typeof d?.statementId === 'string' ? d.statementId : '';
  if (!tenantId || !entityId || !statementId) {
    throw new HttpsError('invalid-argument', 'tenantId, entityId, statementId required');
  }
  if (!(await canSelfOrManageEveree(request.auth as any, tenantId, userId))) {
    throw new HttpsError('permission-denied', 'Not allowed to view pay statement for this user');
  }
  await requireEvereeEnabledEntity(tenantId, entityId);
  const out = await getPayStatement(tenantId, entityId, userId, statementId);
  return out ?? null;
});

export const evereeAdminPushShift = onCall(async (request) => {
  requireAuth(request);
  const { tenantId, entityId } = requireTenantEntity(request.data);
  if (!(await canManageEveree(request.auth as any, tenantId))) {
    throw new HttpsError('permission-denied', 'Not allowed');
  }
  await requireEvereeEnabledEntity(tenantId, entityId);
  const payload = (request.data as Record<string, unknown>) ?? {};
  return pushShift(tenantId, entityId, payload as Parameters<typeof pushShift>[2]);
});

export const evereeAdminPreparePayout = onCall(async (request) => {
  requireAuth(request);
  const { tenantId, entityId } = requireTenantEntity(request.data);
  if (!(await canManageEveree(request.auth as any, tenantId))) {
    throw new HttpsError('permission-denied', 'Not allowed');
  }
  await requireEvereeEnabledEntity(tenantId, entityId);
  const payload = (request.data as Record<string, unknown>) ?? {};
  return preparePayout(tenantId, entityId, payload as Parameters<typeof preparePayout>[2]);
});

/**
 * Admin-only "fetch the worker straight from Everee" debug helper. Wraps
 * `GET /api/v2/workers/<id>` and returns the raw response so the operator can
 * eyeball address / direct deposit / W-4 / tax data that lives only in Everee
 * (we never persist that PII in Firestore by design).
 *
 * Failure modes are surfaced verbatim — Everee endpoint 404s ("path not
 * found") look the same as auth errors otherwise, so we let the underlying
 * `Error` message bubble through `failed-precondition` to make it obvious
 * when we need to point at `/api/v2/embedded/workers/{id}` instead.
 */
/**
 * Worker-callable: ask Everee whether onboarding is finished for the worker
 * tied to the given Everee tenant. Used by `/c1/workers/payroll/{tid}` as a
 * server-side preflight so we can request the right Embed Component
 * (`ONBOARDING` vs `WORKER_HOME`) without depending on signals that often
 * aren't available — webhooks may be queued behind a signature rotation, and
 * Everee's iframe posts EMB-201 over `host MessagePort` / `webkit.messageHandlers`,
 * neither of which exists in a browser tab.
 *
 * Returns ONLY status flags, never PII. The full record is exposed via
 * `evereeAdminGetWorker` for admin debugging.
 *
 * On positive detection we mirror `status: 'onboarding_complete'` onto
 * `tenants/{tid}/everee_workers/{entityId__userId}` (UX-only field) so the
 * next page load can short-circuit without re-hitting Everee.
 */
export const evereeGetMyOnboardingStatus = onCall(async (request) => {
  requireAuth(request);
  const d = request.data as Record<string, unknown> | null;
  const tenantId = typeof d?.tenantId === 'string' ? d.tenantId : '';
  const entityId = typeof d?.entityId === 'string' ? d.entityId : '';
  const evereeWorkerId = typeof d?.evereeWorkerId === 'string' ? d.evereeWorkerId : '';
  const targetUserId = typeof d?.userId === 'string' ? d.userId : request.auth?.uid ?? '';
  if (!tenantId || !entityId || !evereeWorkerId) {
    throw new HttpsError('invalid-argument', 'tenantId, entityId, evereeWorkerId required');
  }
  if (!(await canSelfOrManageEveree(request.auth as any, tenantId, targetUserId))) {
    throw new HttpsError('permission-denied', 'Not allowed');
  }
  const config = await requireEvereeEnabledEntity(tenantId, entityId);

  let raw: Record<string, unknown> = {};
  try {
    raw = (await evereeRequest<Record<string, unknown>>(
      config,
      'GET',
      `/api/v2/workers/${encodeURIComponent(evereeWorkerId)}`,
    )) ?? {};
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.warn('[evereeGetMyOnboardingStatus] api_call_failed', {
      tenantId,
      entityId,
      evereeWorkerId,
      message: msg,
    });
    // Soft-fail: caller treats `null` as "couldn't determine" and falls back
    // to its existing client-side detection. We don't surface PII or expose
    // raw API errors to the worker UI.
    return {
      ok: false as const,
      onboardingComplete: null as boolean | null,
      accountClaimed: null as boolean | null,
      reason: 'everee_api_call_failed' as const,
    };
  }

  const detail = inspectEvereeOnboardingState(raw);
  const onboardingComplete = detail.complete;
  const accountClaimed = pickBoolean(raw, [
    'accountClaimed',
    'isAccountClaimed',
    ['account', 'claimed'],
    ['onboarding', 'accountClaimed'],
  ]);

  if (onboardingComplete) {
    try {
      const linkRef = admin
        .firestore()
        .doc(`tenants/${tenantId}/everee_workers/${entityId}__${targetUserId}`);
      await linkRef.set(
        {
          status: 'onboarding_complete',
          // Distinct timestamp from `onboardingCompletedAt` (webhook-set) so we
          // can tell mirrored-from-API vs canonical webhook events apart.
          apiObservedOnboardingCompleteAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    } catch (e: unknown) {
      logger.warn('[evereeGetMyOnboardingStatus] mirror_write_failed', {
        tenantId,
        entityId,
        evereeWorkerId,
        message: e instanceof Error ? e.message : String(e),
      });
    }
    // Flip the entity_employments lifecycle so the Work Readiness chip turns
    // green for this entity (idempotent; never reverses terminal statuses).
    await mirrorEvereeOnboardingCompleteToEmployments({
      tenantId,
      entityId,
      userId: targetUserId,
    });
  } else {
    // Inverse: Everee API authoritatively says the worker is **not** done.
    // Clear stale UX-only completion stamps that may have been written from a
    // false-positive iframe message — those would otherwise keep the client
    // requesting `WORKER_HOME` (→ EMB-202 loop). We **never** touch
    // `status` / `onboardingCompletedAt` here; those belong to the webhook
    // and we don't want to clobber a real completion that the API momentarily
    // failed to surface.
    try {
      const linkRef = admin
        .firestore()
        .doc(`tenants/${tenantId}/everee_workers/${entityId}__${targetUserId}`);
      const snap = await linkRef.get();
      const data = (snap.exists ? snap.data() : null) as
        | { clientObservedOnboardingCompleteAt?: unknown; apiObservedOnboardingCompleteAt?: unknown }
        | null;
      if (
        data &&
        (data.clientObservedOnboardingCompleteAt || data.apiObservedOnboardingCompleteAt)
      ) {
        await linkRef.set(
          {
            clientObservedOnboardingCompleteAt: admin.firestore.FieldValue.delete(),
            clientObservedOnboardingCompleteReason: admin.firestore.FieldValue.delete(),
            apiObservedOnboardingCompleteAt: admin.firestore.FieldValue.delete(),
            preflightClearedStaleStampsAt: admin.firestore.FieldValue.serverTimestamp(),
            preflightClearedStaleStampsReason: 'everee_api_says_not_complete',
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
        logger.info('[evereeGetMyOnboardingStatus] cleared_stale_completion_stamps', {
          tenantId,
          entityId,
          evereeWorkerId,
        });
      }
    } catch (e: unknown) {
      logger.warn('[evereeGetMyOnboardingStatus] stale_clear_failed', {
        tenantId,
        entityId,
        evereeWorkerId,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return {
    ok: true as const,
    onboardingComplete,
    accountClaimed,
    // EE.4 — raw Everee signals so the client can enforce the same
    // unanimity rule (`onboardingComplete && onboardingStatus ===
    // 'COMPLETE'`) before requesting `WORKER_HOME`. Treats the server
    // matcher as a hint, not as the deciding factor — defense in depth.
    onboardingStatus: detail.onboardingStatus,
    onboardingCompleteSignal: detail.onboardingCompleteBool,
  };
});

/**
 * Strict detection of "is this Everee worker done with onboarding?" given
 * the raw `GET /api/v2/workers/{id}` response.
 *
 * EE.4 — historically this matcher accepted `status` / `workerStatus` ∈
 * `{ACTIVE, DONE, COMPLETE, …}` as evidence of onboarding completion.
 * That conflated two orthogonal Everee fields:
 *   - `lifecycleStatus` / `status` describes the **employment** (ACTIVE,
 *     TERMINATED, INACTIVE) — workers mid-onboarding can be ACTIVE.
 *   - `onboardingStatus` describes the **onboarding flow** (IN_PROGRESS,
 *     COMPLETE) — this is the actual signal we need.
 * The conflation produced false positives that:
 *   1) Mirrored `status: 'onboarding_complete'` to the link doc
 *      (`apiObservedOnboardingCompleteAt`) — locking in the deadlock.
 *   2) Made the next preflight request `WORKER_HOME` from Everee, which
 *      Everee correctly rejected with EMB-202 because onboarding wasn't
 *      actually finished. The bridge protocol break (EMB-102) meant the
 *      iframe's EMB-202 toast never reached our client recovery handler,
 *      so the deadlock never self-healed.
 *
 * Rule now: only count Everee onboarding as complete when BOTH of these
 * hold (when present); when only one is present, that signal must be
 * unambiguous on its own:
 *   - `onboardingComplete === true` (the dedicated boolean), OR
 *   - `onboardingStatus`/`onboarding.status` ∈ `{COMPLETE, COMPLETED,
 *     ONBOARDING_COMPLETE}` (the dedicated string).
 *
 * If `onboardingComplete: true` AND `onboardingStatus: 'COMPLETE'` are
 * both present, both must agree. If they disagree, return false (safer
 * to under-report than to over-report — over-reporting deadlocks the
 * worker; under-reporting just costs a session retry).
 *
 * Lifecycle/employment status (`status`, `workerStatus`,
 * `account.status`) is **never** accepted as evidence here.
 */
function isEvereeOnboardingComplete(raw: Record<string, unknown>): boolean {
  const detail = inspectEvereeOnboardingState(raw);
  return detail.complete;
}

/**
 * EE.4 — surface the underlying signals so callers (the preflight
 * callable, the client, and tests) can reason about *why* the matcher
 * returned what it did, not just the boolean. Used by the worker-portal
 * preflight to pass the raw `onboardingStatus` back to the client; the
 * client uses it to enforce the same agreement rule before requesting
 * `WORKER_HOME`.
 */
export function inspectEvereeOnboardingState(raw: Record<string, unknown>): {
  complete: boolean;
  /** Raw `onboardingStatus` as sent by Everee, uppercased; null when absent. */
  onboardingStatus: string | null;
  /** Raw `onboardingComplete` boolean as sent by Everee; null when absent. */
  onboardingCompleteBool: boolean | null;
} {
  const onboardingCompleteBool = pickBoolean(raw, [
    'onboardingComplete',
    ['onboarding', 'complete'],
    ['onboarding', 'isComplete'],
  ]);
  const statusRaw =
    (typeof raw.onboardingStatus === 'string' && raw.onboardingStatus) ||
    (typeof (raw.onboarding as Record<string, unknown> | undefined)?.status === 'string' &&
      ((raw.onboarding as Record<string, unknown>).status as string)) ||
    null;
  const onboardingStatus = statusRaw ? statusRaw.trim().toUpperCase() : null;

  const STATUS_COMPLETE = new Set(['COMPLETE', 'COMPLETED', 'ONBOARDING_COMPLETE']);
  const statusSaysComplete = onboardingStatus !== null && STATUS_COMPLETE.has(onboardingStatus);

  let complete: boolean;
  if (onboardingCompleteBool !== null && onboardingStatus !== null) {
    // Both signals present → require unanimity. Disagreement is a strong
    // hint Everee is mid-state; safer to under-report and ask again.
    complete = onboardingCompleteBool === true && statusSaysComplete;
  } else if (onboardingCompleteBool !== null) {
    complete = onboardingCompleteBool === true;
  } else if (onboardingStatus !== null) {
    complete = statusSaysComplete;
  } else {
    // Neither signal present — Everee API didn't tell us. Default to
    // false so we ask for ONBOARDING and let the worker continue.
    complete = false;
  }

  return { complete, onboardingStatus, onboardingCompleteBool };
}

function pickBoolean(
  obj: Record<string, unknown>,
  paths: Array<string | string[]>,
): boolean | null {
  for (const p of paths) {
    const segments = Array.isArray(p) ? p : [p];
    let cur: unknown = obj;
    for (const seg of segments) {
      if (cur && typeof cur === 'object' && seg in (cur as Record<string, unknown>)) {
        cur = (cur as Record<string, unknown>)[seg];
      } else {
        cur = undefined;
        break;
      }
    }
    if (typeof cur === 'boolean') return cur;
  }
  return null;
}

/**
 * Idempotently mirror Everee's "onboarding complete" signal to
 * `tenants/{tenantId}/entity_employments` (and the related `user_employments`
 * rows). This is what flips the Work Readiness chip for this entity from
 * `Onboarding` (yellow) to `Active` (green) in recruiter tables and the
 * record header.
 *
 * Driven from `evereeGetMyOnboardingStatus` (worker self-fetch) and
 * `evereeAdminGetWorker` (recruiter Everee data card load) so the chip stays
 * in sync regardless of which surface observes the completion first — this
 * is the same end-state the `worker.onboarding-completed` webhook would
 * reach, but Everee's webhook delivery is occasionally delayed in pilot, so
 * we never want the UI to lag the live API.
 *
 * Strong terminal statuses (`terminated`, `inactive`, `blocked`) are
 * preserved — completion never resurrects a closed employment.
 */
// Exported under a `__test__` prefix so the RA.2 unit tests can pin the
// mirror's per-section status writes without forcing the helper into
// callers' public API surface. Kept private from `index.ts` exports —
// production code paths still call it via the file-local reference.
export async function __test__mirrorEvereeOnboardingCompleteToEmployments(args: {
  tenantId: string;
  entityId: string;
  userId: string;
}): Promise<void> {
  return mirrorEvereeOnboardingCompleteToEmployments(args);
}

async function mirrorEvereeOnboardingCompleteToEmployments(args: {
  tenantId: string;
  entityId: string;
  userId: string;
}): Promise<void> {
  const { tenantId, entityId, userId } = args;
  if (!tenantId || !entityId || !userId) return;

  const db = admin.firestore();
  const STRONG = new Set(['terminated', 'inactive', 'blocked']);
  const now = admin.firestore.FieldValue.serverTimestamp();

  try {
    const entityEmpQuery = await db
      .collection(`tenants/${tenantId}/entity_employments`)
      .where('userId', '==', userId)
      .where('entityId', '==', entityId)
      .limit(2)
      .get();

    for (const docSnap of entityEmpQuery.docs) {
      const data = docSnap.data() as Record<string, unknown>;
      const statusNow = String(data.status || '').trim().toLowerCase();
      // Skip mirror writes for strong/terminal lifecycle states — Everee
      // completion can race a recruiter-driven termination; the stronger
      // signal wins.
      if (STRONG.has(statusNow)) continue;

      const alreadyComplete =
        data.onboardingComplete === true && data.active === true && statusNow === 'active';
      const fragment: Record<string, unknown> = {
        evereeOnboardingStatus: 'complete',
        payrollOnboardingCompletedAt: data.payrollOnboardingCompletedAt ?? now,
        updatedAt: now,
      };
      // RA.2 — flip the per-section status flags the client derives Action
      // Items + Readiness chips from. Pre-RA.2 the mirror only set the
      // lifecycle bits (`status`, `active`, `evereeOnboardingStatus`) and
      // left `payrollStatus` / `taxIdentityStatus` at their stale wizard
      // values, which is why workers who finished payroll onboarding in
      // Everee kept seeing "Payroll or tax setup open — C1 Events" on the
      // recruiter Action Items list (Bug #2 in the action-items-readiness
      // audit). Everee's onboarding flow covers payroll setup (W-4 + bank
      // for W-2, W-9 + bank for 1099) and tax identity (I-9 for W-2; W-9
      // covers tax identity for 1099 — for 1099 the rule-layer suppresses
      // `i9_incomplete` regardless via RA.1, so the title stays accurate).
      // Idempotent: don't bump the timestamp if already `complete` so we
      // don't fan out spurious `users.updatedAt` cascades on every preflight.
      const payrollStatusNow = String(data.payrollStatus || '').trim().toLowerCase();
      if (payrollStatusNow !== 'complete') {
        fragment.payrollStatus = 'complete';
      }
      const taxIdentityStatusNow = String(data.taxIdentityStatus || '').trim().toLowerCase();
      if (taxIdentityStatusNow !== 'complete') {
        fragment.taxIdentityStatus = 'complete';
      }
      if (!alreadyComplete) {
        fragment.onboardingComplete = true;
        fragment.active = true;
        fragment.status = 'active';
        fragment.employmentState = 'active';
        if (data.onboardingCompletedAt == null) fragment.onboardingCompletedAt = now;
        if (data.hiredAt == null) fragment.hiredAt = now;
      }
      await docSnap.ref.set(fragment, { merge: true });
    }
  } catch (e: unknown) {
    logger.warn('[mirrorEvereeOnboardingCompleteToEmployments] entity_employments_mirror_failed', {
      tenantId,
      entityId,
      userId,
      message: e instanceof Error ? e.message : String(e),
    });
  }

  try {
    const userEmpQuery = await db
      .collection(`tenants/${tenantId}/user_employments`)
      .where('userId', '==', userId)
      .where('entityId', '==', entityId)
      .limit(10)
      .get();
    for (const docSnap of userEmpQuery.docs) {
      const data = docSnap.data() as Record<string, unknown>;
      if (data.evereeOnboardingStatus === 'complete' && data.payrollOnboardingCompletedAt != null) {
        continue;
      }
      await docSnap.ref.set(
        {
          payrollOnboardingCompletedAt: data.payrollOnboardingCompletedAt ?? now,
          evereeOnboardingStatus: 'complete',
          updatedAt: now,
        },
        { merge: true },
      );
    }
  } catch (e: unknown) {
    logger.warn('[mirrorEvereeOnboardingCompleteToEmployments] user_employments_mirror_failed', {
      tenantId,
      entityId,
      userId,
      message: e instanceof Error ? e.message : String(e),
    });
  }

  // W.1 — work-eligibility mirror (W-2 / Everee I-9 path).
  // Federal contractor rule (1099 = no I-9 required) is mirrored at on-call
  // creation time in `runStartOnCallEmploymentFlow`, so this branch only
  // fires for `workerType === 'employee'`. Reading the link doc is the
  // canonical source for worker classification — the entity_employments
  // schema uses HRX terminology (`w2`/`1099`), the Everee link doc uses
  // Everee API terminology (`employee`/`contractor`), and we want the
  // latter so the gate matches the I-9 collection that just succeeded.
  // Non-blocking: helper logs internal failures and never throws.
  try {
    const linkSnap = await db
      .doc(`tenants/${tenantId}/everee_workers/${entityId}__${userId}`)
      .get();
    const linkData = (linkSnap.exists ? linkSnap.data() : null) as
      | { workerType?: 'employee' | 'contractor' }
      | null;
    const workerType = linkData?.workerType;
    if (workerType === 'employee') {
      await mirrorWorkEligibilityFromAuthoritativeSource({
        userId,
        source: 'everee_i9',
        callerContext: 'mirrorEvereeOnboardingCompleteToEmployments',
        tenantId,
        entityId,
      });
    }
  } catch (e: unknown) {
    logger.warn('[mirrorEvereeOnboardingCompleteToEmployments] work_eligibility_mirror_failed', {
      tenantId,
      entityId,
      userId,
      message: e instanceof Error ? e.message : String(e),
    });
  }
}

/**
 * EE.4 — admin/CSA recovery callable. Clears the optimistic UX-only
 * onboarding-completion stamps from `tenants/{t}/everee_workers/{eId__uId}`
 * so a deadlocked worker can re-enter the ONBOARDING experience.
 *
 * What it clears (UX hints):
 *   - `clientObservedOnboardingCompleteAt` + reason
 *   - `apiObservedOnboardingCompleteAt`
 *   - `status` field, only when its value is `onboarding_complete`
 *     (set by the EE.4 server-side preflight). Canonical webhook
 *     `status` values (e.g. `active`, `terminated`) are left alone.
 *
 * What it never touches (canonical):
 *   - `onboardingCompletedAt` (webhook-owned)
 *   - `lifecycleStatus`, `terminatedAt`, etc.
 *
 * Even with the EE.4 Layer 1+2 fixes, there is an existing population of
 * mis-stamped workers (Greg's C1 Select test worker is one) — this
 * callable is the permanent recovery tool. CSA can call it from the admin
 * console; in the future it could be wired to a "Reset payroll session"
 * button on the worker profile.
 */
export const evereeAdminClearStaleStamps = onCall(async (request) => {
  requireAuth(request);
  const d = request.data as Record<string, unknown> | null;
  const tenantId = typeof d?.tenantId === 'string' ? d.tenantId : '';
  const entityId = typeof d?.entityId === 'string' ? d.entityId : '';
  const userId = typeof d?.userId === 'string' ? d.userId : '';
  const reason = typeof d?.reason === 'string' && d.reason.trim() ? d.reason.trim() : 'admin_csa_clear';
  if (!tenantId || !entityId || !userId) {
    throw new HttpsError('invalid-argument', 'tenantId, entityId, userId required');
  }
  // Admin-only — the worker-self-clear path already exists implicitly
  // via the preflight inverse-mirror (`evereeGetMyOnboardingStatus` →
  // clears stale stamps when the API says not-complete). This callable
  // is for cases where the preflight is unreachable or the stamp got
  // there by some other means.
  if (!(await canManageEveree(request.auth as any, tenantId))) {
    throw new HttpsError(
      'permission-denied',
      'Not allowed to clear Everee onboarding stamps for this tenant',
    );
  }
  const linkRef = admin
    .firestore()
    .doc(`tenants/${tenantId}/everee_workers/${entityId}__${userId}`);
  let cleared: string[] = [];
  try {
    const snap = await linkRef.get();
    const data = (snap.exists ? snap.data() : null) as
      | {
          clientObservedOnboardingCompleteAt?: unknown;
          clientObservedOnboardingCompleteReason?: unknown;
          apiObservedOnboardingCompleteAt?: unknown;
          status?: unknown;
        }
      | null;
    if (!data) {
      return { ok: true as const, cleared: [], reason: 'link_doc_missing' as const };
    }
    const update: Record<string, unknown> = {
      adminStampClearedAt: admin.firestore.FieldValue.serverTimestamp(),
      adminStampClearedReason: reason,
      adminStampClearedBy: request.auth?.uid ?? null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (data.clientObservedOnboardingCompleteAt) {
      update.clientObservedOnboardingCompleteAt = admin.firestore.FieldValue.delete();
      cleared.push('clientObservedOnboardingCompleteAt');
    }
    if (data.clientObservedOnboardingCompleteReason) {
      update.clientObservedOnboardingCompleteReason = admin.firestore.FieldValue.delete();
      cleared.push('clientObservedOnboardingCompleteReason');
    }
    if (data.apiObservedOnboardingCompleteAt) {
      update.apiObservedOnboardingCompleteAt = admin.firestore.FieldValue.delete();
      cleared.push('apiObservedOnboardingCompleteAt');
    }
    // Only clear `status` when it's the optimistic value we ourselves
    // wrote in the preflight; never clobber webhook-owned values.
    if (typeof data.status === 'string' && data.status === 'onboarding_complete') {
      update.status = admin.firestore.FieldValue.delete();
      cleared.push('status');
    }
    if (cleared.length === 0) {
      return { ok: true as const, cleared: [], reason: 'nothing_to_clear' as const };
    }
    await linkRef.set(update, { merge: true });
    logger.info('[evereeAdminClearStaleStamps] cleared', {
      tenantId,
      entityId,
      userId,
      cleared,
      reason,
      callerUid: request.auth?.uid ?? null,
    });
    return { ok: true as const, cleared, reason: reason as string };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    logger.error('[evereeAdminClearStaleStamps] failed', {
      tenantId,
      entityId,
      userId,
      message,
    });
    throw new HttpsError('internal', message || 'Failed to clear stamps');
  }
});

export const evereeAdminGetWorker = onCall(async (request) => {
  requireAuth(request);
  const d = request.data as Record<string, unknown> | null;
  const tenantId = typeof d?.tenantId === 'string' ? d.tenantId : '';
  const entityId = typeof d?.entityId === 'string' ? d.entityId : '';
  const evereeWorkerId = typeof d?.evereeWorkerId === 'string' ? d.evereeWorkerId : '';
  // Subject-of-record. Defaults to caller (worker self-fetch); recruiters/admins
  // may pass any uid. Keeps the gate a single comparison instead of duplicating
  // the role check in every caller. The body of `userId` doesn't have to match
  // the Everee worker's external_user_id — we only use it to widen the gate
  // when the caller is the worker themselves.
  const targetUserId = typeof d?.userId === 'string' ? d.userId : request.auth?.uid ?? '';
  if (!tenantId || !entityId || !evereeWorkerId) {
    throw new HttpsError('invalid-argument', 'tenantId, entityId, evereeWorkerId required');
  }
  if (!(await canSelfOrManageEveree(request.auth as any, tenantId, targetUserId))) {
    throw new HttpsError('permission-denied', 'Not allowed');
  }
  const config = await requireEvereeEnabledEntity(tenantId, entityId);
  try {
    const response = await evereeRequest<unknown>(
      config,
      'GET',
      `/api/v2/workers/${encodeURIComponent(evereeWorkerId)}`,
    );
    // When the live Everee record reports onboarding-complete, flip the
    // matching `entity_employments` row so the Work Readiness chip turns
    // green for this entity. Idempotent and best-effort; never blocks the
    // response, never reverses terminal statuses (handled in the helper).
    if (response && typeof response === 'object') {
      const flat = response as Record<string, unknown>;
      const candidate =
        (flat.worker as Record<string, unknown> | undefined) ||
        (flat.data as Record<string, unknown> | undefined) ||
        flat;
      if (isEvereeOnboardingComplete(candidate)) {
        await mirrorEvereeOnboardingCompleteToEmployments({
          tenantId,
          entityId,
          userId: targetUserId,
        });
      }
    }
    return { ok: true as const, evereeWorkerId, evereeTenantId: config.evereeTenantId, response };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error('[evereeAdminGetWorker] failed', {
      tenantId,
      entityId,
      evereeWorkerId,
      message: msg,
    });
    const safe =
      msg.length > 480 ? `${msg.slice(0, 480)}…` : msg || 'Could not fetch worker from Everee';
    throw new HttpsError('failed-precondition', safe);
  }
});

/**
 * Parse the HTTP status that `evereeRequest` embeds in its thrown Error
 * message (shape: `Everee API GET /path: <status> <body>`). Used by the
 * tax-form callables to distinguish "this worker isn't a contractor / W-2
 * yet" (404 — render the section as not-applicable) from real upstream
 * failures we want the panel to surface.
 */
function parseEvereeErrorStatus(message: string): number | null {
  const match = /:\s*(\d{3})\b/.exec(message);
  if (!match) return null;
  const n = parseInt(match[1], 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Worker-signed file index (`GET /api/v2/workers/files`). Endpoint locked
 * after pilot — single call, paginated by `size`. Default 100 covers the
 * worst pilot scenario (full annual tax pack + onboarding + policies).
 *
 * Wrapper shape preserved for backward compat: callers continue to read
 * `result.ok`. `attempts` always returns `[]` so legacy diagnostic UIs
 * render the empty case until we delete those branches.
 */
export const evereeAdminGetWorkerDocuments = onCall(async (request) => {
  requireAuth(request);
  const d = request.data as Record<string, unknown> | null;
  const tenantId = typeof d?.tenantId === 'string' ? d.tenantId : '';
  const entityId = typeof d?.entityId === 'string' ? d.entityId : '';
  const evereeWorkerId = typeof d?.evereeWorkerId === 'string' ? d.evereeWorkerId : '';
  const targetUserId = typeof d?.userId === 'string' ? d.userId : request.auth?.uid ?? '';
  if (!tenantId || !entityId || !evereeWorkerId) {
    throw new HttpsError('invalid-argument', 'tenantId, entityId, evereeWorkerId required');
  }
  if (!(await canSelfOrManageEveree(request.auth as any, tenantId, targetUserId))) {
    throw new HttpsError('permission-denied', 'Not allowed');
  }
  const config = await requireEvereeEnabledEntity(tenantId, entityId);

  const path = `/api/v2/workers/files?worker-id=${encodeURIComponent(evereeWorkerId)}&size=100`;
  try {
    const response = await evereeRequest<Record<string, unknown>>(config, 'GET', path);
    const items = Array.isArray(response?.items) ? (response.items as unknown[]) : [];
    return {
      ok: true as const,
      evereeWorkerId,
      evereeTenantId: config.evereeTenantId,
      files: items,
    };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    logger.warn('[evereeAdminGetWorkerDocuments] api_call_failed', {
      tenantId,
      entityId,
      evereeWorkerId,
      message: message.slice(0, 240),
    });
    return {
      ok: false as const,
      evereeWorkerId,
      files: [] as unknown[],
      error: message.slice(0, 240),
    };
  }
});

/**
 * W-9 (contractor 1099) signed taxpayer-info pull. Returns the raw response
 * so the panel can render whichever Everee field names happen to be
 * authoritative this revision (we render defensively client-side). 404 ⇒
 * worker is W-2 (no W-9 applicable) — return `{ applicable: false }` so the
 * "Tax Forms" UI hides the W-9 card cleanly. Any other failure ⇒
 * `{ applicable: true, error }` so the panel can surface an inline alert.
 */
export const evereeAdminGetWorkerW9 = onCall(async (request) => {
  requireAuth(request);
  const d = request.data as Record<string, unknown> | null;
  const tenantId = typeof d?.tenantId === 'string' ? d.tenantId : '';
  const entityId = typeof d?.entityId === 'string' ? d.entityId : '';
  const evereeWorkerId = typeof d?.evereeWorkerId === 'string' ? d.evereeWorkerId : '';
  const targetUserId = typeof d?.userId === 'string' ? d.userId : request.auth?.uid ?? '';
  if (!tenantId || !entityId || !evereeWorkerId) {
    throw new HttpsError('invalid-argument', 'tenantId, entityId, evereeWorkerId required');
  }
  if (!(await canSelfOrManageEveree(request.auth as any, tenantId, targetUserId))) {
    throw new HttpsError('permission-denied', 'Not allowed');
  }
  const config = await requireEvereeEnabledEntity(tenantId, entityId);
  try {
    const response = await evereeRequest<unknown>(
      config,
      'GET',
      `/api/v2/workers/${encodeURIComponent(evereeWorkerId)}/w9-info`,
    );
    return { ok: true as const, applicable: true as const, response };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    const status = parseEvereeErrorStatus(message);
    if (status === 404) {
      return { ok: false as const, applicable: false as const };
    }
    logger.warn('[evereeAdminGetWorkerW9] api_call_failed', {
      tenantId,
      entityId,
      evereeWorkerId,
      status,
      message: message.slice(0, 240),
    });
    return {
      ok: false as const,
      applicable: true as const,
      error: message.slice(0, 240),
    };
  }
});

/**
 * W-4 (employee withholding) settings pull. Symmetric to W-9: 404 ⇒
 * `{ applicable: false }` (worker is a contractor / W-2 not yet completed),
 * other failures ⇒ `{ applicable: true, error }`.
 */
export const evereeAdminGetWorkerW4 = onCall(async (request) => {
  requireAuth(request);
  const d = request.data as Record<string, unknown> | null;
  const tenantId = typeof d?.tenantId === 'string' ? d.tenantId : '';
  const entityId = typeof d?.entityId === 'string' ? d.entityId : '';
  const evereeWorkerId = typeof d?.evereeWorkerId === 'string' ? d.evereeWorkerId : '';
  const targetUserId = typeof d?.userId === 'string' ? d.userId : request.auth?.uid ?? '';
  if (!tenantId || !entityId || !evereeWorkerId) {
    throw new HttpsError('invalid-argument', 'tenantId, entityId, evereeWorkerId required');
  }
  if (!(await canSelfOrManageEveree(request.auth as any, tenantId, targetUserId))) {
    throw new HttpsError('permission-denied', 'Not allowed');
  }
  const config = await requireEvereeEnabledEntity(tenantId, entityId);
  try {
    const response = await evereeRequest<unknown>(
      config,
      'GET',
      `/api/v2/workers/${encodeURIComponent(evereeWorkerId)}/w-4-tax-withholding-settings`,
    );
    return { ok: true as const, applicable: true as const, response };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    const status = parseEvereeErrorStatus(message);
    if (status === 404) {
      return { ok: false as const, applicable: false as const };
    }
    logger.warn('[evereeAdminGetWorkerW4] api_call_failed', {
      tenantId,
      entityId,
      evereeWorkerId,
      status,
      message: message.slice(0, 240),
    });
    return {
      ok: false as const,
      applicable: true as const,
      error: message.slice(0, 240),
    };
  }
});
