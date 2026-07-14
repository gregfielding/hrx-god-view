/**
 * Google Drive case folders (Migration Plan P2.5, 2026-07-13).
 *
 * The Cloud Functions runtime service account
 * (143752240496-compute@developer.gserviceaccount.com) is a Content
 * Manager on the "C1 Compliance" Shared Drive, so deployed functions can
 * create folders there via Application Default Credentials — no key files.
 *
 * ensureCaseDriveFolder builds the P0 runbook's convention inside the
 * Shared Drive:  Background Checks / {year} / {Last, First — HRX id}
 * (find-or-create at every level, so re-opened cases reuse their folder).
 *
 * Drive id resolution: `complianceDriveId` on
 * tenants/{tid}/integrations/accusource; when missing, drives.list is
 * queried (prefer a drive whose name contains "compliance") and the id is
 * cached back to the config doc. Everything is best-effort: no Shared
 * Drive membership / API failure → null, and callers proceed without a
 * folder (the case itself must never fail on Drive).
 */
import * as admin from 'firebase-admin';
import { google } from 'googleapis';
import { accusourceLog } from '../integrations/accusource/accusourceLogger';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

const FOLDER_MIME = 'application/vnd.google-apps.folder';

async function getDrive() {
  const auth = new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/drive'],
  });
  return google.drive({ version: 'v3', auth });
}

function escapeDriveQuery(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/** "First [Middle] Last" → "Last, First [Middle]"; single tokens pass through. */
export function caseFolderNameFor(candidateName: string, candidateId: string): string {
  const clean = candidateName.replace(/[/\\]/g, ' ').replace(/\s+/g, ' ').trim();
  const parts = clean.split(' ');
  const display =
    parts.length >= 2 ? `${parts[parts.length - 1]}, ${parts.slice(0, -1).join(' ')}` : clean || 'Unknown';
  return `${display} — ${candidateId}`;
}

async function resolveComplianceDriveId(tenantId: string): Promise<string | null> {
  const cfgRef = db.doc(`tenants/${tenantId}/integrations/accusource`);
  const cfg = (await cfgRef.get()).data() ?? {};
  const cached = String(cfg.complianceDriveId ?? '').trim();
  if (cached) return cached;

  const drive = await getDrive();
  const res = await drive.drives.list({ pageSize: 10, fields: 'drives(id,name)' });
  const drives = res.data.drives ?? [];
  if (drives.length === 0) return null;
  const preferred =
    drives.find((d) => String(d.name ?? '').toLowerCase().includes('compliance')) ?? drives[0];
  if (!preferred.id) return null;
  await cfgRef.set(
    {
      complianceDriveId: preferred.id,
      complianceDriveName: preferred.name ?? null,
      complianceDriveIdResolvedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  accusourceLog('info', 'drive', 'Compliance Shared Drive id auto-resolved and cached', {
    tenantId,
    driveName: preferred.name,
  });
  return preferred.id;
}

async function findOrCreateFolder(
  drive: Awaited<ReturnType<typeof getDrive>>,
  driveId: string,
  parentId: string,
  name: string,
): Promise<{ id: string; webViewLink: string | null }> {
  const q = `name = '${escapeDriveQuery(name)}' and mimeType = '${FOLDER_MIME}' and '${parentId}' in parents and trashed = false`;
  const found = await drive.files.list({
    q,
    corpora: 'drive',
    driveId,
    includeItemsFromAllDrives: true,
    supportsAllDrives: true,
    fields: 'files(id, webViewLink)',
    pageSize: 1,
  });
  const hit = found.data.files?.[0];
  if (hit?.id) return { id: hit.id, webViewLink: hit.webViewLink ?? null };

  const created = await drive.files.create({
    supportsAllDrives: true,
    fields: 'id, webViewLink',
    requestBody: { name, mimeType: FOLDER_MIME, parents: [parentId] },
  });
  return { id: created.data.id as string, webViewLink: created.data.webViewLink ?? null };
}

export interface CaseDriveFolder {
  folderId: string;
  folderUrl: string;
}

/** Best-effort: file a document (e.g. a sent notice) into a case folder. */
export async function uploadToCaseFolder(params: {
  folderId: string;
  name: string;
  content: string | Buffer;
  mimeType: string;
}): Promise<string | null> {
  try {
    const drive = await getDrive();
    const created = await drive.files.create({
      supportsAllDrives: true,
      fields: 'id',
      requestBody: { name: params.name, parents: [params.folderId] },
      media: { mimeType: params.mimeType, body: params.content as never },
    });
    return (created.data.id as string) ?? null;
  } catch (err) {
    accusourceLog('warn', 'drive', 'uploadToCaseFolder failed (send proceeds)', {
      name: params.name,
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/** Best-effort: returns null when the Shared Drive isn't configured/reachable. */
export async function ensureCaseDriveFolder(params: {
  tenantId: string;
  candidateId: string;
  candidateName: string;
}): Promise<CaseDriveFolder | null> {
  const { tenantId, candidateId, candidateName } = params;
  try {
    const driveId = await resolveComplianceDriveId(tenantId);
    if (!driveId) return null;
    const drive = await getDrive();
    const root = await findOrCreateFolder(drive, driveId, driveId, 'Background Checks');
    const year = await findOrCreateFolder(drive, driveId, root.id, String(new Date().getFullYear()));
    const leaf = await findOrCreateFolder(
      drive,
      driveId,
      year.id,
      caseFolderNameFor(candidateName, candidateId),
    );
    const folderUrl = leaf.webViewLink ?? `https://drive.google.com/drive/folders/${leaf.id}`;
    return { folderId: leaf.id, folderUrl };
  } catch (err) {
    accusourceLog('warn', 'drive', 'ensureCaseDriveFolder failed (case proceeds without folder)', {
      tenantId,
      candidateId,
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
