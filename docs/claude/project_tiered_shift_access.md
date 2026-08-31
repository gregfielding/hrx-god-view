# Tiered shift access (Tier 1/2/3) — how gig platforms do it + HRX integration plan

> Greg + Claude design discussion 2026-08-29, written for Mark + his Claude. Status:
> **design brief, nothing built.** Emerged from the signup-flow review
> ([[project_signup_flow_review]]): the end-state for gig work is claim-based shifts with
> tiered access replacing per-shift recruiter review — with the hard constraint that we
> favor our proven regulars over fresh signups, and the vocabulary doctrine that
> **enrollment ≠ booked** (only a confirmed assignment ever means "you're working").

## The concept in one paragraph

Recruiters stop picking 10 winners from 100 applicants per shift. Instead, shifts are
posted with **release tiers**: the venue's trusted crew sees and can claim them first
(instant confirmation), proven platform workers get access after a window, and new
approved workers last. Claiming auto-creates a confirmed assignment up to capacity;
beyond capacity it's a waitlist. The recruiter's job inverts from *selection per shift*
to *curating who's in which tier* — which is literally what Rosa's and Danny's
spreadsheets already do ([[project_recruiter_roster_adoption]]): their crew lists ARE
Tier 1, kept outside the product today.

## How the major gig platforms use tiering (patterns, 2026)

Every serious gig-work platform converged on the same five mechanics:

1. **Client/venue favorites lists.** Instawork, Qwick, Wonolo, and Indeed Flex all let
   the business mark favorite workers; favorites are notified first and often auto-book.
   Indeed Flex calls it "My Flexers"; Wonolo has requester preferred lists; Instawork
   partners' favorites get first dibs at that venue. This is the per-account tier.
2. **Platform-wide status/reliability score.** Instawork's "Top Pro"-style statuses,
   Qwick's professional ratings, Traba's reliability score, Bluecrew's crew ratings.
   Computed from attendance (no-shows/lates weigh heaviest), completed-shift volume,
   and client ratings. Benefits scale with status: earlier shift visibility,
   higher-pay gigs, priority support.
3. **Timed release windows.** The actual gating mechanic: a posted shift is visible to
   favorites/top status immediately, the next band hours later, everyone eventually.
   Windows are per-shift-post config with sane defaults, not per-worker logic.
4. **Auto-book for trusted workers.** The top band doesn't "apply" — claiming IS
   booking (instant confirmed). Some platforms let favorites be auto-booked by the
   client without even claiming.
5. **Consequences + caps.** No-shows and late cancels demote status and can pause
   access; brand-new workers get limited concurrent claims until they've completed a
   few shifts. Waitlists auto-promote when someone drops; light overbooking margins
   absorb no-shows on large crews.

Two things they conspicuously do NOT do: nobody runs a recruiter-review step per shift
for gig work, and nobody exposes raw scores to workers — workers see named statuses
("Pro", "Top Rated") and concrete unlock conditions ("complete 3 more shifts"), never
numbers.

## The HRX tier model (as discussed with Greg)

- **Tier 1 — the crew.** Per-account regulars: Danny's Oakland Arena 100, Rosa's
  VenueSmart block regulars. Curated by recruiters (and eventually clients). Sees
  shifts at post time; claim = instant confirmed assignment; optionally auto-book via
  the parked "always hire" designation ([[project_offer_messaging_tiers]] Tier 2 —
  same concept, finally with a home).
- **Tier 2 — proven platform workers.** Earned: N completed shifts + clean recent
  attendance (+ interview quality as a **ranking/access input**, never a hire/no-hire
  decision — see compliance note). Sees shifts after the Tier-1 window.
- **Tier 3 — approved, unproven.** Everyone through signup ("approved to work with
  C1"). Sees what's left after windows; limited concurrent claims until they've
  completed their first few shifts.

Tier is **two-dimensional**: an account-level dimension (crew membership — you can be
Tier 1 at Oakland Arena and Tier 3 everywhere else) and a global dimension
(reliability). Effective access for a shift = best of the two.

⚠️ **Compliance note (AEDT):** using AI interview scores to auto-*reject* hiring is
regulated territory (NYC Local Law 144 bias audits, Illinois, Colorado AI Act).
Scores ordering *access timing* with a human-curated Tier 1 and an earn-your-way-up
path is the defensible shape; automated hiring *decisions* from scores are not, absent
legal review. Recommendation on file: score-gated group auto-hire should eventually
demote to a recruiter-priority queue ([[project_signup_flow_review]]).

## What HRX already has (the building blocks)

- **User groups = crews** (with auto-add from postings + auto-hire machinery).
- **Assignments as the single source of truth** — claiming maps cleanly to
  "create confirmed assignment," riding the existing hire path (notifications,
  denorm, undo-safe ids). [[feedback_assignment_point_of_truth]]
- **Multi-day gig shifts** with day-by-day apply/confirm/hire (P0-P2 shipped 8/01) —
  the claim unit already exists per day.
- **Offer messaging Tier 1** (invitation framing) shipped; **"always hire"
  auto-accept designation** specced and parked — becomes Tier-1 auto-book.
- **Open Shift spec** ([[project_open_shift_feature]]) — the standing-crew,
  date-range shift shape Tier 1 wants.
- **Roster board / "Paste your list"** design — the recruiter surface where crews
  (Tier 1 membership) get curated.
- **Reliability raw data**: timesheet entries vs assignments give worked counts and
  no-show/late signals per worker per account, historically. Nothing computes it yet.
- **Prescreen scores** on applications (cumulative answer bank, orchestrator
  decisions) — the Tier-2 ranking input.
- **Vocabulary doctrine** already shipped: approved ≠ booked; only assignments say
  "you're working."

## ⚠️ The awareness layer — missing from the original brief (Greg, 2026-08-31)

Greg, reading this brief back: *"If Tier 1 workers get first dibs on a job, then they
need to be notified first. Currently we send new-shift updates to user groups set to
auto-message on the job order, or manually blast everyone within 30 miles. It's
conceivable a Tier 1 worker isn't in a group and lives 32 miles away — how would they
be notified?"*

He is right, and it is a real hole in this document. **This brief designs who may
CLAIM a shift and when. It never designs who gets TOLD.** Phase 1 says Find Shifts
*filters* by effective tier — that is pull. A release window nobody knows has opened is
worth nothing, and "first dibs" a worker cannot perceive is not a benefit.

### Why the 32-mile worker falls through

Both existing mechanisms are **set-based push**: compute an audience (group members, or
everyone within 30 mi) and send to all of it. Tiering is **rank-based**: order
candidates by relationship quality and release in waves. Bolting one onto the other
produces exactly this gap.

The fix is one conceptual move: **distance and group membership stop being gates and
become ranking inputs.** Three layers that are currently conflated:

1. **Eligibility — hard gates only.** Classification/entity, credentials, DNR
   (accountId + parentAccountId), separation (hiringEntityId), restricted-group
   intersection. All already implemented (see `job_board_eligibility.dart`).
   **Distance does not belong in this layer.**
2. **Ranking — soft signals.** Effective tier (dominant term), affinity (worked this
   account / this role / this venue before), reliability, and distance **as a cost, not
   a cutoff**.
3. **Delivery.** Which ranked band is told, when, on which channel.

A Tier 1 worker at 32 miles then ranks above a Tier 3 at 5 miles. We never widen the
radius; we stop treating radius as a boolean. Group membership likewise becomes a
boost, not a door. **Wave 1's audience is simply "eligible workers whose effective tier
for THIS account is 1"** — read from `workerTiers.accounts[accountId]`, which Phase 0
already seeds from both user groups and historical assignments. Danny's Oakland Arena
regulars qualify whether or not anyone put them in a group.

### "How does this shift connect to them, vs 50 others posted nationally?"

Two separate problems:

- **Push.** A Tier-1 notification must be a *different message*, not the same blast
  sent earlier. Name the venue they already know; state the exclusivity and the
  deadline: *"You're first in line — Oakland Arena, Sat 6 PM, $24/hr. Yours to claim
  until 8 PM."* If the copy doesn't say they have first dibs, the mechanic is invisible.
- **Pull.** The app needs a **"For you"** surface distinct from "All shifts", ranked by
  the same score, with a claim badge and a countdown. The other 50 shifts never enter
  it because the worker isn't eligible for them.

### ☠️ The daily SMS cap collides with wave-based release

`tryClaimDailySmsSlot` (`functions/src/jobOrderAutoMessaging.ts`) caps shift-invite SMS
at **one per worker per 24 h, globally and transactionally**. Against tiered waves that
misfires badly: a worker invited to shift A this morning cannot be texted about shift B
tonight — and workers who are Tier 1 at *several* accounts hit the cap first. **The cap
would systematically silence exactly our best workers.** This is not a bug in the cap
(it exists for good reason — see the 2026-08-31 over-texting incident in
[[project_shift_confirmation_cadence]]); it is a genuine conflict between anti-spam and
relevance, and it has to be resolved deliberately rather than discovered in production.

Recommended resolution: **push for tier waves, SMS only for the open/fallback wave.**
Push is uncapped, free, instant, and the app now exists. It also produces a strategic
side effect worth engineering on purpose — *"install the app to get first dibs"* is an
honest, concrete reason for a worker to install it. **Tiering supplies the carrot for
app adoption, and app adoption supplies the uncapped channel tiering needs.** If SMS
must carry a tier wave, digest it (one message, several shifts) rather than one send
per shift.

### ☠️ Phase 0 would compute Tier 1 = nobody at Oakland Arena

Phase 0 derives reliability from "timesheet entries vs assignments". Two findings from
2026-08-31 break that:

- Attendance data is not trustworthy — there is **no real-time check-in signal** at all;
  the no-show detector has been muted and 65 unfounded flags cleared
  ([[project_shift_confirmation_cadence]]).
- **Oakland Arena has zero timesheet coverage across 166 assignments.** A per-account
  "completed shifts" count computed from timesheets therefore returns **0 for precisely
  the crew that most deserves Tier 1**.

So: compute completed-shift counts from **assignments**, never timesheets, and treat
**recruiter curation as the primary Tier-1 seed** with computation as an additive path.
That is also the fastest route — Danny's and Rosa's lists make Tier 1 real on day one,
with no dependency on attendance data we do not yet have.

## ✅ AGREED SPEC — Greg + Danny + Rosa + Mark, 2026-08-31

This supersedes the exploratory model above where they differ. Recruiters were
consulted directly; these are decisions, not proposals.

### Tier assignment

- **Everyone starts Tier 3** (general population). New signups start Tier 3.
- **Recruiters promote manually**, 3→2 or 3→1, from within user groups.
- **AI "Tier Score"** reviews Tier 3s for promotion to **Tier 2 only** (never
  straight to 1). Inputs: interview scoring, resume upload, profile
  completeness, qualifications, and app download/usage. **Be picky.**
  - App-usage input **takes effect 2026-10-01**, not before — at launch nobody
    has the app and it would suppress every promotion.
  - App usage is a **light thumb on the scale, not a major term.** It
    correlates with owning a current smartphone; given the AEDT note above,
    keep it minor and defensible.
- **Automatic movement** (both directions, no human in the loop):
  - **40 hours worked with no penalized no-show → up one tier.**
  - **One penalized no-show → down one tier.**
  - **40 hours restores** the original tier. The counter **resets to zero** on
    demotion.

### User groups = notification groups

Groups are *not* the tier. They are who gets SMS/push when a job order
publishes new shifts — which is what they already do today. Their new job is to
be **the recruiter's to-do list**: work through the members of your commonly
used groups and promote the ones who have earned it.

### Notification schedule (all offsets from PUBLISH)

| When | Who |
|---|---|
| T+0 | Tier 1 |
| T+8h | Tier 1, second notification |
| T+10h | Tier 2 **+ any unassigned Tier 1** |
| T+24h | Tier 3 **+ any unassigned Tier 1 and Tier 2** |

Jobs-board visibility follows the same clock: Tier 1 immediately, Tier 2 at
+10h, Tier 3 at +24h.

☠️ **Volume.** An unassigned Tier 1 receives **four touches per shift**. Five
eligible shifts published in a day is twenty notifications — the Kelly Idarraga
over-texting incident, doubled, by design rather than by bug.
**SMS must be throttled and digested** (`tryClaimDailySmsSlot` already caps
invites at 1/worker/24h, so on SMS the ladder silently collapses to one message
anyway). Push is instant and unlimited per Greg. Noted risk, Greg's call:
spammed iOS users revoke notification permission outright and essentially never
re-grant it, which would cost the T+0 Tier-1 channel permanently — a digest
("3 shifts you're first in line for") protects the channel without a cap.

Later waves must **exclude workers already confirmed for an overlapping
shift** — "unassigned" means *not booked at that time*, not *not booked on this
shift*. Mechanism still to be worked out.

### Claiming

**Claim Shift** → confirmation toast (uniform / transportation / will be there
on date+time) → confirm → **immediately CONFIRMED**. No Pending, Applied, or
Accepted. The only states are **CONFIRMED / Cancelled / No-Show**.

Claim must be **transactional against remaining capacity**. There is no
waitlist state left in the model, so the loser of a race gets an honest
message — *"this shift just filled"* — not a state.

### Exception: Open shifts

Open shifts **post immediately and are visible to everyone until filled**, with
no tier gating. They keep the **existing Apply button and Applied state** — no
Claim button. Their purpose is to feed the "feeder" user group, whose members
then receive real shift notifications when actual orders land.

### No-shows and penalties

On the **timesheet entry layout**, where hours are missing, the recruiter marks
**No-Show with Penalty** or **No-Show No Penalty**. Unmarked items are swept
**Friday night to No-Show *No* Penalty** — defaulting to not punishing, so the
team chooses whom to penalize rather than the system choosing by default.

A penalized worker **is told**: they've been penalized for a no-show and may
see fewer shifts as a result. 40 clean hours restores their tier.

☠️ **Scope the Friday sweep by import, not by assignment.** Claiming creates an
**assignment**; it does **not** create a timesheet row. There is no
assignment→timesheet materializer — entries come only from
`createDraftTimesheetEntryCallable` (manual) or the import pipeline
(`saveImportTimesheetRows` / `submitImportTimesheetBatch` /
`importTimesheetMatchWorkers`, ingesting a client's timesheet file). Over the
60 days to 2026-08-31: 2,962 assignments, **2,083 with a timesheet (70%)**,
**63 zero-hour** (the true review candidates, ~8/week — very manageable), and
**879 with no row at all (30%)**.

Therefore: **the sweep applies only to assignments whose (account, week) had a
timesheet import actually processed.** Where no import landed, assignments are
out of scope — not reviewed, not defaulted, not recorded. Without this rule the
Friday sweep stamps ~879 people as no-shows, which is the 65-flag incident at
13× scale, and now worker-visible.

### 🚩 Unresolved: hours-based movement stalls where imports don't land

The 40-hour rule runs on imported hours. Four Oakland Arena job orders (Usher,
Ticket Taker, Wardrobe Attendant, Elevator Attendant) have **166 assignments and
zero timesheet rows** — re-verified by worker+date, not just jobOrderId.
Account-wide Legends Global is at 74%, so this is specific to those four.

Greg 2026-08-31: cause unknown; the historical pile will be cleared Friday and
ignored. That resolves the backlog. It does **not** resolve the ongoing flow:
until those job orders produce timesheets, **Danny's Oakland Arena crew
accumulates zero hours forever and can never be promoted** — the people the
tier system exists to reward are invisible to the mechanic that rewards them.
Either Legends starts sending those hours, or hours-based movement needs a
fallback (count completed **assignments** where no import exists).

## Integration plan (phased, each phase independently shippable)

**Phase 0 — reliability + tier computation (server, no UI).**
Nightly job (existing scheduled function, no new Cloud Run service) computes per
worker: completed-shift count (global + per account), no-show/late-cancel counts over
trailing 90d, and writes `users/{uid}.workerTiers = { global: 1|2|3, accounts:
{accountId: 1} }` + the inputs. Tier-1 account membership seeds from TWO sources:
existing user-group crews AND historical assignments (anyone with ≥N completed
assignments at an account in the last 90d is de-facto crew — we have this data today,
so Rosa's and Danny's regulars are Tier 1 on day one without anyone lifting a finger).
Recruiter override field wins over computation, both directions.

**Phase 1 — release windows on gig shifts (the core mechanic).**
Shift posting gains a tier schedule (defaults: Tier 1 at post, Tier 2 +12h, Tier 3
+24h; per-post editable; "everyone now" remains one click for fire drills). Claim =
existing hire path creating a confirmed assignment, capacity-capped; waitlist beyond
capacity with auto-promote on drops. Find Shifts filters by the worker's effective
tier vs the shift's clock — and **each wave opening must also PUSH** to that wave's
ranked audience (see the awareness-layer section above; pull alone leaves the
window invisible). Recruiters can still place anyone manually at any time —
tiering gates *self-serve claiming*, never recruiter action.

**Phase 2 — worker-facing transparency.**
Shift cards show "Claimable now" vs "Unlocks for you in 5h"; profile shows named
status (not numbers) with concrete progression ("Complete 2 more shifts to unlock
early access"); claim confirmations use the booked vocabulary ("You're confirmed for
Sat 3 PM at Oakland Arena"). No-show consequences stated up front at claim time.

**Phase 3 — Tier-1 power features.**
Revive "always hire" as auto-book for designated crew members; account-level
favorites management on the roster board (the paste-your-list preview doubles as the
crew editor); client-facing favorites later if/when clients get portal access.

**Phase 4 — hardening.**
Demotion rules (no-show → drop a tier for 30d), new-worker concurrent-claim caps,
overbook margins per venue, waitlist SMS ("a spot opened for Saturday").

## Open questions for Mark

1. Tier windows: are 0/12/24h the right defaults for VenueSmart-style events, or do
   short-notice fills need a compressed schedule (0/2/4h)?
2. Where does claiming live vs Indeed Flex-sourced work? (Flex books on their side —
   tiering applies only to HRX-posted gig shifts; keep the boundary explicit.)
3. Worker-facing status names — "Crew / Pro / Member"? Avoid exposing "Tier 3".
4. Does Tier-1 auto-book need per-worker opt-in (Greg's parked designation implies
   recruiter-designated, worker-consented)?
6. **Channel split for tier waves** — push-only for Tier 1/2 with SMS reserved for the
   open wave (recommended above), or tier-aware SMS caps? This decision unblocks the
   rest of the awareness layer.
7. **Ranking weights** — how much does distance cost relative to one tier step? Tier 1
   at 40 miles vs Tier 2 at 5: who hears first, and does that flip for a 6 AM shift?
8. **Wave audience size** — release to ALL of Tier 1, or the top N by rank? All of
   Tier 1 is simpler and likely right for venue crews; top-N matters once crews grow.
5. Sequencing vs the roster board — Phase 0+1 don't depend on it, but Phase 3's crew
   curation is much better WITH it. Build order opinion wanted.

Related: [[project_signup_flow_review]], [[project_recruiter_roster_adoption]],
[[project_offer_messaging_tiers]], [[project_open_shift_feature]],
[[project_multiday_shifts]], [[project_ontrac_account]] (the recruiting-scale driver).
