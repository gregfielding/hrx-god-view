/**
 * **Fieldglass enrichment HTTP endpoints — the Chrome extension's server
 * side (FG Slice 5).**
 *
 * Two onRequest endpoints consumed by browser-extensions/fieldglass-sync/:
 *
 *   - `fieldglassEnrichmentQueue` (GET ?tenantId=…) — which orders still
 *     need detail-page enrichment, with their deep links. Powers the
 *     popup's "Sync pending from HRX" bulk button.
 *   - `fieldglassEnrichmentIngest` (POST {tenantId, pageText, url?,
 *     postingId?}) — receives a detail page's visible text, extracts via
 *     gpt-5 (enrichment.ts), and upserts the review-queue row:
 *       · UNKNOWN posting id → creates the row (`parseSource:
 *         'extension'`). This is the backlog path — orders whose emails
 *         predate the webhook flow in via one bulk sync of the Fieldglass
 *         worklist.
 *       · merges the `enrichment` sidecar; fills empty `event` fields
 *         (title, dates, payRate from ST) without overwriting email data.
 *       · runs `ensureSiteCore` with the page's REAL street address —
 *         detail pages carry both the site code and the street, so this
 *         path creates fully-addressed locations (better than the email
 *         path, which needs the geocoder).
 *
 * **Auth**: static shared key in `FIELDGLASS_EXTENSION_KEY` (functions
 * env), sent as `Authorization: Bearer <key>`. Firebase ID tokens (the
 * httpAuth.ts pattern) would require bundling Firebase Auth into the MV3
 * extension — deliberately avoided. Endpoints fail closed (503) when the
 * key is unconfigured; comparison is constant-time. Scope of a leaked
 * key: read order queue + submit page text — no worker PII, no sends.
 */

import * as crypto from 'crypto';
import * as admin from 'firebase-admin';
import { onRequest, Request } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import type { Response } from 'express';

import { ensureSiteCore } from './ensureSiteCore';
import {
  closeFieldglassOrder,
  haltFieldglassOrder,
  resumeFieldglassOrderIfHalted,
  ensureJobOrderForFieldglassRequest,
} from './fieldglassJobOrder';
import {
  extractEnrichmentFromPageText,
  extractPostingIdFromText,
  type FieldglassEnrichmentStamp,
} from './enrichment';

if (!admin.apps.length) admin.initializeApp();
const FieldValue = admin.firestore.FieldValue;

// ─────────────────────────────────────────────────────────────────────
// Auth
// ─────────────────────────────────────────────────────────────────────

function verifyExtensionKey(req: Request, res: Response): boolean {
  const configured = String(process.env.FIELDGLASS_EXTENSION_KEY ?? '').trim();
  if (!configured) {
    res.status(503).json({
      success: false,
      error: { code: 'NOT_CONFIGURED', message: 'FIELDGLASS_EXTENSION_KEY is not set' },
    });
    return false;
  }
  const header = String(req.headers.authorization ?? '');
  const presented = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const a = crypto.createHash('sha256').update(presented).digest();
  const b = crypto.createHash('sha256').update(configured).digest();
  if (!presented || !crypto.timingSafeEqual(a, b)) {
    res.status(401).json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Invalid extension key' },
    });
    return false;
  }
  return true;
}

// ─────────────────────────────────────────────────────────────────────
// Queue — orders still needing enrichment
// ─────────────────────────────────────────────────────────────────────

export const fieldglassEnrichmentQueue = onRequest(
  {
    cors: true, // extension origin is chrome-extension:// — auth is the key, not cookies
    memory: '512MiB',
    timeoutSeconds: 60,
    maxInstances: 2,
  },
  async (req, res) => {
    if (!verifyExtensionKey(req, res)) return;
    const tenantId = String(req.query.tenantId ?? '').trim();
    if (!tenantId) {
      res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'tenantId required' } });
      return;
    }

    const db = admin.firestore();
    // No orderBy — equality + order on different fields needs a composite
    // index, and the in-memory filter below touches every row anyway
    // (fieldglass volume is tens of rows, not thousands).
    const snap = await db
      .collection(`tenants/${tenantId}/external_shift_requests`)
      .where('provider', '==', 'fieldglass')
      .limit(500)
      .get();

    const pending: Array<{
      requestId: string;
      postingId: string;
      detailUrl: string | null;
      title: string | null;
      siteName: string | null;
    }> = [];
    for (const d of snap.docs) {
      const x = d.data() as Record<string, unknown>;
      const status = String(x.status ?? '');
      if (status === 'rejected' || status === 'superseded') continue;
      if (x.enrichment) continue; // already synced
      const ev = (x.event ?? {}) as Record<string, unknown>;
      pending.push({
        requestId: d.id,
        postingId: String(ev.jobPostingId ?? d.id.replace(/^fieldglass__/, '')),
        detailUrl: (ev.detailUrl as string | undefined) ?? null,
        title: (ev.title as string | undefined) ?? null,
        siteName: (ev.siteName as string | undefined) ?? null,
      });
    }

    res.status(200).json({ success: true, pending, scanned: snap.size });
  },
);

// ─────────────────────────────────────────────────────────────────────
// Ingest — one detail page's text
// ─────────────────────────────────────────────────────────────────────

export const fieldglassEnrichmentIngest = onRequest(
  {
    cors: true,
    memory: '512MiB',
    timeoutSeconds: 120,
    maxInstances: 4,
  },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ success: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'POST only' } });
      return;
    }
    if (!verifyExtensionKey(req, res)) return;

    const body = (req.body ?? {}) as Record<string, unknown>;
    const tenantId = String(body.tenantId ?? '').trim();
    const pageText = String(body.pageText ?? '');
    const sourceUrl = String(body.url ?? '').trim() || undefined;
    const claimedPostingId = String(body.postingId ?? '').trim() || null;

    if (!tenantId || pageText.trim().length < 200) {
      res.status(400).json({
        success: false,
        error: { code: 'BAD_REQUEST', message: 'tenantId and a non-trivial pageText are required' },
      });
      return;
    }

    // Posting id: regex over the page is the source of truth; the caller's
    // claim (from the queue task) must agree when both exist.
    const pagePostingId = extractPostingIdFromText(pageText);
    const postingId = pagePostingId ?? claimedPostingId;
    if (!postingId) {
      res.status(422).json({
        success: false,
        error: { code: 'NO_POSTING_ID', message: 'No SDXOJP posting id found on the page' },
      });
      return;
    }
    if (pagePostingId && claimedPostingId && pagePostingId !== claimedPostingId) {
      res.status(409).json({
        success: false,
        error: {
          code: 'POSTING_MISMATCH',
          message: `Page shows ${pagePostingId} but task expected ${claimedPostingId}`,
        },
      });
      return;
    }

    // LLM extraction.
    let extraction;
    try {
      extraction = await extractEnrichmentFromPageText(pageText);
    } catch (err) {
      logger.error('[fieldglassEnrichmentIngest] extraction failed', {
        tenantId,
        postingId,
        err: err instanceof Error ? err.message : String(err),
      });
      res.status(502).json({
        success: false,
        error: { code: 'EXTRACTION_FAILED', message: 'LLM extraction failed — try again' },
      });
      return;
    }
    const enrichment = extraction.enrichment;

    const db = admin.firestore();
    const requestId = `fieldglass__${postingId}`;
    const requestRef = db.doc(`tenants/${tenantId}/external_shift_requests/${requestId}`);
    const existing = await requestRef.get();
    const created = !existing.exists;

    const stamp: FieldglassEnrichmentStamp = {
      ...enrichment,
      capturedAt: new Date().toISOString(),
      capturedBy: 'extension',
      ...(sourceUrl ? { sourceUrl } : {}),
      ...(extraction.notes ? { extractionNotes: extraction.notes } : {}),
    };

    if (created) {
      // Backlog path: no email ever landed for this order (webhook is
      // newer than the order, or routing isn't live yet). Build the row
      // from the detail page alone.
      await requestRef.set({
        id: requestId,
        tenantId,
        provider: 'fieldglass',
        sourceIngestEventHash: '',
        eventType: 'new_job_posting',
        event: {
          type: 'new_job_posting',
          jobPostingId: postingId,
          ...(enrichment.title ? { title: enrichment.title } : {}),
          ...(enrichment.siteName ? { siteName: enrichment.siteName } : {}),
          ...(enrichment.startDate ? { startDate: enrichment.startDate } : {}),
          ...(enrichment.endDate ? { endDate: enrichment.endDate } : {}),
          ...(enrichment.payRateSt != null ? { payRate: enrichment.payRateSt } : {}),
          ...(enrichment.billRateSt != null ? { billRateDerived: enrichment.billRateSt } : {}),
          ...(sourceUrl ? { detailUrl: sourceUrl } : {}),
        },
        confidence: 'high',
        parseSource: 'extension',
        status: 'needs_review',
        enrichment: stamp,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    } else {
      // Merge enrichment; fill event gaps without clobbering email data.
      const ev = (existing.data() as Record<string, unknown>).event as
        | Record<string, unknown>
        | undefined;
      const eventPatch: Record<string, unknown> = {};
      const fillIfEmpty = (key: string, value: unknown): void => {
        if (value === undefined || value === null || value === '') return;
        const current = ev?.[key];
        if (current === undefined || current === null || current === '') {
          eventPatch[`event.${key}`] = value;
        }
      };
      fillIfEmpty('title', enrichment.title);
      fillIfEmpty('siteName', enrichment.siteName);
      fillIfEmpty('startDate', enrichment.startDate);
      fillIfEmpty('endDate', enrichment.endDate);
      fillIfEmpty('payRate', enrichment.payRateSt);
      fillIfEmpty('billRateDerived', enrichment.billRateSt);
      fillIfEmpty('detailUrl', sourceUrl);

      await requestRef.update({
        enrichment: stamp,
        ...eventPatch,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    // Site chain — the detail page gives us the site code AND the real
    // street, so this beats the email path's geocoder. Fail-open.
    let siteResolution: Record<string, unknown> | null = null;
    const siteNameForEnsure =
      enrichment.siteName ??
      ((existing.data()?.event as Record<string, unknown> | undefined)?.siteName as
        | string
        | undefined);
    if (siteNameForEnsure) {
      try {
        const ensure = await ensureSiteCore(db, {
          tenantId,
          siteName: siteNameForEnsure,
          siteCode: enrichment.siteCode,
          requestId,
          execute: true,
          actor: 'fieldglass_extension',
          // The page IS the authority (it carries the site code), so no
          // exact-directory requirement — but only when we have a code;
          // otherwise keep the auto-mode guard.
          requireDirectoryMatchForCreate: !enrichment.siteCode,
          address: enrichment.workLocation
            ? {
                street: enrichment.workLocation.street,
                city: enrichment.workLocation.city,
                state: enrichment.workLocation.state,
                zipCode: enrichment.workLocation.zipCode,
              }
            : undefined,
        });
        siteResolution = {
          skipped: ensure.skipped ?? null,
          locationStatus: ensure.location.status,
          locationId: ensure.location.id ?? null,
          childStatus: ensure.childAccount.status,
          childAccountId: ensure.childAccount.id ?? null,
        };
      } catch (err) {
        logger.warn('[fieldglassEnrichmentIngest] ensureSite failed (non-fatal)', {
          tenantId,
          requestId,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // FG Slice 7 — the JO layer. Closed postings cascade shut; open ones
    // get the full JO + shift + posting (+ radius blast via the shift
    // trigger, unless candidate-in-mind). Fail-open: an error here never
    // fails the enrichment itself.
    let jobOrder: Record<string, unknown> | null = null;
    try {
      const postingStatus = String(enrichment.postingStatus ?? '').toLowerCase();
      const isClosed = postingStatus.includes('closed');
      // FG "Halted" = temporarily suspended, not terminal — JO goes
      // on_hold and postings pause (reversible), instead of the close
      // cascade. A halted order with no JO yet gets NOTHING built (no
      // posting, no blast) until FG resumes it.
      const isHalted = postingStatus.includes('halt');
      if (isClosed) {
        const closed = await closeFieldglassOrder(db, {
          tenantId,
          requestId,
          reason: 'detail_page_status_closed',
        });
        jobOrder = { action: 'closed', ...closed };
      } else if (isHalted) {
        const halted = await haltFieldglassOrder(db, {
          tenantId,
          requestId,
          reason: 'detail_page_status_halted',
        });
        jobOrder = { action: 'halted', ...halted };
      } else {
        // Un-halt first (no-op unless WE halted it), then the normal
        // ensure/backfill pass.
        const resumed = await resumeFieldglassOrderIfHalted(db, { tenantId, requestId });
        const ensured = await ensureJobOrderForFieldglassRequest(db, { tenantId, requestId });
        jobOrder = { action: 'ensured', resumed, ...ensured };
      }
    } catch (err) {
      logger.warn('[fieldglassEnrichmentIngest] job-order step failed (non-fatal)', {
        tenantId,
        requestId,
        err: err instanceof Error ? err.message : String(err),
      });
    }

    logger.info('[fieldglassEnrichmentIngest] enriched', {
      tenantId,
      requestId,
      created,
      candidateInMind: enrichment.candidateInMind === true,
      positionsRequested: enrichment.positionsRequested ?? null,
      siteResolution,
      jobOrder,
    });

    res.status(200).json({
      success: true,
      requestId,
      postingId,
      created,
      candidateInMind: enrichment.candidateInMind === true,
      fieldsExtracted: Object.keys(enrichment).length,
      siteResolution,
      jobOrder,
    });
  },
);
