/**
 * indeedFlexApplyShiftRequest — Phase 1b of the scheduling review: the
 * first real APPLY path for the Indeed Flex feed (which until now was a
 * dry-run observability inbox — detection without action).
 *
 * v1 scope: `cancel_booking` rows. The matcher already resolves the
 * email's workerNames[] to live assignment ids (`matchedAssignmentIds`);
 * this callable executes the removal in HRX:
 *   1. status → 'cancelled' first (fires the standard worker push/SMS
 *      cascade via onAssignmentUpdatedPush — worker sees the same
 *      cancellation they'd get from a manual removal), then
 *   2. hard-DELETE the assignment doc — required because the timesheet
 *      grid treats presence as payable; this mirrors
 *      placementsCancelAssignment's delete-after-flip pattern.
 *      (We deliberately skip that path's placement/application revert:
 *      a portal-cancelled worker isn't going back to "Placed" — the
 *      booking is gone at the source.)
 *   3. Stamp the request row applied (appliedAt/appliedBy/appliedResult)
 *      so the feed shows it as handled and re-applies are no-ops.
 *
 * Other event types (new_request / change_headcount / change_time) return
 * failed-precondition for now — they land in later Phase 1 slices.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import * as admin from 'firebase-admin';
import { canManageAssignments } from '../../placementsApi';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

/**
 * Shared apply core — the recruiter's "Apply in HRX" button and the
 * nightly AI triage cron both execute portal rows through here. The
 * CALLER is responsible for authorization; `actor` is stamped as
 * appliedBy/canceledBy for the audit trail (uid or 'ai_triage_nightly').
 * Throws HttpsError on precondition failures; the cron catches per-row.
 */
export async function applyShiftRequestCore(
  tenantId: string,
  requestId: string,
  actor: string,
): Promise<Record<string, unknown>> {
    const rowRef = db.doc(`tenants/${tenantId}/external_shift_requests/${requestId}`);
    const rowSnap = await rowRef.get();
    if (!rowSnap.exists) throw new HttpsError('not-found', 'Shift request not found');
    const row = rowSnap.data() || {};

    const eventType = String(row.eventType ?? '');
    const rowStatus = String(row.status ?? '');
    if (rowStatus === 'applied') {
      return { ok: true, alreadyApplied: true, cancelled: 0, skipped: [] };
    }
    // Only rows still awaiting a decision may be applied — a recruiter's
    // 'rejected' verdict must stand (review fix 2026-07-17).
    if (rowStatus !== 'needs_review') {
      throw new HttpsError(
        'failed-precondition',
        `Request is '${rowStatus}' — only needs_review rows can be applied.`,
      );
    }

    if (eventType === 'change_headcount' || eventType === 'change_time') {
      return applyShiftUpdate({ tenantId, rowRef, row, eventType, uid: actor });
    }
    if (eventType === 'new_request') {
      return applyNewRequest({ tenantId, rowRef, row, uid: actor });
    }
    if (eventType !== 'cancel_booking') {
      throw new HttpsError(
        'failed-precondition',
        `"${eventType}" can't be applied automatically — handle it manually and use Mark applied.`,
      );
    }

    const assignmentIds: string[] = Array.isArray(row.matchedAssignmentIds)
      ? (row.matchedAssignmentIds as unknown[]).map((v) => String(v)).filter(Boolean)
      : [];
    if (!assignmentIds.length) {
      throw new HttpsError(
        'failed-precondition',
        'No matched assignments on this request — match the workers first (or handle manually).',
      );
    }

    const cancelled: string[] = [];
    const skipped: Array<{ id: string; reason: string }> = [];

    for (const assignmentId of assignmentIds) {
      const aRef = db.doc(`tenants/${tenantId}/assignments/${assignmentId}`);
      const aSnap = await aRef.get();
      if (!aSnap.exists) {
        skipped.push({ id: assignmentId, reason: 'assignment no longer exists' });
        continue;
      }
      const a = aSnap.data() || {};
      const status = String(a.status ?? '').toLowerCase();
      if (/cancel|declined|completed|ended/.test(status)) {
        skipped.push({ id: assignmentId, reason: `already ${status}` });
        continue;
      }
      // Flip first so the standard cancellation notification fires…
      await aRef.update({
        status: 'cancelled',
        cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
        canceledBy: actor,
        cancellationReason: 'Indeed Flex booking removed (portal sync)',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      // …then hard-delete so no grid/live query can ever resurface it.
      await aRef.delete();
      cancelled.push(assignmentId);
    }

    await rowRef.update({
      status: 'applied',
      appliedAt: admin.firestore.FieldValue.serverTimestamp(),
      appliedBy: actor,
      appliedResult: {
        action: 'cancel_assignments',
        cancelledAssignmentIds: cancelled,
        skipped,
      },
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    logger.info('indeedFlexApplyShiftRequest applied', {
      tenantId, requestId, actor, cancelled: cancelled.length, skipped: skipped.length,
    });
    return {
      ok: true,
      alreadyApplied: false,
      cancelled: cancelled.length,
      skipped,
      summary: `Cancelled ${cancelled.length} assignment${cancelled.length === 1 ? '' : 's'}`,
    };
}

export const indeedFlexApplyShiftRequest = onCall(
  { region: 'us-central1', memory: '512MiB', timeoutSeconds: 120 },
  async (request) => {
    if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Sign in required');
    const tenantId = String(request.data?.tenantId ?? '').trim();
    const requestId = String(request.data?.requestId ?? '').trim();
    if (!tenantId || !requestId) {
      throw new HttpsError('invalid-argument', 'tenantId and requestId are required');
    }
    // Canonical recruiter gate — same one placementsCancelAssignment uses,
    // so the two cancel paths can never disagree on who is allowed
    // (review fix 2026-07-17; the hand-rolled copy ignored roles/isHRX).
    if (!(await canManageAssignments(request.auth, tenantId, request.auth.uid))) {
      throw new HttpsError('permission-denied', 'Applying shift requests requires assignment-management access.');
    }
    return applyShiftRequestCore(tenantId, requestId, request.auth.uid);
  },
);

// ─────────────────────────────────────────────────────────────────────
// change_headcount / change_time — update the matched shift in place
// ─────────────────────────────────────────────────────────────────────

interface ApplyCtx {
  tenantId: string;
  rowRef: FirebaseFirestore.DocumentReference;
  row: FirebaseFirestore.DocumentData;
  uid: string;
}

function eachDateInclusive(start: string, end: string, cap = 62): string[] {
  const out: string[] = [];
  const d = new Date(`${start}T00:00:00Z`);
  const e = new Date(`${end}T00:00:00Z`);
  while (d <= e && out.length < cap) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

async function stampApplied(
  ctx: ApplyCtx,
  appliedResult: Record<string, unknown>,
): Promise<void> {
  await ctx.rowRef.update({
    status: 'applied',
    appliedAt: admin.firestore.FieldValue.serverTimestamp(),
    appliedBy: ctx.uid,
    appliedResult,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

async function applyShiftUpdate(
  ctx: ApplyCtx & { eventType: 'change_headcount' | 'change_time' },
): Promise<Record<string, unknown>> {
  const { tenantId, row, eventType } = ctx;
  const joId = String(row.matchedJobOrderId ?? '').trim();
  const shiftId = String(row.matchedShiftId ?? '').trim();
  if (!joId || !shiftId) {
    throw new HttpsError(
      'failed-precondition',
      'No matched shift on this request — match it first (or handle manually).',
    );
  }
  const shiftRef = db.doc(`tenants/${tenantId}/job_orders/${joId}/shifts/${shiftId}`);
  const shiftSnap = await shiftRef.get();
  if (!shiftSnap.exists) throw new HttpsError('not-found', 'The matched shift no longer exists.');
  const shift = shiftSnap.data() || {};
  const event = (row.event ?? {}) as Record<string, unknown>;

  const patch: Record<string, unknown> = {
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedBy: ctx.uid,
    lastIndeedFlexApplyAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  // Dates the change applies to: the event's window when present,
  // otherwise every scheduled day on the shift.
  const dateSchedule =
    shift.dateSchedule && typeof shift.dateSchedule === 'object'
      ? { ...(shift.dateSchedule as Record<string, Record<string, unknown>>) }
      : null;
  const evStart = typeof event.workDate === 'string' ? event.workDate : null;
  const evEnd = typeof event.endDate === 'string' ? event.endDate : evStart;
  const targetDates =
    dateSchedule == null
      ? []
      : evStart
        ? eachDateInclusive(evStart, evEnd ?? evStart).filter((d) => dateSchedule[d])
        : Object.keys(dateSchedule);
  // Review fix 2026-07-19: if the email names a date the shift doesn't
  // have, refuse rather than "succeeding" with only the shift-level count
  // touched — the per-day workersNeeded (which drives coverage math)
  // would be unchanged while the row got stamped applied.
  if (dateSchedule != null && evStart && targetDates.length === 0) {
    throw new HttpsError(
      'failed-precondition',
      `The email's date (${evStart}) isn't on the matched shift — handle manually and use Mark applied.`,
    );
  }

  let summary: string;
  if (eventType === 'change_headcount') {
    const newHeadcount = Number(event.newHeadcount);
    if (!Number.isFinite(newHeadcount) || newHeadcount < 0) {
      throw new HttpsError('failed-precondition', 'The email did not carry a usable new headcount.');
    }
    patch.totalStaffRequested = newHeadcount;
    if (dateSchedule) {
      for (const d of targetDates) {
        dateSchedule[d] = { ...dateSchedule[d], workersNeeded: newHeadcount };
      }
      patch.dateSchedule = dateSchedule;
    }
    summary = `Headcount set to ${newHeadcount}`;
  } else {
    const newStart = typeof event.newStartTime === 'string' ? event.newStartTime : null;
    const newEnd = typeof event.newEndTime === 'string' ? event.newEndTime : null;
    if (!newStart && !newEnd) {
      throw new HttpsError('failed-precondition', 'The email did not carry a usable new time.');
    }
    if (newStart) patch.defaultStartTime = newStart;
    if (newEnd) patch.defaultEndTime = newEnd;
    if (dateSchedule) {
      for (const d of targetDates) {
        dateSchedule[d] = {
          ...dateSchedule[d],
          ...(newStart ? { startTime: newStart } : {}),
          ...(newEnd ? { endTime: newEnd } : {}),
        };
      }
      patch.dateSchedule = dateSchedule;
    }
    summary = `Time changed to ${newStart ?? shift.defaultStartTime ?? '?'}–${newEnd ?? shift.defaultEndTime ?? '?'}`;
  }

  await shiftRef.update(patch);
  await stampApplied(ctx, {
    action: eventType,
    jobOrderId: joId,
    shiftId,
    datesTouched: targetDates,
    summary,
  });
  logger.info('indeedFlexApplyShiftRequest shift update', { tenantId, shiftId, eventType, summary });
  return { ok: true, alreadyApplied: false, summary };
}

// ─────────────────────────────────────────────────────────────────────
// new_request — create the shift on the matched (inbox gig) job order
// ─────────────────────────────────────────────────────────────────────

async function applyNewRequest(ctx: ApplyCtx): Promise<Record<string, unknown>> {
  const { tenantId, row } = ctx;
  const joId = String(row.matchedJobOrderId ?? '').trim();
  if (!joId) {
    throw new HttpsError(
      'failed-precondition',
      'No matched job order for this venue yet — use "Link to account" first.',
    );
  }
  const event = (row.event ?? {}) as Record<string, unknown>;
  const workDate = typeof event.workDate === 'string' ? event.workDate : null;
  if (!workDate) {
    throw new HttpsError('failed-precondition', 'The email did not carry a usable shift date.');
  }
  const endDate = typeof event.endDate === 'string' ? event.endDate : workDate;
  const jobId = typeof event.jobId === 'string' ? event.jobId.trim() : '';
  const joRef = db.doc(`tenants/${tenantId}/job_orders/${joId}`);
  const joSnap = await joRef.get();
  if (!joSnap.exists) throw new HttpsError('not-found', 'The matched job order no longer exists.');

  const headcount = Number(event.headcount);
  const need = Number.isFinite(headcount) && headcount > 0 ? headcount : 1;
  const startTime = typeof event.startTime === 'string' ? event.startTime : '';
  const endTime = typeof event.endTime === 'string' ? event.endTime : '';
  const roleName = typeof event.roleName === 'string' ? event.roleName : '';
  const venueName = typeof event.venueName === 'string' ? event.venueName : '';

  // Idempotency on the Indeed Job ID: re-applying (or a second email for
  // the same order) must not mint a duplicate shift. When the email had
  // NO parseable Job ID (extractFields writes '' — real Indeed gap),
  // fall back to (same date + same role, previously auto-created) so a
  // re-sent ID-less email still can't double-mint (review fix 2026-07-19).
  if (jobId) {
    const dupes = await joRef.collection('shifts').where('poNumber', '==', jobId).limit(1).get();
    if (!dupes.empty) {
      await stampApplied(ctx, {
        action: 'new_request',
        jobOrderId: joId,
        shiftId: dupes.docs[0].id,
        summary: `Shift already exists for Indeed job ${jobId}`,
      });
      return { ok: true, alreadyApplied: true, summary: 'Shift already existed — nothing created' };
    }
  } else {
    const sameDay = await joRef.collection('shifts').where('shiftDate', '==', workDate).limit(25).get();
    const dupe = sameDay.docs.find((d) => {
      const s = d.data() as Record<string, unknown>;
      return (
        String(s.source ?? '') === 'indeed_flex_apply' &&
        String(s.defaultJobTitle ?? '').toLowerCase() === roleName.toLowerCase()
      );
    });
    if (dupe) {
      await stampApplied(ctx, {
        action: 'new_request',
        jobOrderId: joId,
        shiftId: dupe.id,
        summary: `A ${roleName || 'Flex'} shift for ${workDate} was already created from a previous email`,
      });
      return { ok: true, alreadyApplied: true, summary: 'Shift already existed — nothing created' };
    }
  }
  const payRate = Number(event.payRateUsd);

  const dateSchedule: Record<string, Record<string, unknown>> = {};
  for (const d of eachDateInclusive(workDate, endDate)) {
    dateSchedule[d] = { startTime, endTime, workersNeeded: need, overstaff: 0 };
  }

  const shiftDoc: Record<string, unknown> = {
    tenantId,
    jobOrderId: joId,
    status: 'open',
    shiftTitle: roleName ? `${roleName}${venueName ? ` — ${venueName}` : ''}` : venueName || 'Indeed Flex shift',
    defaultJobTitle: roleName,
    shiftDate: workDate,
    ...(endDate !== workDate ? { endDate } : {}),
    // shiftMode drives multi-day expansion in gigFinance/occurrence logic —
    // without it a 3-day dateSchedule bills as one day (review fix 2026-07-19).
    shiftMode: endDate !== workDate ? 'multi' : 'single',
    defaultStartTime: startTime,
    defaultEndTime: endTime,
    // Top-level times too — ShiftSelector's single-day fallback reads
    // shift.startTime, not defaultStartTime.
    ...(startTime ? { startTime } : {}),
    ...(endTime ? { endTime } : {}),
    dateSchedule,
    totalStaffRequested: need,
    ...(Number.isFinite(payRate) && payRate > 0 ? { payRate } : {}),
    ...(jobId ? { poNumber: jobId } : {}),
    sendNotification: false,
    showStaffNeeded: false,
    overstaffCount: 0,
    source: 'indeed_flex_apply',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    createdBy: ctx.uid,
  };
  const created = await joRef.collection('shifts').add(shiftDoc);
  const summary = `Shift created for ${workDate}${endDate !== workDate ? `–${endDate}` : ''} (${need} needed)`;
  await stampApplied(ctx, {
    action: 'new_request',
    jobOrderId: joId,
    shiftId: created.id,
    summary,
  });
  logger.info('indeedFlexApplyShiftRequest new shift', { tenantId, jobOrderId: joId, shiftId: created.id });
  return { ok: true, alreadyApplied: false, summary };
}
