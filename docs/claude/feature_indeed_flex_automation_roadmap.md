# indeed flex automation roadmap

> "Indeed Flex email→JO pipeline (Phase 1 shipped 2026-07-08) + PI-7 portal Chrome extension SHIPPED 2026-07-27 (JSON courier taps agency_portal API → roster→assignments) + PI-TS timesheets capture/coverage reconcile SHIPPED 2026-08-01; awaiting Greg's one-time extension install (v1.1.0) + smoke test"

## PI-TS TIMESHEETS CAPTURE + COVERAGE RECONCILE — Slice 1 SHIPPED 2026-08-01 (commit c181cde4; endpoint deployed+smoked)

Greg's ask: the portal Timesheets view (agency.indeedflex.com/o/timesheets) shows EVERYONE with hours → compare vs HRX to catch workers not assigned to the right JOs. Wire pinned LIVE via fetch-tap in Greg's Chrome (SPA blocks direct fetch; page-context replay fails — tap the SPA's own calls):
- `GET flex-core-us.indeed.com/api/v2/agency_portal/timesheets/entries?per_page&page&start_date&end_date[&job_ids]` → BARE ARRAY, one row per worker-per-shift-day: `{id, job_id, worker_id, worker_display_name, client_display_name, clock_in/out_time, break:{duration secs,paid}, role:{title}, venue:{name,timezone}, area_name, status(approved|upcoming|awaiting_submission…), shift_id, start/end_time (venue-local offset embedded → workDate = slice(0,10)), charge_rates:{charge_rate.amount, agency_margin_percentage, total_client_invoice.amount}}`. **NO worker email on the wire.** Siblings: `entries/count`, `entries/worker_names` (no row data — excluded by the `(\?|$)` anchor).
- Extension v1.1.0: interceptor classify 'timesheets' → content.js forwards each entries page directly (URL-keyed 30s debounce; no job bundle) → background POSTs to `indeedFlexTimesheetIngest` (same bearer key).
- Server `timesheetIngest.ts`: normalize → snapshot `tenants/{t}/indeed_flex_timesheets/{flexEntryId}` (idempotent merge) → verdict per row: **ok | no_hrx_shift | worker_unmatched | no_assignment** (job via findHrxShiftForFlexJob request-linkage anchor; worker flexWorkerId-first via shift's portal assignments, then name via resolvePortalWorker; assignment day-scoped exact or legacy spanning range). Rolling summary → `tenants/{t}/integration_health/indeed_flex_timesheets` (for the PI-11 Scheduling Health tile — NOT built yet). Writes NO assignments (audit-only, unlike roster ingest). workedHours = clocks minus unpaid break.
- Smoke vs prod: real row (job 530960, Zaon Cox, Jul 27, 8.02h) → verdict `no_hrx_shift` — CORRECT and a REAL find: that Carrier Enterprise "MA - Hanover Hub" job sits in external_shift_requests as needs_review with NO matchedJobOrderId while the worker accrues paid hours. Auth verified 401/405. Synthetic worker/job rows verdicted correctly + cleaned up.
- LIVE end-to-end 2026-08-01: Greg installed v1.1.0 (key from functions/.env.hrx1-d3beb INDEED_FLEX_EXTENSION_KEY; popup only shows on icon click), real syncs flowing. Worker-first reconcile fix (4c37f989): verdict = worker resolved + ANY active assignment covering the day (linked-shift path, else scan worker's assignments incl. spanning/career open-ended); `flexJobLinked` is a soft link-the-job note. 7-day attention window (db64dd3c): only workDate within 7 days of capture counts as needs-attention (Greg: older-than-a-week mismatches are history — staleProblems tally only). Zaon/JO#310 case CLOSED via .scratch/fix-zaon-jo310-v2.ts (Greg-run): orphan "wrong Zaon" assignment (deleted acct zaonzaon75, Jul 20-22 sent_to_everee — payments confirmed correct by Greg) kept as closed history endDate 07-22; real Zaon (XN7lks…) confirmed open-ended from 07-23; 7 empty drafts re-keyed; shift poNumber 523877→530960 (poNumberHistory) + request matched. Enrichment (ce706238): portalIngest auto-stamps shift `clockInUrl` (derivable: time.indeed.com/time-capture/qr?ar=us&source_flow=worker_link&venueId={venueId}) fill-if-empty + heals poNumber; capture docs keep rawJob/rawShifts (40KB caps) for field pinning + create-JO-from-capture.
- NEXT: pin instructions/charge-rate/title keys from a stored rawJob (any Booked-workers visit persists one — normalizer got title:''/address:'[object Object]' wrong); CORT stragglers (Bryant Pierce + Mercedes Swanson job 532422 no assignment; Engelbert Sanchez 532423 unmatched worker) = recruiter action; PI-11 tile reads `integration_health/indeed_flex_timesheets`; Flex job-chain rollover auto-detect (523877→530960 was manual); jobs-LIST capture for charge rates (only portal view with bill rates) offered to Greg.

## PI-7 PORTAL EXTENSION — Slices 1+2 SHIPPED 2026-07-27 (commits ef06e1aa, 26381917; endpoint deployed+verified)

**Big find:** the Flex agency portal runs on a clean JSON API, so PI-7 is a
JSON courier (NOT the Fieldglass text-scraper). API facts (agency **3403**):
- Portal: `agency.indeedflex.com/platforms/{platformId}/job-details/{jobId}?…&venueId=&roleId=` (+ `&workers=booked` for the roster tab). **jobId is in the PATH**, not a query param.
- API host `flex-core-us.indeed.com/api/v2/agency_portal/agencies/3403/`:
  - `jobs/{jobId}?$type=agencyJobDetail&role_id=&venue_id=&with_pay_rates=true` → job + PAY rate ("Standard $19.00"). **CHARGE/bill rate NOT on this view** (needs the billing page — deferred slice).
  - `agency_shifts?job_id={jobId}&role_id=&venue_id=` → shifts, each with an `agency_shift_id` (e.g. 2020327) distinct from jobId.
  - `workers?booked_agency_shift_ids[]={agencyShiftId}&…` → the BOOKED ROSTER (name/phone/email/branch). The candidate-pool call is `workers?…` WITHOUT `booked_agency_shift_ids` — ignore it.
- Venue clock-in link carries venueId: `time.indeed.com/time-capture/qr?…venueId=11020`. **Flex venues have a stable venueId** — better than address for account matching (a future teach into venue_aliases).

**Server (functions/src/integrations/indeedFlex/):**
- `portalTypes.ts` — wire envelope + defensive normalizer (candidate keys snake_case AND camelCase; never throws; extension ships RAW json, server normalizes so a Flex change can't break the extension).
- `portalIngest.ts` — `reconcileFlexPortalCapture(tenantId, env, actor, {dryRun})` + `indeedFlexPortalIngest` onRequest. Shift anchor (collectionGroup('shifts') is DELIBERATELY un-indexed here): `external_shift_requests(event.jobId==jobId)` → `matchedJobOrderId` → `job_orders/{jo}/shifts(poNumber==jobId)`. Worker match email→phone→name (tenant-scoped, own compact resolver — importTimesheetMatchWorkers matchers are private). Assignment `${shiftId}__${userId}__${date}` status confirmed + **notificationsSuppressed:true** (satisfies logAssignmentCreated index.ts:9182 + onAssignmentUpdatedPush.ts:36 → no offer SMS/push; they're already booked in Flex). Roster drops → status cancelled reason 'unbooked_in_flex' (the raw no-show/cancel signal PI-9 scores). Unmatched job → `tenants/{t}/indeed_flex_portal_captures/{jobId}` status 'unmatched_no_shift' (shift-creation-from-portal deferred). Ledger same collection status 'reconciled'.
- Auth mirrors fieldglassEnrichmentIngest: `INDEED_FLEX_EXTENSION_KEY` bearer (SET in functions/.env.hrx1-d3beb — value lives there, NOT here), fail-closed 503/401. Endpoint deployed + verified (no-key→401, key+badbody→400, GET→405).
- Dry-run validated vs prod: Flex job 532422 → its HRX shift, real worker matched by email, 1 assignment would be created, 0 unmatched.

**Extension (browser-extensions/indeed-flex-sync/):** MV3, MAIN-world `interceptor.js` wraps fetch+XHR to tap agency_portal responses → postMessage → ISOLATED `content.js` buffers job+shifts, bundles when the booked-workers response fires → `background.js` POSTs to indeedFlexPortalIngest with the key. Config in options (key/tenant/URL). Passive: open a job's Booked workers tab → syncs. Same-job de-dup 60s.

**NEXT:** Greg installs the extension one-time (chrome://extensions → Developer mode → Load unpacked browser-extensions/indeed-flex-sync → paste key in options), opens a real job's Booked workers → verify the assignment lands in HRX. Then: charge-rate slice (billing page); PI-9 no_show/reliability rides on the roster-drop 'unbooked_in_flex' cancels; deferred shift-creation-from-portal (match venue by ADDRESS + stable venueId per Greg 2026-07-27, reuse PI-3 Part 2 address matcher).

## FLEX CONTINUITY / ENGAGEMENT LAYER (2026-07-27, Greg's "be careful about ending career/ongoing work")

**Problem:** Flex fragments a genuinely CONTINUOUS engagement (one worker at one venue) into a CHAIN of separate job IDs — one ends at irregular intervals, a new one opens for the same work. HRX saw all Flex work as *gig* (the apply path sets no jobType/career) → a series of unconnected gig assignments → tenure / "is this ongoing" / Career view / reliability all lost the thread, and any lifecycle end risked FALSELY ending continuous work.

**Landmine I'd just shipped + defused (commit within this session):** PI-7 portalIngest's roster-drop reconcile auto-cancelled drops (`unbooked_in_flex`) with NO career guard → a worker rolling to a new Flex job ID would be falsely cancelled + look like a no-show. Now drops are RECORDED as observations only (`flexRosterDropObservedAt`/`flexRosterDropSourceJobId`), never cancelled (field renamed observedDrops). Defused before the extension went live.

**Greg's decisions 2026-07-27:** (1) auto-detect continuity by RECURRENCE (not manual flag / not per-account); (2) represent it as an ENGAGEMENT LAYER over the per-shift assignments (assignments + payroll stay UNTOUCHED — do NOT convert to one rolling career assignment).

**Built — `functions/src/integrations/indeedFlex/engagements.ts`:** doc `tenants/{t}/flex_engagements/{accountId}__{userId}`; `upsertEngagementForPlacement(tenantId, {userId, accountId, flexJobId, date, workerName, ...}, {dryRun})` — on each Flex placement, records it and detects recurrence: a placement within CONTINUITY_WINDOW_DAYS (**30**) of the last one at the same account flips `continuous:true`. CONSERVATIVE: `continuous` only ever turns ON, never off; nothing here ends an engagement (human-only, biases toward continuing on ambiguity). Fields: status/continuous/placementCount/firstSeenDate/lastSeenDate/firstFlexJobId/currentFlexJobId/flexJobIds[] (bounded 30)/becameContinuousAt. Also `isContinuousEngagement(t, acct, user)` (the never-auto-end guard consumers call) + `listFlexEngagements`. Wired into portalIngest reconcile (once per booked worker, latest date); result adds continuousEngagements/newEngagements. Flex-scoped BY CONSTRUCTION (PI-7 is the only writer, only fires for Flex jobs).

**Key data finding (report-flex-engagements.cjs, read-only):** the assignment book has **665** generic worker-account recurrences — but their sources are all_applicants/shift_applicants/group_* = normal Placements-flow workers on STABLE JOs, NOT the Flex job-ID-churn problem. So a broad backfill would manufacture wrong-scoped engagements → DELIBERATELY AVOIDED. Engagements build organically as PI-7 rosters sync (an existing continuous Flex worker is recognized within a job cycle or two: 1st capture creates the engagement, next job flips continuous).

**NEXT (continuity consumers, not yet built):** wire `isContinuousEngagement` guard into any path that could cancel a FUTURE/active Flex assignment (PI-9 drop decisions; cancel_booking apply) so rollovers never end continuous work; Career/Who's-Working reads flex_engagements (continuous=true = one row per ongoing worker); note completing PAST gig assignments is FINE (continuity lives in the engagement, not the individual gig row). Nothing keys career off jobOrderType for Flex — the engagement's `continuous` flag is the signal.

## PI-6 SHIPPED 2026-07-27 — backlog drained + kept clean
`functions/src/integrations/indeedFlex/pruneStaleShiftRequests.ts`: sweeps needs_review rows → 'superseded' (reversible, decidedBy 'pi6_prune', reason stamped) when past_dated (isPastDated: endDate??workDate < today CT), digest_noise (eventType daily_digest_expired), or stale_info_notice (info_notice >21d). Dateless + current-dated actionable rows never touched. Wired into schedulingTriageNightly (keeps it clean nightly). One-time C1 drain: 121 needs_review → 37 (71 past-dated + 13 digest pruned; 0 stale info_notice — all 10 recent). Survivors: 14 exact new_requests (triage auto-creates tonight), 13 current cancels, 10 recent FYIs. So the real human-decision pile is ~13 cancels + 23 fuzzy/multiple/none matches. Scratch: .scratch/run-pi6-prune.cjs.

# Indeed Flex → automated shift/JO creation roadmap

State after the 2026-07-08 session (Greg: "use our fieldglass/sodexo
process and revisit indeed flex"). Supersedes the 2026-05-23 notes.

## Phase 1 SHIPPED (commit 55c9fa0b, onIngestEventCreatedParse deployed 2026-07-08)

Root cause of the 165-stuck-requests queue: the LIVE email format renders
HTML tables as label/value on SEPARATE lines ("Venue\nCHI (Mansfield, OH)
- …") — the colon-based regexes matched nothing, AND the LLM fallback was
starved (`max_completion_tokens: 800` on gpt-5 → empty content every
time; same reasoning-starvation bug as Fieldglass 44cce8ba; now 6000).

- new_request now parses HIGH confidence via regex alone: jobId, venue,
  NEW `venueAddress` (street line under venue), role (line above
  "ID: NNN"), workDate + NEW `endDate` ("Shift dates Jul 12 - Oct 09"),
  headcount, times. Types mirrored shared/ ↔ src/shared
  (functions/src/shared is a SYMLINK to ../../shared — only 2 physical
  copies).
- Classifier now handles live subjects: "bookings have been
  removed" → cancel_booking; "bookings have been changed" + "details for
  your Job N have changed" → change_headcount ("Workers required now" in
  body) else change_time.
- cancel_booking live format has NO worker names (role+date pairs) —
  extractor no longer fakes names from role lines; venue from the
  "<client>, <venue>, <address> have removed…" header (raw, LLM refines).
- **Today-forward gate** (Greg: "we only need jobs from today forward"):
  events whose endDate ?? workDate < today (America/Chicago) are written
  status 'superseded' — skips matcher + review queue. In
  onIngestEventCreatedParse (exported helpers todayCentral/isPastDated).
- Backfill EXECUTED (`.scratch/backfillIndeedFlexReparse20260708.ts`):
  queue went 165 stuck → **22 needs_review (9 exact / 2 multiple / 11
  none)**, 199 superseded (past-dated + stale notices >7d + 1 dedupe).
  Venue matcher proven live: Woodridge→CORT Woodbridge Warehouse,
  Maryland Warehouse→Domino's Distribution Center Maryland, Penn
  Convention Center, Savannah, Kentucky→Domino's Kentucky,
  Mansfield→CORT The Ohio State Reformatory (all EXACT). Unmatched
  venues needing accounts or /shifts/log aliases: "Northern California"
  (Domino's), "Colorado" (ambiguous ×2), CHI Lucas Oil Stadium, WBI
  Lincoln Financial Field, "C9810 - Seattle WA" (Continental Battery).

## Portal facts (Greg's screenshots 2026-07-08) — Phase 2 fuel

Agency portal `agency.indeedflex.com/platforms/2590/...`:
- **Job detail page** (`/job-details/{jobId}?roleId&venueId`) has a
  "Venue clock in/out link" section → `https://time.indeed.com/time-capture/qr?ar=us&source_…`
  — per-VENUE link for workers without the Indeed Flex app. THE thing
  Greg wants captured (not in any email; all email links are SendGrid
  click-wrapped).
- Job detail also: shifts w/ booked/requested counts, optional backup
  limit, rate ("Standard $17.00"), competencies, and a **Candidates tab**
  (worker pool with phone/email + Book buttons, unique identifiers like
  CORT-PHILLY / Hanover-Baltimore).
- **Jobs list** has PAY RATE and CHARGE RATE columns (neither in emails;
  emails only carry "Potential earnings" total), client, venue/area,
  date/time, workers booked/needed, status (New/In Progress/Completed +
  "Held for"), Respond/Book Workers actions.

Phase 2 = port the fieldglass-sync extension (browser-extensions/
fieldglass-sync + enrichmentQueue/enrichmentIngest endpoint pattern) to
capture the portal job detail page → enrich matched shift requests / JOs
with clock-in URL + real rates. NOT built yet.

## Still open after Phase 1

- "Create JO from request" button on unmatched rows (/shifts/log).
- Venue matching quality: matcher fuzzy-matches venueName → child
  account (+ venue_aliases one-click overrides). The 23 new Carrier
  child accounts (2026-07-08) are prime match targets.
- Auto-apply gate still "always queue for human" — loosening comes after
  match quality is proven.
- 29 ingest events remain parse_failed by design (surveys, corrections,
  "worker assignment ended", expiring-soon reminders).
