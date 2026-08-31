/**
 * VenueSmart PO → QBO class automation (Greg 2026-08-31, mid class-cleanup
 * meeting).
 *
 * VenueSmart LLC emails purchase orders to Greg/Rosa/MK from their own QBO
 * (From: quickbooks@notification.intuit.com, Reply-To: angie@venuesmartllc.com)
 * with subjects shaped:
 *
 *   Purchase Order from VenueSmart LLC - 2026 Jimmy Eat World - Moody
 *   └─ prefix ─────────────────────────┘ └─ event ─────────┘ └ venue ┘
 *
 * and bodies carrying "Purchase Order # : 1247". Each PO's event needs a QBO
 * class under the "Venue Smart" parent (per-event job costing; totals roll up
 * to the parent automatically). Before this sweep the class was created by
 * hand when someone noticed — invoices piled up on the bare parent instead
 * (see the 2026-08-31 cleanup: $1.2M of parent-direct activity).
 *
 * The sweep (called from inboxTriageCron — NOT a new function; the project is
 * at the Cloud Run services cap):
 *   1. Gmail-search Greg's mailbox for VenueSmart PO emails.
 *   2. Spoof guard: only intuit notification From + venuesmartllc.com
 *      Reply-To (or direct venuesmartllc.com From) is trusted — this write
 *      path is triggered by inbound email, so provenance matters.
 *   3. Parse event name from the subject, PO number from the body.
 *   4. Dedupe against existing Venue Smart subclasses (normalized
 *      containment either way — "FIFA KC Fan Fest WWI" must land on the
 *      existing "FIFA KC", not create a sibling).
 *   5. Create the class in QBO + the authoritative HRX mapping when new.
 *   6. Ledger every PO: tenants/{t}/venuesmart_po_classes/{poNumber} is the
 *      durable PO→class map (future invoice/JO auto-classing reads this),
 *      and venuesmart_po_email_ledger/{messageId} makes the sweep
 *      idempotent per email.
 *
 * Kill switch: integrations/inboxChiefOfStaff.venuesmartPoSweep === false.
 */

import { logger } from 'firebase-functions/v2';
import * as admin from 'firebase-admin';
import type { gmail_v1 } from 'googleapis';

import { qboQuery, qboEntityCreate } from './qboAuth';

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const trim = (v: unknown): string => String(v ?? '').trim();
const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const SUBJECT_PREFIX = /purchase\s+order\s+from\s+venuesmart\s+llc\s*-\s*/i;
// after:2026/01/01 — the class cleanup scoped to 2026 books (Greg); 2025
// POs (e.g. #1179-#1188, all 2025 concerts) must not spawn classes.
const GMAIL_QUERY = 'subject:"Purchase Order from VenueSmart LLC" after:2026/01/01';

/**
 * "Purchase Order from VenueSmart LLC - 2026 Jimmy Eat World - Moody"
 *   → { event: '2026 Jimmy Eat World', venue: 'Moody' }
 * Single-segment subjects keep the whole remainder as the event.
 * Exported for tests.
 */
export function parsePoSubject(subject: string): { event: string; venue: string } | null {
  const s = trim(subject);
  if (!SUBJECT_PREFIX.test(s)) return null;
  const rest = s.replace(SUBJECT_PREFIX, '').trim();
  if (!rest) return null;
  const segments = rest.split(/\s+-\s+/).map(trim).filter(Boolean);
  if (segments.length === 0) return null;
  if (segments.length === 1) return { event: segments[0], venue: '' };
  return { event: segments.slice(0, -1).join(' - '), venue: segments[segments.length - 1] };
}

/** "Purchase Order # : 1247" → '1247'. Exported for tests. */
export function parsePoNumber(body: string): string {
  const m = body.match(/purchase\s+order\s*#\s*:?\s*(\d+)/i);
  return m ? m[1] : '';
}

/**
 * Match an event name against existing Venue Smart subclasses. Containment
 * in EITHER direction on normalized names counts as "already exists" —
 * creation must be conservative because a wrong create pollutes the books.
 * Exported for tests.
 */
export function matchExistingSubclass(
  event: string,
  subclasses: Array<{ id: string; leaf: string; fqn: string }>,
): { id: string; leaf: string; fqn: string } | null {
  const e = norm(event);
  // A too-short event name can containment-match into anything ("KC" →
  // "FIFA KC") and silently mis-ledger the PO; refuse to match on it.
  if (e.length < 4) return null;
  let best: { id: string; leaf: string; fqn: string } | null = null;
  let bestLen = 0;
  for (const c of subclasses) {
    const k = norm(c.leaf);
    if (k.length < 4) continue;
    if ((e.includes(k) || k.includes(e)) && k.length > bestLen) {
      best = c;
      bestLen = k.length;
    }
  }
  return best;
}

function header(msg: gmail_v1.Schema$Message, name: string): string {
  return trim(msg.payload?.headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value);
}

function plainText(msg: gmail_v1.Schema$Message): string {
  const parts: string[] = [msg.snippet ?? ''];
  const walk = (p?: gmail_v1.Schema$MessagePart): void => {
    if (!p) return;
    if (p.mimeType === 'text/plain' && p.body?.data) {
      parts.push(Buffer.from(p.body.data, 'base64').toString('utf8'));
    }
    (p.parts ?? []).forEach(walk);
  };
  walk(msg.payload as gmail_v1.Schema$MessagePart | undefined);
  return parts.join('\n');
}

function trustedSender(from: string, replyTo: string): boolean {
  const f = from.toLowerCase();
  const r = replyTo.toLowerCase();
  if (f.includes('venuesmartllc.com')) return true;
  return f.includes('notification.intuit.com') && r.includes('venuesmartllc.com');
}

export interface PoSweepResult {
  scanned: number;
  created: Array<{ poNumber: string; event: string; fqn: string }>;
  matchedExisting: Array<{ poNumber: string; event: string; fqn: string }>;
  skipped: number;
  dryRun: boolean;
}

export async function sweepVenueSmartPoEmails(args: {
  tenantId: string;
  gmail: gmail_v1.Gmail;
  dryRun?: boolean;
  maxMessages?: number;
}): Promise<PoSweepResult> {
  const { tenantId, gmail } = args;
  const dryRun = args.dryRun === true;
  const result: PoSweepResult = { scanned: 0, created: [], matchedExisting: [], skipped: 0, dryRun };

  const list = await gmail.users.messages.list({
    userId: 'me',
    q: GMAIL_QUERY,
    maxResults: args.maxMessages ?? 50,
  });
  const ids = (list.data.messages ?? []).map((m) => trim(m.id)).filter(Boolean);
  if (ids.length === 0) return result;

  // Class inventory once per sweep.
  const clsRes = (await qboQuery(tenantId, 'SELECT Id, Name, FullyQualifiedName FROM Class MAXRESULTS 1000')) as Record<string, any>;
  const classes: any[] = clsRes.QueryResponse?.Class ?? clsRes.Class ?? [];
  const parent = classes.find((c) => String(c.FullyQualifiedName) === 'Venue Smart');
  if (!parent) {
    logger.error('[venuesmart_po] "Venue Smart" parent class not found — aborting sweep');
    return result;
  }
  const subclasses = classes
    .filter((c) => String(c.FullyQualifiedName).startsWith('Venue Smart:'))
    .map((c) => ({ id: String(c.Id), leaf: String(c.Name), fqn: String(c.FullyQualifiedName) }));

  for (const id of ids) {
    const ledgerRef = db.doc(`tenants/${tenantId}/venuesmart_po_email_ledger/${id}`);
    if ((await ledgerRef.get()).exists) continue; // already processed
    result.scanned += 1;

    const full = await gmail.users.messages.get({ userId: 'me', id, format: 'full' });
    const msg = full.data;
    const subject = header(msg, 'subject');
    const from = header(msg, 'from');
    const replyTo = header(msg, 'reply-to');

    const parsed = parsePoSubject(subject);
    if (!parsed || !trustedSender(from, replyTo)) {
      result.skipped += 1;
      if (!dryRun) {
        await ledgerRef.set({
          messageId: id, subject, from, replyTo,
          outcome: !parsed ? 'unparseable_subject' : 'untrusted_sender',
          processedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
      continue;
    }

    const poNumber = parsePoNumber(plainText(msg));
    const existing = matchExistingSubclass(parsed.event, subclasses);

    let classId: string;
    let fqn: string;
    let outcome: string;
    if (existing) {
      classId = existing.id;
      fqn = existing.fqn;
      outcome = 'matched_existing';
      result.matchedExisting.push({ poNumber, event: parsed.event, fqn });
    } else if (dryRun) {
      classId = '';
      fqn = `Venue Smart:${parsed.event}`;
      outcome = 'would_create';
      result.created.push({ poNumber, event: parsed.event, fqn });
    } else {
      const created = (await qboEntityCreate(tenantId, 'Class', {
        Name: parsed.event,
        ParentRef: { value: String(parent.Id) },
      })) as Record<string, any>;
      const cls = created.Class ?? created;
      classId = String(cls.Id);
      fqn = String(cls.FullyQualifiedName ?? `Venue Smart:${parsed.event}`);
      outcome = 'created';
      result.created.push({ poNumber, event: parsed.event, fqn });
      // Keep in-memory inventory current so one sweep can't double-create.
      subclasses.push({ id: classId, leaf: parsed.event, fqn });
      // Authoritative HRX mapping — account-kind, inheriting the parent's
      // account (a JO usually doesn't exist yet when the PO arrives).
      const parentMap = (await db.doc(`tenants/${tenantId}/qbo_class_mappings/${String(parent.Id)}`).get()).data() ?? {};
      await db.doc(`tenants/${tenantId}/qbo_class_mappings/${classId}`).set({
        classId,
        className: parsed.event,
        fqn,
        targetKind: 'account',
        jobOrderId: null, jobOrderName: null, jobOrderIds: [], jobOrderNames: [],
        accountId: trim(parentMap.accountId) || null,
        accountName: trim(parentMap.accountName) || null,
        source: 'venuesmart_po_email',
        mappedBy: null,
        mappedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    if (!dryRun) {
      if (poNumber) {
        await db.doc(`tenants/${tenantId}/venuesmart_po_classes/${poNumber}`).set({
          poNumber,
          event: parsed.event,
          venue: parsed.venue,
          classId,
          fqn,
          emailMessageId: id,
          subject,
          processedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
      }
      await ledgerRef.set({
        messageId: id, subject, from, poNumber, event: parsed.event, venue: parsed.venue,
        classId, fqn, outcome,
        processedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
    logger.info('[venuesmart_po] processed', { poNumber, event: parsed.event, fqn, outcome, dryRun });
  }
  return result;
}
