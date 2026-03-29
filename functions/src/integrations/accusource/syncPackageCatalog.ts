import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { accusourceClient } from './accusourceClient';
import { hasAccusourceOutboundAuth } from './accusourceAccessToken';
import { getAccusourceConfig } from './config';
import { ensureAccusourceAdmin } from './accusourceAdminGate';
import { normalizeAccusourceCompanyDetailsResponse } from './catalogNormalize';
import { accusourceLog } from './accusourceLogger';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

/** Single doc: normalized packages/services + sync metadata (server writes only). */
export const ACCUSOURCE_CATALOG_DOC_PATH = 'integrations_accusource/catalog';

/** SourceDirect returns 401 when Bearer token is wrong/expired or env URL mismatch — append ops hint for Firestore + logs. */
function appendAccusource401Hint(message: string): string {
  if (!/401|access_denied|token could not be verified/i.test(message)) {
    return message;
  }
  return `${message.trim()} [Ops: Prefer SOURCEDIRECT_CLIENT_ID + SOURCEDIRECT_CLIENT_SECRET (OAuth client_credentials; tokens refresh automatically) or set ACCUSOURCE_API_KEY / SOURCEDIRECT_API_KEY to a valid Bearer access token for the same stack as ACCUSOURCE_ENVIRONMENT and ACCUSOURCE_BASE_URL (sandbox vs production). Regenerate credentials in SourceDirect if rotated or expired.]`;
}

type SyncInput = {
  /** When set, resolves role/security from `users/{uid}.tenantIds.{tenantId}` (matches profile UI). */
  tenantId?: string;
  /** 1 = active packages (default), 0 = inactive, 'all' = both */
  isActive?: number | 'all';
};

/**
 * Admin-only: GET SourceDirect company details and persist normalized package/service catalog.
 */
export const syncAccusourcePackageCatalog = onCall({ cors: true }, async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Authentication required.');
  }

  const data = (request.data || {}) as SyncInput;
  const tenantIdForGate =
    typeof data.tenantId === 'string' && data.tenantId.trim() !== '' ? data.tenantId.trim() : undefined;
  await ensureAccusourceAdmin(request.auth.uid, tenantIdForGate);

  const cfg = getAccusourceConfig();
  if (!cfg.enabled) {
    throw new HttpsError('failed-precondition', 'AccuSource integration is disabled.');
  }
  if (!hasAccusourceOutboundAuth()) {
    throw new HttpsError(
      'failed-precondition',
      'AccuSource auth is not configured: set SOURCEDIRECT_CLIENT_ID + SOURCEDIRECT_CLIENT_SECRET (OAuth) or ACCUSOURCE_API_KEY / SOURCEDIRECT_API_KEY (static Bearer), matching ACCUSOURCE_ENVIRONMENT and ACCUSOURCE_BASE_URL.',
    );
  }

  const isActive = data.isActive === 'all' || data.isActive === 0 ? data.isActive : 1;

  const ref = db.doc(ACCUSOURCE_CATALOG_DOC_PATH);
  await ref.set(
    {
      syncStatus: 'pending',
      lastError: null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  try {
    const raw = await accusourceClient.getCompanyDetails(isActive);
    const normalized = normalizeAccusourceCompanyDetailsResponse(raw);

    await ref.set(
      {
        packages: normalized.packages,
        services: normalized.services,
        syncStatus: 'ok',
        lastError: null,
        lastSyncedAt: admin.firestore.FieldValue.serverTimestamp(),
        providerEnvironment: cfg.environment,
        syncedByUid: request.auth.uid,
        companyCount: normalized.companyCount,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    accusourceLog('info', 'catalog', 'Package catalog sync completed', {
      packages: normalized.packages.length,
      services: normalized.services.length,
      companies: normalized.companyCount,
    });

    return {
      ok: true,
      providerEnvironment: cfg.environment,
      packageCount: normalized.packages.length,
      serviceCount: normalized.services.length,
      companyCount: normalized.companyCount,
    };
  } catch (e: unknown) {
    const raw = e instanceof Error ? e.message : String(e);
    const msg = appendAccusource401Hint(raw);
    accusourceLog('error', 'catalog', 'Package catalog sync failed', { error: msg });
    await ref.set(
      {
        syncStatus: 'error',
        lastError: msg,
        lastSyncedAt: admin.firestore.FieldValue.serverTimestamp(),
        syncedByUid: request.auth.uid,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    throw new HttpsError('internal', msg);
  }
});
