/**
 * Callable: fetch final or drug PDF from SourceDirect using server credentials (never expose API key to client).
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { getAccusourceBearerToken, hasAccusourceOutboundAuth } from './accusourceAccessToken';
import { getAccusourceConfig } from './config';
import { ensureAccusourceAdmin, assertCallerBelongsToTenant } from './accusourceAdminGate';
import { accusourceLog } from './accusourceLogger';
import { writeWorkerActivityLog } from '../../compliance/workerActivityLog';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

const MAX_PDF_BYTES = 9 * 1024 * 1024; // stay under typical callable response limits

function buildReportUrl(baseUrl: string, profileId: string, kind: 'final' | 'drug'): string {
  const b = baseUrl.replace(/\/+$/, '');
  const tail = kind === 'drug' ? 'drugReport' : 'report';
  if (b.endsWith('/v2') || b.endsWith('/v2/')) {
    return `${b}/profile/${encodeURIComponent(profileId)}/${tail}`;
  }
  return `${b}/api/v2/profile/${encodeURIComponent(profileId)}/${tail}`;
}

export type GetAccusourceBackgroundCheckPdfInput = {
  backgroundCheckId: string;
  kind: 'final' | 'drug';
};

export const getAccusourceBackgroundCheckPdf = onCall(
  { cors: true },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Authentication required.');
    }
    await ensureAccusourceAdmin(request.auth.uid);

    const cfg = getAccusourceConfig();
    if (!cfg.enabled) {
      throw new HttpsError('failed-precondition', 'AccuSource integration is disabled.');
    }
    if (!hasAccusourceOutboundAuth()) {
      throw new HttpsError(
        'failed-precondition',
        'AccuSource auth is not configured: set SOURCEDIRECT_CLIENT_ID + SOURCEDIRECT_CLIENT_SECRET (OAuth) or ACCUSOURCE_API_KEY / SOURCEDIRECT_API_KEY (static Bearer).',
      );
    }

    const data = (request.data || {}) as GetAccusourceBackgroundCheckPdfInput;
    const backgroundCheckId = String(data.backgroundCheckId || '').trim();
    const kind = data.kind === 'drug' ? 'drug' : 'final';
    if (!backgroundCheckId) {
      throw new HttpsError('invalid-argument', 'backgroundCheckId is required.');
    }

    const docRef = db.collection('backgroundChecks').doc(backgroundCheckId);
    const snap = await docRef.get();
    if (!snap.exists) {
      throw new HttpsError('not-found', 'Background check not found.');
    }
    const row = snap.data() || {};

    // P1 security (2026-07-13): report PDFs carry PII + criminal history —
    // the id-only lookup must not cross tenants.
    await assertCallerBelongsToTenant(
      request.auth.uid,
      request.auth.token as Record<string, unknown> | undefined,
      row.tenantId,
      'get_background_check_pdf',
    );
    const providerProfileId = row.providerProfileId;
    const pid = providerProfileId != null && String(providerProfileId).trim() !== '' ? String(providerProfileId).trim() : null;
    if (!pid) {
      throw new HttpsError('failed-precondition', 'No provider profile ID on this check yet.');
    }

    const bearer = await getAccusourceBearerToken();
    if (!bearer) {
      throw new HttpsError('failed-precondition', 'AccuSource Bearer token could not be resolved.');
    }

    const url = buildReportUrl(cfg.baseUrl, pid, kind);
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        authorization: `Bearer ${bearer}`,
        accept: 'application/pdf',
      },
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      accusourceLog('warn', 'pdf', 'SourceDirect PDF fetch failed', {
        status: res.status,
        url,
        snippet: text.slice(0, 200),
      });
      throw new HttpsError('failed-precondition', `SourceDirect returned ${res.status}`);
    }

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_PDF_BYTES) {
      throw new HttpsError('resource-exhausted', 'PDF is too large to return via callable.');
    }

    // Access audit (P1, policy §8): every report view lands on the worker's
    // activity trail. Best-effort — a logging failure must not block the fetch.
    const workerId = String(row.candidateId ?? '').trim();
    if (workerId) {
      await writeWorkerActivityLog({
        userId: workerId,
        action: 'background_check_report_viewed',
        description: `Background check report PDF (${kind}) viewed by staff`,
        severity: 'medium',
        metadata: { backgroundCheckId, viewedBy: request.auth.uid, kind },
      }).catch((err) =>
        accusourceLog('warn', 'pdf', 'report-view activity log failed', {
          backgroundCheckId,
          err: err instanceof Error ? err.message : String(err),
        }),
      );
    }
    accusourceLog('info', 'pdf', 'Report PDF served', {
      backgroundCheckId,
      kind,
      by: request.auth.uid,
    });

    return {
      pdfBase64: buf.toString('base64'),
      mimeType: 'application/pdf',
      kind,
      profileId: pid,
    };
  },
);
