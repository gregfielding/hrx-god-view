/**
 * submitImportTimesheetBatch — P4 of the CSV timesheet importer.
 *
 * Takes the "Ready" rows from the import grid (worker + pay rate + hours +
 * date, plus WC code + worksite for W-2) and submits them to Everee.
 *
 *   - 1099 (C1 Events, contractors): each row becomes a CONTRACTOR payable
 *     (gross = hours × pay rate). No worked-shift, no WC, no work-location.
 *     Idempotency: deterministic `externalId` per (tenant, customer+worker,
 *     workDate) — a re-submit targets the same payable rather than
 *     double-paying.
 *
 *   - W-2 (C1 Select, employees): each row becomes a worked shift on the
 *     Timesheets API. We send a synthetic shift window sized to the day's
 *     hours but DO NOT pre-classify regular/OT/DT — Everee's payroll engine
 *     computes daily + weekly overtime per state rules (an imported timesheet
 *     carries no clock detail, and Everee is the system of record). WC class
 *     code is required; worksite resolves to an Everee `workLocationId` via
 *     the cache. Idempotency is server-assigned: the returned `workedShiftId`
 *     is stored on the per-row status doc, and an already-submitted row is
 *     skipped to avoid duplicate shifts.
 *
 * Two modes for both paths:
 *   - dryRun: compose + return the exact preview WITHOUT calling Everee.
 *   - live: create the payables / worked shifts, write an audit batch doc +
 *     per-row status docs, return a summary.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

import { getEvereeConfigForEntity } from '../integrations/everee/evereeConfig';
import { canManageEveree } from '../integrations/everee/evereeAccessGate';
import {
  bulkCreatePayables,
  deletePayable,
  requestPayablePayout,
  type CreatePayableInput,
} from '../integrations/everee/evereePayables';
import { ensureEvereeWorkLocation } from '../integrations/everee/evereeWorkLocations';
import {
  createWorkedShift,
  deleteWorkedShift,
  type CreateWorkedShiftInput,
} from '../integrations/everee/evereeWorkedShifts';
import { importEntryDocId, importExternalId, payableStatusDocId } from './importEntryKeys';
import {
  classifyWeeklyOt,
  composeImportWindow,
  weekKeyFor,
} from './importWorkedShiftComposer';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

interface SubmitRow {
  /** HRX uid — Everee's externalWorkerId by convention. */
  userId: string;
  /** YYYY-MM-DD. */
  workDate: string;
  hours: number;
  payRate: number;
  /** Flat pay add-ons for the day (dollar amounts ≥ 0). Submitted as separate
   *  Everee TIPS / BONUS payables alongside the contractor payable / worked shift. */
  tips?: number;
  bonus?: number;
  /** For display/labeling only. */
  workerName?: string;
  /** The event/site this day belongs to (CSV "Type"/site). Used only to make
   *  the per-day pay-stub line legible (e.g. "Contractor pay — Railbird — Jun 7"). */
  eventLabel?: string | null;
  /** Real clock-in from the CSV ("6:56 AM" / "06:56"). When present (with a
   *  worksite state for TZ), the W-2 worked-shift window starts here instead
   *  of the noon-UTC synthetic. Pay stays anchored to `hours` either way. */
  clockIn?: string | null;
  /** Kept for audit/labeling — the window END is derived (start + net +
   *  unpaid break) so Everee's minute-floored validation can't reject it. */
  clockOut?: string | null;
  /** Break duration in minutes from the CSV (`Break duration`). Rendered as
   *  a real break on the Everee worked shift. */
  breakMinutes?: number;
  /** CSV `Paid break` — paid breaks count toward worked time. */
  paidBreak?: boolean;
  // ── W-2 only ──
  workersCompCode?: string | null;
  worksiteId?: string | null;
  worksiteName?: string | null;
  worksiteAddress?: { street?: string; city?: string; state?: string; zip?: string } | null;
}

/** A per-day pay-stub line label. Each imported row is one day, so this keeps
 *  the stub itemized by date rather than a single weekly lump. When `hours` is
 *  given (contractor payables, whose amount is a lump with no native hours
 *  breakdown on the Everee stub), it's appended as "… — 6.5 hrs" so the worker
 *  sees the hours behind each day's pay. */
function dayLabel(
  base: string,
  eventLabel: string | null | undefined,
  workDate: string,
  hours?: number | null,
): string {
  const hrs = Number(hours);
  const hrsLabel =
    Number.isFinite(hrs) && hrs > 0 ? `${Math.round(hrs * 100) / 100} hrs` : null;
  return [base, String(eventLabel || '').trim() || null, workDate, hrsLabel]
    .filter(Boolean)
    .join(' — ')
    .slice(0, 120);
}

interface ExtraPayable {
  kind: 'TIPS' | 'BONUS';
  externalId: string;
  amount: number;
  input: CreatePayableInput;
}

/** Build the separate Everee TIPS / BONUS payables for a row's flat pay add-ons.
 *  Each is its own payable with a deterministic externalId (…::TIPS / ::BONUS),
 *  keyed to the SAME worker+day as the main row so re-submits are idempotent and
 *  a void can find them. Returns [] when both are zero. */
function buildExtraPayables(args: {
  tenantId: string;
  customer: string;
  userId: string;
  workDate: string;
  eventLabel: string | null | undefined;
  tips: number;
  bonus: number;
  timestamp: number;
}): ExtraPayable[] {
  const out: ExtraPayable[] = [];
  const add = (kind: 'TIPS' | 'BONUS', base: string, raw: number) => {
    const amount = Math.round(Number(raw) * 100) / 100;
    if (!(amount > 0)) return;
    const externalId = importExternalId({
      tenantId: args.tenantId,
      customer: args.customer,
      userId: args.userId,
      workDate: args.workDate,
      kind,
    });
    out.push({
      kind,
      externalId,
      amount,
      input: {
        externalId,
        externalWorkerId: args.userId,
        label: dayLabel(base, args.eventLabel, args.workDate),
        type: kind.toLowerCase(),
        payCode: kind,
        timestamp: args.timestamp,
        amount: { amount: amount.toFixed(2), currency: 'USD' },
        payableModel: 'PRE_CALCULATED',
      },
    });
  };
  add('TIPS', 'Tips', args.tips);
  add('BONUS', 'Bonus', args.bonus);
  return out;
}

interface ComposedPreview {
  externalId: string;
  externalWorkerId: string;
  workerName: string;
  workDate: string;
  hours: number;
  payRate: number;
  /** Day gross. W-2: reg×rate + OT×1.5×rate (HRX classifies weekly OT —
   *  Everee's endpoint never auto-classified). 1099: hours × rate. */
  amount: number;
  /** W-2 only — the FLSA weekly-40 split for the day. */
  regularHours?: number;
  overtimeHours?: number;
  /** W-2 only — CSV break duration rendered on the worked shift. */
  breakMinutes?: number;
  workersCompCode?: string | null;
  worksiteName?: string | null;
}

/** Build the merge payload that mirrors a submitted import row onto its
 *  canonical `timesheet_entries` doc, so the Timesheet Grid reflects truth even
 *  if the recruiter never clicked "Save progress".
 *
 *  Set only fields this path owns — Firestore `merge:true` deep-merges nested
 *  maps, so writing `null` for a field a prior Save populated would clobber it.
 *  We therefore omit unknown fields rather than null them. */
function importEntryStamp(args: {
  tenantId: string;
  hiringEntityId: string;
  customer: string;
  userId: string;
  workDate: string;
  hours: number;
  payRate: number;
  workerName?: string;
  eventLabel?: string | null;
  workersCompCode?: string | null;
  worksiteId?: string | null;
  worksiteName?: string | null;
  worksiteState?: string | null;
  externalId: string;
  uid: string;
  /** W-2 only — FLSA weekly-40 split (decimal hours). When present, the entry
   *  mirrors the reg/OT segments actually sent to Everee; absent (1099 path)
   *  everything stays straight-time as before. */
  regularHours?: number;
  overtimeHours?: number;
}): Record<string, unknown> {
  const importSidecar: Record<string, unknown> = {
    customer: args.customer,
    matchStatus: 'submitted',
    externalId: args.externalId,
  };
  if (args.workerName) importSidecar.csvWorkerName = args.workerName;
  if (args.eventLabel) importSidecar.csvSite = args.eventLabel;
  if (args.worksiteId) importSidecar.worksiteId = args.worksiteId;
  if (args.worksiteName) importSidecar.worksiteName = args.worksiteName;
  if (args.workersCompCode) importSidecar.workersCompCode = args.workersCompCode;

  const out: Record<string, unknown> = {
    id: importEntryDocId({ customer: args.customer, userId: args.userId, workDate: args.workDate }),
    tenantId: args.tenantId,
    source: 'csv_import',
    hiringEntityId: args.hiringEntityId,
    workerId: args.userId,
    workDate: args.workDate,
    actualHoursOverride: args.hours,
    totalRegularHours: args.regularHours ?? args.hours,
    totalOTHours: args.overtimeHours ?? 0,
    totalFlsaOTHours: args.overtimeHours ?? 0,
    totalNonFlsaOTHours: 0,
    totalDoubleTimeHours: 0,
    mealBreakPenaltyHours: 0,
    restBreakPenaltyHours: 0,
    payRate: args.payRate,
    status: 'sent_to_everee',
    sentToEvereeAt: admin.firestore.FieldValue.serverTimestamp(),
    import: importSidecar,
    updatedBy: args.uid,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  if (args.worksiteState) out.workState = args.worksiteState;
  if (args.workersCompCode) out.workersCompCode = args.workersCompCode;
  return out;
}

/** Noon-UTC of the work date — avoids a TZ off-by-one when Everee renders the
 *  pay-stub date, and keeps a synthetic shift window on the right calendar
 *  day across US time zones. */
function workDateEpochSeconds(workDate: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(workDate || ''));
  if (!m) return 0;
  return Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0) / 1000);
}

/**
 * Snap a day's decimal hours to a WHOLE MINUTE. Everee floors the worked-shift
 * window to the minute but evaluates the classified segment at full precision,
 * so a sub-minute synthetic window (e.g. 5.99h = 5:59:24) gets truncated below
 * the classified hours → "unpayable duration" (500). Rounding the day to the
 * nearest minute and deriving the window, the classified segment, and the gross
 * all from that value keeps the three in lockstep. The pay delta is ≤30s/day
 * (standard minute rounding for an imported daily total with no clock detail).
 */
function minuteAlignedDay(hours: number, rate: number): {
  seconds: number;
  hours: number;
  gross: number;
} {
  const seconds = Math.max(60, Math.round(Number(hours) * 60) * 60);
  const h = seconds / 3600;
  return { seconds, hours: h, gross: Math.round(h * Number(rate) * 100) / 100 };
}

/** Run async tasks with bounded concurrency, preserving input order. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

export const submitImportTimesheetBatch = onCall(
  // W-2 posts one worked shift per row (no bulk endpoint on the default path),
  // so allow plenty of headroom; 1099 is bulk and finishes fast.
  { memory: '512MiB', timeoutSeconds: 540 },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Authentication required');
    }
    const { tenantId, hiringEntityId, customer, dryRun, rows } = (request.data || {}) as {
      tenantId?: string;
      hiringEntityId?: string;
      customer?: string;
      dryRun?: boolean;
      rows?: SubmitRow[];
    };
    if (!tenantId || !hiringEntityId || !Array.isArray(rows) || rows.length === 0) {
      throw new HttpsError('invalid-argument', 'tenantId, hiringEntityId, and rows[] are required');
    }
    if (rows.length > 2000) {
      throw new HttpsError('invalid-argument', 'Too many rows in one submit (max 2000).');
    }
    if (!(await canManageEveree(request.auth as any, tenantId))) {
      throw new HttpsError('permission-denied', 'Not allowed to submit timesheets for this tenant.');
    }

    const cfg = await getEvereeConfigForEntity(tenantId, hiringEntityId);
    if (!cfg?.evereeTenantId) {
      throw new HttpsError('failed-precondition', 'Selected entity is not configured for Everee.');
    }

    const entitySnap = await db.doc(`tenants/${tenantId}/entities/${hiringEntityId}`).get();
    const workerType = String((entitySnap.data() || {}).workerType || '').trim();
    const cust = String(customer || 'import').trim();
    const is1099 = workerType === '1099';

    const pathArgs: PathArgs = {
      uid: request.auth.uid,
      tenantId,
      hiringEntityId,
      cfg,
      cust,
      workerType,
      dryRun: !!dryRun,
      rows,
    };
    return is1099 ? submit1099(pathArgs) : submitW2(pathArgs);
  },
);

interface PathArgs {
  uid: string;
  tenantId: string;
  hiringEntityId: string;
  cfg: NonNullable<Awaited<ReturnType<typeof getEvereeConfigForEntity>>>;
  cust: string;
  workerType: string;
  dryRun: boolean;
  rows: SubmitRow[];
}

// ─────────────────────────────────────────────────────────────────────
// 1099 — contractor payables (bulk)
// ─────────────────────────────────────────────────────────────────────

async function submit1099(args: PathArgs) {
  const { uid, tenantId, hiringEntityId, cfg, cust, workerType, dryRun, rows } = args;
  const payables: CreatePayableInput[] = [];
  const preview: ComposedPreview[] = [];
  let skipped = 0;
  // Contractor pay isn't tied to a specific work day the way W-2 hours are, and
  // Everee rejects a payable dated before the worker's start date (contractors
  // are often onboarded after the work week). So stamp every contractor payable
  // at the PAY DATE (today) — always on/after the hire date, no per-worker
  // lookup needed. The actual work date stays in the pay-stub label + the HRX
  // record (preview.workDate / the canonical entry).
  const payTimestamp = workDateEpochSeconds(new Date().toISOString().slice(0, 10));
  // Tips/bonus ride as separate TIPS/BONUS payables keyed to the same worker+day.
  const extrasByEntry = new Map<string, ExtraPayable[]>();
  let extrasTotal = 0;
  for (const row of rows) {
    const userId = String(row.userId || '').trim();
    const hours = Number(row.hours);
    const payRate = Number(row.payRate);
    const workDate = String(row.workDate || '').trim();
    if (!userId || !workDate || !(hours > 0) || !(payRate > 0)) {
      skipped += 1;
      continue;
    }
    const amount = Math.round(hours * payRate * 100) / 100;
    const externalId = importExternalId({ tenantId, customer: cust, userId, workDate, kind: 'CONTRACTOR' });
    payables.push({
      externalId,
      externalWorkerId: userId,
      label: dayLabel('Contractor pay', row.eventLabel, workDate, hours),
      type: 'contractor',
      payCode: 'CONTRACTOR',
      timestamp: payTimestamp,
      amount: { amount: amount.toFixed(2), currency: 'USD' },
      payableModel: 'PRE_CALCULATED',
    });
    preview.push({
      externalId,
      externalWorkerId: userId,
      workerName: String(row.workerName || '').trim(),
      workDate,
      hours,
      payRate,
      amount,
    });
    const extras = buildExtraPayables({
      tenantId,
      customer: cust,
      userId,
      workDate,
      eventLabel: row.eventLabel,
      tips: Number(row.tips ?? 0),
      bonus: Number(row.bonus ?? 0),
      timestamp: payTimestamp,
    });
    if (extras.length) {
      extrasByEntry.set(`${userId}::${workDate}`, extras);
      for (const ex of extras) {
        payables.push(ex.input);
        extrasTotal += ex.amount;
      }
    }
  }

  const baseTotal = preview.reduce((s, p) => s + p.amount, 0);
  const totalAmount = Math.round((baseTotal + extrasTotal) * 100) / 100;
  if (dryRun) {
    return { dryRun: true, workerType, count: preview.length, skipped, totalAmount, extrasTotal, preview };
  }
  if (payables.length === 0) {
    throw new HttpsError('invalid-argument', 'No payable rows to submit (all skipped).');
  }

  const submitted: string[] = [];
  const errors: string[] = [];
  const CHUNK = 150;
  for (let i = 0; i < payables.length; i += CHUNK) {
    const chunk = payables.slice(i, i + CHUNK);
    try {
      // eslint-disable-next-line no-await-in-loop
      const res = await bulkCreatePayables(cfg, chunk);
      submitted.push(...res.externalIds);
    } catch (e: unknown) {
      errors.push(e instanceof Error ? e.message.slice(0, 240) : String(e).slice(0, 240));
    }
  }

  const batchRef = db.collection(`tenants/${tenantId}/timesheet_import_batches`).doc();
  await batchRef.set({
    tenantId,
    hiringEntityId,
    evereeTenantId: cfg.evereeTenantId,
    customer: cust,
    workerType,
    kind: 'payable',
    submittedByUid: uid,
    rowCount: preview.length,
    totalAmount,
    submittedExternalIds: submitted,
    errors,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  const submittedSet = new Set(submitted);
  const byExternalId = new Map(preview.map((p) => [p.externalId, p]));
  const rowByExternalId = new Map(
    rows.map((r) => [
      importExternalId({
        tenantId,
        customer: cust,
        userId: String(r.userId || '').trim(),
        workDate: String(r.workDate || '').trim(),
        kind: 'CONTRACTOR',
      }),
      r,
    ]),
  );
  // Flatten the tips/bonus extras → per-externalId metadata + per-entry list of
  // submitted extra ids, so the status docs carry real amounts and the entry's
  // payableExternalIds includes them (for void + the paid-webhook reconciler).
  type ExtraMeta = ExtraPayable & { userId: string; workDate: string; workerName: string };
  const extraByExtId = new Map<string, ExtraMeta>();
  const submittedExtraIdsByEntry = new Map<string, string[]>();
  for (const p of preview) {
    const key = `${p.externalWorkerId}::${p.workDate}`;
    const ids: string[] = [];
    for (const ex of extrasByEntry.get(key) || []) {
      extraByExtId.set(ex.externalId, { ...ex, userId: p.externalWorkerId, workDate: p.workDate, workerName: p.workerName });
      if (submittedSet.has(ex.externalId)) ids.push(ex.externalId);
    }
    if (ids.length) submittedExtraIdsByEntry.set(key, ids);
  }
  let writer = db.batch();
  let pending = 0;
  for (const externalId of submittedSet) {
    const p = byExternalId.get(externalId);
    const ex = extraByExtId.get(externalId);
    const row = rowByExternalId.get(externalId);
    writer.set(
      db.doc(`tenants/${tenantId}/timesheet_import_payables/${payableStatusDocId(externalId)}`),
      {
        externalId,
        kind: 'payable',
        payCode: ex ? ex.kind : 'CONTRACTOR',
        externalWorkerId: p?.externalWorkerId ?? ex?.userId ?? null,
        workerName: p?.workerName ?? ex?.workerName ?? null,
        customer: cust,
        hiringEntityId,
        evereeTenantId: cfg.evereeTenantId,
        workDate: p?.workDate ?? ex?.workDate ?? null,
        hours: p?.hours ?? null,
        payRate: p?.payRate ?? null,
        amount: p?.amount ?? ex?.amount ?? null,
        status: 'submitted',
        batchId: batchRef.id,
        submittedByUid: uid,
        submittedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    // Mirror onto the canonical timesheet entry (Grid = source of truth).
    if (p) {
      const docId = importEntryDocId({ customer: cust, userId: p.externalWorkerId, workDate: p.workDate });
      writer.set(
        db.doc(`tenants/${tenantId}/timesheet_entries/${docId}`),
        {
          ...importEntryStamp({
            tenantId,
            hiringEntityId,
            customer: cust,
            userId: p.externalWorkerId,
            workDate: p.workDate,
            hours: p.hours,
            payRate: p.payRate,
            workerName: p.workerName,
            eventLabel: row?.eventLabel ?? null,
            externalId,
            uid,
          }),
          // Nested map (NOT dotted keys) — set(merge:true) deep-merges this,
          // dotted strings would create a literal "everee.x" field.
          everee: {
            payableExternalIds: [externalId, ...(submittedExtraIdsByEntry.get(`${p.externalWorkerId}::${p.workDate}`) || [])],
            status: 'SUBMITTED',
            respondedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
        },
        { merge: true },
      );
      pending += 1;
    }
    if (++pending >= 400) {
      // eslint-disable-next-line no-await-in-loop
      await writer.commit();
      writer = db.batch();
      pending = 0;
    }
  }
  if (pending > 0) await writer.commit();

  // Creating payables alone leaves them as raw line items — they only show up
  // as a "Needs Approval" PAYMENT after a payout request groups them. The
  // regular payroll flow (finalizeTimesheetBatch) does this; the import path
  // must too, or the contractor pay never surfaces in Everee. Scoped to the
  // externalIds we just created; idempotent (Everee dedupes already-paid).
  let payRunId: number | undefined;
  let payoutError: string | undefined;
  if (submitted.length > 0) {
    try {
      const r = await requestPayablePayout(cfg, {
        externalIds: [...submittedSet],
        includeWorkersOnRegularPayCycle: false,
      });
      payRunId = r.id || undefined;
    } catch (e) {
      payoutError = e instanceof Error ? e.message : String(e);
    }
  }

  return {
    dryRun: false,
    workerType,
    batchId: batchRef.id,
    payRunId,
    payoutError,
    submitted: submitted.length,
    failed: payables.length - submitted.length,
    errors,
    totalAmount,
  };
}

// ─────────────────────────────────────────────────────────────────────
// W-2 — worked shifts (per-row; Everee classifies OT/DT)
// ─────────────────────────────────────────────────────────────────────

interface W2Plan {
  row: SubmitRow;
  userId: string;
  workDate: string;
  hours: number;
  payRate: number;
  wc: string;
  externalId: string;
  /** FLSA weekly-40 split (minute-aligned seconds), stamped after
   *  classifyWeeklyOt runs against the batch + prior-week submissions. */
  regularSeconds: number;
  overtimeSeconds: number;
}

/** Round-to-cent day gross under the reg/OT split. */
function splitGross(regularSeconds: number, overtimeSeconds: number, rate: number): {
  regularHours: number;
  overtimeHours: number;
  gross: number;
} {
  const regularHours = regularSeconds / 3600;
  const overtimeHours = overtimeSeconds / 3600;
  const gross =
    Math.round((regularHours * rate + overtimeHours * rate * 1.5) * 100) / 100;
  return { regularHours, overtimeHours, gross };
}

/**
 * Net seconds already submitted to Everee (sent/paid import entries) per
 * `${userId}__${weekKey}`, EXCLUDING entries the current batch is about to
 * overwrite — so the weekly-40 threshold accounts for a partial upload
 * earlier in the same week without double-counting a re-upload.
 */
async function priorWeekSecondsForBatch(
  tenantId: string,
  hiringEntityId: string,
  cust: string,
  plans: W2Plan[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const weeks = new Map<string, { start: string; end: string }>();
  for (const p of plans) {
    const wk = weekKeyFor(p.workDate);
    if (!weeks.has(wk)) {
      const startDt = new Date(`${wk}T00:00:00Z`);
      const endDt = new Date(startDt);
      endDt.setUTCDate(endDt.getUTCDate() + 6);
      weeks.set(wk, { start: wk, end: endDt.toISOString().slice(0, 10) });
    }
  }
  const workerIds = new Set(plans.map((p) => p.userId));
  const currentEntryIds = new Set(
    plans.map((p) =>
      importEntryDocId({ customer: cust, userId: p.userId, workDate: p.workDate }),
    ),
  );
  for (const [wk, range] of weeks) {
    // Uses the existing composite index (source ASC, hiringEntityId ASC,
    // workDate ASC) from the P4 grid-resolver work.
    // eslint-disable-next-line no-await-in-loop
    const snap = await db
      .collection(`tenants/${tenantId}/timesheet_entries`)
      .where('source', '==', 'csv_import')
      .where('hiringEntityId', '==', hiringEntityId)
      .where('workDate', '>=', range.start)
      .where('workDate', '<=', range.end)
      .get();
    for (const doc of snap.docs) {
      if (currentEntryIds.has(doc.id)) continue;
      const e = doc.data() as Record<string, unknown>;
      const workerId = String(e.workerId ?? '');
      if (!workerIds.has(workerId)) continue;
      const status = String(e.status ?? '');
      if (status !== 'sent_to_everee' && status !== 'paid') continue;
      const hours = Number(
        e.actualHoursOverride ??
          Number(e.totalRegularHours ?? 0) + Number(e.totalOTHours ?? 0),
      );
      if (!(hours > 0)) continue;
      const gk = `${workerId}__${wk}`;
      out.set(gk, (out.get(gk) ?? 0) + Math.round(hours * 60) * 60);
    }
  }
  return out;
}

async function submitW2(args: PathArgs) {
  const { uid, tenantId, hiringEntityId, cfg, cust, workerType, dryRun, rows } = args;

  // Validate + plan. W-2 worked shifts require a WC class code (comp-insurance
  // classification); a row without one is skipped and reported.
  const plans: W2Plan[] = [];
  let skipped = 0;
  let skippedNoWc = 0;
  for (const row of rows) {
    const userId = String(row.userId || '').trim();
    const hours = Number(row.hours);
    const payRate = Number(row.payRate);
    const workDate = String(row.workDate || '').trim();
    if (!userId || !workDate || !(hours > 0) || !(payRate > 0)) {
      skipped += 1;
      continue;
    }
    const wc = String(row.workersCompCode || '').trim();
    if (!wc) {
      skippedNoWc += 1;
      continue;
    }
    plans.push({
      row,
      userId,
      workDate,
      hours,
      payRate,
      wc,
      externalId: importExternalId({ tenantId, customer: cust, userId, workDate, kind: 'WORKED_SHIFT' }),
      regularSeconds: 0,
      overtimeSeconds: 0,
    });
  }

  // FLSA weekly-40 cascade across the batch (+ anything already submitted
  // for the same worker-weeks in earlier batches). Everee's endpoint
  // requires fullyClassifiedHours and does NOT auto-classify — the original
  // "Everee adds OT at the pay run" assumption was wrong and shipped
  // straight-time-only weeks (2026-07-06 Zirick Brooks report: 44.6 hrs,
  // zero OT).
  const priorSeconds = await priorWeekSecondsForBatch(tenantId, hiringEntityId, cust, plans);
  const splits = classifyWeeklyOt(
    plans.map((p) => ({
      key: p.externalId,
      userId: p.userId,
      workDate: p.workDate,
      netHours: p.hours,
    })),
    priorSeconds,
  );
  for (const p of plans) {
    const split = splits.get(p.externalId);
    if (split) {
      p.regularSeconds = split.regularSeconds;
      p.overtimeSeconds = split.overtimeSeconds;
    } else {
      p.regularSeconds = minuteAlignedDay(p.hours, p.payRate).seconds;
      p.overtimeSeconds = 0;
    }
  }

  const preview: ComposedPreview[] = plans.map((p) => {
    const g = splitGross(p.regularSeconds, p.overtimeSeconds, p.payRate);
    return {
      externalId: p.externalId,
      externalWorkerId: p.userId,
      workerName: String(p.row.workerName || '').trim(),
      workDate: p.workDate,
      hours: p.hours,
      payRate: p.payRate,
      // Minute-aligned gross incl. the OT premium — matches the worked shift.
      amount: g.gross,
      regularHours: Math.round(g.regularHours * 100) / 100,
      overtimeHours: Math.round(g.overtimeHours * 100) / 100,
      breakMinutes: Math.max(0, Math.round(Number(p.row.breakMinutes ?? 0))),
      workersCompCode: p.wc,
      worksiteName: p.row.worksiteName ?? null,
    };
  });
  const totalAmount = Math.round(preview.reduce((s, p) => s + p.amount, 0) * 100) / 100;

  if (dryRun) {
    return {
      dryRun: true,
      workerType,
      // HRX classifies weekly OT now (Everee never did) — the total is exact.
      evereeClassifiesOt: false,
      count: preview.length,
      skipped,
      skippedNoWc,
      totalAmount,
      preview,
    };
  }

  if (plans.length === 0) {
    throw new HttpsError(
      'invalid-argument',
      skippedNoWc > 0
        ? `No submittable rows — ${skippedNoWc} are missing a workers-comp code.`
        : 'No worked-shift rows to submit (all skipped).',
    );
  }

  // Skip rows already live in Everee (status doc 'submitted') so a re-submit
  // after a re-match doesn't create duplicate worked shifts. Worked-shift
  // idempotency is server-assigned, not deterministic, so this guard matters.
  const alreadyLive = new Set<string>();
  const READ_CHUNK = 300;
  for (let i = 0; i < plans.length; i += READ_CHUNK) {
    const slice = plans.slice(i, i + READ_CHUNK);
    const refs = slice.map((p) =>
      db.doc(`tenants/${tenantId}/timesheet_import_payables/${payableStatusDocId(p.externalId)}`),
    );
    // eslint-disable-next-line no-await-in-loop
    const snaps = await db.getAll(...refs);
    snaps.forEach((snap, j) => {
      if (snap.exists && String(snap.data()?.status || '') === 'submitted') {
        alreadyLive.add(slice[j].externalId);
      }
    });
  }

  // Resolve each unique worksite to an Everee numeric workLocationId once.
  const locationCache = new Map<string, number>();
  const resolveLocation = async (row: SubmitRow): Promise<number | undefined> => {
    const wsId = String(row.worksiteId || '').trim();
    if (!wsId) return undefined;
    if (locationCache.has(wsId)) return locationCache.get(wsId);
    try {
      const a = row.worksiteAddress || {};
      const id = await ensureEvereeWorkLocation(tenantId, cfg, {
        worksiteId: wsId,
        name: String(row.worksiteName || wsId),
        address: { street: a.street, city: a.city, state: a.state, zip: a.zip },
      });
      locationCache.set(wsId, id);
      return id;
    } catch {
      // Non-fatal: Everee falls back to the worker's default work location.
      return undefined;
    }
  };

  const toSubmit = plans.filter((p) => !alreadyLive.has(p.externalId));
  let submitted = 0;
  const errors: string[] = [];
  const statusWrites: Array<{ plan: W2Plan; workedShiftId: number }> = [];

  // Bounded concurrency — Everee rate-limits, and evereeRequest retries 429s.
  await mapWithConcurrency(toSubmit, 8, async (p) => {
    try {
      const workLocationId = await resolveLocation(p.row);
      // Real clock-in + break from the CSV when available (falls back to the
      // legacy noon-UTC synthetic). Window end is DERIVED (start + net +
      // unpaid break) so window − breaks ≡ classified seconds and Everee's
      // minute-floored validation can't reject the shift.
      const window = composeImportWindow({
        workDate: p.workDate,
        netHours: p.hours,
        clockIn: p.row.clockIn,
        worksiteState: p.row.worksiteAddress?.state ?? null,
        breakMinutes: p.row.breakMinutes,
        breakPaid: p.row.paidBreak,
      });
      // Fully Classified Shifts is enabled on all C1 Everee instances, so
      // the endpoint REQUIRES fullyClassifiedHours (it does NOT auto-classify
      // when omitted — that returns 400). HRX classifies the FLSA weekly-40
      // cascade (classifyWeeklyOt) and lays REGULAR then OVERTIME segments
      // sequentially from the window start — same convention as the grid
      // path's composeTimesheetBatchPayloads.
      const rateStr = p.payRate.toFixed(2);
      const segments: CreateWorkedShiftInput['fullyClassifiedHours'] = [];
      let cursor = window.startEpochSeconds;
      if (p.regularSeconds > 0) {
        const regGross = Math.round((p.regularSeconds / 3600) * p.payRate * 100) / 100;
        segments.push({
          type: 'REGULAR_TIME',
          startEpochSeconds: cursor,
          endEpochSeconds: cursor + p.regularSeconds,
          hourlyPayRate: { amount: rateStr, currency: 'USD' },
          grossPayAmount: { amount: regGross.toFixed(2), currency: 'USD' },
        });
        cursor += p.regularSeconds;
      }
      if (p.overtimeSeconds > 0) {
        const otRate = Math.round(p.payRate * 1.5 * 100) / 100;
        const otGross = Math.round((p.overtimeSeconds / 3600) * p.payRate * 1.5 * 100) / 100;
        segments.push({
          type: 'OVERTIME',
          startEpochSeconds: cursor,
          endEpochSeconds: cursor + p.overtimeSeconds,
          hourlyPayRate: { amount: otRate.toFixed(2), currency: 'USD' },
          grossPayAmount: { amount: otGross.toFixed(2), currency: 'USD' },
        });
        cursor += p.overtimeSeconds;
      }
      const input: CreateWorkedShiftInput = {
        externalWorkerId: p.userId,
        shiftStartEpochSeconds: window.startEpochSeconds,
        shiftEndEpochSeconds: window.endEpochSeconds,
        effectiveHourlyPayRate: { amount: rateStr, currency: 'USD' },
        workersCompClassCode: p.wc,
        note: dayLabel(`Imported from ${cust}`, p.row.eventLabel, p.workDate),
        fullyClassifiedHours: segments,
      };
      if (window.breaks.length > 0) {
        input.createBreaks = window.breaks.map((b) => ({
          segmentConfigCode: b.paid ? 'DEFAULT_PAID' : 'DEFAULT_UNPAID',
          breakStartEpochSeconds: b.startEpochSeconds,
          breakEndEpochSeconds: b.endEpochSeconds,
        }));
      }
      if (workLocationId != null) input.overrideWorkLocationId = workLocationId;
      const res = await createWorkedShift(cfg, input);
      submitted += 1;
      statusWrites.push({ plan: p, workedShiftId: res.workedShiftId });
    } catch (e: unknown) {
      const who = String(p.row.workerName || p.userId);
      errors.push(
        `${who} ${p.workDate}: ${e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200)}`,
      );
    }
  });

  // Tips/bonus → separate TIPS/BONUS payables for the worked-shift rows that
  // landed. Worked shifts don't carry flat add-ons, so these go as payables
  // (then a payout request — on the worker's regular W-2 cycle — to materialize,
  // since a payable alone never surfaces as a payment).
  const w2ExtrasByPlanExtId = new Map<string, ExtraPayable[]>();
  const w2ExtraInputs: CreatePayableInput[] = [];
  for (const { plan } of statusWrites) {
    const extras = buildExtraPayables({
      tenantId,
      customer: cust,
      userId: plan.userId,
      workDate: plan.workDate,
      eventLabel: plan.row.eventLabel,
      tips: Number(plan.row.tips ?? 0),
      bonus: Number(plan.row.bonus ?? 0),
      timestamp: workDateEpochSeconds(plan.workDate),
    });
    if (!extras.length) continue;
    w2ExtrasByPlanExtId.set(plan.externalId, extras);
    for (const ex of extras) w2ExtraInputs.push(ex.input);
  }
  const submittedExtraIds = new Set<string>();
  if (w2ExtraInputs.length > 0) {
    const CHUNK = 150;
    for (let i = 0; i < w2ExtraInputs.length; i += CHUNK) {
      const chunk = w2ExtraInputs.slice(i, i + CHUNK);
      try {
        // eslint-disable-next-line no-await-in-loop
        const res = await bulkCreatePayables(cfg, chunk);
        res.externalIds.forEach((id) => submittedExtraIds.add(id));
      } catch (e: unknown) {
        errors.push(`tips/bonus: ${e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200)}`);
      }
    }
    if (submittedExtraIds.size > 0) {
      try {
        await requestPayablePayout(cfg, {
          externalIds: [...submittedExtraIds],
          includeWorkersOnRegularPayCycle: true,
        });
      } catch (e: unknown) {
        errors.push(`tips/bonus payout: ${e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200)}`);
      }
    }
  }

  const batchRef = db.collection(`tenants/${tenantId}/timesheet_import_batches`).doc();
  await batchRef.set({
    tenantId,
    hiringEntityId,
    evereeTenantId: cfg.evereeTenantId,
    customer: cust,
    workerType,
    kind: 'worked_shift',
    submittedByUid: uid,
    rowCount: plans.length,
    totalAmount,
    submitted,
    skippedNoWc,
    alreadyLive: alreadyLive.size,
    errors,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  const previewByExtId = new Map(preview.map((p) => [p.externalId, p]));
  let writer = db.batch();
  let pending = 0;
  for (const { plan, workedShiftId } of statusWrites) {
    const p = previewByExtId.get(plan.externalId);
    writer.set(
      db.doc(`tenants/${tenantId}/timesheet_import_payables/${payableStatusDocId(plan.externalId)}`),
      {
        externalId: plan.externalId,
        kind: 'worked_shift',
        workedShiftId,
        externalWorkerId: plan.userId,
        workerName: p?.workerName ?? null,
        customer: cust,
        hiringEntityId,
        evereeTenantId: cfg.evereeTenantId,
        workDate: plan.workDate,
        hours: plan.hours,
        payRate: plan.payRate,
        workersCompCode: plan.wc,
        amount: p?.amount ?? null,
        status: 'submitted',
        batchId: batchRef.id,
        submittedByUid: uid,
        submittedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    // Tips/bonus payables that landed for this row → status docs (so void + the
    // paid webhook can find them).
    const planExtras = (w2ExtrasByPlanExtId.get(plan.externalId) || []).filter((ex) =>
      submittedExtraIds.has(ex.externalId),
    );
    for (const ex of planExtras) {
      writer.set(
        db.doc(`tenants/${tenantId}/timesheet_import_payables/${payableStatusDocId(ex.externalId)}`),
        {
          externalId: ex.externalId,
          kind: 'payable',
          payCode: ex.kind,
          externalWorkerId: plan.userId,
          workerName: p?.workerName ?? null,
          customer: cust,
          hiringEntityId,
          evereeTenantId: cfg.evereeTenantId,
          workDate: plan.workDate,
          amount: ex.amount,
          status: 'submitted',
          batchId: batchRef.id,
          submittedByUid: uid,
          submittedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    }
    // Mirror onto the canonical timesheet entry (Grid = source of truth).
    const entryDocId = importEntryDocId({ customer: cust, userId: plan.userId, workDate: plan.workDate });
    writer.set(
      db.doc(`tenants/${tenantId}/timesheet_entries/${entryDocId}`),
      {
        ...importEntryStamp({
          tenantId,
          hiringEntityId,
          customer: cust,
          userId: plan.userId,
          workDate: plan.workDate,
          hours: plan.hours,
          payRate: plan.payRate,
          workerName: p?.workerName,
          eventLabel: plan.row.eventLabel ?? null,
          workersCompCode: plan.wc,
          worksiteId: plan.row.worksiteId ?? null,
          worksiteName: plan.row.worksiteName ?? null,
          worksiteState: plan.row.worksiteAddress?.state ?? null,
          externalId: plan.externalId,
          uid,
          regularHours: Math.round((plan.regularSeconds / 3600) * 10000) / 10000,
          overtimeHours: Math.round((plan.overtimeSeconds / 3600) * 10000) / 10000,
        }),
        everee: {
          workedShiftId: String(workedShiftId),
          status: 'SUBMITTED',
          respondedAt: admin.firestore.FieldValue.serverTimestamp(),
          ...(planExtras.length
            ? { payableExternalIds: planExtras.map((ex) => ex.externalId) }
            : {}),
        },
      },
      { merge: true },
    );
    pending += 2 + planExtras.length;
    if (pending >= 400) {
      // eslint-disable-next-line no-await-in-loop
      await writer.commit();
      writer = db.batch();
      pending = 0;
    }
  }
  if (pending > 0) await writer.commit();

  return {
    dryRun: false,
    workerType,
    evereeClassifiesOt: true,
    batchId: batchRef.id,
    submitted,
    failed: toSubmit.length - submitted,
    skippedNoWc,
    alreadyLive: alreadyLive.size,
    errors,
    totalAmount,
  };
}

/**
 * Retract a previously-submitted import row. For a payable, deletes it in
 * Everee by externalId; for a worked shift, deletes by the stored
 * `workedShiftId` (with `correction-authorized` in case the period already
 * posted). Marks the local status doc voided so the row returns to "Ready"
 * and can be re-submitted.
 */
export const voidImportTimesheetPayable = onCall(
  { memory: '512MiB', timeoutSeconds: 60 },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Authentication required');
    }
    const { tenantId, hiringEntityId, externalId, userId, workDate, customer } = (request.data || {}) as {
      tenantId?: string;
      hiringEntityId?: string;
      externalId?: string;
      /** Optional — lets the void reconstruct the canonical entry id to flip it
       *  back to re-sendable. The client always sends these for import rows. */
      userId?: string;
      workDate?: string;
      customer?: string;
    };
    if (!tenantId || !hiringEntityId || !externalId) {
      throw new HttpsError('invalid-argument', 'tenantId, hiringEntityId, and externalId are required');
    }
    if (!(await canManageEveree(request.auth as any, tenantId))) {
      throw new HttpsError('permission-denied', 'Not allowed to void payables for this tenant.');
    }
    const cfg = await getEvereeConfigForEntity(tenantId, hiringEntityId);
    if (!cfg?.evereeTenantId) {
      throw new HttpsError('failed-precondition', 'Selected entity is not configured for Everee.');
    }

    const statusRef = db.doc(
      `tenants/${tenantId}/timesheet_import_payables/${payableStatusDocId(externalId)}`,
    );
    const statusSnap = await statusRef.get();
    const data = statusSnap.data() || {};

    if (data.kind === 'worked_shift') {
      const workedShiftId = Number(data.workedShiftId);
      if (!(workedShiftId > 0)) {
        throw new HttpsError('failed-precondition', 'No Everee worked-shift id recorded for this row.');
      }
      await deleteWorkedShift(cfg, workedShiftId, { correctionAuthorized: true });
    } else {
      await deletePayable(cfg, externalId);
    }

    await statusRef.set(
      {
        status: 'voided',
        voidedByUid: request.auth.uid,
        voidedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    // Flip the canonical entry back to a re-sendable draft so the Grid + Import
    // tab both show it as no-longer-submitted. Prefer the explicit identity the
    // client passes; fall back to the status doc's recorded worker + date.
    const vUserId = String(userId || data.externalWorkerId || '').trim();
    const vWorkDate = String(workDate || data.workDate || '').trim();
    const vCustomer = String(customer || data.customer || '').trim();
    if (vUserId && vWorkDate && vCustomer) {
      const entryDocId = importEntryDocId({ customer: vCustomer, userId: vUserId, workDate: vWorkDate });
      await db.doc(`tenants/${tenantId}/timesheet_entries/${entryDocId}`).set(
        {
          status: 'draft',
          sentToEvereeAt: admin.firestore.FieldValue.delete(),
          // Nested maps deep-merge under set(merge:true); dotted keys would
          // create literal "import.x"/"everee.x" fields instead.
          import: { matchStatus: 'voided' },
          everee: {
            workedShiftId: admin.firestore.FieldValue.delete(),
            payableExternalIds: admin.firestore.FieldValue.delete(),
            status: 'VOIDED',
          },
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedBy: request.auth.uid,
        },
        { merge: true },
      );

      // Retract any tips/bonus payables attached to the same row, so voiding the
      // main earning doesn't leave orphaned TIPS/BONUS payments live in Everee.
      // Only touch extras that actually have a (non-voided) status doc.
      for (const kind of ['TIPS', 'BONUS'] as const) {
        const exId = importExternalId({ tenantId, customer: vCustomer, userId: vUserId, workDate: vWorkDate, kind });
        const exRef = db.doc(`tenants/${tenantId}/timesheet_import_payables/${payableStatusDocId(exId)}`);
        // eslint-disable-next-line no-await-in-loop
        const exSnap = await exRef.get();
        if (!exSnap.exists || String(exSnap.data()?.status || '') === 'voided') continue;
        try {
          // eslint-disable-next-line no-await-in-loop
          await deletePayable(cfg, exId);
        } catch {
          /* already gone in Everee — fall through to mark voided locally */
        }
        // eslint-disable-next-line no-await-in-loop
        await exRef.set(
          {
            status: 'voided',
            voidedByUid: request.auth.uid,
            voidedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      }
    }
    return { ok: true, externalId };
  },
);
