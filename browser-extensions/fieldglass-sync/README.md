# HRX Fieldglass Sync (Chrome extension)

Syncs SAP Fieldglass (Sodexo) job-order details into HRX. Two modes:

- **Passive** — while logged into Fieldglass, just *view* an order
  (`job_posting_detail.do`). The extension ships the page text to HRX,
  which extracts positions, ST/OT/DT pay+bill rates, street address,
  schedule, hiring manager, and the "candidate in mind" competitor flag,
  then creates/links the CRM location + child account.
- **Bulk** — click the extension icon:
  - **Sync pending orders from HRX** — HRX lists every order still
    missing details (from the email pipeline); the extension fetches each
    deep link with your logged-in session and syncs them all (~1.5s per
    order, so 60 orders ≈ 2 minutes).
  - **Scan this tab for orders & sync** — open your Fieldglass job-postings
    worklist, click this, and every order linked on that page syncs —
    including old orders that never had an email ingested (HRX creates
    review rows for them).

The extension extracts nothing itself — it is a courier. HRX's server
does the parsing (LLM over page text), so SAP layout changes don't
break the extension.

## Install (each recruiter, one time)

1. Chrome → `chrome://extensions` → enable **Developer mode** (top right).
2. **Load unpacked** → select this folder (`browser-extensions/fieldglass-sync`).
3. Click the extension's **Details → Extension options** and paste:
   - **HRX extension key** — from your HRX admin (the
     `FIELDGLASS_EXTENSION_KEY` value in the functions env).
   - Base URL + tenant are pre-filled for production.
4. Log into Fieldglass and open any order — the badge counts each sync.

## Server side

- `fieldglassEnrichmentQueue` / `fieldglassEnrichmentIngest`
  (functions/src/integrations/fieldglass/enrichmentApi.ts), authed by the
  shared `FIELDGLASS_EXTENSION_KEY` (Bearer). Endpoints fail closed (503)
  when the key is unset. Rotate by changing the env value + redeploying,
  then updating the key in each recruiter's extension options.

## Troubleshooting

- **"Fieldglass session expired"** — log into Fieldglass in a tab, run again.
- **"No SDXOJP posting id found"** on bulk items — that page didn't
  server-render for a background fetch; open the order directly (passive
  capture handles it).
- Progress log lives in the popup; it survives closing the popup mid-run.
