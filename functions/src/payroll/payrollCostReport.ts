/**
 * Payroll cost attribution report (Greg 2026-07-28).
 *
 * Answers "what did FIFA Dallas cost us in payroll?" — the accounting gap
 * where money flowed HRX → Everee with no per-job attribution. Aggregates
 * SUBMITTED/PAID timesheet entries over a date range and groups dollars by
 * account → job order → worksite, plus a per-batch section that gives the
 * bookkeeper the split for each Everee funding wire ("$10,000 on 7/18 =
 * $2,000 Lollapalooza + $3,100 FIFA Dallas …") with percentages she can
 * apply to the burdened wire total (pro-rata, per Greg's decision).
 *
 * Source of truth is HRX's own entries (attribution resolved
 * entry → assignment → job order, same chain the submit orchestrator
 * uses); the Everee-side note/label tags are a convenience layer on top.
 * June-era entries that can't resolve a job order land in an explicit
 * "Unattributed" bucket rather than being silently dropped.
 *
 * Gate: books-level access (hrx claim, admin role, or securityLevel ≥ 6)
 * — same bar as the QBO connection management.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

const MAX_RANGE_DAYS = 92;
const MAX_ROWS = 12000;

function trim(v: unknown): string {
  return String(v ?? '').trim();
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Venue-label → job-order mappings (learn-once, per Greg 2026-07-28):
 * unattributed rows carry a venue label ("FIFA WC Dallas") from the CSV
 * import; an admin maps that label to the right JO once and every entry
 * with that label — past and future — reports under the JO. Applied at
 * READ time (no entry mutation), stored at
 * tenants/{t}/payroll_venue_mappings/{venueKey}.
 */
function normalizeVenueKey(label: string): string {
  return label.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Firestore doc ids cannot contain '/'; keep the key readable otherwise. */
function venueMappingDocId(label: string): string {
  return normalizeVenueKey(label).replace(/\//g, '_').slice(0, 400) || '_';
}

/**
 * Notes-text lookup: a mapped venue name appearing anywhere in free-text
 * notes links the payment ("Minnesota Yacht Club" in a note → its JO).
 * Keys shorter than 5 chars are skipped — too collision-prone as
 * substrings. Longest key wins when several match.
 */
function findMappingInText(
  mappings: Map<string, VenueMapping>,
  text: string,
): VenueMapping | undefined {
  const t = normalizeVenueKey(text);
  if (t.length < 5) return undefined;
  let best: { key: string; m: VenueMapping } | undefined;
  for (const [key, m] of mappings) {
    if (key.length >= 5 && t.includes(key) && (!best || key.length > best.key.length)) {
      best = { key, m };
    }
  }
  return best?.m;
}

interface VenueMapping {
  venueLabel: string;
  jobOrderId: string;
  jobOrderName: string | null;
  jobOrderNumber: string | null;
  poNumber: string | null;
  accountId: string | null;
  accountName: string | null;
}

export const savePayrollVenueMapping = onCall(
  { region: 'us-central1', memory: '512MiB', timeoutSeconds: 60 },
  async (request) => {
    const tenantId = trim(request.data?.tenantId);
    const venueLabel = trim(request.data?.venueLabel);
    const jobOrderId = trim(request.data?.jobOrderId);
    if (!tenantId || !venueLabel) {
      throw new HttpsError('invalid-argument', 'tenantId and venueLabel are required.');
    }
    await ensureBooksAccess(request.auth?.uid, request.auth?.token as never, tenantId);

    const ref = db.doc(`tenants/${tenantId}/payroll_venue_mappings/${venueMappingDocId(venueLabel)}`);
    if (!jobOrderId) {
      await ref.delete();
      return { deleted: true, venueLabel };
    }

    let jo: Record<string, unknown> | null = null;
    for (const coll of ['job_orders', 'jobOrders', 'recruiter_jobOrders']) {
      const s = await db.doc(`tenants/${tenantId}/${coll}/${jobOrderId}`).get();
      if (s.exists) {
        jo = s.data() as Record<string, unknown>;
        break;
      }
    }
    if (!jo) throw new HttpsError('not-found', `Job order ${jobOrderId} not found.`);
    const accountId = trim(jo.recruiterAccountId) || null;
    let accountName: string | null = null;
    if (accountId) {
      const acct = await db.doc(`tenants/${tenantId}/accounts/${accountId}`).get();
      accountName = acct.exists ? trim(acct.data()?.name) || null : null;
    }
    const mapping: VenueMapping = {
      venueLabel,
      jobOrderId,
      jobOrderName: trim(jo.jobOrderName) || null,
      jobOrderNumber: trim(jo.jobOrderNumber) || null,
      poNumber: trim(jo.poNumber) || null,
      accountId,
      accountName,
    };
    await ref.set({
      ...mapping,
      venueKey: normalizeVenueKey(venueLabel),
      updatedByUid: request.auth?.uid ?? null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return { deleted: false, ...mapping };
  },
);

/** Books access: hrx staff, admin role, or securityLevel >= 6. Shared with offCyclePayments. */
export async function ensureBooksAccess(uid: string | undefined, token: Record<string, unknown> | undefined, tenantId: string): Promise<void> {
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  if (token?.hrx === true) return;
  const data = ((await db.collection('users').doc(uid).get()).data() ?? {}) as Record<string, unknown>;
  const role = String(data.role ?? '').toLowerCase();
  const level = Number.parseInt(String(data.securityLevel ?? '0'), 10) || 0;
  const tenantLevel = Number.parseInt(
    String((data.tenantIds as Record<string, Record<string, unknown>> | undefined)?.[tenantId]?.securityLevel ?? '0'),
    10,
  ) || 0;
  if (role === 'admin' || role === 'super_admin' || level >= 6 || tenantLevel >= 6) return;
  throw new HttpsError('permission-denied', 'Payroll cost reporting requires admin access.');
}

interface ReportRow {
  entryId: string;
  workDate: string;
  hiringEntityId: string;
  batchId: string | null;
  workerId: string;
  workerName: string | null;
  accountId: string | null;
  accountName: string | null;
  jobOrderId: string | null;
  jobOrderName: string | null;
  jobOrderNumber: string | null;
  /** Customer PO on the JO (VenueSmart's real "job order id"). */
  poNumber: string | null;
  worksiteName: string | null;
  hours: number;
  gross: number;
  tips: number;
  bonus: number;
  premiums: number;
  total: number;
  status: string;
  source: string;
  /** Full-fields export additions (Greg 2026-08-05). */
  payRate: number | null;
  regularHours: number;
  overtimeHours: number;
  doubleTimeHours: number;
  workState: string | null;
  workersCompCode: string | null;
  workersCompRate: number | null;
}

interface GroupTotals {
  key: string;
  label: string;
  entries: number;
  workers: number;
  hours: number;
  total: number;
  pct: number;
}

export const getPayrollCostReport = onCall(
  { region: 'us-central1', memory: '1GiB', timeoutSeconds: 300 },
  async (request) => {
    const tenantId = trim(request.data?.tenantId);
    const startDate = trim(request.data?.startDate);
    const endDate = trim(request.data?.endDate);
    const hiringEntityId = trim(request.data?.hiringEntityId);
    if (!tenantId || !/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      throw new HttpsError('invalid-argument', 'tenantId, startDate, endDate (YYYY-MM-DD) are required.');
    }
    const rangeDays = (Date.parse(endDate) - Date.parse(startDate)) / 86400000;
    if (rangeDays < 0 || rangeDays > MAX_RANGE_DAYS) {
      throw new HttpsError('invalid-argument', `Date range must be 0-${MAX_RANGE_DAYS} days.`);
    }
    await ensureBooksAccess(request.auth?.uid, request.auth?.token as never, tenantId);

    // Entries in range. Single-field range on workDate is auto-indexed;
    // status + entity filters applied in memory.
    const snap = await db
      .collection(`tenants/${tenantId}/timesheet_entries`)
      .where('workDate', '>=', startDate)
      .where('workDate', '<=', endDate)
      .get();

    interface Picked {
      id: string;
      e: Record<string, unknown>;
    }
    const picked: Picked[] = [];
    snap.forEach((d) => {
      const e = d.data();
      // Canonical "money left HRX" statuses (live vocabulary 2026-07-28:
      // draft | approved | sent_to_everee | paid | error).
      const status = trim(e.status);
      if (status !== 'sent_to_everee' && status !== 'submitted' && status !== 'paid') return;
      if (hiringEntityId && trim(e.hiringEntityId) !== hiringEntityId) return;
      picked.push({ id: d.id, e });
    });

    // Resolve attribution via assignments (batched), then JO + account names.
    const assignmentIds = Array.from(
      new Set(picked.map((p) => trim(p.e.assignmentId)).filter(Boolean)),
    );
    const assignments = new Map<string, Record<string, unknown>>();
    for (let i = 0; i < assignmentIds.length; i += 100) {
      const chunk = assignmentIds.slice(i, i + 100);
      const snaps = await db.getAll(...chunk.map((id) => db.doc(`tenants/${tenantId}/assignments/${id}`)));
      snaps.forEach((s) => {
        if (s.exists) assignments.set(s.id, s.data() as Record<string, unknown>);
      });
    }

    const joIds = new Set<string>();
    const accountIds = new Set<string>();
    for (const p of picked) {
      const a = assignments.get(trim(p.e.assignmentId));
      const joId = trim(p.e.jobOrderId) || trim(a?.jobOrderId);
      if (joId) joIds.add(joId);
      // Entries carry accountId top-level (both scheduled and csv_import).
      const acctId = trim(p.e.accountId) || trim(a?.accountId);
      if (acctId) accountIds.add(acctId);
    }

    const joDocs = new Map<string, Record<string, unknown>>();
    for (const joId of joIds) {
      for (const coll of ['job_orders', 'jobOrders', 'recruiter_jobOrders']) {
        const s = await db.doc(`tenants/${tenantId}/${coll}/${joId}`).get();
        if (s.exists) {
          joDocs.set(joId, s.data() as Record<string, unknown>);
          const acctId = trim(s.data()?.recruiterAccountId);
          if (acctId) accountIds.add(acctId);
          break;
        }
      }
    }
    const accountDocs = new Map<string, Record<string, unknown>>();
    const acctIdList = Array.from(accountIds);
    for (let i = 0; i < acctIdList.length; i += 100) {
      const chunk = acctIdList.slice(i, i + 100);
      const snaps = await db.getAll(...chunk.map((id) => db.doc(`tenants/${tenantId}/accounts/${id}`)));
      snaps.forEach((s) => {
        if (s.exists) accountDocs.set(s.id, s.data() as Record<string, unknown>);
      });
    }

    // Venue-label mappings (admin-curated) — applied to rows that can't
    // resolve a JO through the assignment chain.
    const venueMappings = new Map<string, VenueMapping>();
    const mappingsSnap = await db.collection(`tenants/${tenantId}/payroll_venue_mappings`).get();
    mappingsSnap.forEach((d) => {
      const m = d.data() as VenueMapping & { venueKey?: string };
      const key = trim(m.venueKey) || normalizeVenueKey(trim(m.venueLabel));
      if (key && trim(m.jobOrderId)) venueMappings.set(key, m);
    });

    // Per-entry dollars — mirrors the server-side batch total math
    // (createTimesheetBatch) and the grid's dollarAmountForRow.
    const rows: ReportRow[] = [];
    for (const p of picked.slice(0, MAX_ROWS)) {
      const e = p.e;
      const a = assignments.get(trim(e.assignmentId));
      const isImport = trim(e.source) === 'csv_import';
      const rate = num(e.payRate);
      const reg = num(e.totalRegularHours);
      const ot = num(e.totalOTHours);
      const dt = num(e.totalDoubleTimeHours);
      const meal = num(e.mealBreakPenaltyHours);
      const rest = num(e.restBreakPenaltyHours);
      const tips = num(e.tips);
      const bonus = num(e.bonusAmount);
      const gross = isImport
        ? round2(reg * rate + ot * rate * 1.5)
        : round2(reg * rate + ot * rate * 1.5 + dt * rate * 2);
      const premiums = isImport ? 0 : round2((meal + rest) * rate);
      const total = round2(gross + premiums + tips + bonus);
      const hours = round2(reg + ot + dt);

      let joId = trim(e.jobOrderId) || trim(a?.jobOrderId) || null;
      const jo = joId ? joDocs.get(joId) : undefined;
      let acctId = trim(e.accountId) || trim(a?.accountId) || trim(jo?.recruiterAccountId) || null;
      const acct = acctId ? accountDocs.get(acctId) : undefined;
      const importSidecar = (e.import ?? {}) as Record<string, unknown>;
      const workerName =
        `${trim(a?.firstName)} ${trim(a?.lastName)}`.trim() ||
        trim(a?.workerDisplayName) ||
        null;

      // Submit-day key: entries don't carry a batch id in prod, and Everee
      // funds per pay run — (entity, submit date) is the wire-shaped group.
      const sentAt = e.sentToEvereeAt as admin.firestore.Timestamp | undefined;
      const sentDate = sentAt?.toDate ? sentAt.toDate().toISOString().slice(0, 10) : null;

      const worksiteName =
        trim(a?.worksiteName) ||
        trim(jo?.worksiteName) ||
        trim(importSidecar.worksiteName) ||
        trim(importSidecar.csvSite) ||
        trim(e.worksiteName) ||
        null;

      // Admin-curated venue mapping: rows that can't resolve a JO adopt
      // the mapped JO's identity (name/number/PO/account) at read time.
      // Two lookups, same memory (per Greg 2026-07-28): exact venue-label
      // match first, then mapped venue names appearing in free-text notes
      // ("all payments with that in the notes should connect").
      let joName = trim(jo?.jobOrderName) || null;
      let joNumber = trim(jo?.jobOrderNumber) || null;
      let joPo = trim(jo?.poNumber) || null;
      let acctName = trim(acct?.name) || null;
      if (!joId) {
        const m =
          (worksiteName ? venueMappings.get(normalizeVenueKey(worksiteName)) : undefined) ??
          findMappingInText(venueMappings, trim(e.notes));
        if (m) {
          joId = trim(m.jobOrderId) || null;
          joName = trim(m.jobOrderName) || null;
          joNumber = trim(m.jobOrderNumber) || null;
          joPo = trim(m.poNumber) || null;
          if (!acctId) acctId = trim(m.accountId) || null;
          if (!acctName) acctName = trim(m.accountName) || null;
        }
      }

      rows.push({
        entryId: p.id,
        workDate: trim(e.workDate),
        hiringEntityId: trim(e.hiringEntityId),
        batchId: sentDate ? `${trim(e.hiringEntityId) || 'entity'} · sent ${sentDate}` : null,
        workerId: trim(e.workerId),
        workerName,
        accountId: acctId,
        accountName: acctName,
        jobOrderId: joId,
        jobOrderName: joName,
        jobOrderNumber: joNumber,
        poNumber: joPo,
        worksiteName,
        hours,
        gross,
        tips,
        bonus,
        premiums,
        total,
        status: trim(e.status),
        source: isImport ? 'csv_import' : 'scheduled',
        payRate: rate || null,
        regularHours: round2(reg),
        overtimeHours: round2(ot),
        doubleTimeHours: round2(dt),
        workState:
          trim(e.workState).toUpperCase() ||
          trim((e.worksiteAddress as Record<string, unknown> | undefined)?.state).toUpperCase() ||
          trim((importSidecar.worksiteAddress as Record<string, unknown> | undefined)?.state).toUpperCase() ||
          null,
        workersCompCode: trim(e.workersCompCode) || null,
        workersCompRate: num(e.workersCompRate) || null,
      });
    }

    // Off-cycle payments (Mark's manual adjustments) — first-class rows,
    // attributed at creation time so no mapping/fallback chain needed.
    const ocSnap = await db
      .collection(`tenants/${tenantId}/offcycle_payments`)
      .where('workDate', '>=', startDate)
      .where('workDate', '<=', endDate)
      .get();
    ocSnap.forEach((d) => {
      const oc = d.data();
      const status = trim(oc.status);
      if (status !== 'sent_to_everee' && status !== 'paid') return;
      if (hiringEntityId && trim(oc.hiringEntityId) !== hiringEntityId) return;
      const sentAt = oc.sentToEvereeAt as admin.firestore.Timestamp | undefined;
      const sentDate = sentAt?.toDate ? sentAt.toDate().toISOString().slice(0, 10) : null;
      // Same mapping memory as timesheet entries: an off-cycle payment
      // saved without a job order links via its worksite label or a
      // mapped venue name in its notes/label text.
      let ocJoId = trim(oc.jobOrderId) || null;
      let ocJoName = trim(oc.jobOrderName) || null;
      let ocJoNumber = trim(oc.jobOrderNumber) || null;
      let ocPo = trim(oc.poNumber) || null;
      let ocAcctId = trim(oc.accountId) || null;
      let ocAcctName = trim(oc.accountName) || null;
      if (!ocJoId) {
        const wk = trim(oc.worksiteName);
        const m =
          (wk ? venueMappings.get(normalizeVenueKey(wk)) : undefined) ??
          findMappingInText(venueMappings, `${trim(oc.notes)} ${trim(oc.label)}`);
        if (m) {
          ocJoId = trim(m.jobOrderId) || null;
          ocJoName = trim(m.jobOrderName) || null;
          ocJoNumber = trim(m.jobOrderNumber) || null;
          ocPo = trim(m.poNumber) || null;
          if (!ocAcctId) ocAcctId = trim(m.accountId) || null;
          if (!ocAcctName) ocAcctName = trim(m.accountName) || null;
        }
      }
      rows.push({
        entryId: `offcycle:${d.id}`,
        workDate: trim(oc.workDate),
        hiringEntityId: trim(oc.hiringEntityId),
        batchId: sentDate ? `${trim(oc.hiringEntityId) || 'entity'} · sent ${sentDate}` : null,
        workerId: trim(oc.workerId),
        workerName: trim(oc.workerName) || null,
        accountId: ocAcctId,
        accountName: ocAcctName,
        jobOrderId: ocJoId,
        jobOrderName: ocJoName,
        jobOrderNumber: ocJoNumber,
        poNumber: ocPo,
        worksiteName: trim(oc.worksiteName) || null,
        hours: num(oc.hours),
        gross: num(oc.grossAmount),
        tips: 0,
        bonus: 0,
        premiums: 0,
        total: num(oc.total),
        status,
        source: `off_cycle (${trim(oc.reasonLabel) || trim(oc.reason)})`,
        payRate: num(oc.hourlyRate) || null,
        regularHours: num(oc.hours),
        overtimeHours: 0,
        doubleTimeHours: 0,
        workState: null,
        workersCompCode: null,
        workersCompRate: null,
      });
    });

    const grand = round2(rows.reduce((s, r) => s + r.total, 0));

    const group = (keyOf: (r: ReportRow) => string, labelOf: (r: ReportRow) => string): GroupTotals[] => {
      const m = new Map<string, GroupTotals & { workerSet: Set<string> }>();
      for (const r of rows) {
        const key = keyOf(r);
        let g = m.get(key);
        if (!g) {
          g = { key, label: labelOf(r), entries: 0, workers: 0, hours: 0, total: 0, pct: 0, workerSet: new Set() };
          m.set(key, g);
        }
        g.entries += 1;
        g.hours = round2(g.hours + r.hours);
        g.total = round2(g.total + r.total);
        g.workerSet.add(r.workerId);
      }
      return Array.from(m.values())
        .map(({ workerSet, ...g }) => ({ ...g, workers: workerSet.size, pct: grand > 0 ? round2((g.total / grand) * 100) : 0 }))
        .sort((x, y) => y.total - x.total);
    };

    // Name-first grouping (2026-07-28, per Greg): internal JO ids mean
    // different things per client (VenueSmart keys on customer PO, Flex
    // mints a job id per shift), so the stable attribution key — and the
    // future QBO class — is the NAME, scoped by account to avoid
    // cross-client collisions. Multiple JOs sharing a name merge into
    // one row; their #numbers and POs are listed as refs.
    interface ClassGroup extends GroupTotals {
      accountName: string | null;
      attributed: boolean;
      /** Internal JO #numbers merged into this row (context, not the key). */
      jobOrderRefs: string[];
      /** Customer PO numbers seen on the merged JOs. */
      poNumbers: string[];
      worksites: string[];
    }
    const classMap = new Map<string, ClassGroup & { workerSet: Set<string> }>();
    for (const r of rows) {
      const name = r.jobOrderName ?? r.worksiteName ?? 'Unknown';
      const key = `${r.accountId ?? ''}|${r.jobOrderName ? 'jo' : 'venue'}|${name}`;
      let g = classMap.get(key);
      if (!g) {
        g = {
          key,
          label: r.jobOrderName ? name : `Unattributed — ${name}`,
          accountName: r.accountName,
          attributed: Boolean(r.jobOrderName),
          jobOrderRefs: [],
          poNumbers: [],
          worksites: [],
          entries: 0,
          workers: 0,
          hours: 0,
          total: 0,
          pct: 0,
          workerSet: new Set<string>(),
        };
        classMap.set(key, g);
      }
      if (!g.accountName && r.accountName) g.accountName = r.accountName;
      const ref = r.jobOrderNumber ? `#${r.jobOrderNumber}` : null;
      if (ref && !g.jobOrderRefs.includes(ref)) g.jobOrderRefs.push(ref);
      if (r.poNumber && !g.poNumbers.includes(r.poNumber)) g.poNumbers.push(r.poNumber);
      if (r.worksiteName && !g.worksites.includes(r.worksiteName)) g.worksites.push(r.worksiteName);
      g.entries += 1;
      g.hours = round2(g.hours + r.hours);
      g.total = round2(g.total + r.total);
      g.workerSet.add(r.workerId);
    }
    const byJobOrder: ClassGroup[] = Array.from(classMap.values())
      .map(({ workerSet, ...g }) => ({
        ...g,
        workers: workerSet.size,
        pct: grand > 0 ? round2((g.total / grand) * 100) : 0,
      }))
      .sort((x, y) => y.total - x.total);
    const byAccount = group(
      (r) => r.accountId ?? 'unattributed',
      (r) => r.accountName ?? 'Unattributed',
    );

    // Per-batch split — the wire-parsing view for the bookkeeper.
    interface BatchSplit {
      batchId: string;
      hiringEntityId: string;
      total: number;
      entries: number;
      dateRange: { min: string; max: string };
      byJobOrder: Array<{ label: string; total: number; pct: number }>;
    }
    const batchMap = new Map<string, ReportRow[]>();
    for (const r of rows) {
      const key = r.batchId ?? 'no-batch';
      batchMap.set(key, [...(batchMap.get(key) ?? []), r]);
    }
    const byBatch: BatchSplit[] = Array.from(batchMap.entries())
      .map(([batchId, batchRows]) => {
        const total = round2(batchRows.reduce((s, r) => s + r.total, 0));
        const joTotals = new Map<string, { label: string; total: number }>();
        for (const r of batchRows) {
          // Class-path shaped label (Account:Name) so the split lines map
          // 1:1 onto QBO classes ("Venue Smart:FIFA KC"); name-keyed —
          // same-name JOs merge, unattributed rows fall back to venue.
          const name = r.jobOrderName ?? r.worksiteName;
          const label = name
            ? `${r.accountName ? `${r.accountName}:` : ''}${name}`
            : 'Unattributed';
          const cur = joTotals.get(label) ?? { label, total: 0 };
          cur.total = round2(cur.total + r.total);
          joTotals.set(label, cur);
        }
        const dates = batchRows.map((r) => r.workDate).sort();
        return {
          batchId,
          hiringEntityId: batchRows[0]?.hiringEntityId ?? '',
          total,
          entries: batchRows.length,
          dateRange: { min: dates[0] ?? '', max: dates[dates.length - 1] ?? '' },
          byJobOrder: Array.from(joTotals.values())
            .map((t) => ({ ...t, pct: total > 0 ? round2((t.total / total) * 100) : 0 }))
            .sort((x, y) => y.total - x.total),
        };
      })
      .sort((x, y) => (x.dateRange.max < y.dateRange.max ? 1 : -1));

    return {
      startDate,
      endDate,
      hiringEntityId: hiringEntityId || null,
      totals: {
        gross: grand,
        entries: rows.length,
        workers: new Set(rows.map((r) => r.workerId)).size,
        unattributed: round2(rows.filter((r) => !r.jobOrderId).reduce((s, r) => s + r.total, 0)),
      },
      truncated: picked.length > MAX_ROWS,
      byJobOrder,
      byAccount,
      byBatch,
      rows,
      venueMappings: Array.from(venueMappings.values()).map((m) => ({
        venueLabel: m.venueLabel,
        jobOrderId: m.jobOrderId,
        jobOrderName: m.jobOrderName,
        jobOrderNumber: m.jobOrderNumber,
        accountName: m.accountName,
      })),
    };
  },
);

/* -------------------------------------------------------------------------
 * Workers' comp monthly report (WC-C, Greg 2026-08-05)
 * ------------------------------------------------------------------------- */

interface WcMatrixMaps {
  /** `${STATE}_${code}` → rate, entity-scoped rows winning over generic. */
  rateByStateCode: Map<string, number>;
  /** `${STATE}_${lowercased title}` → { code, rate }, entity-scoped first. */
  byStateTitle: Map<string, { code: string; rate: number }>;
  /**
   * `${STATE}` → { code, rate } — the state DEFAULT, from a row whose
   * jobTitles contain '*'. Fallback when an entry has no resolvable job
   * title (import rows without a paired assignment); a real title match
   * always wins over the default.
   */
  byStateDefault: Map<string, { code: string; rate: number }>;
}

/**
 * Matrix rows may carry an optional `hiringEntityId` scope (added 2026-08-05):
 * C1 Events reports WC to the carrier on its own rate schedule even though
 * contractor codes never go to Everee, so the same state+code can price
 * differently per entity. Entity-scoped rows win; generic rows are the
 * fallback. Rows scoped to a DIFFERENT entity are ignored. (Account-scoped
 * `modifierAccountId` rows are excluded here as before — they exist for JO
 * pricing, not entity reporting.)
 */
async function loadWcMatrixForEntity(tenantId: string, hiringEntityId: string): Promise<WcMatrixMaps> {
  const snap = await db.collection(`tenants/${tenantId}/workers_comp_rates`).get();
  const rateByStateCode = new Map<string, number>();
  const byStateTitle = new Map<string, { code: string; rate: number }>();
  const byStateDefault = new Map<string, { code: string; rate: number }>();
  const apply = (docData: Record<string, unknown>): void => {
    const st = trim(docData.state).toUpperCase();
    const code = trim(docData.code);
    const rate = num(docData.rate);
    if (!st || !code) return;
    rateByStateCode.set(`${st}_${code}`, rate);
    const titles = Array.isArray(docData.jobTitles) ? (docData.jobTitles as unknown[]) : [];
    for (const t of titles) {
      const title = trim(t);
      if (title === '*') {
        byStateDefault.set(st, { code, rate });
        continue;
      }
      const key = `${st}_${title.toLowerCase()}`;
      if (key !== `${st}_`) byStateTitle.set(key, { code, rate });
    }
  };
  // Two passes: generic first, then entity-scoped so scoped entries overwrite.
  const generic: Array<Record<string, unknown>> = [];
  const scoped: Array<Record<string, unknown>> = [];
  snap.forEach((d) => {
    const x = d.data();
    if (trim(x.modifierAccountId)) return;
    const scope = trim(x.hiringEntityId);
    if (!scope) generic.push(x);
    else if (scope === hiringEntityId) scoped.push(x);
  });
  generic.forEach(apply);
  scoped.forEach(apply);
  return { rateByStateCode, byStateTitle, byStateDefault };
}

/**
 * Gross pay totals by work state + WC class code for one entity and one
 * calendar month — the carrier's monthly payroll report, generated from HRX.
 *
 * Codes resolve per entry at READ time: entry.workersCompCode →
 * assignment.workersCompCode → matrix (state + assignment jobTitle). C1
 * Events contractors are classified this way even though their codes never
 * reach Everee — C1 reports and pays WC premium on contractors (Greg
 * 2026-08-05). Whatever still can't resolve is returned as `unresolved`
 * groups (state + job title) so the UI can offer an assign-code control;
 * assigning writes a matrix row and the next Generate self-heals.
 *
 * Gross math mirrors getPayrollCostReport; contractor entities pay all hours
 * flat (no auto-OT). Premium = gross × rate / 100 per bucket.
 */
export const getWorkersCompMonthlyReport = onCall(
  { region: 'us-central1', memory: '1GiB', timeoutSeconds: 300 },
  async (request) => {
    const tenantId = trim(request.data?.tenantId);
    const hiringEntityId = trim(request.data?.hiringEntityId);
    const month = trim(request.data?.month); // YYYY-MM
    if (!tenantId || !hiringEntityId || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      throw new HttpsError('invalid-argument', 'tenantId, hiringEntityId, month (YYYY-MM) are required.');
    }
    await ensureBooksAccess(request.auth?.uid, request.auth?.token as never, tenantId);

    const startDate = `${month}-01`;
    const [y, m] = month.split('-').map(Number);
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const endDate = `${month}-${String(lastDay).padStart(2, '0')}`;

    const entitySnap = await db.doc(`tenants/${tenantId}/entities/${hiringEntityId}`).get();
    const entityData = (entitySnap.data() ?? {}) as Record<string, unknown>;
    const entityName = trim(entityData.name) || hiringEntityId;
    const isContractor =
      trim(entityData.workerType).toLowerCase() === 'contractor' ||
      /events|workforce/i.test(hiringEntityId);

    const matrix = await loadWcMatrixForEntity(tenantId, hiringEntityId);

    const snap = await db
      .collection(`tenants/${tenantId}/timesheet_entries`)
      .where('workDate', '>=', startDate)
      .where('workDate', '<=', endDate)
      .get();

    // First pass: pick entries + collect assignment ids for batched fetch.
    interface PickedEntry {
      e: Record<string, unknown>;
      total: number;
      hours: number;
      state: string;
    }
    const pickedEntries: PickedEntry[] = [];
    const assignmentIds = new Set<string>();
    snap.forEach((d) => {
      const e = d.data();
      const status = trim(e.status);
      if (status !== 'sent_to_everee' && status !== 'submitted' && status !== 'paid') return;
      if (trim(e.hiringEntityId) !== hiringEntityId) return;
      const isImport = trim(e.source) === 'csv_import';
      const rate = num(e.payRate);
      const reg = num(e.totalRegularHours);
      const ot = num(e.totalOTHours);
      const dt = num(e.totalDoubleTimeHours);
      const premiums = isImport ? 0 : round2((num(e.mealBreakPenaltyHours) + num(e.restBreakPenaltyHours)) * rate);
      const hourly = isContractor
        ? round2((reg + ot + dt) * rate)
        : isImport
          ? round2(reg * rate + ot * rate * 1.5)
          : round2(reg * rate + ot * rate * 1.5 + dt * rate * 2);
      const total = round2(hourly + premiums + num(e.tips) + num(e.bonusAmount));
      if (total === 0) return;
      const sidecarAddr = ((e.import ?? {}) as Record<string, unknown>).worksiteAddress as
        | Record<string, unknown>
        | undefined;
      const state =
        trim(e.workState).toUpperCase() ||
        trim((e.worksiteAddress as Record<string, unknown> | undefined)?.state).toUpperCase() ||
        trim(sidecarAddr?.state).toUpperCase() ||
        '';
      pickedEntries.push({ e, total, hours: round2(reg + ot + dt), state });
      const asnId = trim(e.assignmentId);
      if (asnId && !trim(e.workersCompCode)) assignmentIds.add(asnId);
    });

    // Batched assignment fetch for the resolution chain.
    const assignments = new Map<string, Record<string, unknown>>();
    const asnIdList = Array.from(assignmentIds);
    for (let i = 0; i < asnIdList.length; i += 100) {
      const chunk = asnIdList.slice(i, i + 100);
      const snaps = await db.getAll(...chunk.map((id) => db.doc(`tenants/${tenantId}/assignments/${id}`)));
      snaps.forEach((s) => {
        if (s.exists) assignments.set(s.id, s.data() as Record<string, unknown>);
      });
    }

    interface Bucket {
      state: string;
      code: string;
      gross: number;
      hours: number;
      entries: number;
      workers: Set<string>;
    }
    const buckets = new Map<string, Bucket>();
    interface UnresolvedGroup {
      state: string;
      jobTitle: string;
      gross: number;
      entries: number;
      workers: Set<string>;
    }
    const unresolvedGroups = new Map<string, UnresolvedGroup>();
    let totalGross = 0;
    let entryCount = 0;

    for (const p of pickedEntries) {
      const e = p.e;
      const state = p.state || '(no state)';
      // Resolution chain: entry stamp → assignment stamp → matrix by title →
      // per-state default ('*' title — set from the report's assign control
      // for import rows that carry no job title).
      let code = trim(e.workersCompCode);
      const a = assignments.get(trim(e.assignmentId));
      const jobTitle = trim(a?.jobTitle) || '(no title)';
      if (!code && a) {
        code = trim(a.workersCompCode);
        if (!code && p.state) {
          const hit = matrix.byStateTitle.get(`${p.state}_${jobTitle.toLowerCase()}`);
          if (hit) code = hit.code;
        }
      }
      if (!code && p.state) {
        const def = matrix.byStateDefault.get(p.state);
        if (def) code = def.code;
      }

      totalGross = round2(totalGross + p.total);
      entryCount += 1;
      const workerId = trim(e.workerId);

      if (!code || state === '(no state)') {
        const uKey = `${state}|${jobTitle}`;
        if (!unresolvedGroups.has(uKey)) {
          unresolvedGroups.set(uKey, { state, jobTitle, gross: 0, entries: 0, workers: new Set() });
        }
        const u = unresolvedGroups.get(uKey)!;
        u.gross = round2(u.gross + p.total);
        u.entries += 1;
        if (workerId) u.workers.add(workerId);
        continue;
      }

      const key = `${state}_${code}`;
      if (!buckets.has(key)) {
        buckets.set(key, { state, code, gross: 0, hours: 0, entries: 0, workers: new Set() });
      }
      const b = buckets.get(key)!;
      b.gross = round2(b.gross + p.total);
      b.hours = round2(b.hours + p.hours);
      b.entries += 1;
      if (workerId) b.workers.add(workerId);
    }

    // Off-cycle payments (no WC classification) — separate visible section.
    const ocSnap = await db
      .collection(`tenants/${tenantId}/offcycle_payments`)
      .where('workDate', '>=', startDate)
      .where('workDate', '<=', endDate)
      .get();
    const offCycle: Array<Record<string, unknown>> = [];
    let offCycleTotal = 0;
    ocSnap.forEach((d) => {
      const p = d.data();
      if (trim(p.hiringEntityId) !== hiringEntityId) return;
      if (trim(p.status) !== 'sent_to_everee' && trim(p.status) !== 'paid') return;
      const total = num(p.total);
      offCycleTotal = round2(offCycleTotal + total);
      offCycle.push({
        workDate: trim(p.workDate),
        workerName: trim(p.workerName),
        reasonLabel: trim(p.reasonLabel),
        total,
      });
    });

    let totalPremium = 0;
    const rows = Array.from(buckets.values())
      .map((b) => {
        const rate = matrix.rateByStateCode.get(`${b.state}_${b.code}`) ?? null;
        const premium = rate != null ? round2((b.gross * rate) / 100) : null;
        if (premium != null) totalPremium = round2(totalPremium + premium);
        return {
          state: b.state,
          code: b.code,
          rate,
          gross: b.gross,
          hours: b.hours,
          entries: b.entries,
          workers: b.workers.size,
          premium,
        };
      })
      .sort((a, b) => a.state.localeCompare(b.state) || a.code.localeCompare(b.code));

    const unresolved = Array.from(unresolvedGroups.values())
      .map((u) => ({
        state: u.state,
        jobTitle: u.jobTitle,
        gross: u.gross,
        entries: u.entries,
        workers: u.workers.size,
      }))
      .sort((a, b) => b.gross - a.gross);

    // Available codes per state for the assign dropdown — same options the
    // timesheets WC dialog shows: this entity's rated matrix codes, labeled
    // with the catalog title. Keyed by the states that actually need codes.
    const catalogSnap = await db.collection(`tenants/${tenantId}/workers_comp_class_codes`).get();
    const catalogTitle = new Map<string, string>();
    catalogSnap.forEach((d) => {
      const code = trim(d.data().code);
      if (code && !catalogTitle.has(code)) catalogTitle.set(code, trim(d.data().title));
    });
    // Every state in the report gets options — resolved rows are re-codeable
    // (click the code → pick the right one; rate follows the matrix), not
    // just the unresolved groups.
    const reportStates = new Set([
      ...unresolved.map((u) => u.state),
      ...rows.map((r) => r.state),
    ]);
    reportStates.delete('(no state)');
    const stateCodeOptions: Record<string, Array<{ code: string; rate: number; title: string | null }>> = {};
    for (const [key, rate] of matrix.rateByStateCode) {
      const sep = key.indexOf('_');
      const st = key.slice(0, sep);
      const code = key.slice(sep + 1);
      if (!reportStates.has(st)) continue;
      if (!stateCodeOptions[st]) stateCodeOptions[st] = [];
      stateCodeOptions[st].push({ code, rate, title: catalogTitle.get(code) ?? null });
    }
    // The 8040 placeholder (tenant convention, 2.35) is always offerable even
    // in a state whose matrix lacks the row yet.
    for (const st of reportStates) {
      if (!stateCodeOptions[st]) stateCodeOptions[st] = [];
      if (!stateCodeOptions[st].some((o) => o.code === '8040')) {
        stateCodeOptions[st].push({ code: '8040', rate: 2.35, title: 'Placeholder' });
      }
      stateCodeOptions[st].sort((a, b) => a.code.localeCompare(b.code));
    }

    return {
      month,
      startDate,
      endDate,
      hiringEntityId,
      entityName,
      workerType: isContractor ? 'contractor' : 'employee',
      rows,
      unresolved,
      unresolvedGross: round2(unresolved.reduce((s, u) => s + u.gross, 0)),
      stateCodeOptions,
      totalGross,
      totalPremium,
      entryCount,
      offCycle,
      offCycleTotal,
      grandTotal: round2(totalGross + offCycleTotal),
    };
  },
);

/**
 * Upsert one WC matrix row from the report's assign-code control. Optional
 * `hiringEntityId` writes an entity-scoped row (`STATE_CODE__e__ENTITY`) that
 * wins over the generic row for that entity's reports; omitted → generic row
 * (`STATE_CODE`). `jobTitles` merge (learn-once) so title-based resolution
 * self-heals next month. Books-gated like the reports it feeds.
 */
export const upsertWorkersCompRate = onCall(
  { region: 'us-central1', memory: '512MiB', timeoutSeconds: 30 },
  async (request) => {
    const tenantId = trim(request.data?.tenantId);
    const hiringEntityId = trim(request.data?.hiringEntityId);
    const state = trim(request.data?.state).toUpperCase();
    const code = trim(request.data?.code);
    const rate = num(request.data?.rate);
    const jobTitles = Array.isArray(request.data?.jobTitles)
      ? (request.data.jobTitles as unknown[]).map((t) => trim(t)).filter(Boolean).slice(0, 20)
      : [];
    if (!tenantId || !/^[A-Z]{2}$/.test(state) || !/^\d{3,4}$/.test(code) || !(rate >= 0) || rate > 100) {
      throw new HttpsError('invalid-argument', 'tenantId, state (XX), code (3-4 digits), rate (0-100) are required.');
    }
    await ensureBooksAccess(request.auth?.uid, request.auth?.token as never, tenantId);

    const docId = hiringEntityId ? `${state}_${code}__e__${hiringEntityId}` : `${state}_${code}`;
    const ref = db.doc(`tenants/${tenantId}/workers_comp_rates/${docId}`);
    const existing = await ref.get();
    const priorTitles = Array.isArray(existing.data()?.jobTitles)
      ? (existing.data()!.jobTitles as unknown[]).map((t) => trim(t))
      : [];
    const mergedTitles = Array.from(new Set([...priorTitles, ...jobTitles])).filter(Boolean);
    await ref.set(
      {
        state,
        code,
        rate,
        jobTitles: mergedTitles,
        ...(hiringEntityId ? { hiringEntityId } : {}),
        source: 'wc_report_assign',
        updatedBy: request.auth?.uid ?? null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    // Connect the code to the DATA, not just the matrix (Greg 2026-08-05):
    // stamp every uncoded assignment in this state (same entity + same job
    // title when one was learned) so the assignment chain — timesheets grid,
    // imports, payroll export — resolves without the report's read-time
    // fallback. FUTURE assignments self-classify via the matrix row written
    // above (the assignment-creation denorm resolver looks up state+title).
    // With `propagateMonth`, that month's uncoded entries get stamped too.
    //
    // `reclassifyFromCode` (Greg 2026-08-05, code-first editing): move the
    // state's assignments/entries OFF a wrong or unrated code onto this one
    // (e.g. NC 9014 → NC 8044, matching how the carrier actually bills), and
    // relearn the moved assignments' job titles onto the new matrix row so
    // future work classifies to the corrected code.
    const propagateMonth = trim(request.data?.propagateMonth); // YYYY-MM, optional
    const reclassifyFromCode = trim(request.data?.reclassifyFromCode); // optional old code
    const realTitles = jobTitles.filter((t) => t !== '*').map((t) => t.toLowerCase());
    let assignmentsStamped = 0;
    let entriesStamped = 0;
    const stampedAssignmentIds = new Set<string>();
    const movedTitles = new Set<string>();
    const asnSnap = await db
      .collection(`tenants/${tenantId}/assignments`)
      .where('worksiteState', '==', state)
      .get();
    let batch = db.batch();
    let batchN = 0;
    const flush = async (): Promise<void> => {
      if (batchN > 0) {
        await batch.commit();
        batch = db.batch();
        batchN = 0;
      }
    };
    for (const d of asnSnap.docs) {
      const a = d.data();
      if (hiringEntityId && trim(a.hiringEntityId) && trim(a.hiringEntityId) !== hiringEntityId) continue;
      const currentCode = trim(a.workersCompCode);
      const title = trim(a.jobTitle).toLowerCase();
      let matches: boolean;
      if (reclassifyFromCode) {
        matches = currentCode === reclassifyFromCode;
      } else {
        if (currentCode) continue;
        // Real-title assigns stamp matching titles; a state-default ('*')
        // assign stamps only title-less assignments — titled ones should get
        // their own explicit code.
        matches = realTitles.length > 0 ? realTitles.includes(title) : !title;
      }
      if (!matches) continue;
      batch.update(d.ref, {
        workersCompCode: code,
        workersCompRate: rate,
        workersCompSource: 'wc_report_assign',
      });
      stampedAssignmentIds.add(d.id);
      if (title) movedTitles.add(trim(a.jobTitle));
      assignmentsStamped += 1;
      batchN += 1;
      if (batchN >= 400) await flush();
    }
    await flush();

    // Relearn moved titles onto the new code's matrix row (entity-scoped rows
    // apply after generic, so these mappings win for this entity).
    if (reclassifyFromCode && movedTitles.size > 0) {
      const learned = Array.from(new Set([...mergedTitles, ...movedTitles])).filter(Boolean);
      await ref.set({ jobTitles: learned }, { merge: true });
    }

    if (/^\d{4}-(0[1-9]|1[0-2])$/.test(propagateMonth)) {
      const pStart = `${propagateMonth}-01`;
      const [py, pm] = propagateMonth.split('-').map(Number);
      const pEnd = `${propagateMonth}-${String(new Date(Date.UTC(py, pm, 0)).getUTCDate()).padStart(2, '0')}`;
      const eSnap = await db
        .collection(`tenants/${tenantId}/timesheet_entries`)
        .where('workDate', '>=', pStart)
        .where('workDate', '<=', pEnd)
        .get();
      for (const d of eSnap.docs) {
        const e = d.data();
        if (trim(e.workersCompCode)) continue;
        if (hiringEntityId && trim(e.hiringEntityId) !== hiringEntityId) continue;
        const sidecarAddr = ((e.import ?? {}) as Record<string, unknown>).worksiteAddress as
          | Record<string, unknown>
          | undefined;
        const eState =
          trim(e.workState).toUpperCase() ||
          trim((e.worksiteAddress as Record<string, unknown> | undefined)?.state).toUpperCase() ||
          trim(sidecarAddr?.state).toUpperCase();
        if (eState !== state) continue;
        const asnId = trim(e.assignmentId);
        // Reclassify moves entries carrying the old code; plain assigns stamp
        // uncoded entries (real-title: via the stamped assignments;
        // state-default: assignment-less ones too).
        const matches = reclassifyFromCode
          ? trim(e.workersCompCode) === reclassifyFromCode || stampedAssignmentIds.has(asnId)
          : realTitles.length > 0
            ? stampedAssignmentIds.has(asnId)
            : !asnId || stampedAssignmentIds.has(asnId);
        if (!matches) continue;
        batch.update(d.ref, {
          workersCompCode: code,
          workersCompRate: rate,
          workersCompSource: 'wc_report_assign',
        });
        entriesStamped += 1;
        batchN += 1;
        if (batchN >= 400) await flush();
      }
      await flush();
    }

    return { docId, state, code, rate, jobTitles: mergedTitles, assignmentsStamped, entriesStamped };
  },
);

/* -------------------------------------------------------------------------
 * Complete venue mapping — assignments as the point of truth (Greg 2026-08-05)
 * ------------------------------------------------------------------------- */

/**
 * The venue→JO label mapping alone is a READ-TIME patch: dollars report under
 * the JO but no assignments exist, so WC, rates, and future imports stay
 * hollow. This callable does the real repair: map the label AND materialize
 * an assignment per worker from the paid entries — position, pay rate (their
 * actual paid rate by default), JO/account/worksite — then stamp the entries
 * with assignmentId + attribution + WC. The assignment-write denorm trigger
 * fills worksite address/state; future imports pair to these assignments via
 * the normal date-window matcher, so the hole never reopens.
 *
 * Created assignments carry `retroactive: true` + `notificationsSuppressed:
 * true` (the existing contract every worker-facing notification trigger
 * honors) — no SMS/push to the 79 workers.
 */
export const completeVenueMapping = onCall(
  { region: 'us-central1', memory: '1GiB', timeoutSeconds: 300 },
  async (request) => {
    const tenantId = trim(request.data?.tenantId);
    const venueLabel = trim(request.data?.venueLabel);
    const jobOrderId = trim(request.data?.jobOrderId);
    const positionTitle = trim(request.data?.positionTitle);
    const rateMode = trim(request.data?.rateMode) === 'fixed' ? 'fixed' : 'actual';
    const fixedRate = num(request.data?.fixedRate);
    const sinceDate = /^\d{4}-\d{2}-\d{2}$/.test(trim(request.data?.sinceDate))
      ? trim(request.data?.sinceDate)
      : '2026-06-01';
    const dryRun = request.data?.dryRun !== false;
    if (!tenantId || !venueLabel || !jobOrderId) {
      throw new HttpsError('invalid-argument', 'tenantId, venueLabel, jobOrderId are required.');
    }
    if (rateMode === 'fixed' && !(fixedRate > 0)) {
      throw new HttpsError('invalid-argument', 'fixedRate must be > 0 when rateMode is fixed.');
    }
    await ensureBooksAccess(request.auth?.uid, request.auth?.token as never, tenantId);

    // Job order + account + anchor shift.
    let jo: Record<string, unknown> | null = null;
    let joColl = 'job_orders';
    for (const coll of ['job_orders', 'jobOrders', 'recruiter_jobOrders']) {
      const s = await db.doc(`tenants/${tenantId}/${coll}/${jobOrderId}`).get();
      if (s.exists) {
        jo = s.data() as Record<string, unknown>;
        joColl = coll;
        break;
      }
    }
    if (!jo) throw new HttpsError('not-found', `Job order ${jobOrderId} not found.`);
    const accountId = trim(jo.recruiterAccountId) || null;
    let accountName: string | null = trim(jo.accountName) || null;
    if (accountId && !accountName) {
      const acct = await db.doc(`tenants/${tenantId}/accounts/${accountId}`).get();
      accountName = acct.exists ? trim(acct.data()?.name) || null : null;
    }
    const joEntityId = trim(jo.hiringEntityId);
    const joStatus = trim(jo.status).toLowerCase();
    const ongoing = ['open', 'active', 'in_progress', 'filled'].includes(joStatus);
    const jobTitle = positionTitle || trim(jo.jobTitle) || '';

    const shiftsSnap = await db.collection(`tenants/${tenantId}/${joColl}/${jobOrderId}/shifts`).get();
    let anchorShiftId = '';
    let anchorShift: Record<string, unknown> | null = null;
    for (const d of shiftsSnap.docs) {
      const s = d.data();
      if (trim(s.shiftType) === 'open') {
        anchorShiftId = d.id;
        anchorShift = s;
        break;
      }
    }
    if (!anchorShiftId && shiftsSnap.docs.length > 0) {
      anchorShiftId = shiftsSnap.docs[0].id;
      anchorShift = shiftsSnap.docs[0].data();
    }
    // No shifts at all: a surrogate keeps the id convention without pointing
    // at a nonexistent shift doc (grid ignores it; pairing works by userId).
    const assignmentPrefix = anchorShiftId || `jo_${jobOrderId}`;

    // Entries carrying this venue label with no assignment/JO attribution.
    const wantedKey = normalizeVenueKey(venueLabel);
    const entriesSnap = await db
      .collection(`tenants/${tenantId}/timesheet_entries`)
      .where('workDate', '>=', sinceDate)
      .get();
    interface WorkerGroup {
      userId: string;
      entryIds: string[];
      minDate: string;
      maxDate: string;
      rates: Map<number, number>; // rate -> entry count
      entityIds: Set<string>;
      states: Set<string>;
    }
    const groups = new Map<string, WorkerGroup>();
    entriesSnap.forEach((d) => {
      const e = d.data();
      if (trim(e.assignmentId) || trim(e.jobOrderId)) return;
      const importSidecar = (e.import ?? {}) as Record<string, unknown>;
      const label =
        trim(e.worksiteName) || trim(importSidecar.worksiteName) || trim(importSidecar.csvSite);
      if (!label || normalizeVenueKey(label) !== wantedKey) return;
      const userId = trim(e.workerId);
      if (!userId) return;
      const workDate = trim(e.workDate);
      if (!groups.has(userId)) {
        groups.set(userId, {
          userId,
          entryIds: [],
          minDate: workDate,
          maxDate: workDate,
          rates: new Map(),
          entityIds: new Set(),
          states: new Set(),
        });
      }
      const g = groups.get(userId)!;
      g.entryIds.push(d.id);
      if (workDate < g.minDate) g.minDate = workDate;
      if (workDate > g.maxDate) g.maxDate = workDate;
      const r = num(e.payRate);
      if (r > 0) g.rates.set(r, (g.rates.get(r) ?? 0) + 1);
      if (trim(e.hiringEntityId)) g.entityIds.add(trim(e.hiringEntityId));
      const sidecarAddr = (importSidecar.worksiteAddress ?? {}) as Record<string, unknown>;
      const st =
        trim(e.workState).toUpperCase() ||
        trim((e.worksiteAddress as Record<string, unknown> | undefined)?.state).toUpperCase() ||
        trim(sidecarAddr.state).toUpperCase();
      if (st) g.states.add(st);
    });

    const workers = Array.from(groups.values());
    const totalEntries = workers.reduce((s, g) => s + g.entryIds.length, 0);
    const dominantEntity =
      joEntityId ||
      Array.from(
        workers.reduce((m, g) => {
          g.entityIds.forEach((id) => m.set(id, (m.get(id) ?? 0) + 1));
          return m;
        }, new Map<string, number>()),
      ).sort((a, b) => b[1] - a[1])[0]?.[0] ||
      '';

    // WC via the same chain the report uses (title -> state default).
    const matrix = dominantEntity ? await loadWcMatrixForEntity(tenantId, dominantEntity) : null;
    const wcFor = (state: string): { code: string; rate: number } | null => {
      if (!matrix || !state) return null;
      if (jobTitle) {
        const t = matrix.byStateTitle.get(`${state}_${jobTitle.toLowerCase()}`);
        if (t) return t;
      }
      return matrix.byStateDefault.get(state) ?? null;
    };

    // Worker names for preview + assignment docs.
    const userDocs = new Map<string, Record<string, unknown>>();
    const ids = workers.map((g) => g.userId);
    for (let i = 0; i < ids.length; i += 100) {
      const snaps = await db.getAll(...ids.slice(i, i + 100).map((id) => db.doc(`users/${id}`)));
      snaps.forEach((s) => {
        if (s.exists) userDocs.set(s.id, s.data() as Record<string, unknown>);
      });
    }

    const preview = {
      venueLabel,
      jobOrderId,
      jobOrderName: trim(jo.jobOrderName) || null,
      accountName,
      jobTitle,
      rateMode,
      ongoing,
      anchorShiftId: assignmentPrefix,
      hiringEntityId: dominantEntity || null,
      workers: workers.length,
      entries: totalEntries,
      dateSpan: workers.length
        ? `${workers.reduce((m, g) => (g.minDate < m ? g.minDate : m), workers[0].minDate)} → ${workers.reduce((m, g) => (g.maxDate > m ? g.maxDate : m), workers[0].maxDate)}`
        : null,
      rateSummary: Array.from(
        workers.reduce((m, g) => {
          g.rates.forEach((n, r) => m.set(r, (m.get(r) ?? 0) + n));
          return m;
        }, new Map<number, number>()),
      )
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([r, n]) => `$${r} × ${n}`),
      sample: workers.slice(0, 8).map((g) => {
        const u = userDocs.get(g.userId);
        return {
          name: `${trim(u?.firstName)} ${trim(u?.lastName)}`.trim() || g.userId,
          entries: g.entryIds.length,
          span: `${g.minDate} → ${g.maxDate}`,
        };
      }),
    };
    if (dryRun) return { dryRun: true, ...preview };

    // 1) The label mapping (read-time attribution for anything not stamped).
    await db.doc(`tenants/${tenantId}/payroll_venue_mappings/${venueMappingDocId(venueLabel)}`).set({
      venueLabel,
      venueKey: wantedKey,
      jobOrderId,
      jobOrderName: trim(jo.jobOrderName) || null,
      jobOrderNumber: trim(jo.jobOrderNumber) || null,
      poNumber: trim(jo.poNumber) || null,
      accountId,
      accountName,
      updatedByUid: request.auth?.uid ?? null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // 2) Assignments + entry stamps.
    let assignmentsCreated = 0;
    let assignmentsReused = 0;
    let entriesStamped = 0;
    for (const g of workers) {
      const u = userDocs.get(g.userId) ?? {};
      const assignmentId = `${assignmentPrefix}__${g.userId}`;
      const aRef = db.doc(`tenants/${tenantId}/assignments/${assignmentId}`);
      const existing = await aRef.get();
      // Most common actual rate; ties break to the highest (worker-favorable).
      const actualRate =
        Array.from(g.rates.entries()).sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0] ?? 0;
      const payRate = rateMode === 'fixed' ? fixedRate : actualRate;
      const state = g.states.size === 1 ? Array.from(g.states)[0] : Array.from(g.states)[0] ?? '';
      const wc = wcFor(state);
      if (!existing.exists) {
        await aRef.set({
          tenantId,
          jobOrderId,
          shiftId: anchorShiftId || null,
          candidateId: g.userId,
          userId: g.userId,
          status: ongoing ? 'active' : 'ended',
          startDate: g.minDate,
          endDate: ongoing ? '' : g.maxDate,
          startTime: trim(anchorShift?.startTime) || '',
          endTime: trim(anchorShift?.endTime) || '',
          payRate,
          billRate: num(jo.billRate) || 0,
          timesheetMode: trim(jo.timesheetMode) || 'import',
          firstName: trim(u.firstName),
          lastName: trim(u.lastName),
          email: trim(u.email),
          phone: trim(u.phone) || trim(u.phoneE164),
          companyId: trim(jo.companyId) || '',
          companyName: trim(jo.companyName) || accountName || '',
          accountId: accountId || null,
          accountName: accountName || null,
          hiringEntityId: dominantEntity || null,
          worksiteName: trim(jo.worksiteName) || venueLabel,
          jobOrderType: trim(jo.jobType) || 'gig',
          jobTitle,
          assignmentSource: 'venue_mapping_backfill',
          placementMode: 'retro_backfill',
          retroactive: true,
          notificationsSuppressed: true,
          suppressInitialNotification: true,
          ...(wc ? { workersCompCode: wc.code, workersCompRate: wc.rate, workersCompSource: 'venue_mapping_backfill' } : {}),
          createdBy: request.auth?.uid ?? null,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        assignmentsCreated += 1;
      } else {
        assignmentsReused += 1;
      }
      // Stamp the worker's entries.
      for (let i = 0; i < g.entryIds.length; i += 400) {
        const batch = db.batch();
        for (const entryId of g.entryIds.slice(i, i + 400)) {
          const patch: Record<string, unknown> = {
            assignmentId,
            jobOrderId,
            ...(accountId ? { accountId } : {}),
            ...(accountName ? { accountName } : {}),
          };
          if (wc) {
            patch.workersCompCode = wc.code;
            patch.workersCompRate = wc.rate;
            patch.workersCompSource = 'venue_mapping_backfill';
          }
          batch.update(db.doc(`tenants/${tenantId}/timesheet_entries/${entryId}`), patch);
        }
        await batch.commit();
        entriesStamped += g.entryIds.length > 400 ? 400 : g.entryIds.length;
      }
    }

    return { dryRun: false, ...preview, assignmentsCreated, assignmentsReused, entriesStamped };
  },
);
