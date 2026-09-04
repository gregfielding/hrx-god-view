# Tier system / Claim Shift — planning spec (for Friday planning)

**Status:** DRAFT for the tier-system planning session (~2026-09-11).
Written 2026-09-03 from Greg's flow description + the current codebase.
Nothing here is built except where marked EXISTS.

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
  `shiftReminderProfile.resolveShiftReminderProfile` — field name must
  match whatever the claim writer stamps.
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

1. Inline assignment details on posting page vs route to Assignment
   Details (this spec recommends route; Greg's original ask was inline).
2. Claim endpoint routing (which existing callable carries it, given the
   function cap).
3. Claim caps for Tier 3 (agreed spec says "limited concurrent claims
   until first few shifts completed" — pick the number).
4. Cancel-policy threshold (24h?) + whether late cancels count like
   penalized no-shows or a lighter weight.
5. Where the worker sees their tier (Profile, per messaging decision 4).
6. Multi-day gigs: claim per day (existing day-by-day unit) or whole run?

## Suggested build order

1. Data model + claim endpoint (transaction, gates, provenance stamps).
2. App + web button states & acknowledgement sheets (parity).
3. Messaging `gig_claimed` profile + claim confirmation message.
4. Tier fields + release-window enforcement (can ship after claim v1 with
   everyone treated as one tier, windows off).
5. Tier computation cron + worker-visible tier UI + cancel teeth.
