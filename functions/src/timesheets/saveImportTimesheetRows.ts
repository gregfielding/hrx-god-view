/**
 * saveImportTimesheetRows — persist a CSV-import grid into timesheet_entries.
 *
 * The Timesheet Grid is the single source of truth: every imported row —
 * matched, needs-rate, blocked, even unmatched — is upserted as a
 * `timesheet_entries` doc under a synthetic `import__…` id (see
 * importEntryKeys.ts) so the recruiter's hour-long cleanup survives a reload
 * and blocked workers are never lost. The Import tab calls this on a manual
 * "Save progress" click.
 *
 * Import entries carry STRAIGHT-TIME totals (Everee classifies OT at the pay
 * run) and `source: 'csv_import'`, which short-circuits the recompute trigger.
 *
 * Idempotent: same (worker|csvKey, workDate) → same doc, merged. A "Save"
 * never downgrades a row that's already live in Everee (submit/void own that
 * transition). Duplicate (worker, day) rows are summed. A row that was blocked
 * (keyed by csvKey) and is now matched (keyed by userId) migrates — the old
 * csvKey doc is deleted in the same batch.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

import { importEntryDocId } from './importEntryKeys';

/** Entry states that are live in Everee — never deletable as "stale". */
const LIVE_STATUSES = new Set(['sent_to_everee', 'paid']);
const LIVE_MATCH_STATUSES = new Set(['submitted', 'paid']);

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

type ImportMatchStatus = 'ready' | 'needs_rate' | 'needs_wc' | 'blocked' | 'submitted' | 'voided';

interface SaveImportRow {
  rowIndex: number;
  workDate: string;
  hours: number;
  userId?: string | null;
  csvKey: string;
  csvWorkerName: string;
  csvEmail?: string | null;
  csvSite?: string | null;
  csvRole?: string | null;
  matchStatus: ImportMatchStatus;
  blockReason?: string | null;
  ambiguous?: boolean;
  evereeWorkerId?: string | null;
  evereeLinked?: boolean;
  matchedByName?: boolean;
  matchedManual?: boolean;
  forcedUserId?: string | null;
  assignmentId?: string | null;
  jobOrderId?: string | null;
  shiftId?: string | null;
  accountId?: string | null;
  worksiteId?: string | null;
  worksiteName?: string | null;
  worksiteAddress?: { street?: string; city?: string; state?: string; zip?: string } | null;
  workState?: string | null;
  payRate?: number | null;
  workersCompCode?: string | null;
  workersCompRate?: number | null;
  billRate?: number | null;
  payRateSource?: string | null;
  workersCompSource?: string | null;
  worksiteSource?: string | null;
}

/** Recruiter band (5–7) or an HRX super-admin token. Mirrors the gate used by
 *  the alias / site-mapping import callables. */
async function assertTimesheetEditor(
  uid: string,
  token: Record<string, unknown> | undefined,
  tenantId: string,
): Promise<void> {
  if (token?.hrx === true) return;
  const userSnap = await db.collection('users').doc(uid).get();
  const data = (userSnap.data() || {}) as Record<string, any>;
  const nested = data.tenantIds?.[tenantId]?.securityLevel;
  const level = Number.parseInt(String(nested ?? data.securityLevel ?? '0'), 10) || 0;
  if (level >= 5 && level <= 7) return;
  throw new HttpsError('permission-denied', 'Saving timesheets requires tenant security level 5–7.');
}

/** Canonical TimesheetEntryStatus for an import row's match status. Sent rows
 *  keep their payroll status; everything pre-submit is a `draft`. */
function canonicalStatus(matchStatus: ImportMatchStatus): 'draft' | 'sent_to_everee' {
  return matchStatus === 'submitted' ? 'sent_to_everee' : 'draft';
}

export const saveImportTimesheetRows = onCall(
  { cors: true, memory: '512MiB', timeoutSeconds: 120 },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Authentication required');
    }
    const { tenantId, hiringEntityId, customer, rows } = (request.data || {}) as {
      tenantId?: string;
      hiringEntityId?: string;
      customer?: string;
      rows?: SaveImportRow[];
    };
    if (!tenantId || !hiringEntityId || !Array.isArray(rows) || rows.length === 0) {
      throw new HttpsError('invalid-argument', 'tenantId, hiringEntityId, and rows[] are required');
    }
    if (rows.length > 2000) {
      throw new HttpsError('invalid-argument', 'Too many rows in one save (max 2000).');
    }
    await assertTimesheetEditor(request.auth.uid, request.auth.token as Record<string, unknown>, tenantId);

    const cust = String(customer || 'import').trim();
    const uid = request.auth.uid;

    // ── Aggregate by target doc id; sum hours for duplicate (worker, day). ──
    interface Planned {
      docId: string;
      row: SaveImportRow;
      hours: number;
      staleCsvKeyDocId?: string; // prior blocked doc to delete after a match
    }
    const byDoc = new Map<string, Planned>();
    for (const row of rows) {
      const workDate = String(row.workDate || '').trim();
      if (!workDate) continue;
      const userId = String(row.userId || '').trim();
      const csvKey = String(row.csvKey || '').trim() || 'unknown';
      const docId = importEntryDocId({ customer: cust, userId, csvKey, workDate });
      const hours = Number(row.hours) > 0 ? Number(row.hours) : 0;
      const existing = byDoc.get(docId);
      if (existing) {
        existing.hours += hours; // duplicate worker+day → sum
        continue;
      }
      // When a row is matched (has userId) but its csvKey would key a different
      // doc, that prior blocked doc must be removed.
      const csvKeyDocId = userId
        ? importEntryDocId({ customer: cust, userId: '', csvKey, workDate })
        : undefined;
      byDoc.set(docId, {
        docId,
        row,
        hours,
        staleCsvKeyDocId: csvKeyDocId && csvKeyDocId !== docId ? csvKeyDocId : undefined,
      });
    }

    const planned = [...byDoc.values()];

    // ── Pre-read existing docs so a Save can't downgrade an already-sent row. ──
    const sentDocIds = new Set<string>();
    const existingDocIds = new Set<string>();
    const existingAddrByDocId = new Map<
      string,
      { address: { street?: string; city?: string; state?: string; zip?: string }; worksiteName: string }
    >();
    const READ_CHUNK = 300;
    for (let i = 0; i < planned.length; i += READ_CHUNK) {
      const slice = planned.slice(i, i + READ_CHUNK);
      const refs = slice.map((p) =>
        db.doc(`tenants/${tenantId}/timesheet_entries/${p.docId}`),
      );
      // eslint-disable-next-line no-await-in-loop
      const snaps = await db.getAll(...refs);
      snaps.forEach((snap, j) => {
        if (!snap.exists) return;
        existingDocIds.add(slice[j].docId);
        const d = snap.data() || {};
        const st = String(d.status || '');
        const ms = String((d.import || {}).matchStatus || '');
        if (st === 'sent_to_everee' || st === 'paid' || ms === 'submitted') {
          sentDocIds.add(slice[j].docId);
        }
        // Address preservation (2026-07-23): remember an existing
        // COMPLETE worksite address so a re-save from stale browser
        // state can't clobber a repaired street with an empty one.
        const wa = (d.import || {}).worksiteAddress as
          | { street?: string; city?: string; state?: string; zip?: string }
          | undefined;
        if (wa && String(wa.street || '').trim()) {
          existingAddrByDocId.set(slice[j].docId, {
            address: wa,
            worksiteName: String((d.import || {}).worksiteName || ''),
          });
        }
      });
    }

    // ── Entity exception (Greg, 2026-07-22) ──────────────────────────
    // A job order can override its account's default entity (Venue
    // Smart Supervisors Travel Team runs W-2 under C1 Select while
    // Venuesmart is otherwise C1 Events/1099). The paired ASSIGNMENT's
    // hiringEntityId is authoritative for its rows: hours must post to
    // the entity that actually employs and pays the worker, no matter
    // which entity the import screen was on. Overridden entries stamp
    // `import.entityOverrideFrom` for audit and land on the other
    // entity's Timesheets grid + Everee submission automatically
    // (every downstream query keys on hiringEntityId).
    const assignmentEntityCache = new Map<string, string>();
    const entityForAssignment = async (assignmentId: string): Promise<string> => {
      if (!assignmentId) return '';
      const cached = assignmentEntityCache.get(assignmentId);
      if (cached !== undefined) return cached;
      let e = '';
      try {
        const snap = await db.doc(`tenants/${tenantId}/assignments/${assignmentId}`).get();
        e = String((snap.data() || {}).hiringEntityId || '').trim();
      } catch {
        /* fall back to the batch entity */
      }
      assignmentEntityCache.set(assignmentId, e);
      return e;
    };
    let entityOverrides = 0;

    const byStatus: Record<string, number> = {};
    let writer = db.batch();
    let pending = 0;
    const entryIds: string[] = [];
    const flush = async () => {
      if (pending > 0) {
        await writer.commit();
        writer = db.batch();
        pending = 0;
      }
    };

    for (const p of planned) {
      const { row, docId, hours } = p;
      const userId = String(row.userId || '').trim();
      const workDate = String(row.workDate || '').trim();
      const preserveSent = sentDocIds.has(docId);
      byStatus[row.matchStatus] = (byStatus[row.matchStatus] || 0) + 1;
      entryIds.push(docId);

      const importSidecar: Record<string, unknown> = {
        customer: cust,
        csvWorkerName: String(row.csvWorkerName || ''),
        csvEmail: String(row.csvEmail || ''),
        csvSite: row.csvSite ?? '',
        csvRole: row.csvRole ?? '',
        blockReason: row.blockReason ?? null,
        ambiguous: !!row.ambiguous,
        evereeWorkerId: row.evereeWorkerId ?? null,
        evereeLinked: !!row.evereeLinked,
        matchedByName: !!row.matchedByName,
        matchedManual: !!row.matchedManual,
        forcedUserId: row.forcedUserId ?? null,
        worksiteId: row.worksiteId ?? null,
        worksiteName: row.worksiteName ?? null,
        worksiteAddress: (() => {
          const incoming = row.worksiteAddress ?? null;
          const kept = existingAddrByDocId.get(docId);
          // Same worksite + incoming street empty + saved street present →
          // keep the saved (complete) address. Repairs made directly on the
          // entry survive re-saves from tabs that predate them.
          if (
            kept &&
            (!incoming || !String(incoming.street || '').trim()) &&
            (!row.worksiteName || String(row.worksiteName) === kept.worksiteName || !kept.worksiteName)
          ) {
            return kept.address;
          }
          return incoming;
        })(),
        workersCompCode: row.workersCompCode ?? null,
        workersCompRate: row.workersCompRate ?? null,
        payRateSource: row.payRateSource ?? 'none',
        workersCompSource: row.workersCompSource ?? 'none',
        worksiteSource: row.worksiteSource ?? 'none',
        csvKey: String(row.csvKey || ''),
        rowIndex: row.rowIndex,
      };
      // Only set matchStatus here when NOT preserving a sent row (submit/void
      // own that field once live).
      if (!preserveSent) importSidecar.matchStatus = row.matchStatus;

      // eslint-disable-next-line no-await-in-loop
      const assignmentEntity = await entityForAssignment(String(row.assignmentId || ''));
      const effectiveEntityId =
        assignmentEntity && assignmentEntity !== hiringEntityId ? assignmentEntity : hiringEntityId;
      if (effectiveEntityId !== hiringEntityId) {
        entityOverrides += 1;
        importSidecar.entityOverrideFrom = hiringEntityId;
      }

      const doc: Record<string, unknown> = {
        id: docId,
        tenantId,
        source: 'csv_import',
        hiringEntityId: effectiveEntityId,
        accountId: row.accountId ?? '',
        assignmentId: row.assignmentId ?? '',
        jobOrderId: row.jobOrderId ?? '',
        shiftId: row.shiftId ?? '',
        workerId: userId,
        workDate,
        workState: row.workState ?? (row.worksiteAddress?.state || ''),
        scheduledStartTime: '',
        scheduledEndTime: '',
        scheduledBreakMinutes: 0,
        actualStartTime: '',
        actualEndTime: '',
        breaks: [],
        actualHoursOverride: hours,
        // Straight-time — Everee classifies OT/DT. The recompute trigger
        // short-circuits on source:'csv_import' so these are never touched.
        totalRegularHours: hours,
        totalOTHours: 0,
        totalFlsaOTHours: 0,
        totalNonFlsaOTHours: 0,
        totalDoubleTimeHours: 0,
        mealBreakPenaltyHours: 0,
        restBreakPenaltyHours: 0,
        tips: 0,
        bonusAmount: 0,
        payRate: Number(row.payRate) > 0 ? Number(row.payRate) : 0,
        billRate: Number(row.billRate) > 0 ? Number(row.billRate) : 0,
        workersCompCode: row.workersCompCode ?? null,
        workersCompRate: row.workersCompRate ?? null,
        import: importSidecar,
        updatedBy: uid,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      if (!preserveSent) doc.status = canonicalStatus(row.matchStatus);
      if (!existingDocIds.has(docId)) {
        doc.createdBy = uid;
        doc.createdAt = admin.firestore.FieldValue.serverTimestamp();
      }

      writer.set(db.doc(`tenants/${tenantId}/timesheet_entries/${docId}`), doc, { merge: true });
      pending += 1;

      // Clean up a prior blocked (csvKey-keyed) doc now that the row is matched.
      if (p.staleCsvKeyDocId) {
        writer.delete(db.doc(`tenants/${tenantId}/timesheet_entries/${p.staleCsvKeyDocId}`));
        pending += 1;
      }

      if (pending >= 400) {
        // eslint-disable-next-line no-await-in-loop
        await flush();
      }
    }
    await flush();

    return { ok: true, upserted: planned.length, byStatus, entryIds, entityOverrides };
  },
);

/**
 * deleteStaleImportEntries — remove orphan import rows left by a re-upload.
 *
 * When a recruiter re-uploads a corrected week, rows that were in the prior
 * upload but absent from the new one become stale `timesheet_entries`. This
 * deletes them — scoped to (hiringEntity, customer) within a workDate range,
 * and ONLY rows NOT in `keepDocIds` and NOT live in Everee (submitted/paid are
 * always kept). `dryRun` returns the count without deleting so the client can
 * confirm first.
 */
export const deleteStaleImportEntries = onCall(
  { cors: true, memory: '512MiB', timeoutSeconds: 120 },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Authentication required');
    }
    const { tenantId, hiringEntityId, customer, keepDocIds, minDate, maxDate, dryRun } =
      (request.data || {}) as {
        tenantId?: string;
        hiringEntityId?: string;
        customer?: string;
        keepDocIds?: string[];
        minDate?: string;
        maxDate?: string;
        dryRun?: boolean;
      };
    if (!tenantId || !hiringEntityId || !customer || !minDate || !maxDate) {
      throw new HttpsError(
        'invalid-argument',
        'tenantId, hiringEntityId, customer, minDate, and maxDate are required',
      );
    }
    await assertTimesheetEditor(request.auth.uid, request.auth.token as Record<string, unknown>, tenantId);

    const keep = new Set(Array.isArray(keepDocIds) ? keepDocIds : []);
    const snap = await db
      .collection(`tenants/${tenantId}/timesheet_entries`)
      .where('source', '==', 'csv_import')
      .where('hiringEntityId', '==', hiringEntityId)
      .where('workDate', '>=', String(minDate))
      .where('workDate', '<=', String(maxDate))
      .get();

    const stale: string[] = [];
    let live = 0;
    snap.forEach((d) => {
      const data = d.data() || {};
      if (String((data.import || {}).customer || '') !== customer) return;
      if (keep.has(d.id)) return;
      if (LIVE_STATUSES.has(String(data.status || '')) || LIVE_MATCH_STATUSES.has(String((data.import || {}).matchStatus || ''))) {
        live += 1;
        return; // never delete a row that's live in Everee
      }
      stale.push(d.id);
    });

    if (dryRun) {
      return { dryRun: true, staleCount: stale.length, liveKept: live, sample: stale.slice(0, 20) };
    }

    let deleted = 0;
    let writer = db.batch();
    let pending = 0;
    for (const id of stale) {
      writer.delete(db.doc(`tenants/${tenantId}/timesheet_entries/${id}`));
      deleted += 1;
      if (++pending >= 450) {
        // eslint-disable-next-line no-await-in-loop
        await writer.commit();
        writer = db.batch();
        pending = 0;
      }
    }
    if (pending > 0) await writer.commit();

    return { dryRun: false, deleted, liveKept: live };
  },
);
