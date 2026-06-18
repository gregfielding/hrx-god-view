/**
 * openShiftFromJobOrder — shared helper that derives a standing "open shift"
 * doc from a Job Order and idempotently creates it under the JO's `shifts`
 * subcollection.
 *
 * Used by:
 *  - `onJobOrderCreatedOpenShift` (trigger): one open shift per new JO,
 *    start date = creation date.
 *  - `backfillOpenShifts` (callable): one open shift per existing eligible JO.
 *
 * The doc shape mirrors what `EditShiftForm` writes for a manually-created
 * open shift (`shiftType:'open'`, `noFixedTimes`, `hideFromJobsBoard`,
 * `shiftMode:'single'`, empty times, no `endDate`/`weeklySchedule`/
 * `dateSchedule`, position pricing snapshot) so generated shifts behave
 * identically in PlacementsTab, placementsApi, and the timesheet grid
 * resolver. See memory: open-shift-feature-design-decisions.
 */

import * as admin from 'firebase-admin';

type Firestore = admin.firestore.Firestore;
type JobOrderData = Record<string, any>;

/** Calendar date (YYYY-MM-DD) in UTC — matches the tz-naive date strings the
 *  shift queries compare against (mirrors gigJobOrderStatusCron.todayUtcIso). */
export function todayUtcIso(now: Date = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** JO statuses that are terminal — never auto-create an open shift for these. */
const TERMINAL_STATUSES = new Set(['cancelled', 'canceled', 'completed', 'closed']);
/** JO statuses that count as "active/open" for the backfill (drafts excluded). */
const ACTIVE_STATUSES = new Set([
  'open',
  'on_hold',
  'partially_filled',
  'interviewing',
  'offer',
  'filled',
]);

export function isTerminalJobOrderStatus(status: unknown): boolean {
  return TERMINAL_STATUSES.has(String(status ?? '').trim().toLowerCase());
}

export function isActiveJobOrderStatus(status: unknown): boolean {
  return ACTIVE_STATUSES.has(String(status ?? '').trim().toLowerCase());
}

export function isGigJobOrder(jobOrder: JobOrderData): boolean {
  return String(jobOrder?.jobType ?? '').trim().toLowerCase() === 'gig';
}

/** Which JO types auto-created open shifts apply to. */
export type OpenShiftJobTypeScope = 'gig' | 'career' | 'all';

/**
 * Default scope: **gig JOs only** (Greg, 2026-06-17). Open shifts model a
 * standing crew at a worksite where the client manages the schedule and just
 * sends weekly hours — which in C1's world is the gig/event staffing JOs
 * (Indeed Flex, VenueSmart, etc.), the same clients the CSV timesheet
 * importer serves. Career JOs use ordinary scheduled shifts.
 */
export const OPEN_SHIFT_JOB_TYPE_SCOPE_DEFAULT: OpenShiftJobTypeScope = 'gig';

/** Whether a JO matches the configured job-type scope. */
export function matchesOpenShiftJobTypeScope(
  jobOrder: JobOrderData,
  scope: OpenShiftJobTypeScope,
): boolean {
  if (scope === 'all') return true;
  const gig = isGigJobOrder(jobOrder);
  return scope === 'gig' ? gig : !gig;
}

/** Crew size = JO headcount (workersNeeded → headcountRequested), fallback 1. */
export function jobOrderCrewSize(jobOrder: JobOrderData): number {
  const wn = Number(jobOrder?.workersNeeded);
  const hc = Number(jobOrder?.headcountRequested);
  const n = Number.isFinite(wn) && wn > 0 ? wn : Number.isFinite(hc) && hc > 0 ? hc : 1;
  return Math.max(1, Math.floor(n));
}

const SNAPSHOT_KEYS = [
  'payRate',
  'billRate',
  'markupPercent',
  'workersCompCode',
  'workersCompRate',
  'sutaRate',
  'futaRate',
] as const;

/**
 * Resolve a single position's pricing from the JO — match the position whose
 * jobTitle equals the JO's own jobTitle (falling back to the first position),
 * then fall back to the JO's top-level fields. Mirrors the resolution
 * placementsApi uses at placement time. Only defined values are returned
 * (Firestore rejects `undefined`).
 */
export function resolveJobOrderPricingSnapshot(
  jobOrder: JobOrderData,
): Record<string, number | string> {
  const num = (v: unknown): number | undefined => {
    if (v == null || String(v).trim() === '') return undefined;
    const n = Number.parseFloat(String(v));
    return Number.isFinite(n) ? n : undefined;
  };
  const str = (v: unknown): string | undefined => {
    const s = String(v ?? '').trim();
    return s || undefined;
  };
  const title = String(jobOrder?.jobTitle ?? '').trim().toLowerCase();
  const positions: JobOrderData[] =
    Array.isArray(jobOrder?.positions) && jobOrder.positions.length
      ? jobOrder.positions
      : Array.isArray(jobOrder?.gigPositions)
        ? jobOrder.gigPositions
        : [];
  const matched =
    (title
      ? positions.find((p) => String(p?.jobTitle ?? '').trim().toLowerCase() === title)
      : undefined) ??
    positions[0] ??
    {};

  const pick = (k: string): number | string | undefined => {
    if (k === 'workersCompCode') {
      return (
        str(matched?.workersCompCode) ??
        str(matched?.workersCompClassCode) ??
        str(jobOrder?.workersCompCode) ??
        str(jobOrder?.workersCompClassCode)
      );
    }
    return num((matched as any)?.[k]) ?? num((jobOrder as any)?.[k]);
  };

  const out: Record<string, number | string> = {};
  for (const k of SNAPSHOT_KEYS) {
    const v = pick(k);
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/** Build the open-shift doc (no id) from a JO. */
export function buildOpenShiftDoc(
  jobOrder: JobOrderData,
  opts: { tenantId: string; jobOrderId: string; startDate: string; createdBy?: string },
): Record<string, unknown> {
  const { tenantId, jobOrderId, startDate, createdBy } = opts;
  const jobTitle = String(jobOrder?.jobTitle ?? '').trim();
  const ts = admin.firestore.FieldValue.serverTimestamp();
  return {
    shiftTitle: jobTitle ? `${jobTitle} — Open Shift` : 'Open Shift',
    status: 'open',
    defaultJobTitle: jobTitle,
    totalStaffRequested: jobOrderCrewSize(jobOrder),
    overstaffCount: 0,
    showStaffNeeded: jobOrder?.showWorkersNeeded === true,
    poNumber: String(jobOrder?.poNumber ?? '').trim(),
    shiftDate: startDate,
    defaultStartTime: '',
    defaultEndTime: '',
    shiftDescription: '',
    emailIntro: '',
    clockInUrl: '',
    sendNotification: false,
    tenantId,
    jobOrderId,
    ...resolveJobOrderPricingSnapshot(jobOrder),
    // Open-shift markers (mirror EditShiftForm's open-shift write path).
    shiftType: 'open',
    noFixedTimes: true,
    hideFromJobsBoard: true,
    shiftMode: 'single',
    // Provenance — distinguishes auto-generated open shifts from hand-made ones.
    autoCreatedOpenShift: true,
    createdAt: ts,
    updatedAt: ts,
    createdBy: createdBy || 'system:openShiftAutoCreate',
    // No endDate (ongoing), no weeklySchedule/dateSchedule.
  };
}

export interface EnsureOpenShiftResult {
  outcome: 'created' | 'would_create' | 'already_exists';
  shiftId: string | null;
}

/**
 * Idempotently create an open shift for a JO. Skips if the JO already has any
 * `shiftType:'open'` shift (manual or auto). The caller is responsible for
 * eligibility (status / job type) — see `isOpenShiftBackfillEligible`.
 */
export async function ensureOpenShiftForJobOrder(
  db: Firestore,
  opts: {
    tenantId: string;
    jobOrderId: string;
    jobOrder: JobOrderData;
    startDate: string;
    createdBy?: string;
    dryRun?: boolean;
  },
): Promise<EnsureOpenShiftResult> {
  const { tenantId, jobOrderId, jobOrder, startDate, createdBy, dryRun } = opts;
  const shiftsRef = db
    .collection('tenants')
    .doc(tenantId)
    .collection('job_orders')
    .doc(jobOrderId)
    .collection('shifts');

  const existing = await shiftsRef.where('shiftType', '==', 'open').limit(1).get();
  if (!existing.empty) {
    return { outcome: 'already_exists', shiftId: existing.docs[0].id };
  }
  if (dryRun) {
    return { outcome: 'would_create', shiftId: null };
  }
  const doc = buildOpenShiftDoc(jobOrder, { tenantId, jobOrderId, startDate, createdBy });
  const ref = await shiftsRef.add(doc);
  return { outcome: 'created', shiftId: ref.id };
}

/**
 * Backfill eligibility for an existing JO: active (non-draft, non-terminal)
 * status, and matching the configured job-type scope (gig-only by default).
 */
export function isOpenShiftBackfillEligible(
  jobOrder: JobOrderData,
  opts: { scope: OpenShiftJobTypeScope },
): { eligible: boolean; reason: string } {
  const status = String(jobOrder?.status ?? '').trim().toLowerCase() || '(none)';
  if (!isActiveJobOrderStatus(status)) return { eligible: false, reason: `status:${status}` };
  if (!matchesOpenShiftJobTypeScope(jobOrder, opts.scope)) {
    return { eligible: false, reason: `jobType:${String(jobOrder?.jobType ?? '(none)').toLowerCase()}` };
  }
  return { eligible: true, reason: 'eligible' };
}

/**
 * Trigger eligibility for a newly-created JO: any non-terminal JO (drafts
 * included, since most JOs are created as drafts then activated) matching the
 * configured job-type scope (gig-only by default).
 */
export function isOpenShiftTriggerEligible(
  jobOrder: JobOrderData,
  opts: { scope: OpenShiftJobTypeScope },
): { eligible: boolean; reason: string } {
  if (isTerminalJobOrderStatus(jobOrder?.status)) {
    return { eligible: false, reason: `status:${String(jobOrder?.status ?? '').toLowerCase()}` };
  }
  if (!matchesOpenShiftJobTypeScope(jobOrder, opts.scope)) {
    return { eligible: false, reason: `jobType:${String(jobOrder?.jobType ?? '(none)').toLowerCase()}` };
  }
  return { eligible: true, reason: 'eligible' };
}
