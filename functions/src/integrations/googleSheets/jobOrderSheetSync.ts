/**
 * Per-job-order Google Sheet roster sync.
 *
 * One spreadsheet per JO (created on toggle-on), with one tab per shift.
 * Each tab lists the workers ON that shift (placements + live assignments)
 * with First name · Last name · Phone · Email · Status.
 *
 * Data sources (per shift `sid`):
 *   - tenants/{tid}/placements   where shiftId == sid   → "Placed"
 *   - tenants/{tid}/assignments  where shiftId == sid   → mapped status
 *     (cancelled/declined excluded — they're off the shift)
 *   - users/{uid} for name/phone/email
 */
import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';
import { getSheetsApi, getDriveApi, getSharedDriveId, isGoogleSheetsConfigured } from './sheetsClient';

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const HEADER = ['First Name', 'Last Name', 'Phone', 'Email', 'Status'];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function is404(e: unknown): boolean {
  const x = e as { code?: number | string; response?: { status?: number }; message?: string };
  return (
    x?.code === 404 ||
    x?.code === '404' ||
    x?.response?.status === 404 ||
    /not\s*found/i.test(String(x?.message || ''))
  );
}

/**
 * Run a Google API call. Retries on 404 (handles the Drive→Sheets eventual-
 * consistency race right after a file is created in a Shared Drive); on final
 * failure logs which step + the structured Google error.
 */
async function labeled<T>(step: string, ctx: Record<string, unknown>, fn: () => Promise<T>): Promise<T> {
  // A freshly Drive-created spreadsheet can briefly 404 on the Sheets API
  // (Drive→Sheets consistency). Re-syncs hit an already-propagated file.
  const delays = [1500, 3000, 5000]; // ~9.5s of patience
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (is404(e) && attempt < delays.length) {
        logger.info(`[jobOrderSheetSync] ${step} 404 — retrying`, { ...ctx, attempt: attempt + 1 });
        await sleep(delays[attempt]);
        continue;
      }
      const ge = e as { response?: { data?: unknown }; message?: string };
      logger.error(`[jobOrderSheetSync] ${step} failed`, {
        ...ctx,
        googleError: JSON.stringify(ge?.response?.data ?? ge?.message ?? String(e)).slice(0, 800),
      });
      throw e;
    }
  }
}

/** Map a raw assignment status to a recruiter-facing roster label, or null to exclude. */
function rosterStatusLabel(raw: string): string | null {
  const s = String(raw || '').toLowerCase();
  if (['cancelled', 'canceled', 'declined', 'worker-cancelled', 'worker_cancelled', 'deleted'].includes(s)) {
    return null; // off the shift — don't list
  }
  if (['proposed', 'pending', 'offered', 'pending_confirmation'].includes(s)) return 'Offered';
  if (s === 'accepted') return 'Accepted';
  if (s === 'confirmed') return 'Confirmed';
  if (s === 'in_progress') return 'In progress';
  if (s === 'completed') return 'Completed';
  return raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : 'Offered';
}

/** Sheets tab titles can't contain : \ / ? * [ ] and cap at 100 chars. */
function sanitizeTabTitle(name: string): string {
  return name.replace(/[:\\/?*[\]]/g, '-').slice(0, 90).trim() || 'Shift';
}

/**
 * Tab titles must be unique within a spreadsheet. Multiple shifts can resolve
 * to the same label (e.g. unnamed shifts on the same date → "Shift 6-12"), so
 * append a counter on collision, re-trimming to the 90-char budget.
 */
function uniqueTabTitle(base: string, used: Set<string>): string {
  let title = base;
  let n = 2;
  while (used.has(title)) {
    const suffix = ` (${n})`;
    title = `${base.slice(0, 90 - suffix.length).trim()}${suffix}`;
    n += 1;
  }
  used.add(title);
  return title;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** Pull {y,m,d} from a "YYYY-MM-DD" string or a Firestore Timestamp. */
function ymdParts(raw: unknown): { y: number; m: number; d: number } | null {
  const ts = raw as { toDate?: () => Date };
  if (typeof ts?.toDate === 'function') {
    const dt = ts.toDate();
    return { y: dt.getFullYear(), m: dt.getMonth() + 1, d: dt.getDate() };
  }
  if (typeof raw === 'string' && raw.trim()) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw.trim());
    if (m) return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
    const t = Date.parse(raw);
    if (!Number.isNaN(t)) {
      const dt = new Date(t);
      return { y: dt.getFullYear(), m: dt.getMonth() + 1, d: dt.getDate() };
    }
  }
  return null;
}

function weekdayName(y: number, m: number, d: number): string {
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

/** "Friday June 5th" — for tab titles (no year, to stay short). */
function tabDate(raw: unknown): string {
  const p = ymdParts(raw);
  if (!p) return '';
  return `${weekdayName(p.y, p.m, p.d)} ${MONTHS[p.m - 1]} ${ordinal(p.d)}`;
}

/** "Friday, June 5, 2026" — for the in-sheet detail heading. */
function longDate(raw: unknown): string {
  const p = ymdParts(raw);
  if (!p) return '';
  return `${weekdayName(p.y, p.m, p.d)}, ${MONTHS[p.m - 1]} ${p.d}, ${p.y}`;
}

/** "16:00" → "4:00 PM". */
function time12(raw: unknown): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(raw ?? '').trim());
  if (!m) return '';
  let h = Number(m[1]);
  const ampm = h >= 12 ? 'PM' : 'AM';
  h %= 12;
  if (h === 0) h = 12;
  return `${h}:${m[2]} ${ampm}`;
}

/** Sortable value: chronological by date then start time (undated/untimed last). */
function shiftSortValue(sd: Record<string, unknown>): number {
  const p = ymdParts(sd.shiftDate ?? sd.startDate);
  const dateNum = p ? p.y * 10000 + p.m * 100 + p.d : 99999999;
  const tm = /^(\d{1,2}):(\d{2})/.exec(String(sd.defaultStartTime ?? sd.startTime ?? ''));
  const minutes = tm ? Number(tm[1]) * 60 + Number(tm[2]) : 9999;
  return dateNum * 10000 + minutes;
}

interface ShiftRoster {
  tabTitle: string;
  /** Shift document id — needed to write placements back from the sheet. */
  shiftId: string;
  /** 2 shift-detail heading rows (single-cell each): title line + date/time/position. */
  headingLines: [string, string];
  /** worker rows (no header). Each: [first, last, phone, email, status, uid].
   * The trailing uid lives in a hidden column F and marks HRX-written rows so
   * the non-destructive sync can tell them apart from hand-typed rows. */
  rows: string[][];
}

/** Digits-only 10-digit US phone key (drops +1 / formatting), or '' if not 10. */
function normPhone(raw: unknown): string {
  let d = String(raw ?? '').replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
  return d.length === 10 ? d : '';
}

/** Build the per-shift roster data for a JO. */
async function buildRosters(tenantId: string, jobOrderId: string): Promise<ShiftRoster[]> {
  const shiftsSnap = await db
    .collection(`tenants/${tenantId}/job_orders/${jobOrderId}/shifts`)
    .get();

  const out: ShiftRoster[] = [];
  const usedTitles = new Set<string>();
  // Tabs are created in this order, so sort shifts chronologically up front.
  const sortedDocs = [...shiftsSnap.docs].sort(
    (a, b) => shiftSortValue(a.data()) - shiftSortValue(b.data()),
  );
  for (const shiftDoc of sortedDocs) {
    const sd = shiftDoc.data() as Record<string, unknown>;
    const sid = shiftDoc.id;
    const name = String(sd.shiftTitle || sd.shiftName || sd.name || sd.title || 'Shift');
    const dateRaw = sd.shiftDate ?? sd.startDate;
    const dateTab = tabDate(dateRaw);
    // e.g. "PM Cleaners, Friday June 5th"
    const tabTitle = uniqueTabTitle(
      sanitizeTabTitle(dateTab ? `${name}, ${dateTab}` : name),
      usedTitles,
    );

    // Two heading rows mirroring the shift-accordion header.
    const staff = sd.totalStaffRequested ?? sd.assignmentsTarget;
    const over = Number(sd.overstaffCount || 0);
    const titleLine =
      staff != null
        ? `${name}  ·  Staff: ${staff}${over ? ` (+${over} overstaff)` : ''}`
        : name;
    const startT = time12(sd.defaultStartTime ?? sd.startTime);
    const endT = time12(sd.defaultEndTime ?? sd.endTime);
    const timeStr = startT && endT ? `${startT} – ${endT}` : startT || endT || '';
    const position = String(sd.defaultJobTitle || sd.jobTitle || '');
    const detailLine = [longDate(dateRaw), timeStr, position].filter(Boolean).join('    •    ');
    const headingLines: [string, string] = [titleLine, detailLine];

    // Roster = placements ∪ non-cancelled assignments.
    const statusByUser = new Map<string, string>();
    const [plSnap, asnSnap] = await Promise.all([
      db.collection(`tenants/${tenantId}/placements`).where('shiftId', '==', sid).get(),
      db.collection(`tenants/${tenantId}/assignments`).where('shiftId', '==', sid).get(),
    ]);
    plSnap.forEach((d) => {
      const uid = String((d.data() as Record<string, unknown>).userId || '');
      if (uid) statusByUser.set(uid, 'Placed');
    });
    asnSnap.forEach((d) => {
      const a = d.data() as Record<string, unknown>;
      const uid = String(a.userId || a.candidateId || '');
      if (!uid) return;
      const label = rosterStatusLabel(String(a.status || ''));
      if (label === null) {
        // Cancelled assignment — only drop them if they have no placement.
        if (statusByUser.get(uid) === 'Placed') return;
        statusByUser.delete(uid);
        return;
      }
      statusByUser.set(uid, label);
    });

    const userIds = Array.from(statusByUser.keys());
    const rows: string[][] = [];
    if (userIds.length > 0) {
      const userRefs = userIds.map((uid) => db.doc(`users/${uid}`));
      const userDocs = await db.getAll(...userRefs);
      userDocs.forEach((u, i) => {
        const uid = userIds[i];
        const ud = (u.exists ? u.data() : {}) as Record<string, unknown>;
        rows.push([
          String(ud.firstName || ''),
          String(ud.lastName || ''),
          String(ud.phone || ud.phoneE164 || ''),
          String(ud.email || ''),
          statusByUser.get(uid) || '',
          uid, // hidden col F — marks this row as HRX-written
        ]);
      });
      // Sort by status then last name for a stable, readable roster.
      rows.sort((a, b) => (a[4].localeCompare(b[4]) || a[1].localeCompare(b[1])));
    }
    out.push({ tabTitle, shiftId: sid, headingLines, rows });
  }
  return out;
}

/** Create the spreadsheet for a JO if it doesn't exist yet; returns {spreadsheetId, url}. */
async function ensureSpreadsheet(
  tenantId: string,
  jobOrderId: string,
  joName: string,
): Promise<{ spreadsheetId: string; url: string; created: boolean }> {
  const joRef = db.doc(`tenants/${tenantId}/job_orders/${jobOrderId}`);
  const joSnap = await joRef.get();
  const gss = (joSnap.data() as { googleSheetSync?: { spreadsheetId?: string } } | undefined)
    ?.googleSheetSync;
  // NB: must read the field directly — `String(undefined && x)` yields the
  // literal string "undefined" (truthy), which would wrongly skip creation.
  const existing = String(gss?.spreadsheetId ?? '').trim();
  if (existing) {
    return {
      spreadsheetId: existing,
      url: `https://docs.google.com/spreadsheets/d/${existing}`,
      created: false,
    };
  }

  const drive = await getDriveApi();
  const sharedDriveId = getSharedDriveId();
  // Create the spreadsheet file directly in the Shared Drive via Drive API.
  const file = await labeled('files.create', { sharedDriveId }, () =>
    drive.files.create({
      supportsAllDrives: true,
      requestBody: {
        name: `${joName} — Roster`,
        mimeType: 'application/vnd.google-apps.spreadsheet',
        parents: [sharedDriveId],
      },
      fields: 'id, webViewLink',
    }),
  );
  const spreadsheetId = String(file.data.id || '');
  if (!spreadsheetId) throw new Error('Drive did not return a spreadsheet id');

  // Anyone with the link can VIEW (data flows HRX → sheet, so view-only).
  await labeled('permissions.create', { spreadsheetId }, () =>
    drive.permissions.create({
      fileId: spreadsheetId,
      supportsAllDrives: true,
      requestBody: { type: 'anyone', role: 'reader' },
    }),
  );

  const url = String(file.data.webViewLink || `https://docs.google.com/spreadsheets/d/${spreadsheetId}`);
  return { spreadsheetId, url, created: true };
}

/**
 * Full sync: ensure the spreadsheet + one tab per shift, then overwrite each
 * tab with the current roster. Idempotent. Returns the spreadsheet url.
 */
export async function syncJobOrderToSheet(
  tenantId: string,
  jobOrderId: string,
): Promise<{ spreadsheetId: string; url: string; shifts: number }> {
  if (!isGoogleSheetsConfigured()) {
    throw new Error(
      'Google Sheets sync is not configured (GOOGLE_SHEETS_SHARED_DRIVE_ID unset). See GOOGLE_SHEETS_SETUP.md.',
    );
  }
  const joRef = db.doc(`tenants/${tenantId}/job_orders/${jobOrderId}`);
  const joSnap = await joRef.get();
  if (!joSnap.exists) throw new Error(`Job order ${jobOrderId} not found`);
  const jo = joSnap.data() as Record<string, unknown>;
  const joName = String(jo.jobOrderName || jo.postTitle || jo.title || `Job Order ${jobOrderId}`);

  const { spreadsheetId, url, created } = await ensureSpreadsheet(tenantId, jobOrderId, joName);
  // Record the new file immediately so a mid-sync failure doesn't orphan it —
  // a retry then reuses this spreadsheet instead of creating another one.
  if (created) {
    await joRef.set({ googleSheetSync: { spreadsheetId, spreadsheetUrl: url } }, { merge: true });
  }
  const sheets = await getSheetsApi();
  const rosters = await buildRosters(tenantId, jobOrderId);

  // Current tabs on the spreadsheet (title → sheetId).
  const meta = await labeled('sheets.get', { spreadsheetId }, () =>
    sheets.spreadsheets.get({ spreadsheetId }),
  );
  const tabByTitle = new Map<string, number>();
  (meta.data.sheets || []).forEach((s) => {
    const t = s.properties?.title;
    if (t) tabByTitle.set(t, s.properties?.sheetId ?? 0);
  });

  // Add any missing shift tabs.
  const addRequests = rosters
    .filter((r) => !tabByTitle.has(r.tabTitle))
    .map((r) => ({ addSheet: { properties: { title: r.tabTitle } } }));
  if (addRequests.length > 0) {
    await labeled('addSheet.batchUpdate', { spreadsheetId }, () =>
      sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: addRequests } }),
    );
  }

  // Re-read tabs so newly-added sheets have their sheetId for formatting.
  const idByTitle = new Map<string, number>(tabByTitle);
  if (addRequests.length > 0) {
    const meta2 = await labeled('sheets.get', { spreadsheetId }, () =>
      sheets.spreadsheets.get({ spreadsheetId }),
    );
    (meta2.data.sheets || []).forEach((s) => {
      const t = s.properties?.title;
      if (t) idByTitle.set(t, s.properties?.sheetId ?? 0);
    });
  }

  // Non-destructive: read the existing data first so hand-typed rows survive.
  // A row is "manual" if its hidden col-F marker (uid) is blank but it has
  // content. We keep those (flagged "Not in HRX") unless their phone now
  // matches an HRX worker on this shift (then the HRX row represents them).
  const manualByTitle = new Map<string, string[][]>();
  try {
    const got = await labeled('values.batchGet', { spreadsheetId }, () =>
      sheets.spreadsheets.values.batchGet({
        spreadsheetId,
        ranges: rosters.map((r) => `'${r.tabTitle}'!A4:F1000`),
      }),
    );
    const valueRanges = got.data.valueRanges || [];
    rosters.forEach((r, i) => {
      const existing = (valueRanges[i]?.values || []) as string[][];
      const hrxPhones = new Set(r.rows.map((row) => normPhone(row[2])).filter(Boolean));
      const manual = existing
        .filter((er) => {
          const marker = String(er[5] ?? '').trim(); // col F = HRX uid
          const hasContent = er.slice(0, 5).some((c) => String(c ?? '').trim());
          if (marker || !hasContent) return false; // HRX-written or blank → not manual
          const p = normPhone(er[2]);
          return !p || !hrxPhones.has(p); // drop if their phone is now an HRX row
        })
        .map((er) => [
          String(er[0] ?? ''),
          String(er[1] ?? ''),
          String(er[2] ?? ''),
          String(er[3] ?? ''),
          'Not in HRX',
        ]);
      if (manual.length > 0) manualByTitle.set(r.tabTitle, manual);
    });
  } catch (e) {
    // Fresh sheet or unreadable — proceed with HRX rows only.
    logger.info('[jobOrderSheetSync] no existing rows to preserve', { spreadsheetId });
  }

  // Overwrite each tab: clear, then write the 2 heading rows + column header +
  // HRX rows (uid in hidden col F) + preserved manual rows.
  const clearRanges = rosters.map((r) => `'${r.tabTitle}'!A1:Z10000`);
  if (clearRanges.length > 0) {
    await labeled('values.batchClear', { spreadsheetId }, () =>
      sheets.spreadsheets.values.batchClear({ spreadsheetId, requestBody: { ranges: clearRanges } }),
    );
  }
  await labeled('values.batchUpdate', { spreadsheetId }, () =>
    sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        valueInputOption: 'RAW',
        data: rosters.map((r) => ({
          range: `'${r.tabTitle}'!A1`,
          values: [
            [r.headingLines[0]],
            [r.headingLines[1]],
            HEADER,
            ...r.rows,
            ...(manualByTitle.get(r.tabTitle) || []),
          ],
        })),
      },
    }),
  );

  // Polish: merge the 2 heading rows so the long title/detail spill rightward
  // (keeps column A narrow), bold title + column-header rows, freeze, autosize.
  // Order matters: merge BEFORE autoResize so column A sizes to the names only.
  const fmtRequests = rosters.flatMap((r) => {
    const sheetId = idByTitle.get(r.tabTitle);
    if (sheetId == null) return [];
    return [
      // Clear any prior heading merges, then merge each heading row across A:J.
      {
        unmergeCells: {
          range: { sheetId, startRowIndex: 0, endRowIndex: 2, startColumnIndex: 0, endColumnIndex: 26 },
        },
      },
      {
        mergeCells: {
          range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 10 },
          mergeType: 'MERGE_ALL',
        },
      },
      {
        mergeCells: {
          range: { sheetId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 0, endColumnIndex: 10 },
          mergeType: 'MERGE_ALL',
        },
      },
      {
        repeatCell: {
          range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
          cell: { userEnteredFormat: { textFormat: { bold: true, fontSize: 12 } } },
          fields: 'userEnteredFormat.textFormat',
        },
      },
      {
        repeatCell: {
          range: { sheetId, startRowIndex: 2, endRowIndex: 3 },
          cell: { userEnteredFormat: { textFormat: { bold: true } } },
          fields: 'userEnteredFormat.textFormat',
        },
      },
      {
        updateSheetProperties: {
          properties: { sheetId, gridProperties: { frozenRowCount: 3 } },
          fields: 'gridProperties.frozenRowCount',
        },
      },
      {
        autoResizeDimensions: {
          dimensions: { sheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: 5 },
        },
      },
      // Hide column F (the HRX-uid marker that drives non-destructive merge).
      {
        updateDimensionProperties: {
          range: { sheetId, dimension: 'COLUMNS', startIndex: 5, endIndex: 6 },
          properties: { hiddenByUser: true },
          fields: 'hiddenByUser',
        },
      },
    ];
  });
  if (fmtRequests.length > 0) {
    await labeled('format.batchUpdate', { spreadsheetId }, () =>
      sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: fmtRequests } }),
    );
  }

  // Remove stale tabs: the default "Sheet1", plus any tab from a previous sync
  // whose shift was renamed/removed (e.g. old "Shift 6-8" after the title change).
  // Guarded so we never delete the last sheet.
  if (rosters.length > 0) {
    const desired = new Set(rosters.map((r) => r.tabTitle));
    const staleIds = Array.from(idByTitle.entries())
      .filter(([title]) => !desired.has(title))
      .map(([, id]) => id);
    if (staleIds.length > 0) {
      try {
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: { requests: staleIds.map((sheetId) => ({ deleteSheet: { sheetId } })) },
        });
      } catch (e) {
        logger.warn('[jobOrderSheetSync] could not delete stale tabs', { jobOrderId });
      }
    }
  }

  // Order the tabs chronologically (rosters are already sorted). addSheet only
  // appends, so existing tabs from a prior sync must be re-indexed explicitly.
  // Applied 0,1,2,… in order — each move is stable against the running layout.
  const orderRequests = rosters
    .map((r, i) => ({ sheetId: idByTitle.get(r.tabTitle), index: i }))
    .filter((x): x is { sheetId: number; index: number } => x.sheetId != null)
    .map((x) => ({
      updateSheetProperties: { properties: { sheetId: x.sheetId, index: x.index }, fields: 'index' },
    }));
  if (orderRequests.length > 0) {
    await labeled('reorder.batchUpdate', { spreadsheetId }, () =>
      sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: orderRequests } }),
    );
  }

  // Stamp the JO with the linkage + last sync time.
  await joRef.set(
    {
      googleSheetSync: {
        enabled: true,
        spreadsheetId,
        spreadsheetUrl: url,
        lastSyncedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
    },
    { merge: true },
  );

  return { spreadsheetId, url, shifts: rosters.length };
}

/**
 * Find the single tenant user whose phone matches `phone10` (10-digit key).
 * Returns the uid, null (no match), or 'ambiguous' (more than one in-tenant).
 */
async function findTenantUserByPhone(
  tenantId: string,
  phone10: string,
): Promise<string | null | 'ambiguous'> {
  const e164 = `+1${phone10}`;
  const candidates = new Map<string, FirebaseFirestore.DocumentData>();
  // Try the common stored shapes (phoneE164, +1-prefixed, bare 10-digit).
  const queries = [
    db.collection('users').where('phoneE164', '==', e164),
    db.collection('users').where('phone', '==', e164),
    db.collection('users').where('phone', '==', phone10),
  ];
  for (const q of queries) {
    const snap = await q.get();
    snap.forEach((d) => candidates.set(d.id, d.data()));
  }
  // Last-ditch: phoneE164 stored without the +1.
  if (candidates.size === 0) {
    const snap = await db.collection('users').where('phoneE164', '==', phone10).get();
    snap.forEach((d) => candidates.set(d.id, d.data()));
  }
  const inTenant = Array.from(candidates.entries()).filter(([, u]) => {
    const tids = u.tenantIds as Record<string, unknown> | undefined;
    return (tids && tids[tenantId]) || u.tenantId === tenantId;
  });
  if (inTenant.length === 0) return null;
  if (inTenant.length > 1) return 'ambiguous';
  return inTenant[0][0];
}

/**
 * Pull hand-typed rows from the sheet back into HRX. For each manual row
 * (hidden col-F marker blank) with a phone that matches exactly one tenant
 * worker not already on that shift, create a placement (silent, like the
 * drag-drop "place"). Unmatched/ambiguous rows are left for the next sync to
 * flag "Not in HRX". Never deletes/​unplaces from sheet edits.
 *
 * Caller should run a normal sync afterward so placed workers migrate from
 * manual rows into the HRX roster.
 */
export async function pullSheetAdditionsToHrx(
  tenantId: string,
  jobOrderId: string,
  createdBy: string,
): Promise<{ placed: number; unmatched: number; ambiguous: number }> {
  const joRef = db.doc(`tenants/${tenantId}/job_orders/${jobOrderId}`);
  const jo = (await joRef.get()).data() as
    | { googleSheetSync?: { spreadsheetId?: string } }
    | undefined;
  const spreadsheetId = String(jo?.googleSheetSync?.spreadsheetId || '').trim();
  if (!spreadsheetId) {
    throw new Error('This job order has no linked sheet — enable sync first.');
  }

  const sheets = await getSheetsApi();
  const rosters = await buildRosters(tenantId, jobOrderId);
  if (rosters.length === 0) return { placed: 0, unmatched: 0, ambiguous: 0 };

  const got = await sheets.spreadsheets.values.batchGet({
    spreadsheetId,
    ranges: rosters.map((r) => `'${r.tabTitle}'!A4:F1000`),
  });
  const valueRanges = got.data.valueRanges || [];

  let placed = 0;
  let unmatched = 0;
  let ambiguous = 0;

  for (let i = 0; i < rosters.length; i += 1) {
    const r = rosters[i];
    const existing = (valueRanges[i]?.values || []) as string[][];
    const hrxPhones = new Set(r.rows.map((row) => normPhone(row[2])).filter(Boolean));
    for (const er of existing) {
      const marker = String(er[5] ?? '').trim(); // col F — HRX uid
      if (marker) continue; // HRX-written row
      const phone = normPhone(er[2]);
      if (!phone || hrxPhones.has(phone)) continue; // no phone, or already placed
      const match = await findTenantUserByPhone(tenantId, phone);
      if (match === 'ambiguous') {
        ambiguous += 1;
        continue;
      }
      if (!match) {
        unmatched += 1;
        continue;
      }
      // Silent placement — same shape as the drag-drop "place".
      const placementId = `${r.shiftId}__${match}`;
      await db.doc(`tenants/${tenantId}/placements/${placementId}`).set(
        {
          tenantId,
          jobOrderId,
          shiftId: r.shiftId,
          userId: match,
          createdBy,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          createdVia: 'google_sheet_pull',
        },
        { merge: true },
      );
      hrxPhones.add(phone); // avoid double-placing if the phone repeats in the tab
      placed += 1;
    }
  }

  return { placed, unmatched, ambiguous };
}
