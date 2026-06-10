/**
 * Google Sheets / Drive client for the per-job-order roster sync.
 *
 * Auth: the Cloud Functions default service account
 * (`143752240496-compute@developer.gserviceaccount.com`) acting as itself
 * via Application Default Credentials. No OAuth / domain-wide delegation —
 * the sheets live in a Shared Drive the SA is a member of, and are shared
 * read-only via a link.
 *
 * PREREQS (one-time, see GOOGLE_SHEETS_SETUP.md):
 *   1. Enable the Google Sheets API + Google Drive API on hrx1-d3beb.
 *   2. Create a Shared Drive; add the SA above as a Content Manager.
 *   3. Set env `GOOGLE_SHEETS_SHARED_DRIVE_ID` to that Shared Drive's id.
 */
import { google, type sheets_v4, type drive_v3 } from 'googleapis';

const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive',
];

let cachedSheets: sheets_v4.Sheets | null = null;
let cachedDrive: drive_v3.Drive | null = null;

async function getAuthedClient() {
  const auth = new google.auth.GoogleAuth({ scopes: SCOPES });
  return auth.getClient();
}

export async function getSheetsApi(): Promise<sheets_v4.Sheets> {
  if (cachedSheets) return cachedSheets;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const auth = (await getAuthedClient()) as any;
  cachedSheets = google.sheets({ version: 'v4', auth });
  return cachedSheets;
}

export async function getDriveApi(): Promise<drive_v3.Drive> {
  if (cachedDrive) return cachedDrive;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const auth = (await getAuthedClient()) as any;
  cachedDrive = google.drive({ version: 'v3', auth });
  return cachedDrive;
}

/** The Shared Drive new spreadsheets are created in. Empty ⇒ feature not configured. */
export function getSharedDriveId(): string {
  return String(process.env.GOOGLE_SHEETS_SHARED_DRIVE_ID || '').trim();
}

export function isGoogleSheetsConfigured(): boolean {
  return getSharedDriveId().length > 0;
}
