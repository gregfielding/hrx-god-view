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
tier vs the shift's clock. Recruiters can still place anyone manually at any time —
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
5. Sequencing vs the roster board — Phase 0+1 don't depend on it, but Phase 3's crew
   curation is much better WITH it. Build order opinion wanted.

Related: [[project_signup_flow_review]], [[project_recruiter_roster_adoption]],
[[project_offer_messaging_tiers]], [[project_open_shift_feature]],
[[project_multiday_shifts]], [[project_ontrac_account]] (the recruiting-scale driver).
