/**
 * **Slice 3 matcher — top-level dispatcher (event type → strategy).**
 *
 * One entrypoint per `ExternalShiftRequest`. The Firestore trigger
 * (`onShiftRequestCreatedMatch`) calls this once per newly-parsed
 * row, then writes the returned `MatchResult` back onto the doc.
 *
 * Strategy table:
 *
 *   - `new_request`           — jobId (required) → matchByJobId
 *                               (returns JO, no shift expected
 *                               since this is a fill request)
 *   - `change_time`           — jobId (required) → matchByJobId
 *                               with workDate
 *   - `change_headcount`      — no jobId in current emails →
 *                               matchByFallback (venue+date+time)
 *   - `cancel_booking`        — no jobId → matchByFallback, then
 *                               matchWorkerAssignments per worker
 *                               name in the event
 *   - `no_show`               — jobId (required) → matchByJobId,
 *                               then matchWorkerAssignments
 *   - `daily_digest_expired`  — per-job loop: each expired entry
 *                               runs matchByJobId. Slice 3 returns
 *                               the FIRST resolved JO + a note
 *                               listing how many entries hit.
 *                               (The recruiter UI surfaces the full
 *                               list of expiredJobs separately.)
 *
 * The dispatcher catches and downgrades exceptions — a failing
 * Firestore query shouldn't leave the request stuck in
 * `needs_review` with no `matchConfidence` stamped. On error we
 * stamp `matchConfidence='none'` with the error message as
 * `matchNotes` so ops can triage.
 */

import type { IndeedFlexEvent } from '../../../shared/indeedFlex/types';

import { matchByFallback } from './matchByFallback';
import { matchByJobId } from './matchByJobId';
import { matchWorkerAssignments } from './matchWorkerAssignments';
import type { MatchResult, Reader } from './types';

export async function matchShiftRequest(
  reader: Reader,
  args: { tenantId: string; event: IndeedFlexEvent },
): Promise<MatchResult> {
  try {
    return await dispatch(reader, args);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      matchConfidence: 'none',
      matchNotes: `matcher threw: ${message}`,
    };
  }
}

async function dispatch(
  reader: Reader,
  args: { tenantId: string; event: IndeedFlexEvent },
): Promise<MatchResult> {
  const { tenantId, event } = args;

  switch (event.type) {
    case 'new_request': {
      return matchByJobId(reader, {
        tenantId,
        jobId: event.jobId,
        workDate: event.workDate,
      });
    }

    case 'change_time': {
      return matchByJobId(reader, {
        tenantId,
        jobId: event.jobId,
        workDate: event.workDate,
      });
    }

    case 'change_headcount': {
      // jobId is sometimes present too — try id first, fall back to
      // venue+date+time. Stamp combined notes for transparency.
      if (event.jobId) {
        const byId = await matchByJobId(reader, {
          tenantId,
          jobId: event.jobId,
          workDate: event.workDate,
        });
        if (byId.matchedShiftId) return byId;
      }
      return matchByFallback(reader, {
        tenantId,
        venueName: event.venueName,
        workDate: event.workDate,
        startTime: event.startTime,
        endTime: event.endTime,
        roleName: event.roleName,
      });
    }

    case 'cancel_booking': {
      const fallback = await matchByFallback(reader, {
        tenantId,
        venueName: event.venueName,
        workDate: event.workDate,
        startTime: event.startTime,
        endTime: event.endTime,
        roleName: event.roleName,
      });
      if (!fallback.matchedShiftId || event.workerNames.length === 0) {
        return fallback;
      }
      const wrk = await matchWorkerAssignments(reader, {
        tenantId,
        shiftId: fallback.matchedShiftId,
        workerNames: event.workerNames,
      });
      const matchedCount = wrk.assignmentIds.filter(Boolean).length;
      const note = wrk.unmatched.length
        ? `${matchedCount}/${event.workerNames.length} workers matched; unmatched: ${wrk.unmatched.join(', ')}`
        : `all ${matchedCount} worker(s) matched`;
      return {
        ...fallback,
        matchedAssignmentIds: wrk.assignmentIds,
        matchNotes: [fallback.matchNotes, note].filter(Boolean).join(' | '),
      };
    }

    case 'no_show': {
      const byId = await matchByJobId(reader, {
        tenantId,
        jobId: event.jobId,
        workDate: event.workDate,
      });
      if (!byId.matchedShiftId) return byId;
      const wrk = await matchWorkerAssignments(reader, {
        tenantId,
        shiftId: byId.matchedShiftId,
        workerNames: [event.workerName],
      });
      return {
        ...byId,
        matchedAssignmentIds: wrk.assignmentIds,
        matchNotes:
          wrk.unmatched.length > 0
            ? `worker '${event.workerName}' not on the shift's assignment list`
            : byId.matchNotes,
      };
    }

    case 'daily_digest_expired': {
      // Run per-job lookups. Return the FIRST resolved JO id + a
      // summary note. The full list of expired jobs stays on the
      // event payload for the recruiter to fan out from the UI.
      let firstHit: MatchResult | null = null;
      let hits = 0;
      for (const j of event.expiredJobs) {
        if (!j.jobId) continue;
        const r = await matchByJobId(reader, {
          tenantId,
          jobId: j.jobId,
        });
        if (r.matchedJobOrderId) {
          hits++;
          if (!firstHit) firstHit = r;
        }
      }
      if (!firstHit) {
        return {
          matchConfidence: 'none',
          matchNotes: `digest: 0/${event.expiredJobs.length} job ids resolved`,
        };
      }
      return {
        ...firstHit,
        matchConfidence: 'multiple',
        matchNotes: `digest: ${hits}/${event.expiredJobs.length} job ids resolved; see event.expiredJobs for full list`,
      };
    }
  }
}
