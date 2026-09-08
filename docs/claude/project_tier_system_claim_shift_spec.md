# Tier system / Claim Shift — planning spec (for Friday planning)

**Status:** Claim Shift v1 BUILT + DEPLOYED 2026-09-06 (endpoint, web +
app buttons/sheets, messaging track). Tier release windows are wired but
OFF; tier movement cron + worker-visible tier UI + cancel teeth remain
for the ~2026-09-11 planning session. Written 2026-09-03 from Greg's flow
description + the current codebase.

## ✅ BUILT 2026-09-06 — what shipped and how to turn it on

**Nothing changes on a live posting until a recruiter flips it on.** The
opt-in is per posting: `job_postings/{postId}.claimShiftEnabled` (toggle
"Instant Claim (workers book without an offer)" in the JO Jobs Board tab
editor `JobPostForm` and in `PostToJobsBoardDialog`; gig postings only;
default off). With it on, every available gig shift row shows a GREEN
**Claim Shift** in place of the green Apply (web `ShiftSelector`, app
`_GigRowActionButton`; the 9/3 spec said black — Greg flipped it to green
after the first production claim on 2026-09-06: the row CTA is the GO
action), the header/sticky CTA reads Claim Shift and opens the first free
row, and the acknowledgement sheet (uniform / transportation / arrival /
no-show, green confirm) books the day on the spot and routes to Assignment
Details.

**First production claim (Greg, 2026-09-06 ~18:05 PT, posting
moWsEDWmnA5jaR4O0X2X "Electric Forest" test shift 9/28)**: button + sheet
rendered, callable ran, and the HEADSHOT GATE refused it — Greg's photo on
file is a two-person shot the Vision verifier rejected as `multiple_faces`
(a blocking reason by policy), so the sheet showed the inline uploader.
No assignment was written (gates run before the transaction). Working as
designed; the fix on the worker side is a solo headshot.
**Upload path PROVEN 2026-09-06 21:37 PT** (Claude drove Greg's admin
session with a manual-override rejection on the record): gate card rendered,
both file inputs sit inside `<label>`s and a label click reaches the input,
the injected file hit Storage (new token) → the account's verdict flipped
to approved on that file 4s later → the sheet resubmitted and the claim
landed 13s after the upload (assignment confirmed / acquisition claimed).
Note: an ADMIN account claiming is bounced to /dashboard afterwards by the
role router; worker accounts land on Assignment Details.

- **Endpoint**: `respondToAssignment` with `decision: 'claim'` +
  `{ tenantId, jobOrderId, shiftId, date?, jobPostId?, channel, acknowledgements }`
  (no new Cloud Function — service cap). Code:
  `functions/src/claims/claimShift.ts` (Firestore glue) +
  `claims/claimShiftPolicy.ts` (pure rules, 18 mocha tests). Returns
  `{ success, status:'confirmed', assignmentId, alreadyClaimed, remaining, dayKey }`.
- **Unit of claim = one shift-day.** Doc id `${shiftId}__${uid}__${day}`
  doubles as the idempotency key (a retry / double tap returns the same
  assignment with `alreadyClaimed: true`). Multi-day gigs: both web and
  app render one row per day and claim that day (app per-day rows shipped
  later the same day).
- **Capacity is transactional**: the transaction reads + writes the SHIFT
  doc (`claimStats[day]`), so two claims for the last spot serialize; the
  loser recounts and gets `shift_filled`. Per-day capacity =
  `dateSchedule[day].workersNeeded (+overstaff)`, else
  `totalStaffRequested` + overstaff (same math as shiftFillAutomation).
- **Gates (typed `failed-precondition` errors, `details.code`)**:
  `not_claimable` (posting not opted in / not active, JO not gig or
  on-hold/closed/cancelled, shift cancelled or open-type, bad day, no
  hours, already started), `ineligible` (DNR, no user doc), the headshot
  gate's `HEADSHOT_*` codes (web renders the inline `HeadshotGateCard` in
  the sheet, app opens the headshot sheet), `tier_locked` (wired, OFF —
  `CLAIM_TIER_WINDOWS_ENABLED=false`; T+0/+10h/+24h from `postedAt`),
  `conflict` (overlaps any live assignment; details carry the other
  shift), `claim_cap` (no completed shift yet AND ≥2 live claimed future
  shifts — `CLAIM_UNPROVEN_CONCURRENT_CAP`, Greg to tune Friday).
- **Assignment shape**: the recruiter-create shape plus `status:'confirmed'`,
  `confirmedAt/By`, `acquisition:'claimed'`, `claimedAt`, `claimChannel`
  ('web'|'app'), `acknowledgements {uniform, transportation, arrival,
  attendancePolicy}`, `cortConfirmation {state:'confirmed', profileId:
  'gig_claimed', confirmedVia:'claim'}`, `assignmentSource:'worker_claim'`,
  `placementMode:'claim'`, `suppressInitialNotification:true` (no legacy
  ACCEPT/DECLINE SMS — the cadence engine's `gig_claim_confirmation` is the
  confirmation). Rates via the shared `resolveShiftRates` (shift snapshot →
  JO position → JO).
- **Side effects mirrored from the recruiter path**: onboarding instance,
  application → `accepted` (+ `workerClaimConfirmation` /
  `lastAssignmentDecision` stamped on the application), overlapping open
  applications released, onboarding pipeline, and the confirmed-transition
  screening auto-order — called DIRECTLY (`runScreeningAutomationForConfirmedAssignment`,
  extracted from the onUpdate trigger) because a born-confirmed doc never
  produces a pending→confirmed edge.
- **Clients**: web `formatClaimShiftError` + i18n `jobs.claim*` (EN/ES);
  app `ClaimShiftBlock.tryParse`, `runClaimShiftFlow` /
  `ClaimShiftBottomSheet`, `AppStrings.claim*`, repository `claimShift`,
  `JobPostingModel.claimShiftEnabled`.
- **Spots remaining (BUILT later 2026-09-06)**: `shift.liveFill`
  (`functions/src/shifts/shiftLiveFill.ts`, written by shiftFillAutomation
  on every assignment create/update/delete and on dateSchedule/headcount
  edits): `{ total, byDay, target, targetByDay, remaining, remainingByDay }`
  over ALL live statuses (pending offers hold a spot — same set the claim
  transaction counts). **Clients read `remaining` / `remainingByDay`, never
  recompute**: for dateSchedule gigs `remaining` is the BEST day (any free
  day → row not full; day rows use `remainingByDay`); otherwise it counts
  only the shift's OWN `shiftDate` — the first dry run showed a 2-headcount
  weekly shift reading Full from one hire on Aug 18 plus one on Aug 25, so
  a recurring shift's other occurrences never fill it. Web
  `resolveShiftSpots` → `spotsRemaining` / `spotsRemainingByDay`; app
  `GigShiftRow.spotsRemaining` → disabled "Full". Backfilled 189 shifts on
  active postings 2026-09-06 (`functions/.scratch/backfill_live_fill.ts`,
  per-tenant queries — a collection-group query on posting status needs an
  index that doesn't exist). The recruiter-facing `assignmentsCount` /
  `status:'filled'` automation is unchanged (still proposed/confirmed/active
  only, shift-level).
- **Cancel = claim RELEASE (Greg, 2026-09-06 evening, after the first
  production claim)**: a recruiter red-X (`placementsCancelAssignment`) on a
  MANUAL placement keeps today's behavior (assignment deleted → "Placed"
  again, application back to submitted so the pool keeps the worker). On a
  CLAIMED assignment (`acquisition:'claimed'`) both the recruiter X and the
  worker's own cancel (`respondToAssignment` worker_cancel) release the
  claim instead: no placement doc, the claim-created application (`source:
  'claim'`, or legacy `workerClaimConfirmation` with nothing else) is
  DELETED, a pre-existing application just loses this day/shift (withdrawn
  if nothing is left — never a live "Shift Requested"), and the ASSIGNMENT
  doc is kept (cancelled / worker-cancelled + `claimReleasedAt/By/Plan`) as
  the cancel-policy audit trail. Board row returns to Claim Shift; the pool
  forgets the request. Pure planner + 6 tests: `claims/claimRelease.ts`.
  Placements tile now reads "Claimed {time}" (no "Offer sent", no Confirm
  chip) for claimed assignments.
- **Not yet built**: tier windows ON, tier cron / earn-back, worker-visible
  tier, cancel-sheet tier-consequence copy (the sheet shows the >24h/<24h
  hint text only).

**⚠️ Read [[project_tiered_shift_access]] FIRST — its "✅ AGREED SPEC"
(Greg + Danny + Rosa + Mark, 2026-08-31) already settles the tier model:
everyone starts Tier 3; manual promotion + AI Tier Score (to Tier 2
only); automatic ±1 tier (40 clean hours up / penalized no-show down);
notification + visibility windows T+0 (T1) / +10h (T2) / +24h (T3);
open shifts keep Apply with NO tier gating; no-show penalties marked on
the timesheet layout with the import-scoped Friday sweep. THIS doc is
the UI/build layer on top of those decisions — buttons, sheet, states,
endpoint, messaging — and defers to that doc wherever they overlap.**

## Goal

Tier 1/2/3 reliability system where gig shifts are **claimed** (instant
commitment), not applied for. Claiming replaces the offer→accept round
trip for gigs; Careers keep apply; Open Shifts stay curated. Tier
standing controls who sees claimable shifts first.

## Buttons by track (Greg 2026-09-03)

| Track | Jobs-board / posting button | After action |
|---|---|---|
| Gig (non-open) | **Claim Shift** | → acknowledgement sheet → confirmed instantly → button becomes **View Assignment** |
| Open shift | **Apply** (unchanged, AGREED 8/31: no tier gating, visible to all until filled) | recruiter accepts — standing crews stay curated, no instant claim |
| Career | **Apply** | unchanged (prescreen/interview path) |

## The Claim flow (gigs)

1. Worker taps **Claim Shift** (black, standard primary CTA) on the jobs
   board card or posting detail.
2. **Acknowledgement sheet** (bottom sheet on app; the web already has the
   equivalent toast — EXISTS as the offer-accept acknowledgement UI; the
   app twin is `AcceptAssignmentOfferBottomSheet`, adapt it):
   - ☐ I have the required uniform
   - ☐ I have transportation to the worksite  ← NEW checkbox (offer sheet
     today sends `arrivalCommitment` / `uniformPpeCommitment` /
     `attendancePolicyAcknowledged`; add `transportCommitment`)
   - ☐ I will be at the worksite by the shift start time
   - Confirm button at bottom: **Claim Shift** in the CONFIRMED-state
     green (the status-chip green, not a new green; the board CTA stays
     black — green is reserved for the commitment moment). Disabled until
     all boxes are checked.
3. On success: shift is **official** — assignment exists with status
   `confirmed`, `cortConfirmation.state = 'confirmed'` stamped at claim
   (the claim IS the confirmation — see Messaging below).
4. Jobs board card flips to **View Assignment**.
5. Posting detail for a claimed shift: no claim button; a "You're on this
   shift ✓" banner routes to the EXISTING Assignment Details screen
   (schedule, map/directions, on-site contact, clock-in, cancel flow).
   DECISION (recommended, pending Greg): route rather than embedding
   assignment details inline in the posting page — one surface, one
   cancel flow, no parity drift. Greg's original ask was inline; revisit
   Friday.
6. Cancellation: existing worker-cancel confirmation flow
   (`respondToAssignment` decision `worker_cancel`), extended with the
   tier-consequence copy (below).

## Button / card states (jobs board + posting detail)

| State | Render | Cause |
|---|---|---|
| Claimable | **Claim Shift** (black) | open spots, worker eligible, tier window open |
| Claimed by me | **View Assignment** | worker holds confirmed assignment on this shift |
| Just filled | "Shift filled" (disabled) + card fades/removes on refresh | capacity reached |
| Tier-locked | "Opens to you {day/time}" (disabled) | release window not reached for worker's tier |
| Ineligible | "Requirements needed" → routes to readiness | credential/screening gate unmet |
| Conflict | sheet blocks with "You're already booked {time} at {site}" | overlapping confirmed shift |

## Server-side claim semantics (the real build)

Claiming creates an assignment worker-side with NO offer in between —
a new server path. Must be:

- **Transactional against capacity**: read shift `workersNeeded` minus
  live confirmed count inside a Firestore transaction; lose the race →
  typed error `shift_filled` (sheet shows "This shift just filled").
- **Gated**: tier window open for this worker; screening/credential
  requirements met (reuse readiness resolution); no overlapping
  confirmed assignment (query worker's confirmed/active for time
  overlap); account/JO not paused.
- **Auditable**: assignment stamps `acquisition: 'claimed'`, `claimedAt`,
  `acknowledgements: {uniform, transportation, arrival, ...}` (same map
  shape acceptOffer sends today), `createdAt` (bulk-loader rule).
- **Function-cap routing**: we're AT the 1,000-service cap — the claim
  endpoint rides an existing callable. Candidates: a new `decision:
  'claim'`-style action on `respondToAssignment` doesn't fit (no
  assignment exists yet); better candidates are the apply/jobs callable
  the board already uses, or `placementsCreateAssignments` gaining a
  worker-initiated mode with its own auth path (worker can only create
  for self + claimable shift). Decide Friday.

## Tier model — ALREADY AGREED (2026-08-31, see [[project_tiered_shift_access]])

Not re-opened here. The parts this build consumes:

- Visibility/notification windows from PUBLISH: Tier 1 at T+0, Tier 2 at
  +10h, Tier 3 at +24h (jobs-board visibility follows the same clock) →
  drives the **Tier-locked** button state ("Opens to you {time}").
- Tier movement: 40 clean hours up / one penalized no-show down; no-show
  marking lives on the timesheet layout with the import-scoped Friday
  sweep + human completion marker.
- Cancellation teeth (NEW here, feeds that model): the cancel sheet
  shows what a cancel costs (">24h out: no impact · inside 24h: counts
  against your reliability"); late cancels feed the tier inputs.

## Messaging tie-in (already decided 2026-09-03, see
[project_worker_messaging_tracks.md](project_worker_messaging_tracks.md))

- New profile `gig_claimed`: SKIP the 24h/23h/22h ask ladder (claim is
  the confirmation). Keep `assignment_reconfirm_4h`,
  `assignment_reminder_2h_instructions` (day-of logistics),
  `assignment_checkin_0h`, `assignment_noshow_check`.
- Fence on the claim provenance (`acquisition === 'claimed'`) in
  `shiftReminderProfile.resolveShiftReminderProfile` — **BUILT 2026-09-06,
  field name is now fixed: the claim writer stamps `acquisition: 'claimed'`
  and `claimedAt` (Timestamp).** Profile `gig_claimed`, step
  `gig_claim_confirmation`, seeds `cortConfirmation.state='confirmed'`.
  See project_worker_messaging_tracks.md decision 1.
- Claim confirmation message (immediate): "You're on the crew —
  {job} {date} at {site}" (the openshift_welcome pattern, single-shift
  copy) so the worker gets an artifact of the commitment.

## Web ↔ Flutter parity checklist (both must ship together)

- Jobs board button states (web PublicJobsBoard/JobPostingDetail worker
  paths + app jobs_board/job_detail screens)
- Acknowledgement sheet w/ transportation checkbox + green confirm
- Claimed-state posting page banner → assignment view
- Cancel sheet tier-consequence copy
- i18n EN/ES for all new strings

## Failure/UX cases to test

1. Race on last spot (two claims, one wins, loser sees filled state)
2. Claim while holding overlapping shift → blocked with specifics
3. Tier-locked worker deep-links to a posting → locked state, not error
4. Claim then immediate cancel (>24h) → clean reversal, spot reopens
5. Offline claim tap → clear retry, no phantom double-claim (idempotency
   key per worker+shift)
6. Claim on a JO whose day-of readiness is 0/5 → still works, but
   recruiters see the readiness gap (JO card) — logistics push degrades
   gracefully

## Open questions for Friday (windows/tier-movement are NOT open — agreed 8/31)

1. ~~Inline assignment details on posting page vs route~~ → BUILT as
   route (claimed row = "View Details" → Assignment Details).
2. ~~Claim endpoint routing~~ → BUILT on `respondToAssignment`
   `decision:'claim'`.
3. Claim caps for Tier 3 → BUILT with a default of 2 live claimed shifts
   until the first completed one (`CLAIM_UNPROVEN_CONCURRENT_CAP`);
   confirm the number.
4. Cancel-policy threshold (24h?) + whether late cancels count like
   penalized no-shows or a lighter weight. (Sheet copy says "inside 24
   hours counts against your reliability" — nothing enforces it yet.)
5. Where the worker sees their tier (Profile, per messaging decision 4).
6. ~~Multi-day gigs: claim per day or whole run?~~ → BUILT per day on
   both web and app.
7. NEW: when to flip `CLAIM_TIER_WINDOWS_ENABLED` (needs the publish clock
   — `postedAt` is stamped when a post goes active — and the notification
   waves from the agreed spec).

## Suggested build order

1. Data model + claim endpoint (transaction, gates, provenance stamps).
2. App + web button states & acknowledgement sheets (parity).
3. Messaging `gig_claimed` profile + claim confirmation message.
4. Tier fields + release-window enforcement (can ship after claim v1 with
   everyone treated as one tier, windows off).
5. Tier computation cron + worker-visible tier UI + cancel teeth.

## Open shifts — the ON-CALL model (Greg 2026-09-03, follow-up session)

Open shift = regular staff where the CLIENT manages the schedule on-site.
HRX never states hours; the worker is simply on-call for X job at Y site.
Doubles as a recruiting tool: the posting advertises on the jobs board,
applicants build the labor pool / feeder group, and when real (claimable)
shifts land that group is notified in tier order.

Decisions + state:

- **Worker display (app SHIPPED c1_app 1bf6119; web = tracked gap)**:
  Schedule shows an on-call banner ("On-call at {site} — hours are
  managed on-site"), List rows read "On-call" (never a clock time — the
  midnight bug was date-only startDate rendered as 12:00 AM), an active
  engagement always lives in List regardless of contract startDate, and
  Assignment Details' schedule card reads "On-call — exact shift hours
  are managed on-site."
- **NO day-of hero for open shifts** (Greg: workers may be on-call at
  multiple sites and work few hours/month — a persistent hero would
  clutter and confuse). Excluded in dayOfShiftFrom.
- **Messaging (SHIPPED)**: welcome at creation ("your shift hours are
  managed on-site") + **bi-weekly Sunday-evening check-in** ("You're
  still on our on-call crew at {site}. Everything going OK?") replacing
  the weekly schedule digest — career-adjacent voice, doubles as roster
  hygiene via replies. Reminder doc keeps the openshift_weekly_digest
  type/id; first check-in lands the second Sunday after creation.
- **weeklySchedule stays as an internal scaffold** where ops wants
  pre-materialized timesheet rows — worker surfaces just never show it.
  NOTE: the web timesheet grid ALREADY materializes a blank enterable
  row for EVERY day in the window for isOpenShift assignments (the
  "Open · enter hours" rows) — Greg's "all 7 days available" already
  exists; no build needed.
- **Buttons**: Apply → **"Submitted"** post-apply (app tag shipped; web
  already said "Application Submitted"). "Under Review" only if it ever
  reflects a real recruiter action — no fake process states.

## Pre-demand labor pool + per-account onboarding throttle (Greg 2026-09-07 — URGENT)

Greg: "I'm okay building a qualified, interviewed, and onboarded labor
pool — in fact it's urgent that we do so. Ideally you would do all of
this before our human recruiters ever start working on the account."
Driving example: anticipated OnTrac Dallas business → recruit ahead
(Indeed + Craigslist ads, outreach to current Dallas workers), AI-bump
the better applicants to Tier 2, then a PER-CHILD-ACCOUNT setting
decides whether proactive onboarding spend (C1 Select onboarding +
background package + E-Verify) reaches Tier 2 or stays Tier-1-only.
This is also the answer to "who pays / when do we order screens" for
credential-gated Claim Shift (CORT Rapid etc.): spend is governed by
account ramp settings, not by individual claims.

### The pipeline (account "ramp mode")

1. **Intake**: posting ads (Indeed/Craigslist — manual today) + outreach
   to existing workers in the metro (notification groups; Natalie SMS).
2. **Qualify**: AI prescreen interview (EXISTS) → AI Tier Score (EXISTS,
   `shared/workerTierScoring.ts`, agreed 8/31: promotes Tier 3→2 only,
   be picky; screening completions already score points).
3. **Onboard (the new trigger)**: today screening auto-orders ONLY on
   assignment→confirmed (`screeningAutomationTrigger` + layered JO →
   Location → Account package resolution, AccuSource ordering behind
   env/tenant config + entity allowlist + dry-run + audit). Ramp mode
   adds a SECOND trigger: account-driven, pre-assignment — for pool
   members at/above the account's tier threshold, run C1 Select (Everee)
   onboarding invite → I-9/E-Verify (sequenced AFTER onboarding — E-Verify
   requires an actual hire, never speculative pre-employment) → account's
   background package (OnTrac → "Sodexo Basic"; CORT → "CORT Rapid").
4. **Recruiters inherit** a pool that is interviewed, tiered, and
   onboarded before they start working the account.

### Per-child-account settings (where the throttle lives)

On the account (child-account granularity, e.g. OnTrac Dallas):
- `rampMode: on | off` — master switch for proactive onboarding.
- `onboardDownToTier: 1 | 2` — Greg's toggle: Tier-1-only, or extend the
  spend to Tier 2.
- `screeningPackage` — already resolvable via the automation's Account
  layer; ramp mode reuses it.
- Budget guards (NEW, required): `maxOrdersPerDay` + `campaignBudget` (or
  max total orders) so a runaway pipeline can't order 400 screens; every
  order rides the existing screening_automation_audit trail.

### Credential-gated claiming (agreed direction, 2026-09-06 discussion)

- Requirements on the posting/JO; worker credential wallet
  ({package, passed, completedAt, expiresAt, source}) — server-side
  evaluation EXISTS (`evaluateScreeningSatisfiedServer` +
  `requestedEquivalencyKey`); user docs carry `backgroundCheckOrders[]`.
- Claim button states: cleared → Claim Shift (instant); missing →
  "Get qualified"; in-flight → "Screening in progress" (maps to the
  existing `ineligible` gate / "Requirements needed" state).
- Credentials are CLIENT-SCOPED (exact package match; equivalency table
  later). Expiry per client policy so cleared workers degrade to "Get
  qualified", never to a compliance no-show.
- FCRA: pass/fail drives the button; the app says "not eligible", never
  why; adverse action stays human.
- Conditional claim (shift ≥N days out, spot held pending clearance,
  auto-release to the pool at T−X) — DEFERRED: no waitlist state in the
  agreed model; revisit only if cleared-pool fill rates disappoint.

### Open questions (Friday)

1. Tier threshold semantics confirmed as: ramp spend reaches Tier 2 when
   toggled, else Tier-1-only? (Greg's words: "onboard Tier 2 or only
   Tier 1".)
2. Budget guard defaults (orders/day, campaign cap) + who gets the
   "campaign spent $X this week" digest.
3. Consent capture for pre-assignment screening orders (FCRA disclosure
   ride the C1 Select onboarding? AccuSource applicant-entry flow?).
4. Do AccuSource RESULTS land electronically on `backgroundCheckOrders[]`
   (auto-populating the wallet) or is a human keying them?
5. Ads: is Indeed/Craigslist posting staying manual, or does ramp mode
   generate the ad copy + track source attribution?
6. Metro targeting for outreach ("current Dallas people") — existing
   notification groups, or a geo query?

## ✅ RAMP THROTTLE SHIPPED overnight 2026-09-07→08 (Greg: "operational when I wake up")

Commits b9444ca5 + follow-up (throttle card on all account types); functions
(scheduledOrchestrator, onApplicationHiringSignalsChangedAutoOnboard) and
hosting deployed; curl 200 postflight.

- **Settings — account page → Cascading Data → "Applicant Auto-Onboarding"
  card, on EVERY account type** (child overrides national; "Off (inherit)"
  DELETES the fields so an untouched child keeps inheriting):
  `tierAutomation.autoOnboardDownToTier` (0/1/2 — Off / Tier 1 only /
  Tiers 1+2), `maxAutoOnboardsPerDay` (default 25), legacy
  `autoOnboardTier2` kept in lockstep. Last-sweep stats line renders under
  the budget field.
- **Budget guard**: transactional per-day counter
  `accounts/{policyAccountId}/ramp_counters/{YYYY-MM-DD}` on the account
  whose config supplied the policy (national opt-in caps the whole family;
  child override gets its own budget). Cap-skips are NOT stamped → retried
  next day by the sweep.
- **Hourly `tier_ramp_sweep`** rides scheduledOrchestrator
  (ENABLE_TIER_RAMP_SWEEP, default on; ~2 account queries/tenant/hour when
  nothing is opted in): backfills EXISTING applicants (submitted/waitlisted,
  postings + JOs of the account family, chunked 'in' queries, caps logged),
  auto-applies qualifying Tier 3→2 promotions scoped to ramp accounts'
  pools (shared scorer, tenant threshold config, dismissed/approved
  proposals respected), then funnels eligible applicants through the SAME
  `maybeAutoOnboardTierTwoApplicant` path as the live trigger. Stamps
  `tierAutomation.lastSweepAt/lastSweepStats`.
- **Verified end-to-end on prod** with a synthetic account (created →
  UI toggle → Firestore write confirmed → sweep picked it up → stats line
  rendered → deleted). Live-config truth at ship time: screening automation
  ENABLED, dryRun FALSE, real AccuSource ordering ON, allowlisted to
  `c1_select_llc`; EVEREE_ENABLED=true; ACCUSOURCE production with
  HRX_ONLY=false. **Flipping a real account = real spend immediately,
  throttled by the daily budget.** Tenant tierAutomation mode remains
  'propose' tenant-wide; ramp accounts get scoped automatic promotion.
- Footgun fixed en route: the old UI switch wrote dot-keys into local
  state that nested reads never saw; `updateTierAutomation` batches
  fields into one updateDoc and merges the nested map.
