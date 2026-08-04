/**
 * **extendJobOrderEndDate — the JO endDate follows its shifts, automatically.**
 *
 * Greg (2026-08-03): the jobs board now derives gig card date ranges from the
 * JO's own endDate (the per-card shifts fetch was the mobile perf killer), so
 * a shift added past the JO endDate would understate the card range. Rather
 * than special-case the board, materialize the truth: whenever a shift is
 * created or edited, extend the parent JO's endDate to cover that shift's
 * last calendar day. Overnight shifts (end time earlier than start time) get
 * +1 day since the work truly ends the next calendar day.
 *
 * Extend-only: endDate never shrinks here — deleting/shortening shifts leaves
 * the JO end as a human decision (same philosophy as the never-auto-end rule
 * for engagements). No trigger loop: we write the JO doc, we listen on shifts.
 */
import * as admin from 'firebase-admin';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions/v2';

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

/** yyyy-mm-dd from a string date or Firestore Timestamp; null otherwise. */
function toDay(v: unknown): string | null {
  if (typeof v === 'string') {
    const m = v.match(/\d{4}-\d{2}-\d{2}/);
    return m ? m[0] : null;
  }
  const ts = v as { toDate?: () => Date } | null;
  if (ts && typeof ts.toDate === 'function') return ts.toDate().toISOString().slice(0, 10);
  return null;
}

/** Last calendar day a shift covers, overnight-aware. */
export function shiftLastDay(shift: Record<string, unknown>): string | null {
  const days: string[] = [];
  const sched = shift.dateSchedule as Record<string, { endTime?: string; startTime?: string }> | undefined;
  if (sched && typeof sched === 'object') {
    days.push(...Object.keys(sched).filter((k) => DAY_RE.test(k)));
  }
  for (const f of ['endDate', 'shiftDate', 'startDate']) {
    const d = toDay(shift[f]);
    if (d) days.push(d);
  }
  if (days.length === 0) return null;
  const last = days.sort()[days.length - 1];

  // Overnight detection on the last day: end time before start time means the
  // shift spills into the NEXT calendar day.
  const daySched = sched?.[last];
  const start = String(daySched?.startTime ?? shift.defaultStartTime ?? shift.startTime ?? '');
  const end = String(daySched?.endTime ?? shift.defaultEndTime ?? shift.endTime ?? '');
  if (start && end && end < start) return addDays(last, 1);
  return last;
}

export const extendJobOrderEndDateOnShiftWrite = onDocumentWritten(
  {
    document: 'tenants/{tenantId}/job_orders/{jobOrderId}/shifts/{shiftId}',
    memory: '512MiB',
  },
  async (event) => {
    const after = event.data?.after;
    if (!after?.exists) return; // deletes never shrink the JO window
    const shift = after.data() as Record<string, unknown>;
    const lastDay = shiftLastDay(shift);
    if (!lastDay) return;

    const { tenantId, jobOrderId } = event.params;
    const joRef = db.doc(`tenants/${tenantId}/job_orders/${jobOrderId}`);
    const joSnap = await joRef.get();
    if (!joSnap.exists) return;
    const jo = joSnap.data() as Record<string, unknown>;
    const currentEnd = toDay(jo.endDate);
    if (currentEnd && currentEnd >= lastDay) return; // already covers it

    // Preserve the stored type: Timestamp JOs keep Timestamps (UTC noon,
    // matching the codebase's tz-safe convention), string/missing get the
    // plain yyyy-mm-dd string.
    const wasTimestamp = !!(jo.endDate as { toDate?: unknown } | null)?.toDate;
    const newEnd = wasTimestamp
      ? admin.firestore.Timestamp.fromDate(new Date(`${lastDay}T12:00:00Z`))
      : lastDay;

    await joRef.update({
      endDate: newEnd,
      endDateExtendedBy: 'extendJobOrderEndDateOnShiftWrite',
      endDateExtendedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    logger.info('[extendJobOrderEndDate] extended', {
      tenantId,
      jobOrderId,
      from: currentEnd ?? '(none)',
      to: lastDay,
      shiftId: event.params.shiftId,
    });
  },
);
