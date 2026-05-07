/**
 * onTimesheetEntryWrite — maintain `Assignment.latestTimesheetStatus`.
 *
 * Fires on every `tenants/{tid}/timesheet_entries/{entryId}` write
 * (create / update / delete) and recomputes the assignment's
 * `latestTimesheetStatus` field by aggregating across all the
 * assignment's entries with a precedence rule.
 *
 * **Naming.** The "latest" in the field name is slightly misleading:
 * what we actually want is "worst-state-on-this-assignment" — the
 * most-attention-grabbing status across all entries — so a recruiter
 * can fast-filter the dashboard for assignments needing review
 * (`latestTimesheetStatus IN ('draft', 'error')`). We keep the
 * existing field name (already declared in `Assignment` type and
 * referenced across the build plan) but the semantics are
 * precedence-based, not last-write-based.
 *
 * **Precedence (top wins):**
 *   1. error            — any entry in error blocks the assignment
 *                         from being clean
 *   2. draft            — anything still being entered
 *   3. submitted        — reserved for future worker self-clock
 *   4. approved         — ready to batch
 *   5. sent_to_everee   — in flight
 *   6. paid             — all settled
 *   (none of the above) — null (no entries exist)
 *
 * Concretely: a 5-day week with 4 entries `paid` and 1 entry `error`
 * surfaces as `error`, because the recruiter needs to fix the
 * problem entry before payroll closes.
 *
 * **Loop prevention.** The trigger writes to a different document
 * (the assignment, not the entry that triggered it) so there's no
 * direct self-loop. However, the assignment write fires
 * `onAssignmentWriteEnsureDenormFields` (P1.B.2). We protect THAT
 * trigger from infinite loops by:
 *   1. P1.B.2's tier-2 diff guard recognizes when only managed
 *      fields changed — `latestTimesheetStatus` is in its
 *      `TRIGGER_ANCILLARY_FIELDS` set, so a `latestTimesheetStatus`-
 *      only update doesn't re-fire the denorm resolver chain.
 *   2. We skip writing to the assignment if the new
 *      `latestTimesheetStatus` value is identical to the current
 *      one. Saves a Firestore write + a needless denorm trigger
 *      invocation.
 *
 * **Cost.** Per entry write, this trigger does:
 *   - 1 collection-query read scoped to the assignment's entries
 *     (typically 1-7 docs for a weekly view).
 *   - 1 assignment-doc read.
 *   - 0 or 1 assignment-doc writes (skipped when status unchanged).
 *
 * @see TS.1 build plan §4.3 — assignment latestTimesheetStatus
 */

import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

/**
 * Precedence order — index 0 wins over later indices. Mirrors the
 * worker-attention-grabbing semantic described in the build plan.
 *
 * `submitted` sits between draft and approved deliberately: it
 * represents "worker submitted, recruiter not yet reviewed", which
 * is more progressed than draft but still requires recruiter action
 * (so it should out-rank approved when both exist on the same
 * assignment).
 */
const PRECEDENCE_ORDER = [
  'error',
  'draft',
  'submitted',
  'approved',
  'sent_to_everee',
  'paid',
] as const;

type LatestStatus = (typeof PRECEDENCE_ORDER)[number] | null;

/** Returns the highest-precedence status from the input set, or
 *  `null` when the set is empty (no entries on the assignment). */
function pickPrecedence(statuses: Iterable<string>): LatestStatus {
  const present = new Set<string>();
  for (const s of statuses) {
    if (typeof s === 'string') present.add(s);
  }
  for (const candidate of PRECEDENCE_ORDER) {
    if (present.has(candidate)) return candidate;
  }
  return null;
}

export const onTimesheetEntryWriteUpdateAssignmentLatestStatus = onDocumentWritten(
  {
    document: 'tenants/{tenantId}/timesheet_entries/{entryId}',
    region: 'us-central1',
    maxInstances: 10,
    retry: false,
  },
  async (event) => {
    const tenantId = event.params.tenantId as string;
    const entryId = event.params.entryId as string;

    // Resolve the assignmentId from whichever side of the write has
    // it. Most paths go through after.exists; delete handlers fall
    // back to before.
    const afterData = event.data?.after?.exists ? (event.data.after.data() as Record<string, unknown>) : null;
    const beforeData = event.data?.before?.exists ? (event.data.before.data() as Record<string, unknown>) : null;

    const assignmentId =
      (afterData && typeof afterData.assignmentId === 'string' && afterData.assignmentId) ||
      (beforeData && typeof beforeData.assignmentId === 'string' && beforeData.assignmentId) ||
      null;

    if (!assignmentId) {
      logger.warn('[TS.1.P1.D][onTimesheetEntryWriteUpdateAssignmentLatestStatus] no assignmentId on entry', {
        tenantId,
        entryId,
      });
      return;
    }

    // Fetch the full set of entries for this assignment under this
    // tenant. We could use a collectionGroup query, but a scoped
    // collection query keeps the index footprint tiny — single-field
    // `assignmentId` equality is auto-indexed within
    // `tenants/{tid}/timesheet_entries`.
    let entriesSnap;
    try {
      entriesSnap = await db
        .collection('tenants')
        .doc(tenantId)
        .collection('timesheet_entries')
        .where('assignmentId', '==', assignmentId)
        .get();
    } catch (err) {
      logger.error(
        '[TS.1.P1.D][onTimesheetEntryWriteUpdateAssignmentLatestStatus] entries query failed',
        {
          tenantId,
          assignmentId,
          entryId,
          error: err instanceof Error ? err.message : String(err),
        },
      );
      return;
    }

    const statuses: string[] = [];
    for (const d of entriesSnap.docs) {
      const data = d.data();
      if (typeof data?.status === 'string') statuses.push(data.status);
    }

    const newLatest = pickPrecedence(statuses);

    // Read the assignment to skip when nothing changed. Without this
    // we'd write on every entry write, even no-ops, churning the
    // P1.B.2 denorm trigger needlessly.
    const assignmentRef = db.doc(`tenants/${tenantId}/assignments/${assignmentId}`);
    let assignmentSnap;
    try {
      assignmentSnap = await assignmentRef.get();
    } catch (err) {
      logger.error(
        '[TS.1.P1.D][onTimesheetEntryWriteUpdateAssignmentLatestStatus] assignment read failed',
        {
          tenantId,
          assignmentId,
          error: err instanceof Error ? err.message : String(err),
        },
      );
      return;
    }
    if (!assignmentSnap.exists) {
      // Entry references an assignment that's been deleted. Nothing
      // to update; not an error.
      return;
    }
    const currentLatest = assignmentSnap.data()?.latestTimesheetStatus;
    const currentNormalized =
      typeof currentLatest === 'string' && currentLatest.length > 0
        ? currentLatest
        : null;
    if (currentNormalized === newLatest) {
      return; // No-op — the most common case after the first write.
    }

    try {
      if (newLatest === null) {
        // All entries deleted / none exist. Clear the field.
        await assignmentRef.set(
          {
            latestTimesheetStatus: admin.firestore.FieldValue.delete(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      } else {
        await assignmentRef.set(
          {
            latestTimesheetStatus: newLatest,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      }
      logger.debug(
        '[TS.1.P1.D][onTimesheetEntryWriteUpdateAssignmentLatestStatus] updated',
        {
          tenantId,
          assignmentId,
          previous: currentNormalized,
          next: newLatest,
          entryCount: statuses.length,
        },
      );
    } catch (err) {
      logger.error(
        '[TS.1.P1.D][onTimesheetEntryWriteUpdateAssignmentLatestStatus] write failed',
        {
          tenantId,
          assignmentId,
          error: err instanceof Error ? err.message : String(err),
        },
      );
    }
  },
);
