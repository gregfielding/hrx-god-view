/**
 * QuickBooks Online — tenant-level OAuth connection (Expensify pipeline
 * phase 1, 2026-07-14; also the foundation for the invoicing roadmap in
 * docs/QUICKBOOKS_ONLINE_INTEGRATION_REFERENCE.md).
 *
 * One QBO company (realmId) connects per tenant; tokens live on
 * tenants/{tid}/integrations/quickbooks. Intuit refresh tokens ROTATE on
 * every refresh and carry a rolling ~100-day expiry — getQboAccessToken
 * always persists the newest refresh token, and anything that fails with
 * invalid_grant flips connected:false so the UI shows Reconnect.
 *
 * getQboAuthUrl / qboOAuthCallback — consent URL + redirect handler
 * (admin-gated: hrx claim, admin role, or securityLevel >= 6).
 * getQboStatus — connection health for the UI card.
 * getQboAccessToken / qboQuery — shared plumbing for downstream modules
 * (transaction puller, invoicing).
 */
import { onCall, onRequest, HttpsError } from 'firebase-functions/v2/https';
import { defineString } from 'firebase-functions/params';
import { logger } from 'firebase-functions/v2';
import * as admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

const qboClientId = defineString('QBO_CLIENT_ID');
const qboClientSecret = defineString('QBO_CLIENT_SECRET');
const qboRedirectUri = defineString('QBO_REDIRECT_URI');

const DISCOVERY_URL = 'https://developer.api.intuit.com/.well-known/openid_configuration';
const FALLBACK_AUTH_URL = 'https://appcenter.intuit.com/connect/oauth2';
const FALLBACK_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const API_BASE = 'https://quickbooks.api.intuit.com/v3/company';
const SCOPE = 'com.intuit.quickbooks.accounting';
const MINOR_VERSION = '75';
/** Refresh the access token when it has less than this long to live. */
const ACCESS_TOKEN_SLACK_MS = 5 * 60 * 1000;
/** OAuth state nonces are single-use and expire quickly (CSRF protection). */
const NONCE_TTL_MS = 15 * 60 * 1000;

/** Intuit discovery document (endpoints), cached per instance for a day. */
let discoveryCache: { authUrl: string; tokenUrl: string; fetchedAt: number } | null = null;
async function getEndpoints(): Promise<{ authUrl: string; tokenUrl: string }> {
  if (discoveryCache && Date.now() - discoveryCache.fetchedAt < 24 * 60 * 60 * 1000) {
    return discoveryCache;
  }
  try {
    const res = await fetch(DISCOVERY_URL, { headers: { Accept: 'application/json' } });
    const doc = (await res.json()) as Record<string, unknown>;
    const authUrl = trim(doc.authorization_endpoint) || FALLBACK_AUTH_URL;
    const tokenUrl = trim(doc.token_endpoint) || FALLBACK_TOKEN_URL;
    discoveryCache = { authUrl, tokenUrl, fetchedAt: Date.now() };
    return discoveryCache;
  } catch (err) {
    logger.warn('[qbo] discovery document fetch failed — using documented fallbacks', {
      err: err instanceof Error ? err.message : String(err),
    });
    return { authUrl: FALLBACK_AUTH_URL, tokenUrl: FALLBACK_TOKEN_URL };
  }
}

function trim(v: unknown): string {
  return String(v ?? '').trim();
}

function cfgRef(tenantId: string) {
  return db.doc(`tenants/${tenantId}/integrations/quickbooks`);
}

function basicAuthHeader(): string {
  return 'Basic ' + Buffer.from(`${qboClientId.value()}:${qboClientSecret.value()}`).toString('base64');
}

/** Books access: hrx staff, admin role, or securityLevel >= 6. */
async function ensureQboAdmin(uid: string, token: Record<string, unknown> | undefined): Promise<void> {
  if (token?.hrx === true) return;
  const data = ((await db.collection('users').doc(uid).get()).data() ?? {}) as Record<string, unknown>;
  const role = String(data.role ?? '').toLowerCase();
  const securityLevel = Number.parseInt(String(data.securityLevel ?? '0'), 10) || 0;
  if (role === 'admin' || role === 'super_admin' || securityLevel >= 6) return;
  throw new HttpsError('permission-denied', 'QuickBooks connection management requires admin privileges.');
}

async function exchangeToken(body: Record<string, string>): Promise<Record<string, unknown>> {
  const { tokenUrl } = await getEndpoints();
  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      Authorization: basicAuthHeader(),
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams(body).toString(),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    // intuit_tid is Intuit's per-request trace id — logged so their support
    // can locate the request when troubleshooting (App assessment Q).
    throw new Error(
      `Intuit token endpoint ${res.status} (intuit_tid=${res.headers.get('intuit_tid') ?? 'n/a'}): ${JSON.stringify(json)}`,
    );
  }
  return json;
}

function tokenPatch(tokens: Record<string, unknown>): Record<string, unknown> {
  const now = Date.now();
  return {
    'tokens.access_token': trim(tokens.access_token),
    'tokens.refresh_token': trim(tokens.refresh_token),
    'tokens.accessTokenExpiresAt': now + Number(tokens.expires_in ?? 3600) * 1000,
    'tokens.refreshTokenExpiresAt': now + Number(tokens.x_refresh_token_expires_in ?? 0) * 1000,
    'tokens.updatedAt': admin.firestore.FieldValue.serverTimestamp(),
  };
}

// ─────────────────────────────────────────────────────────────────────
// Connect
// ─────────────────────────────────────────────────────────────────────

export const getQboAuthUrl = onCall({ cors: true }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  const tenantId = trim((request.data as Record<string, unknown>)?.tenantId);
  if (!tenantId) throw new HttpsError('invalid-argument', 'tenantId is required.');
  await ensureQboAdmin(uid, request.auth?.token as never);

  // Single-use CSRF nonce: the callback only accepts states it issued.
  const nonceRef = db.collection('qbo_oauth_nonces').doc();
  await nonceRef.set({
    tenantId,
    connectedBy: uid,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    used: false,
  });

  const { authUrl } = await getEndpoints();
  const params = new URLSearchParams({
    client_id: qboClientId.value(),
    response_type: 'code',
    scope: SCOPE,
    redirect_uri: qboRedirectUri.value(),
    state: JSON.stringify({ purpose: 'qbo', tenantId, connectedBy: uid, nonce: nonceRef.id }),
  });
  return { authUrl: `${authUrl}?${params.toString()}` };
});

/** CSRF check: state must carry a nonce we issued, unexpired and unused —
 *  consumed transactionally so a replayed callback cannot reuse it. */
async function consumeOauthNonce(nonce: string, tenantId: string): Promise<boolean> {
  if (!nonce) return false;
  const ref = db.collection('qbo_oauth_nonces').doc(nonce);
  try {
    return await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const d = snap.data();
      if (!snap.exists || d?.used === true || trim(d?.tenantId) !== tenantId) return false;
      const createdAt = d?.createdAt as admin.firestore.Timestamp | undefined;
      if (!createdAt || Date.now() - createdAt.toMillis() > NONCE_TTL_MS) return false;
      tx.update(ref, { used: true, usedAt: admin.firestore.FieldValue.serverTimestamp() });
      return true;
    });
  } catch {
    return false;
  }
}

export const qboOAuthCallback = onRequest(async (req, res) => {
  const page = (title: string, body: string, notify: boolean) => `<!doctype html>
<html><head><meta charset="utf-8"><title>${title}</title></head>
<body style="font-family: Arial, sans-serif; padding: 24px;">
<h1>${title}</h1><p>${body}</p><p>You can close this window.</p>
${notify ? `<script>if (window.opener && typeof window.opener.postMessage === 'function') { window.opener.postMessage({ type: 'qbo-auth-success' }, '*'); }</script>` : ''}
</body></html>`;

  try {
    const code = trim(req.query.code);
    const realmId = trim(req.query.realmId);
    let state: Record<string, unknown> = {};
    try {
      state = JSON.parse(trim(req.query.state) || '{}');
    } catch {
      /* handled below */
    }
    const tenantId = trim(state.tenantId);
    if (!code || !realmId || !tenantId) {
      res.status(400).send(page('Connection failed', 'Missing code, realmId, or tenant in the Intuit callback.', false));
      return;
    }
    if (!(await consumeOauthNonce(trim(state.nonce), tenantId))) {
      logger.warn('[qbo] OAuth callback rejected — invalid, expired, or reused state nonce', { tenantId });
      res.status(400).send(page('Connection failed', 'This authorization link is invalid or expired — start the connect again from HRX.', false));
      return;
    }

    const tokens = await exchangeToken({
      grant_type: 'authorization_code',
      code,
      redirect_uri: qboRedirectUri.value(),
    });
    if (!trim(tokens.refresh_token)) {
      res.status(400).send(page('Connection incomplete', 'Intuit did not return a refresh token — try connecting again.', false));
      return;
    }

    await cfgRef(tenantId).set(
      {
        realmId,
        connected: true,
        connectedAt: admin.firestore.FieldValue.serverTimestamp(),
        connectedBy: trim(state.connectedBy) || null,
        tokenError: null,
      },
      { merge: true },
    );
    await cfgRef(tenantId).update(tokenPatch(tokens));

    logger.info('[qbo] connected', { tenantId, realmId, by: trim(state.connectedBy) });
    res.status(200).send(page(
      'QuickBooks connected',
      `Company <b>${realmId}</b> is connected. HRX can now read transactions for the expense pipeline and invoicing.`,
      true,
    ));
  } catch (err) {
    logger.error('[qbo] OAuth callback failed', { err: err instanceof Error ? err.message : String(err) });
    res.status(500).send(page('Connection failed', 'Could not complete the QuickBooks connection — close this window and try again.', false));
  }
});

export const getQboStatus = onCall({ cors: true }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  const tenantId = trim((request.data as Record<string, unknown>)?.tenantId);
  if (!tenantId) throw new HttpsError('invalid-argument', 'tenantId is required.');
  await ensureQboAdmin(uid, request.auth?.token as never);

  const cfg = (await cfgRef(tenantId).get()).data() ?? {};
  const tokens = (cfg.tokens ?? {}) as Record<string, unknown>;
  const ts = (v: unknown) => (v instanceof admin.firestore.Timestamp ? v.toMillis() : null);
  return {
    connected: cfg.connected === true,
    realmId: trim(cfg.realmId) || null,
    connectedAt: ts(cfg.connectedAt),
    refreshTokenExpiresAt: Number(tokens.refreshTokenExpiresAt ?? 0) || null,
    tokenError: trim(cfg.tokenError) || null,
  };
});

// ─────────────────────────────────────────────────────────────────────
// Shared plumbing for downstream modules
// ─────────────────────────────────────────────────────────────────────

export interface QboAccess {
  accessToken: string;
  realmId: string;
}

/** Returns a live access token, refreshing (and persisting the ROTATED
 *  refresh token) when needed. Throws failed-precondition if not connected. */
export async function getQboAccessToken(tenantId: string): Promise<QboAccess> {
  const ref = cfgRef(tenantId);
  const cfg = (await ref.get()).data() ?? {};
  const tokens = (cfg.tokens ?? {}) as Record<string, unknown>;
  const realmId = trim(cfg.realmId);
  if (cfg.connected !== true || !trim(tokens.refresh_token) || !realmId) {
    throw new HttpsError('failed-precondition', 'QuickBooks is not connected for this tenant.');
  }
  const expiresAt = Number(tokens.accessTokenExpiresAt ?? 0);
  if (trim(tokens.access_token) && Date.now() < expiresAt - ACCESS_TOKEN_SLACK_MS) {
    return { accessToken: trim(tokens.access_token), realmId };
  }
  try {
    const fresh = await exchangeToken({
      grant_type: 'refresh_token',
      refresh_token: trim(tokens.refresh_token),
    });
    await ref.update({ ...tokenPatch(fresh), tokenError: null });
    return { accessToken: trim(fresh.access_token), realmId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/invalid_grant/i.test(msg)) {
      await ref.set(
        { connected: false, tokenError: msg, tokenErrorAt: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true },
      );
    }
    throw err;
  }
}

/** Run a QBO query (SQL-ish) and return the parsed QueryResponse. */
export async function qboQuery(tenantId: string, query: string): Promise<Record<string, unknown>> {
  const { accessToken, realmId } = await getQboAccessToken(tenantId);
  const url = `${API_BASE}/${realmId}/query?minorversion=${MINOR_VERSION}&query=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  });
  const intuitTid = res.headers.get('intuit_tid') ?? 'n/a';
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    logger.error('[qbo] query failed', { status: res.status, intuitTid, query: query.slice(0, 120) });
    throw new Error(`QBO query ${res.status} (intuit_tid=${intuitTid}): ${JSON.stringify(json).slice(0, 500)}`);
  }
  return (json.QueryResponse ?? {}) as Record<string, unknown>;
}
