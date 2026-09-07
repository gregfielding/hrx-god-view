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
agency user invited as Admin. **Phone BOUGHT 2026-09-06 (Greg approved, via Claude-in-Chrome in the
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
served at https://hrxone.com/brand/natalie-brooks-512.jpg after the next
hosting deploy; use it for the Google profile photo, Slack app icon, and
the signature block.

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
