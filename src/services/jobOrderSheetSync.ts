/**
 * Typed httpsCallable wrappers for the per-job-order Google Sheet roster sync.
 * Backend: functions/src/integrations/googleSheets/jobOrderSheetCallables.ts
 */
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';

type JoRef = { tenantId: string; jobOrderId: string };
type SyncResult = { ok: true; spreadsheetId: string; url: string; shifts: number };
type PullResult = SyncResult & { placed: number; unmatched: number; ambiguous: number };

/** Toggle on: create the spreadsheet (if needed) + run an initial full sync. */
export const jobOrderSheetEnable = httpsCallable<JoRef, SyncResult>(
  functions,
  'jobOrderSheetEnable',
);

/** Toggle off: unlink (the spreadsheet is left in the Shared Drive for re-enable). */
export const jobOrderSheetDisable = httpsCallable<JoRef, { ok: true }>(
  functions,
  'jobOrderSheetDisable',
);

/** Manual full re-sync of every shift tab. */
export const jobOrderSheetSyncNow = httpsCallable<JoRef, SyncResult>(
  functions,
  'jobOrderSheetSyncNow',
);

/**
 * Pull hand-typed rows from the sheet back into HRX: rows with a phone that
 * matches one tenant worker get placed on that shift; unmatched rows are left
 * flagged "Not in HRX". Returns counts + a fresh sync result.
 */
export const jobOrderSheetPullFromSheet = httpsCallable<JoRef, PullResult>(
  functions,
  'jobOrderSheetPullFromSheet',
);
