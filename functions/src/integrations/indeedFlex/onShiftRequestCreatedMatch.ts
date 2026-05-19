/**
 * **Indeed Flex Slice 3 — onCreate trigger that matches a parsed
 * request to an HRX shift / JO / assignment.**
 *
 * Fires when Slice 2's parser writes a new
 * `tenants/{tid}/external_shift_requests/{id}` doc with
 * `status='needs_review'`. For each matching doc:
 *
 *   1. Build the production Firestore reader.
 *   2. Call `matchShiftRequest` with the event payload — the
 *      dispatcher picks the right strategy (jobId-first vs
 *      venue+date fallback) based on `event.type` and which fields
 *      the parser populated.
 *   3. Stamp the result fields (`matchedShiftId`,
 *      `matchedJobOrderId`, `matchedAssignmentIds`,
 *      `matchConfidence`, `matchedAt`, `matchNotes`) back onto the
 *      doc.
 *
 * The trigger never mutates the source `external_ingest_events`
 * row — that's already in `parsed` status. We're only enriching
 * the per-event row Slice 2 wrote.
 *
 * **Idempotent**: re-firing the trigger overwrites the same fields
 * with the same query results. Safe for retries.
 *
 * **What this doesn't do** (Slices 4-5):
 *   - Show the queue to the recruiter (Slice 4 UI).
 *   - Apply the action — create shift, update headcount, cancel
 *     assignments. Those wait for explicit recruiter approval.
 */

import * as admin from 'firebase-admin';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions/v2';

import { createFirestoreReader } from './matcher/firestoreReader';
import { matchShiftRequest } from './matcher/matchShiftRequest';
import type {
  ExternalShiftRequest,
  IndeedFlexEvent,
} from '../../shared/indeedFlex/types';

if (!admin.apps.length) {
  admin.initializeApp();
}

export const onShiftRequestCreatedMatch = onDocumentCreated(
  {
    document: 'tenants/{tenantId}/external_shift_requests/{requestId}',
    region: 'us-central1',
    memory: '512MiB',
    timeoutSeconds: 60,
    maxInstances: 4,
  },
  async (event) => {
    const { tenantId, requestId } = event.params as {
      tenantId: string;
      requestId: string;
    };
    const data = event.data?.data() as ExternalShiftRequest | undefined;
    if (!data) return;

    // Provider gate (same defense-in-depth as Slice 2's trigger).
    if (data.provider !== 'indeed_flex') return;

    // Only match rows that need it — Slice 5 may later transition
    // through `approved`/`applied` and we don't want to overwrite
    // match fields after the recruiter acted on them.
    if (data.status !== 'needs_review') return;

    // If a previous match attempt already stamped a confidence, skip
    // (idempotent on re-fire). Allows manual re-run by clearing the
    // field on the doc.
    if (data.matchConfidence) return;

    const db = admin.firestore();
    const reader = createFirestoreReader(db);

    let result;
    try {
      result = await matchShiftRequest(reader, {
        tenantId,
        event: data.event as IndeedFlexEvent,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('[onShiftRequestCreatedMatch] dispatcher threw', {
        tenantId,
        requestId,
        err: message,
      });
      await event.data?.ref.update({
        matchConfidence: 'none',
        matchedAt: new Date().toISOString(),
        matchNotes: `match_failed: ${message}`,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return;
    }

    const updates: Record<string, unknown> = {
      matchConfidence: result.matchConfidence,
      matchedAt: new Date().toISOString(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (result.matchedShiftId) updates.matchedShiftId = result.matchedShiftId;
    if (result.matchedJobOrderId) updates.matchedJobOrderId = result.matchedJobOrderId;
    if (result.matchedAssignmentIds && result.matchedAssignmentIds.length > 0) {
      updates.matchedAssignmentIds = result.matchedAssignmentIds;
    }
    if (result.matchNotes) updates.matchNotes = result.matchNotes;

    await event.data?.ref.update(updates);

    logger.info('[onShiftRequestCreatedMatch] matched', {
      tenantId,
      requestId,
      eventType: data.eventType,
      matchConfidence: result.matchConfidence,
      matchedShiftId: result.matchedShiftId,
      matchedJobOrderId: result.matchedJobOrderId,
      matchedAssignmentCount: (result.matchedAssignmentIds ?? []).filter(Boolean).length,
    });
  },
);
