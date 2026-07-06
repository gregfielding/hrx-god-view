/**
 * **Fieldglass inbound webhook (FG Slice 1).**
 *
 * SendGrid Inbound Parse receiver for SAP Fieldglass notification emails
 * (Sodexo program). Structural mirror of `indeedFlexInboundWebhook` —
 * same multipart parsing, DKIM policy shape, dedupe hash, and
 * `external_ingest_events` persistence — with `provider: 'fieldglass'`
 * and the SAP sender domains.
 *
 * Operational setup (outside this file): either point a dedicated
 * Fieldglass supplier-user's notification email directly at the ingest
 * address (cleanest — DKIM arrives intact), or forward from a recruiter
 * inbox (Gmail forwards usually preserve the original DKIM signature on
 * unmodified bodies; if forwarded mail lands as `rejected_dkim`, the
 * events are persisted for audit and the policy can be revisited against
 * real samples).
 *
 * Scope stops at persistence — parsing happens in
 * `onFieldglassIngestEventCreatedParse`. Deliberately NOT here: JO
 * creation, worksite/child-account wiring, user-group auto-messaging
 * (Greg, 2026-07-06: those layers need design discussion first).
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
} from '../indeedFlex/eventHash';
import type { FieldglassIngestEvent } from './types';

const FieldValue = admin.firestore.FieldValue;

if (!admin.apps.length) {
  admin.initializeApp();
}

/** C1 Staffing tenant. Hardcoded until multi-tenant routing is needed —
 *  same convention as the Indeed Flex webhook. */
const TENANT_ID = 'BCiP2bQ9CgVOCTfV6MhD';

/** DKIM from any of these domains (or a subdomain) is trusted. The real
 *  sender observed is `fieldglass@us.fieldglass.cloud.sap`. */
const EXPECTED_SENDER_DOMAINS = ['fieldglass.cloud.sap', 'fieldglass.net', 'sap.com'];

const RAW_BODY_CAP_BYTES = 256 * 1024;
const RAW_HEADERS_CAP_BYTES = 64 * 1024;
const MULTIPART_MAX_BYTES = 10 * 1024 * 1024;
const ACTOR = 'system_fieldglass_inbound_webhook';

interface ParsedMultipart {
  fields: Record<string, string>;
  attachmentCount: number;
}

function parseMultipart(req: Request): Promise<ParsedMultipart> {
  return new Promise((resolve, reject) => {
    const fields: Record<string, string> = {};
    let attachmentCount = 0;

    const bb = Busboy({
      headers: req.headers,
      limits: {
        fieldSize: RAW_BODY_CAP_BYTES,
        fields: 100,
        files: 50,
        fileSize: 1,
      },
    });

    bb.on('field', (name, value) => {
      fields[name] = value;
    });
    bb.on('file', (_name, stream) => {
      attachmentCount += 1;
      stream.on('data', () => undefined);
      stream.on('end', () => undefined);
      stream.resume();
    });
    bb.on('finish', () => resolve({ fields, attachmentCount }));
    bb.on('error', (err: Error) => reject(err));

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

function parseDkimField(raw: string): {
  result: FieldglassIngestEvent['authVerification']['dkim'];
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
  return { result: 'pass', domains: passes.map((m) => m[1].toLowerCase()) };
}

function parseSpfField(raw: string): FieldglassIngestEvent['authVerification']['spf'] {
  const v = (raw ?? '').trim().toLowerCase();
  if (v === 'pass' || v === 'softfail' || v === 'fail' || v === 'none') return v;
  return v ? 'unknown' : 'none';
}

function extractSenderDomain(from: string): string {
  const match = (from ?? '').match(/@([a-z0-9.-]+)/i);
  return match ? match[1].toLowerCase().replace(/[>"']/g, '').trim() : '';
}

function verifyDkim(dkim: ReturnType<typeof parseDkimField>): string | null {
  if (dkim.result !== 'pass') {
    return `dkim_${dkim.result}`;
  }
  const passing = dkim.domains.some((d) =>
    EXPECTED_SENDER_DOMAINS.some((exp) => d === exp || d.endsWith(`.${exp}`)),
  );
  if (!passing) {
    return 'dkim_unexpected_domain';
  }
  return null;
}

function truncateUtf8(
  input: string | undefined,
  capBytes: number,
): { value?: string; truncated: boolean } {
  if (input == null) return { value: undefined, truncated: false };
  if (Buffer.byteLength(input, 'utf8') <= capBytes) {
    return { value: input, truncated: false };
  }
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

export const fieldglassInboundWebhook = onRequest(
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
      logger.error('fieldglassInboundWebhook: multipart parse failed', {
        error: (err as Error).message,
      });
      res.status(200).send('Bad payload (logged)');
      return;
    }

    const { fields, attachmentCount } = parsed;
    const senderDomain = extractSenderDomain(fields.from ?? '');
    const dkim = parseDkimField(fields.dkim ?? '');
    const spf = parseSpfField(fields.SPF ?? '');

    const authVerification: FieldglassIngestEvent['authVerification'] = {
      dkim: dkim.result,
      dkimDomains: dkim.domains,
      spf,
      sender: fields.from ?? '',
      senderDomain,
      ...(fields.sender_ip ? { senderIp: fields.sender_ip } : {}),
    };

    const text = truncateUtf8(fields.text, RAW_BODY_CAP_BYTES);
    const html = truncateUtf8(fields.html, RAW_BODY_CAP_BYTES);
    const headers = truncateUtf8(fields.headers, RAW_HEADERS_CAP_BYTES);
    const truncated = text.truncated || html.truncated || headers.truncated;
    const raw: FieldglassIngestEvent['raw'] = {
      from: fields.from ?? '',
      to: fields.to ?? '',
      subject: fields.subject ?? '',
      ...(text.value !== undefined ? { text: text.value } : {}),
      ...(html.value !== undefined ? { html: html.value } : {}),
      ...(headers.value !== undefined ? { headers: headers.value } : {}),
      ...(fields.envelope ? { envelope: fields.envelope } : {}),
      attachmentCount,
      ...(truncated ? { truncated: true } : {}),
    };

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
      await docRef.set(
        {
          provider: 'fieldglass',
          eventHash,
          receivedAt: FieldValue.serverTimestamp(),
          authVerification,
          raw,
          status: 'rejected_dkim',
          rejectionReason: dkimRejectionReason,
          actor: ACTOR,
        },
        { merge: true },
      );
      logger.warn('fieldglassInboundWebhook: dkim rejected', {
        eventHash,
        reason: dkimRejectionReason,
        senderDomain,
        dkimDomains: dkim.domains,
      });
      res.status(200).send('Rejected (logged)');
      return;
    }

    const existing = await docRef.get();
    if (existing.exists) {
      logger.info('fieldglassInboundWebhook: duplicate', {
        eventHash,
        existingStatus: existing.get('status'),
      });
      res.status(200).send('Already received');
      return;
    }

    await docRef.set({
      provider: 'fieldglass',
      eventHash,
      receivedAt: FieldValue.serverTimestamp(),
      authVerification,
      raw,
      status: 'received',
      actor: ACTOR,
    });

    logger.info('fieldglassInboundWebhook: received', {
      eventHash,
      senderDomain,
      subject: fields.subject ?? '',
      hasText: Boolean(fields.text),
      hasHtml: Boolean(fields.html),
      attachmentCount,
      truncated,
    });
    res.status(200).send('OK');
  },
);
