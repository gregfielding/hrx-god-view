/**
 * **Fieldglass FG Slice 2 — parse trigger + instant recruiter alert.**
 *
 * Fires when the webhook writes a `provider='fieldglass'` row to
 * `tenants/{tid}/external_ingest_events`. For "New Job Posting" emails:
 *
 *   1. Parse via `parseFieldglassEmail` (regex against the templated
 *      label/value body; wage lifted from Comments prose; bill rate
 *      derived at the 1.56 Sodexo markup).
 *   2. Upsert `tenants/{tid}/external_shift_requests/fieldglass__{postingId}`
 *      — keyed by the SDXO posting id so a re-distributed posting updates
 *      its existing row instead of duplicating. Rows a recruiter already
 *      decided (`approved`/`applied`/`rejected`) are never reset.
 *   3. On FIRST sight of a posting id, SMS the recruiters configured at
 *      `tenants/{tid}/integrations/fieldglass` (`alertPhonesE164`) — the
 *      speed race is the whole point: C1 should know about a Sodexo order
 *      minutes after distribution, not when someone checks an inbox.
 *
 * Deliberately NOT here (Greg, 2026-07-06 — "don't go too far"): site→
 * account/worksite resolution, JO/shift creation, jobs-board posting,
 * user-group auto-invites. Those layers need design discussion first.
 */

import * as admin from 'firebase-admin';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions/v2';

import { parseFieldglassEmail, type FieldglassParseFailure } from './parseFieldglassEmail';
import type {
  FieldglassIngestEvent,
  FieldglassIntegrationConfig,
  FieldglassJobPostingRequest,
} from './types';

if (!admin.apps.length) {
  admin.initializeApp();
}

const FieldValue = admin.firestore.FieldValue;

/** Statuses a recruiter has already acted on — a re-parse must not clobber. */
const DECIDED_STATUSES = new Set(['approved', 'applied', 'rejected', 'superseded']);

async function sendNewOrderAlert(
  tenantId: string,
  request: FieldglassJobPostingRequest,
): Promise<boolean> {
  const cfgSnap = await admin
    .firestore()
    .doc(`tenants/${tenantId}/integrations/fieldglass`)
    .get();
  const cfg = (cfgSnap.data() ?? {}) as FieldglassIntegrationConfig;
  const phones = (cfg.alertPhonesE164 ?? []).filter(
    (p) => typeof p === 'string' && /^\+\d{8,15}$/.test(p),
  );
  if (cfg.alertEnabled === false || phones.length === 0) {
    logger.info('[fieldglass] alert skipped — no recipients configured', { tenantId });
    return false;
  }

  const e = request.event;
  const parts = [
    `New Sodexo order: ${e.title ?? request.event.jobPostingId}`,
    e.siteName ? `@ ${e.siteName}` : null,
    e.payRate !== undefined ? `$${e.payRate.toFixed(2)}/hr` : null,
    e.startDate ? `starts ${e.startDate}` : null,
  ].filter(Boolean);
  const body = `${parts.join(' · ')}${e.detailUrl ? `\n${e.detailUrl}` : ''}`;

  // Lazy import keeps this trigger's cold-start graph small when alerts
  // are unconfigured. sendWorkerMessageInternal handles STOP/opt-out and
  // runs the self-hosted link shortener on the detail URL.
  const { sendWorkerMessageInternal } = await import('../../twilio');
  let sentAny = false;
  for (const phone of phones) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const result = await sendWorkerMessageInternal(phone, body, {
        systemContext: true,
        source: 'fieldglass_new_order_alert',
        sourceId: request.event.jobPostingId,
        tenantId,
        messageTypeId: 'fieldglass_new_order_alert',
      });
      sentAny = sentAny || result.success;
    } catch (err) {
      logger.warn('[fieldglass] alert send failed', {
        tenantId,
        phone,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return sentAny;
}

export const onFieldglassIngestEventCreatedParse = onDocumentCreated(
  {
    document: 'tenants/{tenantId}/external_ingest_events/{eventHash}',
    region: 'us-central1',
    memory: '512MiB',
    timeoutSeconds: 120,
    maxInstances: 4,
  },
  async (event) => {
    const { tenantId, eventHash } = event.params as {
      tenantId: string;
      eventHash: string;
    };
    const data = event.data?.data() as FieldglassIngestEvent | undefined;
    if (!data) return;

    // Provider + status gates — the sibling Indeed Flex trigger owns
    // 'indeed_flex' rows on this same collection.
    if (data.provider !== 'fieldglass') return;
    if (data.status !== 'received') return;

    const db = admin.firestore();
    const sourceRef = db
      .collection('tenants')
      .doc(tenantId)
      .collection('external_ingest_events')
      .doc(eventHash);

    const parseResult = parseFieldglassEmail({
      subject: data.raw?.subject ?? '',
      text: data.raw?.text,
      html: data.raw?.html,
    });

    if (!parseResult.ok) {
      // Explicit cast: functions/tsconfig has strict:false, which weakens
      // discriminated-union narrowing (same workaround as the Indeed Flex
      // webhook's verifyDkim comment).
      const failure = parseResult as FieldglassParseFailure;
      logger.warn('[onFieldglassIngestEventCreatedParse] could not parse', {
        tenantId,
        eventHash,
        reason: failure.reason,
        subject: data.raw?.subject ?? '',
      });
      await sourceRef.update({
        status: 'parse_failed',
        parseFailureReason: failure.reason,
      });
      return;
    }

    const postingId = parseResult.event.jobPostingId;
    const requestId = `fieldglass__${postingId}`;
    const requestRef = db
      .collection('tenants')
      .doc(tenantId)
      .collection('external_shift_requests')
      .doc(requestId);

    const existing = await requestRef.get();
    const existingStatus = existing.exists ? String(existing.get('status') ?? '') : null;
    const isFirstSight = !existing.exists;

    if (existingStatus && DECIDED_STATUSES.has(existingStatus)) {
      // Recruiter already acted — record the re-distribution on the ingest
      // event but leave the request untouched.
      await sourceRef.update({
        status: 'parsed',
        parsedRequestIds: [requestId],
        parseFailureReason: FieldValue.delete(),
      });
      logger.info('[onFieldglassIngestEventCreatedParse] duplicate of decided request', {
        tenantId,
        eventHash,
        requestId,
        existingStatus,
      });
      return;
    }

    const requestDoc: Omit<FieldglassJobPostingRequest, 'createdAt' | 'updatedAt' | 'alertSentAt'> & {
      createdAt: FirebaseFirestore.FieldValue;
      updatedAt: FirebaseFirestore.FieldValue;
    } = {
      id: requestId,
      tenantId,
      provider: 'fieldglass',
      sourceIngestEventHash: eventHash,
      eventType: 'new_job_posting',
      event: parseResult.event,
      confidence: parseResult.confidence,
      parseSource: 'regex',
      status: 'needs_review',
      ...(parseResult.notes ? { parseNotes: parseResult.notes } : {}),
      createdAt: isFirstSight ? FieldValue.serverTimestamp() : (existing.get('createdAt') as FirebaseFirestore.FieldValue),
      updatedAt: FieldValue.serverTimestamp(),
    };

    const batch = db.batch();
    batch.set(requestRef, requestDoc, { merge: true });
    batch.update(sourceRef, {
      status: 'parsed',
      parsedRequestIds: [requestId],
    });
    await batch.commit();

    logger.info('[onFieldglassIngestEventCreatedParse] parsed', {
      tenantId,
      eventHash,
      requestId,
      confidence: parseResult.confidence,
      isFirstSight,
      title: parseResult.event.title,
      siteName: parseResult.event.siteName,
      payRate: parseResult.event.payRate,
    });

    // Instant alert — first sight only, so a re-distributed posting
    // doesn't re-text everyone. Failure is non-fatal (queue row exists).
    if (isFirstSight) {
      try {
        const sent = await sendNewOrderAlert(tenantId, requestDoc as unknown as FieldglassJobPostingRequest);
        if (sent) {
          await requestRef.update({ alertSentAt: FieldValue.serverTimestamp() });
        }
      } catch (err) {
        logger.warn('[onFieldglassIngestEventCreatedParse] alert failed', {
          tenantId,
          requestId,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }
  },
);
