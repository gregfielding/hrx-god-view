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

function shortDate(raw: unknown): string {
  let d: Date | null = null;
  const ts = raw as { toDate?: () => Date };
  if (typeof ts?.toDate === 'function') d = ts.toDate();
  else if (typeof raw === 'string' && raw) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
    if (m) return `${Number(m[2])}/${Number(m[3])}`;
    const t = Date.parse(raw);
    if (!Number.isNaN(t)) d = new Date(t);
  }
  if (!d || Number.isNaN(d.getTime())) return '';
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

interface ShiftRoster {
  tabTitle: string;
  rows: string[][]; // worker rows (no header)
}

/** Build the per-shift roster data for a JO. */
async function buildRosters(tenantId: string, jobOrderId: string): Promise<ShiftRoster[]> {
  const shiftsSnap = await db
    .collection(`tenants/${tenantId}/job_orders/${jobOrderId}/shifts`)
    .get();

  const out: ShiftRoster[] = [];
  for (const shiftDoc of shiftsSnap.docs) {
    const sd = shiftDoc.data() as Record<string, unknown>;
    const sid = shiftDoc.id;
    const name = String(sd.shiftName || sd.name || sd.title || 'Shift');
    const dateLabel = shortDate(sd.shiftDate ?? sd.startDate);
    const tabTitle = sanitizeTabTitle(dateLabel ? `${name} ${dateLabel}` : name);

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
        ]);
      });
      // Sort by status then last name for a stable, readable roster.
      rows.sort((a, b) => (a[4].localeCompare(b[4]) || a[1].localeCompare(b[1])));
    }
    out.push({ tabTitle, rows });
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
  const existing = String(
    (joSnap.data() as Record<string, unknown> | undefined)?.googleSheetSync &&
      ((joSnap.data() as any).googleSheetSync.spreadsheetId || ''),
  ).trim();
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
  const file = await drive.files.create({
    supportsAllDrives: true,
    requestBody: {
      name: `${joName} — Roster`,
      mimeType: 'application/vnd.google-apps.spreadsheet',
      parents: [sharedDriveId],
    },
    fields: 'id, webViewLink',
  });
  const spreadsheetId = String(file.data.id || '');
  if (!spreadsheetId) throw new Error('Drive did not return a spreadsheet id');

  // Anyone with the link can VIEW (data flows HRX → sheet, so view-only).
  await drive.permissions.create({
    fileId: spreadsheetId,
    supportsAllDrives: true,
    requestBody: { type: 'anyone', role: 'reader' },
  });

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
  const sheets = await getSheetsApi();
  const rosters = await buildRosters(tenantId, jobOrderId);

  // Current tabs on the spreadsheet (title → sheetId).
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
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
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: addRequests },
    });
  }

  // Overwrite each tab: clear, then write header + rows.
  const clearRanges = rosters.map((r) => `'${r.tabTitle}'!A1:Z10000`);
  if (clearRanges.length > 0) {
    await sheets.spreadsheets.values.batchClear({ spreadsheetId, requestBody: { ranges: clearRanges } });
  }
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: 'RAW',
      data: rosters.map((r) => ({
        range: `'${r.tabTitle}'!A1`,
        values: [HEADER, ...r.rows],
      })),
    },
  });

  // Remove the auto-created default "Sheet1" once real tabs exist.
  if (created) {
    const defaultId = tabByTitle.get('Sheet1');
    if (defaultId != null && rosters.length > 0) {
      try {
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: { requests: [{ deleteSheet: { sheetId: defaultId } }] },
        });
      } catch (e) {
        logger.warn('[jobOrderSheetSync] could not delete default Sheet1', { jobOrderId });
      }
    }
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
