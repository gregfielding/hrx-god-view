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
 *   4. **FG Slice 4 (Greg, 2026-07-06: "we want this to happen. Everything
 *      short of a job order.")** — auto-run `ensureSiteCore` so the CRM
 *      location + child account are pre-staged before a recruiter even
 *      opens the queue. Creation only happens on an EXACT site-directory
 *      match; ambiguous/unknown sites park as needs-review for the
 *      /shifts/log button. Fail-open: an ensure error never breaks the
 *      parse or the alert.
 *
 * Deliberately NOT here: JO/shift creation, jobs-board posting,
 * user-group auto-invites. Those layers need design discussion first.
 */

import * as admin from 'firebase-admin';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions/v2';

import { ensureSiteCore } from './ensureSiteCore';
import { closeFieldglassOrder, ensureJobOrderForFieldglassRequest } from './fieldglassJobOrder';
import { extractPostingIdFromText } from './enrichment';
import { enqueuePortalAction } from '../portalActions/enqueuePortalAction';
import {
  parseFieldglassEmail,
  type FieldglassClosureParseSuccess,
  type FieldglassParseFailure,
} from './parseFieldglassEmail';
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

/**
 * Change loop (2026-09-06): any Fieldglass email about a posting HRX already
 * tracks — a revision we can't classify, or a re-distribution of a decided
 * order — asks the portal worker (Natalie) to re-read that posting's detail
 * page NOW, so rate/positions/status changes land on the JO within minutes
 * instead of at the next scheduled pass. Fail-open, never blocks the parse.
 */
async function requestTargetedPortalSync(
  db: FirebaseFirestore.Firestore,
  tenantId: string,
  postingId: string,
  reason: string,
  sourceEventHash: string,
): Promise<{ id: string; created: boolean } | null> {
  try {
    const res = await enqueuePortalAction(db, {
      tenantId,
      action: 'fieldglass_sync',
      payload: { postingIds: [postingId], force: true, reason },
      refs: { externalShiftRequestId: `fieldglass__${postingId}` },
      createdBy: { kind: 'system', id: `onFieldglassIngestEventCreatedParse:${sourceEventHash}` },
      priority: 20,
      force: true,
    });
    logger.info('[fieldglass] targeted portal sync requested', { tenantId, postingId, reason, id: res.id, created: res.created });
    return { id: res.id, created: res.created };
  } catch (err) {
    logger.warn('[fieldglass] targeted portal sync enqueue failed (non-fatal)', {
      tenantId,
      postingId,
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/** Send `body` to the recruiter phones on the integration config doc.
 *  Shared by new-order, closure, and unrecognized-email alerts. */
async function sendFieldglassAlertSms(
  tenantId: string,
  body: string,
  opts: { source: string; sourceId: string },
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

  // Lazy import keeps this trigger's cold-start graph small when alerts
  // are unconfigured. sendWorkerMessageInternal handles STOP/opt-out and
  // runs the self-hosted link shortener on any URL in the body.
  const { sendWorkerMessageInternal } = await import('../../twilio');
  let sentAny = false;
  for (const phone of phones) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const result = await sendWorkerMessageInternal(phone, body, {
        systemContext: true,
        source: opts.source,
        sourceId: opts.sourceId,
        tenantId,
        messageTypeId: opts.source,
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

async function sendNewOrderAlert(
  tenantId: string,
  request: FieldglassJobPostingRequest,
): Promise<boolean> {
  const e = request.event;
  // 🔥 Hot-account triage (Greg, 2026-07-08): if the child account for
  // this site is marked hot, the alert leads with it. FG emails carry the
  // EXACT account name, so a name-equality lookup covers the common case;
  // a miss only costs the prefix (the JO still inherits hot downstream).
  let hotPrefix = '';
  if (e.siteName) {
    try {
      const acct = await admin
        .firestore()
        .collection(`tenants/${tenantId}/accounts`)
        .where('name', '==', e.siteName)
        .limit(1)
        .get();
      if (!acct.empty && acct.docs[0].get('hot') === true) {
        hotPrefix = '🔥 HOT ACCOUNT — ';
      }
    } catch {
      // never block the alert on the lookup
    }
  }
  const parts = [
    `${hotPrefix}New Sodexo order: ${e.title ?? request.event.jobPostingId}`,
    e.siteName ? `@ ${e.siteName}` : null,
    e.payRate !== undefined ? `$${e.payRate.toFixed(2)}/hr` : null,
    e.startDate ? `starts ${e.startDate}` : null,
  ].filter(Boolean);
  const body = `${parts.join(' · ')}${e.detailUrl ? `\n${e.detailUrl}` : ''}`;
  return sendFieldglassAlertSms(tenantId, body, {
    source: 'fieldglass_new_order_alert',
    sourceId: request.event.jobPostingId,
  });
}

/** Email-driven close (Greg, 2026-07-08: "lets build it") — runs the same
 *  cascade the extension path uses, but ONLY for orders HRX already
 *  tracks, and always announces the outcome by SMS so an email-triggered
 *  close is never invisible. Unknown posting ids are logged and left
 *  alone (nothing to close; if the order later syncs, the detail page's
 *  own Closed status handles it). */
async function handleClosureEmail(
  db: admin.firestore.Firestore,
  tenantId: string,
  eventHash: string,
  sourceRef: FirebaseFirestore.DocumentReference,
  closure: FieldglassClosureParseSuccess,
): Promise<void> {
  const requestId = `fieldglass__${closure.jobPostingId}`;
  const requestSnap = await db
    .doc(`tenants/${tenantId}/external_shift_requests/${requestId}`)
    .get();

  if (!requestSnap.exists) {
    await sourceRef.update({
      status: 'parsed',
      parsedRequestIds: [],
      closureNotice: {
        jobPostingId: closure.jobPostingId,
        phrase: closure.closurePhrase,
        knownOrder: false,
      },
    });
    logger.info('[onFieldglassIngestEventCreatedParse] closure for untracked order — no action', {
      tenantId,
      eventHash,
      jobPostingId: closure.jobPostingId,
    });
    return;
  }

  const result = await closeFieldglassOrder(db, {
    tenantId,
    requestId,
    reason: `closure_email:${closure.closurePhrase}`,
  });
  await sourceRef.update({
    status: 'parsed',
    parsedRequestIds: [requestId],
    closureNotice: {
      jobPostingId: closure.jobPostingId,
      phrase: closure.closurePhrase,
      knownOrder: true,
      cascade: result.status,
      postingsExpired: result.postingsExpired,
      shiftsClosed: result.shiftsClosed,
    },
  });
  logger.info('[onFieldglassIngestEventCreatedParse] closure email applied', {
    tenantId,
    eventHash,
    requestId,
    phrase: closure.closurePhrase,
    cascade: result.status,
    postingsExpired: result.postingsExpired,
    shiftsClosed: result.shiftsClosed,
  });

  const label = closure.title ?? closure.jobPostingId;
  const outcome =
    result.status === 'no_job_order'
      ? 'review row cleared (no job order existed)'
      : `job order completed, ${result.postingsExpired} posting(s) expired`;
  await sendFieldglassAlertSms(
    tenantId,
    `Sodexo order ${closure.closurePhrase} (via email): ${label} — ${outcome}.`,
    { source: 'fieldglass_order_closed_alert', sourceId: closure.jobPostingId },
  );
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
      // A Fieldglass email we couldn't classify (revision? unknown close
      // format?) must never be silent — it's both an operational heads-up
      // ("go look at Fieldglass / run Sync Sodexo") and the sample-
      // collection mechanism for hardening the parser (raw body is on the
      // ingest event). Duplicate emails dedupe at the webhook, so this
      // fires at most once per unique email.
      if (failure.reason === 'unclassified') {
        const subject = (data.raw?.subject ?? '(no subject)').slice(0, 120);
        // Revision loop: if the email names a posting we already track, have
        // the portal worker re-read it right away instead of asking a human
        // to press Sync Sodexo.
        const mentioned = extractPostingIdFromText(`${data.raw?.subject ?? ''}\n${data.raw?.text ?? ''}`);
        let synced: { id: string; created: boolean } | null = null;
        if (mentioned) {
          const known = await db.doc(`tenants/${tenantId}/external_shift_requests/fieldglass__${mentioned}`).get();
          if (known.exists) synced = await requestTargetedPortalSync(db, tenantId, mentioned, 'unclassified_email', eventHash);
        }
        await sourceRef.update({
          parseFailureReason: failure.reason,
          ...(mentioned ? { mentionedPostingId: mentioned } : {}),
          ...(synced ? { portalSyncActionId: synced.id } : {}),
        });
        await sendFieldglassAlertSms(
          tenantId,
          synced
            ? `Fieldglass email not recognized: "${subject}". Natalie is re-syncing ${mentioned} from the portal now — check the JO in a few minutes.`
            : `Fieldglass email not recognized (no action taken): "${subject}". Check the order in Fieldglass or run Sync Sodexo.`,
          { source: 'fieldglass_unclassified_email_alert', sourceId: eventHash },
        ).catch(() => undefined);
      }
      return;
    }

    // Closure notice — separate lane from new-posting handling: no request
    // row is created, and the DECIDED_STATUSES guard below must NOT block
    // it (an applied order is exactly the one that needs closing).
    if (parseResult.kind === 'closure') {
      await handleClosureEmail(
        db,
        tenantId,
        eventHash,
        sourceRef,
        parseResult as FieldglassClosureParseSuccess,
      );
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
      // A re-distributed posting often carries a change (dates, positions,
      // rate) — re-read the detail page so the live JO reflects it.
      if (existingStatus !== 'rejected' && existingStatus !== 'superseded') {
        await requestTargetedPortalSync(db, tenantId, postingId, 'redistributed_email', eventHash);
      }
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

    // FG Slice 4 — pre-stage the site chain (CRM location + child account
    // + linkage; NO job order). Exact directory matches only; everything
    // else stays parked for the /shifts/log button. Runs on re-parses too
    // (idempotent), which retries a site that failed transiently. No
    // street address here — the Maps key is browser-only, so the street
    // is backfilled on first human touch via the dialog.
    const siteName = parseResult.event.siteName;
    if (siteName) {
      try {
        const ensure = await ensureSiteCore(db, {
          tenantId,
          siteName,
          requestId,
          execute: true,
          actor: 'system_fieldglass_parse',
          requireDirectoryMatchForCreate: true,
        });
        logger.info('[onFieldglassIngestEventCreatedParse] site auto-ensure', {
          tenantId,
          requestId,
          skipped: ensure.skipped ?? null,
          locationStatus: ensure.location.status,
          locationId: ensure.location.id ?? null,
          childStatus: ensure.childAccount.status,
          childAccountId: ensure.childAccount.id ?? null,
        });

        // FG Slice 7 — email-first JO creation: the email alone carries
        // title + dates + site, which is enough to stand up the JO +
        // posting + shift and fire the radius blast within seconds of
        // the order landing. Enrichment (rates/positions/candidate-in-
        // mind) backfills when the extension syncs the detail page.
        if (ensure.stampedRequest) {
          const jo = await ensureJobOrderForFieldglassRequest(db, { tenantId, requestId });
          logger.info('[onFieldglassIngestEventCreatedParse] job-order auto-create', {
            tenantId,
            requestId,
            status: jo.status,
            jobOrderId: jo.jobOrderId ?? null,
            jobType: jo.jobType ?? null,
            blastConfigured: jo.blastConfigured ?? false,
          });
        }
      } catch (err) {
        logger.warn('[onFieldglassIngestEventCreatedParse] site auto-ensure failed (non-fatal)', {
          tenantId,
          requestId,
          siteName,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }
  },
);
