# HRX Indeed Flex Sync (Chrome extension)

Syncs Indeed Flex **agency-portal** jobs into HRX — the job, its shifts, and
most importantly the **booked worker roster** (the positive "who is actually
booked" list that the Flex notification emails never give). Once the roster
is in HRX, no-shows, worker-level cancels, and reliability scoring all work.

## How it works

Unlike the Fieldglass extension (which ships page *text*), Indeed Flex has a
clean JSON API, so this extension is a **JSON courier**: as you browse a job
in the agency portal, it taps the portal's own API responses
(`flex-core-us.indeed.com/api/v2/agency_portal/…`) — job, shifts, and the
booked-workers list — and forwards them to HRX. It extracts nothing itself;
HRX's server normalizes the payload, so a Flex portal/API change can't break
the extension.

**Passive** — while logged into the agency portal, open a job and click its
**Booked workers** tab. The extension bundles that job + shifts + roster and
syncs it to HRX. The badge counts each job synced this session; the popup
shows the last result.

## Install (each recruiter, one time)

1. Chrome → `chrome://extensions` → enable **Developer mode** (top right).
2. **Load unpacked** → select this folder (`browser-extensions/indeed-flex-sync`).
3. Open the extension's **Details → Extension options** and paste the
   **HRX extension key** (the `INDEED_FLEX_EXTENSION_KEY` value from your HRX
   admin). Base URL + tenant are pre-filled for production.
4. Log into `agency.indeedflex.com`, open a job, click **Booked workers** —
   the badge increments and the popup shows "N added / re-booked / dropped".

## Server side

- `indeedFlexPortalIngest`
  (`functions/src/integrations/indeedFlex/portalIngest.ts`), authed by the
  shared `INDEED_FLEX_EXTENSION_KEY` (Bearer). Fails closed (503) when the
  key is unset. Rotate by changing the env value + redeploying, then updating
  each recruiter's extension options.
- The endpoint matches the Flex job to the HRX shift the email pipeline
  already created (`external_shift_requests(event.jobId)` →
  `matchedJobOrderId` → `job_orders/{jo}/shifts(poNumber)`), then reconciles
  the roster into confirmed, notification-suppressed assignments and cancels
  any roster drops. A job HRX has no shift for yet is recorded under
  `tenants/{t}/indeed_flex_portal_captures/{jobId}` as `unmatched_no_shift`.

## Notes

- The **candidate pool** call (`/workers` without `booked_agency_shift_ids`)
  is ignored — only the booked roster is synced.
- Same job is de-duped for 60s across tabs, so re-opening a job won't spam.
- Charge (bill) rate is not on the job-details view; a later slice adds it
  from the billing page. Pay rate + roster + shifts come through today.
