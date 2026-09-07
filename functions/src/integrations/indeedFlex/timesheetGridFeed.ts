/**
 * Indeed Flex clock punches → the HRX Timesheet Grid (2026-09-07, Greg:
 * "when workers clock in, their in-times should be entered in their
 * timesheet grid row, then their clock-outs at the end of the day").
 *
 * Input is the timesheet ingest's per-entry verdicts that resolved to an
 * HRX assignment. For each one we get-or-create the grid row
 * (`timesheet_entries/{assignmentId}_{workDate}` via the same core the
 * recruiter grid uses) and write the punch times into `actualStartTime` /
 * `actualEndTime` (HH:mm worksite-local — the Flex ISO strings embed the
 * venue offset, so the wall time is a substring read) plus the unpaid break.
 *
 * Guardrails:
 *   - only `draft` rows are touched (approved / sent_to_everee / paid: skip);
 *   - a field is written only when it is empty OR still equals the value we
 *     last applied from Flex (`flexPunch.applied.*`) — a recruiter's hand
 *     edit is never overwritten, a later Flex correction replaces only ours;
 *   - `actualHoursOverride` is never set — hours derive from the times;
 *   - days the assignment isn't scheduled for are reported, not forced.
 *
 * Also stamps the assignment's cadence state `checked_in` from a real
 * clock-in (the attendance signal the muted no-show probe was waiting for).
 */
import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';
import { createDraftTimesheetEntryCore, DraftEntryError } from '../../timesheets/createDraftTimesheetEntryCallable';

const SYSTEM_ACTOR = 'system_indeed_flex_timesheets';

export interface FlexPunchInput {
  tenantId: string;
  assignmentId: string;
  userId: string;
  workDate: string;
  flexEntryId: string;
  /** ISO with venue-local offset, e.g. 2026-09-05T10:02:00-06:00 */
  clockIn: string | null;
  clockOut: string | null;
  breakSeconds: number | null;
  breakPaid: boolean | null;
  flexStatus: string | null;
}

export interface GridFeedSummary {
  considered: number;
  created: number;
  updated: number;
  unchanged: number;
  skippedLocked: number;
  skippedManual: number;
  notScheduled: number;
  errors: number;
  checkIns: number;
}

/** Wall-clock HH:mm from an ISO string that carries its own UTC offset. */
export function hhmmFromOffsetIso(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const m = /^\d{4}-\d{2}-\d{2}T(\d{2}):(\d{2})/.exec(iso);
  return m ? `${m[1]}:${m[2]}` : null;
}

export interface PunchFieldPlan {
  actualStartTime?: string;
  actualEndTime?: string;
  breakMinutes?: number;
  skippedManual: string[];
}

/**
 * Decide which fields to write. `current` is the entry as stored; `applied`
 * is what we wrote from Flex last time (undefined on first sync).
 */
export function planPunchFields(
  current: { actualStartTime?: unknown; actualEndTime?: unknown; flexBreakMinutes?: unknown },
  applied: { actualStartTime?: string; actualEndTime?: string; breakMinutes?: number } | undefined,
  next: { actualStartTime: string | null; actualEndTime: string | null; breakMinutes: number | null },
): PunchFieldPlan {
  const plan: PunchFieldPlan = { skippedManual: [] };
  const ours = (field: 'actualStartTime' | 'actualEndTime', cur: unknown): boolean => {
    if (cur === undefined || cur === null || cur === '') return true;
    return applied?.[field] !== undefined && applied[field] === cur;
  };
  if (next.actualStartTime) {
    if (ours('actualStartTime', current.actualStartTime)) {
      if (current.actualStartTime !== next.actualStartTime) plan.actualStartTime = next.actualStartTime;
    } else plan.skippedManual.push('actualStartTime');
  }
  if (next.actualEndTime) {
    if (ours('actualEndTime', current.actualEndTime)) {
      if (current.actualEndTime !== next.actualEndTime) plan.actualEndTime = next.actualEndTime;
    } else plan.skippedManual.push('actualEndTime');
  }
  if (next.breakMinutes !== null && next.breakMinutes !== current.flexBreakMinutes) plan.breakMinutes = next.breakMinutes;
  return plan;
}

export async function applyFlexPunchesToGrid(
  db: admin.firestore.Firestore,
  punches: FlexPunchInput[],
): Promise<GridFeedSummary> {
  const summary: GridFeedSummary = {
    considered: 0,
    created: 0,
    updated: 0,
    unchanged: 0,
    skippedLocked: 0,
    skippedManual: 0,
    notScheduled: 0,
    errors: 0,
    checkIns: 0,
  };
  const now = admin.firestore.FieldValue.serverTimestamp();

  for (const p of punches) {
    if (!p.clockIn && !p.clockOut) continue; // nothing punched yet — the scheduled row is enough
    if (/cancel|declined|no.?show/i.test(p.flexStatus ?? '')) continue;
    summary.considered += 1;
    const entryId = `${p.assignmentId}_${p.workDate}`;
    const entryRef = db.doc(`tenants/${p.tenantId}/timesheet_entries/${entryId}`);
    try {
      // 1. Get-or-create the grid row through the canonical core.
      let snap = await entryRef.get();
      if (!snap.exists) {
        try {
          const r = await createDraftTimesheetEntryCore({ tenantId: p.tenantId, assignmentId: p.assignmentId, workDate: p.workDate }, SYSTEM_ACTOR);
          if (r.created) summary.created += 1;
          snap = await entryRef.get();
        } catch (err) {
          if (err instanceof DraftEntryError) {
            summary.notScheduled += 1;
            logger.info('[flexGridFeed] row not created', { entryId, code: err.code, reason: err.message });
            continue;
          }
          throw err;
        }
      }
      const entry = (snap.data() ?? {}) as Record<string, unknown>;
      const status = String(entry.status ?? 'draft');
      if (status !== 'draft') {
        summary.skippedLocked += 1;
        continue;
      }

      // 2. Plan the field writes under the overwrite rules.
      const flexPunch = (entry.flexPunch ?? {}) as { applied?: { actualStartTime?: string; actualEndTime?: string; breakMinutes?: number } };
      const unpaidBreakMinutes = p.breakPaid === false && p.breakSeconds ? Math.round(p.breakSeconds / 60) : p.breakSeconds === 0 ? 0 : null;
      const plan = planPunchFields(
        { actualStartTime: entry.actualStartTime, actualEndTime: entry.actualEndTime, flexBreakMinutes: flexPunch.applied?.breakMinutes },
        flexPunch.applied,
        { actualStartTime: hhmmFromOffsetIso(p.clockIn), actualEndTime: hhmmFromOffsetIso(p.clockOut), breakMinutes: unpaidBreakMinutes },
      );
      if (plan.skippedManual.length) summary.skippedManual += 1;

      const update: Record<string, unknown> = {};
      const applied = { ...(flexPunch.applied ?? {}) };
      if (plan.actualStartTime) {
        update.actualStartTime = plan.actualStartTime;
        applied.actualStartTime = plan.actualStartTime;
      }
      if (plan.actualEndTime) {
        update.actualEndTime = plan.actualEndTime;
        applied.actualEndTime = plan.actualEndTime;
      }
      if (plan.breakMinutes !== undefined) {
        // One unpaid break of Flex's reported length. Only touch `breaks`
        // when it is empty or entirely ours (a single flex-sourced break).
        const breaks = Array.isArray(entry.breaks) ? (entry.breaks as Array<Record<string, unknown>>) : [];
        const allOurs = breaks.every((b) => b.source === 'indeed_flex');
        if (allOurs) {
          update.breaks = plan.breakMinutes > 0 ? [{ startTime: '', endTime: '', durationMins: plan.breakMinutes, paid: false, source: 'indeed_flex' }] : [];
          applied.breakMinutes = plan.breakMinutes;
        }
      }
      const changed = Object.keys(update).length > 0;
      update.flexPunch = {
        flexEntryId: p.flexEntryId,
        clockIn: p.clockIn,
        clockOut: p.clockOut,
        breakSeconds: p.breakSeconds,
        breakPaid: p.breakPaid,
        flexStatus: p.flexStatus,
        applied,
        syncedAt: now,
      };
      if (changed) {
        update.updatedBy = SYSTEM_ACTOR;
        update.updatedAt = now;
        summary.updated += 1;
      } else {
        summary.unchanged += 1;
      }
      await entryRef.set(update, { merge: true });

      // 3. A real clock-in is the attendance signal the cadence lacked.
      if (p.clockIn) {
        const stamped = await stampCheckInFromPunch(db, p);
        if (stamped) summary.checkIns += 1;
      }
    } catch (err) {
      summary.errors += 1;
      logger.warn('[flexGridFeed] entry failed', { entryId, err: err instanceof Error ? err.message : String(err) });
    }
  }
  return summary;
}

/**
 * Flip `cortConfirmation.state` to checked_in when a clock-in exists and the
 * cadence still thinks the worker is pending/confirmed (or has no state).
 * Never downgrades cancelled/no_show/checked_in. Returns true when written.
 */
export async function stampCheckInFromPunch(db: admin.firestore.Firestore, p: FlexPunchInput): Promise<boolean> {
  const ref = db.doc(`tenants/${p.tenantId}/assignments/${p.assignmentId}`);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return false;
    const conf = (snap.get('cortConfirmation') ?? {}) as { state?: string };
    const state = String(conf.state ?? '');
    if (state === 'checked_in' || state === 'cancelled' || state === 'no_show') return false;
    const now = admin.firestore.FieldValue.serverTimestamp();
    tx.set(
      ref,
      {
        cortConfirmation: {
          state: 'checked_in',
          checkedInAt: now,
          updatedAt: now,
          checkedInVia: { channel: 'indeed_flex_timesheet', clockIn: p.clockIn, flexEntryId: p.flexEntryId, workDate: p.workDate },
        },
      },
      { merge: true },
    );
    return true;
  });
}
