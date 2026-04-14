/**
 * Gig job orders: auto-toggle between `open` and `on_hold` from shift calendar dates.
 * - If every non-cancelled shift occurrence is before today (UTC calendar), set `on_hold` when status was `open`.
 * - If any occurrence is today or later, set `open` when status was `on_hold`.
 * Other statuses (draft, cancelled, filled, completed) are left unchanged.
 */
import * as admin from 'firebase-admin';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import type { Firestore } from 'firebase-admin/firestore';

const db = admin.firestore() as Firestore;

function assertTenantStaff(auth: { uid: string; token: Record<string, unknown> } | undefined, tenantId: string): void {
  if (!auth) throw new HttpsError('unauthenticated', 'Authentication required');
  if (auth.token.hrx === true) return;
  const roles = auth.token.roles as Record<string, { role?: string }> | undefined;
  const role = roles?.[tenantId]?.role;
  if (role && ['Recruiter', 'Manager', 'Admin'].includes(role)) return;
  throw new HttpsError('permission-denied', 'Recruiter or Manager access required for this tenant');
}

function utcTodayYyyyMmDd(): string {
  const n = new Date();
  const y = n.getUTCFullYear();
  const m = String(n.getUTCMonth() + 1).padStart(2, '0');
  const d = String(n.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function normalizeYyyyMmDd(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'string') {
    const iso = v.split('T')[0];
    return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : null;
  }
  if (typeof (v as { toDate?: () => Date }).toDate === 'function') {
    const d = (v as admin.firestore.Timestamp).toDate();
    if (Number.isNaN(d.getTime())) return null;
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  return null;
}

function dateHasHours(entry: { startTime?: string; endTime?: string } | null | undefined): boolean {
  if (!entry) return false;
  const s = (entry.startTime || '').trim();
  const e = (entry.endTime || '').trim();
  return s.length > 0 && e.length > 0;
}

function getDateRange(startISO: string, endISO: string): string[] {
  const [ys, ms, ds] = startISO.split('-').map(Number);
  const [ye, me, de] = endISO.split('-').map(Number);
  const start = Date.UTC(ys, ms - 1, ds);
  const end = Date.UTC(ye, me - 1, de);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return [];
  const out: string[] = [];
  for (let t = start; t <= end; t += 86400000) {
    const d = new Date(t);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    out.push(`${y}-${m}-${day}`);
  }
  return out;
}

/** Calendar occurrence dates (YYYY-MM-DD) for one shift doc; skips cancelled shifts. */
export function collectGigShiftOccurrenceDates(shift: Record<string, unknown>): string[] {
  const st = shift.status;
  if (st === 'cancelled' || st === 'canceled') return [];

  const shiftMode = shift.shiftMode;
  const shiftDate = normalizeYyyyMmDd(shift.shiftDate);
  const endDate = shift.endDate != null ? normalizeYyyyMmDd(shift.endDate) : null;

  if (shiftMode === 'multi' && shiftDate && endDate && endDate >= shiftDate) {
    const ds = shift.dateSchedule as Record<string, { startTime?: string; endTime?: string }> | undefined;
    const out: string[] = [];
    if (ds && typeof ds === 'object') {
      const range = getDateRange(shiftDate, endDate);
      for (const iso of range) {
        if (dateHasHours(ds[iso])) out.push(iso);
      }
    }
    if (out.length > 0) return out;
    if (shiftDate) return [shiftDate];
    return [];
  }

  if (shiftDate) return [shiftDate];
  return [];
}

export type GigStatusSyncResult = {
  ok: boolean;
  updated: boolean;
  newStatus?: string;
  reason: string;
  maxShiftDate?: string | null;
  today?: string;
};

export async function recomputeGigJobOrderStatusFromShifts(
  firestore: Firestore,
  tenantId: string,
  jobOrderId: string,
): Promise<GigStatusSyncResult> {
  const today = utcTodayYyyyMmDd();
  const joRef = firestore.doc(`tenants/${tenantId}/job_orders/${jobOrderId}`);
  const joSnap = await joRef.get();
  if (!joSnap.exists) {
    return { ok: true, updated: false, reason: 'no_job_order', maxShiftDate: null, today };
  }
  const jo = joSnap.data() as Record<string, unknown>;
  if (jo.jobType !== 'gig') {
    return { ok: true, updated: false, reason: 'not_gig', maxShiftDate: null, today };
  }

  const status = typeof jo.status === 'string' ? jo.status : '';
  if (!['open', 'on_hold'].includes(status)) {
    return { ok: true, updated: false, reason: 'status_not_auto_managed', maxShiftDate: null, today };
  }

  const shiftsSnap = await joRef.collection('shifts').get();
  if (shiftsSnap.empty) {
    return { ok: true, updated: false, reason: 'no_shifts', maxShiftDate: null, today };
  }

  let maxDate: string | null = null;
  for (const d of shiftsSnap.docs) {
    const shift = d.data() as Record<string, unknown>;
    for (const iso of collectGigShiftOccurrenceDates(shift)) {
      if (!maxDate || iso > maxDate) maxDate = iso;
    }
  }

  if (maxDate == null) {
    if (status === 'open') {
      await joRef.update({
        status: 'on_hold',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return { ok: true, updated: true, newStatus: 'on_hold', reason: 'no_active_shift_dates', maxShiftDate: null, today };
    }
    return { ok: true, updated: false, reason: 'already_on_hold_no_dates', maxShiftDate: null, today };
  }

  const hasTodayOrFuture = maxDate >= today;

  if (hasTodayOrFuture && status === 'on_hold') {
    await joRef.update({
      status: 'open',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return { ok: true, updated: true, newStatus: 'open', reason: 'has_upcoming_or_today_shift', maxShiftDate: maxDate, today };
  }

  if (!hasTodayOrFuture && status === 'open') {
    await joRef.update({
      status: 'on_hold',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return { ok: true, updated: true, newStatus: 'on_hold', reason: 'all_shifts_in_past', maxShiftDate: maxDate, today };
  }

  return { ok: true, updated: false, reason: 'no_change', maxShiftDate: maxDate, today };
}

export const onGigJobOrderShiftWritten = onDocumentWritten(
  {
    document: 'tenants/{tenantId}/job_orders/{jobOrderId}/shifts/{shiftId}',
    region: 'us-central1',
    memory: '256MiB',
    timeoutSeconds: 60,
  },
  async (event) => {
    const tenantId = event.params.tenantId as string;
    const jobOrderId = event.params.jobOrderId as string;
    try {
      await recomputeGigJobOrderStatusFromShifts(db, tenantId, jobOrderId);
    } catch (e) {
      console.error('onGigJobOrderShiftWritten', { tenantId, jobOrderId, err: e });
    }
  },
);

export const syncGigJobOrderStatusFromShifts = onCall(
  {
    region: 'us-central1',
    memory: '256MiB',
    timeoutSeconds: 60,
  },
  async (request) => {
    const { tenantId, jobOrderId } = (request.data || {}) as { tenantId?: string; jobOrderId?: string };
    if (!tenantId?.trim() || !jobOrderId?.trim()) {
      throw new HttpsError('invalid-argument', 'tenantId and jobOrderId are required');
    }
    assertTenantStaff(request.auth as { uid: string; token: Record<string, unknown> }, tenantId);
    return recomputeGigJobOrderStatusFromShifts(db, tenantId.trim(), jobOrderId.trim());
  },
);
