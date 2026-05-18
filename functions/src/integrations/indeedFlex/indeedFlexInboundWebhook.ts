/**
 * **Indeed Flex inbound webhook (Slice 1).**
 *
 * Receives SendGrid Inbound Parse POSTs for the Indeed Flex notification
 * inbox (`indeed-flex@ingest.hrxone.com` or similar — DNS/SendGrid config
 * is operational, not in this file).
 *
 * Slice 1 scope is intentionally narrow:
 *
 *   1. Parse the multipart body.
 *   2. Verify DKIM against the expected sender domain (`indeedflex.com`).
 *      A failed DKIM gets the email persisted with status
 *      `rejected_dkim` (audit trail) but no further processing.
 *   3. Compute a dedupe `eventHash` (see {@link computeEventHash}).
 *   4. Persist the raw payload to
 *      `tenants/{tid}/external_ingest_events/{eventHash}` with status
 *      `received`. Idempotent — re-delivery hits an existing doc and
 *      short-circuits.
 *   5. Return 200 to SendGrid in every case. We never want SendGrid
 *      retrying — internal failures are our problem to chase, not
 *      hers to re-send.
 *
 * **Not yet** in scope (subsequent slices):
 *
 *   - Parsing the email body into `IndeedFlexEvent[]` (Slice 2).
 *   - Writing to `external_shift_requests` (Slice 2).
 *   - Any modification to shifts / JOs / assignments (Slices 3-5,
 *     paused until the proposed-action list has been validated against
 *     real-world emails).
 *
 * Tenant is hardcoded to C1 Staffing for now — multi-tenant routing
 * (via inbound address mapping) is a future concern.
 */

import * as admin from 'firebase-admin';
import { onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import type { Request } from 'firebase-functions/v2/https';
import type { Response } from 'express';
import Busboy from 'busboy';

import {
  computeEventHash,
  extractDateHeader,
  extractMessageId,
} from './eventHash';
import type {
  ExternalIngestEvent,
  ExternalIngestEventAuthVerification,
  ExternalIngestEventRaw,
} from '../../shared/indeedFlex/types';

const FieldValue = admin.firestore.FieldValue;

if (!admin.apps.length) {
  admin.initializeApp();
}

// ─────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────

/** C1 Staffing tenant. Hardcoded until multi-tenant routing is needed. */
const TENANT_ID = 'BCiP2bQ9CgVOCTfV6MhD';

/** DKIM signature from this domain is what we trust as authentic. */
const EXPECTED_SENDER_DOMAIN = 'indeedflex.com';

/** Per-field truncation caps for the persisted raw payload. Indeed Flex
 *  notification emails are ~1KB in practice; these caps are defensive
 *  against pathological forwarded messages or HTML with embedded images. */
const RAW_BODY_CAP_BYTES = 256 * 1024;
const RAW_HEADERS_CAP_BYTES = 64 * 1024;

/** Hard cap on the multipart body we'll accept from SendGrid. SendGrid's
 *  Inbound Parse default is ~30MB; we don't care about attachments in
 *  Slice 1, so the 10MB ceiling here is generous for an email + headers. */
const MULTIPART_MAX_BYTES = 10 * 1024 * 1024;

/** Stamped on the audit trail so log searches can attribute writes. */
const ACTOR = 'system_indeed_flex_inbound_webhook';

// ─────────────────────────────────────────────────────────────────────
// Multipart parsing
// ─────────────────────────────────────────────────────────────────────

interface ParsedMultipart {
  fields: Record<string, string>;
  attachmentCount: number;
}

/**
 * Parse the SendGrid Inbound Parse multipart/form-data body into a
 * flat `fields` map. Attachment streams are counted but not buffered
 * (Slice 1 doesn't process attachments — and base64-loading them into
 * memory would defeat the whole purpose of using a streaming parser).
 *
 * Busboy is preferred over multer here because we never need the file
 * bytes; counting is enough.
 */
function parseMultipart(req: Request): Promise<ParsedMultipart> {
  return new Promise((resolve, reject) => {
    const fields: Record<string, string> = {};
    let attachmentCount = 0;

    const bb = Busboy({
      headers: req.headers,
      limits: {
        // Each field individually capped; total bytes capped too.
        fieldSize: RAW_BODY_CAP_BYTES,
        fields: 100,
        files: 50,
        fileSize: 1, // 1 byte — we don't read file content, busboy will
                     // emit 'limit' and drain the stream for us.
      },
    });

    bb.on('field', (name, value) => {
      // busboy gives us the value as a string already.
      fields[name] = value;
    });

    bb.on('file', (_name, stream) => {
      attachmentCount += 1;
      // Drain without buffering. Busboy enforces fileSize=1, so the
      // stream is effectively a no-op, but we still need to consume
      // events to avoid back-pressure stalls.
      stream.on('data', () => undefined);
      stream.on('end', () => undefined);
      stream.resume();
    });

    bb.on('finish', () => resolve({ fields, attachmentCount }));
    bb.on('error', (err: Error) => reject(err));

    // Firebase Functions provides the raw request body as `rawBody`.
    // Without it busboy never sees the data.
    const raw = (req as Request & { rawBody?: Buffer }).rawBody;
    if (!raw) {
      reject(new Error('multipart_no_raw_body'));
      return;
    }
    if (raw.length > MULTIPART_MAX_BYTES) {
      reject(new Error('multipart_too_large'));
      return;
    }
    bb.end(raw);
  });
}

// ─────────────────────────────────────────────────────────────────────
// DKIM / SPF / sender parsing
// ─────────────────────────────────────────────────────────────────────

/**
 * Parse SendGrid's `dkim` field. SendGrid emits values like
 * `{@indeedflex.com : pass}` for one signature or
 * `{@a.com : pass, @b.com : pass}` for multiple. When DKIM checks are
 * disabled on the Parse settings the field is absent; when the message
 * has no signatures the value is `none`.
 *
 * Returns:
 *   - `pass`    when every listed signature passed
 *   - `fail`    when at least one signature is listed and none passed
 *   - `none`    when the field is empty / `none`
 *   - `unknown` when the field is present but unparseable
 */
function parseDkimField(raw: string): {
  result: ExternalIngestEventAuthVerification['dkim'];
  domains: string[];
} {
  const trimmed = (raw ?? '').trim();
  if (!trimmed || trimmed.toLowerCase() === 'none') {
    return { result: 'none', domains: [] };
  }
  const matches = Array.from(trimmed.matchAll(/@([a-z0-9.-]+)\s*:\s*(\w+)/gi));
  if (matches.length === 0) return { result: 'unknown', domains: [] };
  const domains = matches.map((m) => m[1].toLowerCase());
  const passes = matches.filter((m) => m[2].toLowerCase() === 'pass');
  if (passes.length === matches.length) return { result: 'pass', domains };
  if (passes.length === 0) return { result: 'fail', domains };
  // Partial pass — at least one signature checked out. Treat as pass
  // and let the policy check decide on the basis of which domain
  // passed.
  return { result: 'pass', domains: passes.map((m) => m[1].toLowerCase()) };
}

/**
 * Parse SendGrid's `SPF` field. Values are a single token like `pass`,
 * `softfail`, `fail`, `none`, etc.
 */
function parseSpfField(raw: string): ExternalIngestEventAuthVerification['spf'] {
  const v = (raw ?? '').trim().toLowerCase();
  if (v === 'pass' || v === 'softfail' || v === 'fail' || v === 'none') return v;
  return v ? 'unknown' : 'none';
}

/**
 * Extract the lowercased domain from an RFC5322 From header value.
 * Handles `"Name" <addr@domain>` and bare `addr@domain` shapes.
 */
function extractSenderDomain(from: string): string {
  const match = (from ?? '').match(/@([a-z0-9.-]+)/i);
  return match ? match[1].toLowerCase().replace(/[>"']/g, '').trim() : '';
}

/**
 * Apply the policy: DKIM must `pass` AND must include a signature from
 * {@link EXPECTED_SENDER_DOMAIN} (or a subdomain thereof).
 *
 * Returns `null` when the policy is satisfied. Returns a rejection
 * reason string when it isn't.
 *
 * We use `string | null` rather than a discriminated union here because
 * `functions/tsconfig.json` has `strict: false`, which weakens
 * control-flow narrowing on literal-typed unions. The simpler return
 * shape narrows cleanly under non-strict mode.
 */
function verifyDkim(dkim: ReturnType<typeof parseDkimField>): string | null {
  if (dkim.result !== 'pass') {
    return `dkim_${dkim.result}`;
  }
  const passing = dkim.domains.some(
    (d) => d === EXPECTED_SENDER_DOMAIN || d.endsWith(`.${EXPECTED_SENDER_DOMAIN}`),
  );
  if (!passing) {
    return 'dkim_unexpected_domain';
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────
// Body normalization
// ─────────────────────────────────────────────────────────────────────

function truncateUtf8(input: string | undefined, capBytes: number): { value?: string; truncated: boolean } {
  if (input == null) return { value: undefined, truncated: false };
  // Quick path — most fields are well under the cap.
  if (Buffer.byteLength(input, 'utf8') <= capBytes) {
    return { value: input, truncated: false };
  }
  // Walk down character-by-character until the encoded length fits.
  // O(N) in worst case, but typical caller is a few hundred KB at most.
  let lo = 0;
  let hi = input.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (Buffer.byteLength(input.slice(0, mid), 'utf8') <= capBytes) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return { value: input.slice(0, lo), truncated: true };
}

function buildRawPayload(fields: Record<string, string>, attachmentCount: number): {
  raw: ExternalIngestEventRaw;
  truncated: boolean;
} {
  const text = truncateUtf8(fields.text, RAW_BODY_CAP_BYTES);
  const html = truncateUtf8(fields.html, RAW_BODY_CAP_BYTES);
  const headers = truncateUtf8(fields.headers, RAW_HEADERS_CAP_BYTES);
  const truncated = text.truncated || html.truncated || headers.truncated;
  const raw: ExternalIngestEventRaw = {
    from: fields.from ?? '',
    to: fields.to ?? '',
    subject: fields.subject ?? '',
    text: text.value,
    html: html.value,
    headers: headers.value,
    envelope: fields.envelope,
    attachmentCount,
    truncated: truncated || undefined,
  };
  return { raw, truncated };
}

// ─────────────────────────────────────────────────────────────────────
// Handler
// ─────────────────────────────────────────────────────────────────────

/**
 * SendGrid Inbound Parse webhook. POST-only. Returns 200 unconditionally
 * to suppress SendGrid retries — any internal failure is logged at
 * `error` and pursued separately.
 */
export const indeedFlexInboundWebhook = onRequest(
  {
    region: 'us-central1',
    memory: '512MiB',
    maxInstances: 2,
    timeoutSeconds: 60,
  },
  async (req: Request, res: Response): Promise<void> => {
    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }

    let parsed: ParsedMultipart;
    try {
      parsed = await parseMultipart(req);
    } catch (err) {
      logger.error('indeedFlexInboundWebhook: multipart parse failed', {
        error: (err as Error).message,
      });
      // Still 200 — no retry value here.
      res.status(200).send('Bad payload (logged)');
      return;
    }

    const { fields, attachmentCount } = parsed;
    const senderDomain = extractSenderDomain(fields.from ?? '');
    const dkim = parseDkimField(fields.dkim ?? '');
    const spf = parseSpfField(fields.SPF ?? '');

    const authVerification: ExternalIngestEventAuthVerification = {
      dkim: dkim.result,
      dkimDomains: dkim.domains,
      spf,
      sender: fields.from ?? '',
      senderDomain,
      senderIp: fields.sender_ip,
    };

    const { raw } = buildRawPayload(fields, attachmentCount);

    const messageId = extractMessageId(fields.headers);
    const dateHeader = extractDateHeader(fields.headers);
    const bodyPreview = (fields.text || fields.html || '').slice(0, 256);
    const eventHash = computeEventHash({
      messageId,
      from: fields.from,
      subject: fields.subject,
      date: dateHeader,
      bodyPreview,
    });

    const docRef = admin
      .firestore()
      .collection('tenants')
      .doc(TENANT_ID)
      .collection('external_ingest_events')
      .doc(eventHash);

    const dkimRejectionReason = verifyDkim(dkim);

    if (dkimRejectionReason !== null) {
      // Persist for audit so we can see exactly what was rejected and
      // why, but don't process further.
      const eventDoc: Omit<ExternalIngestEvent, 'receivedAt'> & {
        receivedAt: FirebaseFirestore.FieldValue;
        actor: string;
      } = {
        provider: 'indeed_flex',
        eventHash,
        receivedAt: FieldValue.serverTimestamp(),
        authVerification,
        raw,
        status: 'rejected_dkim',
        rejectionReason: dkimRejectionReason,
        actor: ACTOR,
      };
      await docRef.set(eventDoc, { merge: true });
      logger.warn('indeedFlexInboundWebhook: dkim rejected', {
        eventHash,
        reason: dkimRejectionReason,
        senderDomain,
        dkimDomains: dkim.domains,
      });
      res.status(200).send('Rejected (logged)');
      return;
    }

    // Idempotency — same hash means we've already received this email.
    // Slice 2 may have already advanced its status to `parsed`; in
    // either case there's nothing for us to do.
    const existing = await docRef.get();
    if (existing.exists) {
      logger.info('indeedFlexInboundWebhook: duplicate', {
        eventHash,
        existingStatus: existing.get('status'),
      });
      res.status(200).send('Already received');
      return;
    }

    const eventDoc: Omit<ExternalIngestEvent, 'receivedAt'> & {
      receivedAt: FirebaseFirestore.FieldValue;
      actor: string;
    } = {
      provider: 'indeed_flex',
      eventHash,
      receivedAt: FieldValue.serverTimestamp(),
      authVerification,
      raw,
      status: 'received',
      actor: ACTOR,
    };
    await docRef.set(eventDoc);

    logger.info('indeedFlexInboundWebhook: received', {
      eventHash,
      senderDomain,
      subject: fields.subject ?? '',
      hasText: Boolean(fields.text),
      hasHtml: Boolean(fields.html),
      attachmentCount,
      truncated: raw.truncated === true,
    });
    res.status(200).send('OK');
  },
);
