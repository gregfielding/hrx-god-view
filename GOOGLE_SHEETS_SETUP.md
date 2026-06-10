# Google Sheets roster sync — one-time setup

Per-job-order roster sync creates **one Google Sheet per job order** (when
toggled on from the JO → Placements tab), with **one tab per shift** listing
placed/assigned workers (first name · last name · phone · email · status).

The sheets are owned by HRX's Cloud Functions service account and live in a
**Shared Drive**, shared via a view-only link. The code is deployed, but it
stays inert until these one-time steps are done.

## Service account

The functions authenticate as the default Cloud Functions compute SA:

```
143752240496-compute@developer.gserviceaccount.com
```

## Steps (need GCP Console + Google Workspace admin)

1. **Enable the APIs** on project `hrx1-d3beb`:
   - Google Sheets API
   - Google Drive API
   ```sh
   gcloud services enable sheets.googleapis.com drive.googleapis.com --project=hrx1-d3beb
   ```

2. **Create a Shared Drive** in Google Workspace (Drive → Shared drives → New),
   e.g. "C1 — Job Order Rosters".

3. **Add the service account as a member** of that Shared Drive with the
   **Content Manager** role (so it can create/edit sheets there):
   - In the Shared Drive → Manage members → add
     `143752240496-compute@developer.gserviceaccount.com` → Content Manager.

4. **Get the Shared Drive id** — open the Shared Drive; the URL is
   `https://drive.google.com/drive/folders/<SHARED_DRIVE_ID>`. Copy that id.

5. **Set it as a functions env var** and redeploy the three callables:
   ```sh
   # add to functions/.env (or .env.hrx1-d3beb):
   GOOGLE_SHEETS_SHARED_DRIVE_ID=<SHARED_DRIVE_ID>

   firebase deploy --only \
     functions:jobOrderSheetEnable,functions:jobOrderSheetSyncNow,functions:jobOrderSheetDisable \
     --project hrx1-d3beb
   ```

## Verify

- Open any JO → **Placements** → toggle **"Sync roster to Google Sheets"** on.
- It should create the sheet, show an **Open sheet** link, and one tab per shift
  with the current roster. **Sync now** re-runs a full sync.

If toggle-on errors with "not configured," `GOOGLE_SHEETS_SHARED_DRIVE_ID`
isn't set / the deploy didn't pick it up. If it errors with a Drive/Sheets
permission error, re-check step 3 (the SA must be a Content Manager).

## Phase 2 (not yet built)

Live debounced auto-sync on every placement/status change. Phase 1 is
toggle + **Sync now** (on-demand). The sync core
(`syncJobOrderToSheet`) is trigger-ready for Phase 2.
