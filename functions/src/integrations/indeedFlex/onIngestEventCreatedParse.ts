/**
 * **Indeed Flex Slice 2 — onCreate trigger that parses an ingest event.**
 *
 * Fires when Slice 1's webhook writes a new
 * `tenants/{tid}/external_ingest_events/{eventHash}` doc with
 * `status='received'` and `provider='indeed_flex'`. For each
 * matching doc:
 *
 *   1. Call `parseIndeedFlexEmail` with the raw payload.
 *   2. For every returned event, write
 *      `tenants/{tid}/external_shift_requests/{eventHash}__{eventIndex}`
 *      with status `needs_review` (deterministic id → idempotent).
 *   3. Flip the source ingest event's status to `parsed` (or
 *      `parse_failed` when classification failed) and stamp
 *      `parsedRequestIds[]` for backlink.
 *
 * **Why `onDocumentCreated` instead of polling.** Slice 1's webhook
 * returns 200 immediately; the parse runs out-of-band so a slow LLM
 * call doesn't slow down SendGrid acks. Plus we get free retries
 * for free — `onDocumentCreated` re-fires if the function instance
 * crashes mid-parse (idempotent end-to-end so a re-fire just
 * re-writes the same doc).
 *
 * **Tenant routing.** Slice 1 is hardcoded to C1 (`BCiP2bQ9CgVOCTfV6MhD`);
 * this trigger is wildcarded across tenants but only acts on
 * `provider='indeed_flex'` rows so adding a sibling provider later
 * doesn't accidentally fire this handler.
 *
 * **What this trigger does NOT do** (deferred to Slices 3-5):
 *   - Match the parsed event to an HRX shift / JO / assignment.
 *   - Apply the action (create / update / cancel) to the matched
 *     target. That requires recruiter approval first per the
 *     "always queue for human" policy chosen for Slice 2.
 */

import * as admin from 'firebase-admin';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions/v2';

import { parseIndeedFlexEmail } from './parser/parseIndeedFlexEmail';
import type {
  ExternalIngestEvent,
  ExternalShiftRequest,
} from '../../shared/indeedFlex/types';

if (!admin.apps.length) {
  admin.initializeApp();
}

const FieldValue = admin.firestore.FieldValue;

export const onIngestEventCreatedParse = onDocumentCreated(
  {
    document: 'tenants/{tenantId}/external_ingest_events/{eventHash}',
    region: 'us-central1',
    memory: '512MiB',
    timeoutSeconds: 120,
    maxInstances: 4,
    // OPENAI_API_KEY comes via process.env (set in functions/.env files)
    // rather than a `secrets:` binding — Firebase rejects declaring the
    // same key in both places, and the env-var path is what every other
    // AI consumer in this codebase (appAi.ts, etc.) already uses.
  },
  async (event) => {
    const { tenantId, eventHash } = event.params as {
      tenantId: string;
      eventHash: string;
    };
    const data = event.data?.data() as ExternalIngestEvent | undefined;
    if (!data) return;

    // Provider gate — only act on Indeed Flex rows.
    if (data.provider !== 'indeed_flex') return;

    // Status gate — only parse `received` rows. `rejected_dkim` and
    // already-parsed rows are no-ops here.
    if (data.status !== 'received') return;

    const subject = data.raw?.subject ?? '';
    const text = data.raw?.text;
    const html = data.raw?.html;

    const db = admin.firestore();
    const sourceRef = db
      .collection('tenants')
      .doc(tenantId)
      .collection('external_ingest_events')
      .doc(eventHash);

    let parseResult;
    try {
      parseResult = await parseIndeedFlexEmail({ subject, text, html });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('[onIngestEventCreatedParse] parser threw', {
        tenantId,
        eventHash,
        err: message,
      });
      await sourceRef.update({
        status: 'parse_failed',
        parseFailureReason: `parser_threw: ${message}`,
      });
      return;
    }

    if (parseResult.reason === 'unclassified' || parseResult.reason === 'no_body') {
      logger.warn('[onIngestEventCreatedParse] could not parse', {
        tenantId,
        eventHash,
        reason: parseResult.reason,
        subject,
      });
      await sourceRef.update({
        status: 'parse_failed',
        parseFailureReason: parseResult.reason,
      });
      return;
    }

    // Write one `external_shift_requests` row per parsed event. Doc
    // id is deterministic so a re-fire of this trigger overwrites
    // rather than duplicates.
    const parsedRequestIds: string[] = [];
    const batch = db.batch();
    parseResult.events.forEach((parsed, idx) => {
      const docId = `${eventHash}__${idx}`;
      const docRef = db
        .collection('tenants')
        .doc(tenantId)
        .collection('external_shift_requests')
        .doc(docId);
      const now = new Date().toISOString();
      const reqDoc: Omit<ExternalShiftRequest, 'createdAt' | 'updatedAt'> & {
        createdAt: FirebaseFirestore.FieldValue;
        updatedAt: FirebaseFirestore.FieldValue;
      } = {
        id: docId,
        tenantId,
        provider: 'indeed_flex',
        sourceIngestEventHash: eventHash,
        eventIndex: idx,
        eventType: parsed.event.type,
        event: parsed.event,
        confidence: parsed.confidence,
        parseSource: parsed.parseSource,
        status: 'needs_review',
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        ...(parsed.notes ? { parseNotes: parsed.notes } : {}),
      };
      // Strip the ISO `now` placeholder — Firestore timestamps come from
      // the FieldValue we already set.
      void now;
      batch.set(docRef, reqDoc, { merge: true });
      parsedRequestIds.push(docId);
    });

    batch.update(sourceRef, {
      status: 'parsed',
      parsedRequestIds,
    });

    await batch.commit();

    logger.info('[onIngestEventCreatedParse] parsed', {
      tenantId,
      eventHash,
      events: parseResult.events.length,
      types: parseResult.events.map((e) => e.event.type),
      confidence: parseResult.events.map((e) => e.confidence),
      parseSource: parseResult.events.map((e) => e.parseSource),
    });
  },
);
