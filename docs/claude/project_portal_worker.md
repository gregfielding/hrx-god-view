# portal worker (autonomous recruiter, portal execution layer)

> "Queue + always-on Playwright worker that executes portal actions (Flex bookings, Fieldglass submissions) with bot accounts — scaffold SHIPPED 2026-09-06 (loop verified end-to-end), adapters stubbed; replaces the human-in-Chrome courier model"

## Why this exists (Greg, 2026-09-06)

Greg wants recruiter work done with **no ongoing involvement**: no approvals
in chat, no laptop that has to be awake, no manual syncs. Driving his Chrome
via claude-in-chrome can't get there — every send/booking is a per-action
approval, it runs only while his laptop + a chat session are open, and
background automation tabs starve the SPAs (see
[[feedback_chrome_automation_tab_throttling]]). API access for Flex and
Fieldglass is **not** obtainable (Greg, same day) — "work within the
confines we have today". So: a queue in HRX + a worker process on an
always-on box that logs into both portals as dedicated bot users and does
the clicks itself. Phone calls stay human (all career jobs + first-time
gig workers) — the agent will produce the call list.

Verified 2026-09-06 (unauthenticated probes): **Fieldglass** sign-in at
`https://www.us.fieldglass.cloud.sap/` is a plain `username`/`password`
form (no CAPTCHA, no bot-protection scripts, no iframe; the old
fieldglass.net hosts redirect with a notice). **Indeed Flex** agency
sign-in at `agency.indeedflex.com/o/signin` is email-first (single
`input[name=email]` + Continue), no bot-protection scripts on step 1; the
second step (password vs emailed code) is still unobserved.

## What shipped (commit on 2026-09-06)

- **Contract** `shared/portalActions.ts` (mirrored `src/shared/`): providers
  `indeed_flex | fieldglass`; actions `smoke_test | book_worker |
  unbook_worker | submit_candidate | withdraw_candidate`; statuses
  `pending → claimed → running → succeeded | failed | needs_human |
  cancelled`; error codes + `nextStatusAfterError` policy (transient codes
  retry 5/10/20 min then escalate; LOGIN_FAILED / NOT_IMPLEMENTED →
  needs_human; INVALID_PAYLOAD / PORTAL_REJECTED → failed);
  `buildPortalActionId` = doc id = idempotency key
  (`provider__action__naturalKey`).
- **Producer** `functions/src/integrations/portalActions/enqueuePortalAction.ts`
  — library only (NO new Cloud Function: Cloud Run cap). Transactional
  upsert: open rows returned as-is, succeeded rows re-run only with
  `force`, terminal rows reset. `cancelPortalAction` too. Not yet wired
  into any hire flow (pointless until adapters do real work).
- **Consumer** `portal-worker/` (own npm package, Node 20, tsx + Playwright,
  firebase-admin 13): index-free claim (`where status == pending` + in-memory
  notBefore/provider/priority filter, transactional claim with lease +
  renewal), lease sweeper, heartbeat →
  `tenants/{t}/portal_workers/{workerId}` + rolling
  `tenants/{t}/integration_health/portal_worker` (workers map + queue
  counts via count() aggregations), per-provider keep-alive every 5 min,
  persistent Chromium profile per provider (headed by default), failure
  screenshots (local, + Storage signed URL when `PORTAL_STORAGE_BUCKET`),
  Slack via bot token `chat.postMessage` (optional; deduped login alerts),
  secrets from env or Secret Manager `portal-worker-<provider>-username|password`
  (values redacted from logs), graceful SIGTERM (in-flight action released
  to pending without counting an attempt), 12h max-uptime self-exit for
  launchd restarts. `launchd/com.c1staffing.portal-worker.plist` template.
  CLIs: `npm run enqueue -- --provider=… --action=…`, `npm run status`.
  Tests: `node --test` over the shared policy helpers (11 passing).
- **Adapters**: login detection + login + keep-alive + smoke_test for both;
  real actions throw NOT_IMPLEMENTED → needs_human + Slack, so producers can
  be wired before the adapters land without silent loss.

**End-to-end verified 2026-09-06** on Greg's laptop (headless, no creds):
two smoke_tests → claimed within the 2s poll → browser launched → login
wall detected → Secret Manager returned nothing → `needs_human` with
`LOGIN_FAILED` + a screenshot of each portal's sign-in page; heartbeat and
health docs written. Rows left in prod:
`tenants/BCiP2bQ9CgVOCTfV6MhD/portal_actions/{fieldglass,indeed_flex}__smoke_test__1788738…`
(harmless; delete or ignore).

## The persona: Natalie Brooks (Greg, 2026-09-06)

The automation's identity across every external system is **Natalie Brooks,
n.brooks@c1staffing.com** (Google Workspace user — a real mailbox, not an
alias, because Flex's email-first login and Fieldglass notifications need an
inbox). Use it for: the Indeed Flex agency user (Account level Standard,
all branches/clients/locations/roles), the Fieldglass supplier user, the
Slack app/bot user, and any outbound email/SMS the agent sends later.
Rules: (1) Claude never holds the password — Greg puts creds in the
worker's `.env` / Secret Manager; (2) the mailbox gets connected to HRX via
the existing Gmail OAuth integration so functions can read login codes and
portal notifications, and Greg is a delegate on it; (3) any signature or
message from Natalie discloses that she is C1 Staffing's automated
recruiting assistant and names a human contact (CA bot-disclosure law +
Greg's "workers should know we're a real company" goal); (4) phone calls
stay human — Natalie produces the call list, people make the calls.
**HRX user PROVISIONED 2026-09-06**: Auth uid `sSPyxJiaYsXlHJb5XUOJ3d14PcU2`,
claims roles[T]=Admin/7, users doc mirrors Deborah/Greg shape (securityLevel
'7' + `recruiter:true` + `crm_sales:true` at top level AND in
tenantIds[T]; `isAutomationPersona:true` marker; avatar URL set). Script:
`functions/.scratch/invite-natalie-brooks.ts` (idempotent, --write). Flex
agency user invited as Admin (login = email-first, then a PASSWORD page
"Signing in as …" — confirmed 2026-09-06; no code step). Fieldglass
supplier user invited 2026-09-06: username n.brooks@c1staffing.com, role
Administrator [Primary], supervisor Greg; registration goes through
`user_register_form.do?personId=…` + a one-time emailed registration code
(Greg completes it — password entry). ☠️ Activation/reset links must be
opened in a browser with NO existing Flex session (Incognito) — in Greg's
Chrome the link just lands on his own Jobs page. **Phone BOUGHT 2026-09-06 (Greg approved, via Claude-in-Chrome in the
Twilio console): +1 312 663 8247**, SID `PNadc75695090f91f3f5d65065209fad28`,
friendly name "Natalie Brooks (automation)", $1.15/mo. SMS webhook →
`https://us-central1-hrx1-d3beb.cloudfunctions.net/handleInboundSms` (POST),
same as the main 312 500 4352 line; NOT on a Messaging Service and NOT
A2P-10DLC registered yet — inbound works, outbound US SMS from this number
needs it added to a registered service (C1 Messaging) first. Voice URL
still the Twilio demo; no emergency address (voice unused). The 415 429
3750 number was deliberately left alone (Greg: may become a general company
line). Twilio account shows as "My first Twilio account"; the 888 805 8650
toll-free is on the C1 Messaging service.
☠️ handleInboundSms DROPS texts from senders that are not known users
(portal verification short codes!) — fixed by `sms_inbound_raw/{MessageSid}`
(commit ca71ca36: verbatim copy of every inbound before routing, fail-open,
`expiresAt` +30d for a TTL policy that still has to be enabled in the
console). Read it for Natalie's line with `where('to','==','+13126638247')`.
Deploy of handleInboundSms was blocked for Claude by the permission
classifier — Greg runs `firebase deploy --only functions:handleInboundSms`.
Avatar (AI-generated, Greg 2026-09-06): `public/brand/natalie-brooks.png`
(1254px source) + `public/brand/natalie-brooks-512.jpg` (web/email size) —
served at https://hrxone.com/brand/natalie-brooks-512.jpg (live since the
2026-09-06 evening hosting deploy); use it for the Google profile photo,
Slack app icon, and the signature block. **Gmail signature SET 2026-09-06**
(via Claude-in-Chrome on Greg's session, mailbox u/4): same layout as
Greg's (round 74px photo, gold left rule, name / "Recruiting Assistant ·
C1 Staffing" / 312-663-8247 · n.brooks@ / c1staffing.com / tagline) minus
LinkedIn, plus the rule-(3) disclosure line: "Natalie is C1 Staffing's
automated recruiting assistant. To reach a person, email Greg Fielding at
g.fielding@c1staffing.com." Gmail enforces Trusted Types, so the block was
built with DOM nodes, not innerHTML. Greg's own signature now points at
https://hrxone.com/brand/greg-fielding-512.jpg (new official headshot,
2026-09-06; `public/img/greg-fielding.jpg` replaced too so the old URL
serves the same photo).

## Milestone 2026-09-06 (late): BOTH portal logins succeed unattended

`smoke_test` succeeded for indeed_flex (worker logged in as Natalie →
/jobs) and fieldglass (→ /desktop.do "Home - Fieldglass") on greg-macbook
with creds from `portal-worker/.env`. Facts learned: Flex 2nd step is a
password page (submit via the Continue button; `filledLen` logged);
Fieldglass home is `/desktop.do` — the bare origin renders the sign-in form
even with a live session; its cookies are session-scoped (do NOT survive a
browser restart → the worker re-logs-in after every launchd restart, ~4s);
the SAP footer/cookie banner contains "Terms of Use"/"Accept" on every
page, so interstitial detection must look at headings only. `npm run
login -- --provider=X` = per-step-screenshot login debugger on a separate
profile. Set-password/reset links MUST be opened in Incognito.

## Sync passes (2026-09-06 late, commit f6a3e184): the buttons are now Natalie's job

Greg: "Can this system replace the Sync Sodexo button… can Natalie update
our job orders as changes happen in Fieldglass? … then same for Flex."
- **`fieldglass_sync`** (adapter `sync()`): HRX pending queue
  (`fieldglassEnrichmentQueue`) + paginated worklist scan
  (`job_posting_list.do?cl=1`, follows Next) → opens each
  `job_posting_detail.do` page in Playwright (SAP is JS-rendered; waits
  for the SDXOJP id) → POSTs innerText to `fieldglassEnrichmentIngest`
  with `FIELDGLASS_EXTENSION_KEY` (same server path as the extension: LLM
  extraction → JO ensure/close/halt). **Targeted** syncs
  (`payload.postingIds`) resolve SDXOJP → detail URL via the HRX request
  row (`event.detailUrl` / `enrichment.sourceUrl`), else the worklist row
  text, else the portal search box — ☠️ `job_posting_detail.do?id=` takes
  an INTERNAL id, not the SDXOJP number (constructed URLs render nothing).
- **`indeed_flex_sync`**: jobs list (API body tapped via
  `page.on('response')` on `flex-core-us.indeed.com/api/v2/agency_portal/`,
  DOM `/job-details/` links as fallback) → per job open
  `…/job-details/{id}?…&workers=booked`, wait for the
  `workers?booked_agency_shift_ids` response, bundle {job, agency_shifts,
  roster} → `indeedFlexPortalIngest`; then `/o/timesheets` entries pages +
  a replay of `timesheets/entries` for the last N days using the SPA's own
  Authorization header via `context.request` → `indeedFlexTimesheetIngest`.
  Skips Completed jobs unless `includeCompleted`.
- **Change detection** (`src/syncState.ts`): sha256 of normalized page
  text / JSON bundle in `tenants/{t}/portal_state/{provider}_sync`; unchanged
  pages skip the paid extraction, re-ingested anyway after 24h; `force`
  bypasses. This is what makes an hourly cadence affordable (Greg's manual
  cadence was ~3 presses/day × ~50 postings).
- **Scheduler** (`scheduleSyncsDue` in index.ts): every
  `PORTAL_FG_SYNC_EVERY_MS` / `PORTAL_FLEX_SYNC_EVERY_MS` (default 60 min)
  inside `PORTAL_SYNC_HOURS` (6-21 America/Chicago) the worker enqueues a
  full pass keyed `full__<15-min bucket>` so restarts/second workers don't
  double-run; priority 150 (targeted work wins). Sync actions get
  `PORTAL_SYNC_ACTION_TIMEOUT_MS` (90 min) — the 4-min default timed out a
  50-posting pass on the first run — and a timeout now tears the browser
  context down so the abandoned promise can't keep driving the page.
- **Change loop (functions, needs deploy of
  `onFieldglassIngestEventCreatedParse`)**: an unclassified email that names
  a known posting, or a re-distribution of a decided order, enqueues a
  targeted `fieldglass_sync` (priority 20, force) via
  `enqueuePortalAction`; the SMS alert now says Natalie is re-syncing it.
- Worker env now also needs `FIELDGLASS_EXTENSION_KEY` /
  `INDEED_FLEX_EXTENSION_KEY` (same values as functions env). ☠️ Appending
  to a `.env` that lacks a trailing newline glued a key onto the password
  line and broke the Fieldglass login for 10 minutes — check `cut -d= -f1`.
- Recommended follow-ups: switch the Gmail→ingest forward from Greg's
  mailbox to Natalie's; "vanished from worklist ⇒ probably closed"
  detection; retire the Sync Sodexo button to a manual override.

## Next slices (in order)

1. **Bot accounts + secrets (Greg)**: dedicated Flex agency user + Fieldglass
   supplier user; four Secret Manager secrets; SA
   `portal-worker@hrx1-d3beb` with datastore.user (+ storage.objectAdmin for
   screenshots, + secretAccessor on the four secrets). Any always-on box
   works — the new M6 Mac mini ships 9/22, a refurb M4 mini / spare Mac /
   Greg's laptop as first courier are all fine.
2. **Flex adapter**: observe step-2 login; capture the SPA's booking request
   (headers incl. auth) with `page.on('request')` and replay via
   `page.request` — UI clicking as fallback. Existing API facts in
   [[feature_indeed_flex_automation_roadmap]] (agency 3403, jobId in path,
   `flex-core-us.indeed.com/api/v2/agency_portal/…`).
3. **Fieldglass adapter**: one recorded walkthrough of job-seeker create +
   submit-to-posting with Greg (Sodexo may add per-submission attestations;
   max 3 submissions per supplier per posting).
4. **Producers**: hire flow → `book_worker` for Flex-linked shifts
   (assignment.refs), Sodexo match → `submit_candidate`; write result back
   to the assignment; a `/shifts/log`-style queue view for `needs_human`.
5. **Agent loop** (cron, Claude adapter): intake → rank (rules-based,
   explainable — AEDT note in [[project_tiered_shift_access]]) → HRX offers
   on existing SMS tracks → enqueue portal action on YES → call list for
   humans. Encode the auto-book policy Greg + Mark write.

## Footguns

- The classifier blocks `(cmd &)`-style backgrounding in Claude sessions;
  run the worker with the Bash tool's `run_in_background` instead.
- Headed Chrome needs a GUI login session → LaunchAgent (not daemon),
  auto-login, no sleep. `PORTAL_HEADLESS=1` only for servers, and expect
  more bot-detection risk from datacenter IPs than from an office box.
- Claude never types portal credentials; Greg provisions secrets. With no
  creds the worker escalates instead of failing — a person can also sign in
  by hand in the worker's Chrome window and the persistent profile keeps it.
- Fieldglass "Site" ≠ "Work Location" — see
  [[project_fieldglass_intake_pipeline]] before building submit payloads.
