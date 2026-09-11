# Onboarding + Claim readiness — C1 Events hire-everyone, gate at Claim (decided 2026-09-11)

**Status: DECIDED. S0 (readiness check) DONE; S3 (interview required for Tier 2) COMMITTED 2026-09-11 (4faec962) — DEPLOY PENDING; S1/S2/S4–S6 not built.** Greg, 2026-09-11, while the native apps are in
store review. Companion to [[project_tier_system_claim_shift_spec]] (Claim
Shift v1) and [[project_worker_onboarding_everee]] (the completion curve).
Build slices at the bottom; web + app ship together (parity rule).

## The question

Web workers today: browse the jobs board (or tap an SMS link) → Apply →
account → interview → hired. Once the apps are live and gig shifts are
*claimed* instead of applied for, many workers will never "apply" to a C1
Events posting — so "hire on apply" stops being the moment onboarding
starts. Greg floated redirecting Find Shifts to onboarding first.

## Decisions (Greg 2026-09-11)

1. **Claiming requires payroll to be finished at the shift's hiring entity.**
   For C1 Events (1099) that means Everee done: W-9 + direct deposit. No
   "hold the spot until T−X" conditional claim (stays deferred).
2. **The AI interview is NOT required to be hired or to claim** at C1 Events,
   **but it IS required to reach Tier 2.** Promotion must hard-require a
   completed interview (today it doesn't — see ground truth).
3. **C1 Events hire-everyone is entity-wide.** Every application to a posting
   whose `hiringEntityId` is `c1_events_llc` starts 1099 on-call employment,
   regardless of which user group (if any) the posting feeds.

Plus the model these sit inside (proposed, Greg agreed):

- **Browsing stays open to everyone.** Gate the Claim button, not the board —
  a shift in hand is the motivation to finish setup. No redirect of Find Shifts.
- **Hire at first intent, not at account creation**: first Claim tap on an
  Events shift, first apply to an Events posting, or an explicit "Get set up"
  tap. Account-creation hiring would feed the ~876 stuck Events onboardings
  with people who never wanted Events work.
- **One rule on web and app: to claim, you must be ready at the entity that
  runs the shift.**

| | C1 Events (1099) | C1 Select (W-2) |
|---|---|---|
| Who can get ready | Anyone, self-serve | Only workers the ranking / JO hiring plan picks |
| Ready means | Account + approved headshot + Everee complete (W-9, direct deposit) | Hired + onboarded (I-9/E-Verify) + the client's screening package |
| Onboarding starts | First intent (Claim tap / Events apply / "Get set up") | Hiring plan sweep or recruiter |
| Button before ready | **Finish setup to claim** → checklist → back to that shift/day | **Apply** |

- **Web-first workers** do Events setup on the web (Everee embed works there);
  the app download prompt goes on the "You're ready to work" moment, never
  between apply and the interview (extra step = drop-off).
- **App-first workers** get the same flow inside the app.

## Ground truth at decision time (2026-09-11)

- **Only 18 of 35 active C1 Events postings hire on apply.** Hire happens only
  when the posting's `autoAddToUserGroups` group has
  `hiringConfig.quality.preset == 'hire_everyone'` +
  `automation.hiringActive == true` + `employment.hiringEntityId ==
  'c1_events_llc'` (`onApplicationHiringSignalsChangedAutoOnboard` →
  `autoOnboardForGroupIfEligible`, gated on the application carrying a
  `groupId`). The other 17 had no group or a non-hiring group: Crystal Falls
  Cooks, Slammers Stadium ×2, Bottlerock ×2, Minnesota Yacht Club, Kyle's
  Birthday, FIFA Dallas, Prep Cooks, BTS Stanford ×3, Moody Amphitheater,
  Dell Diamond Cooks, Eaux Claires, Sea Hear Now, Electric Forest.
  (Read-only audit: `functions/.scratch/events_apply_hiring_audit2.ts`.)
- **Claim Shift has no employment/payroll gate.** `claimShift.ts` checks
  posting/JO/shift liveness, DNR, headshot (`assertWorkerHeadshotApproved`),
  tier window (OFF), conflict, claim cap. `resolveOnboardingConfigForJobOrder`
  runs AFTER the gates and only seeds an onboarding instance.
- **Tier 2 promotion has no hard interview check.** `shared/workerTierScoring.ts`
  `qualifies: total >= config.threshold`; threshold is 50 since 2026-09-11 and
  the full no-interview profile score is exactly 50 (25+10+10+5), so the
  "no interview, no promotion" guarantee is currently luck. 0 no-interview
  workers qualified on 9/11, so enforcing it changes nobody today.
- **Post-apply routing differs**: web group auto-hire lands on the payroll hub
  (`/c1/workers/earnings`); the app's `quick_apply_flow.dart` sends first-time
  applicants to the prescreen and never to payroll.
- **Onboarding is slow when there's no shift pulling**: Events median 6.8 days
  invite→complete, p90 22.7 days (August cohort). The bet behind decision 1 is
  that a 1099 setup (SSN, W-9, bank) takes minutes when a claim is waiting.
- Only **1** active posting has `claimShiftEnabled` today — no existing claims
  to migrate.

## ✅ S0 result (2026-09-11) — the readiness signal in "Readiness, precisely" was WRONG

Read-only scripts: `functions/.scratch/verify_events_readiness_signal{,2}.ts`,
`verify_events_readiness_live13.ts` (live Everee GET, flags only).

- **`status == 'active' || onboardingComplete` would have locked out paid
  workers**: of the **174** C1 Events workers paid in the last 30 days
  (`timesheet_entries` status `paid`, `hiringEntityId == 'c1_events_llc'`,
  `workerId`), **92** read not-ready. 79 of those are Everee-complete — the
  onboarding ENGINE row stays `status: 'onboarding'` because its
  `onboardingComplete` covers more than payroll (and isn't re-synced). Across
  all 3,158 Events links, 515 Everee-complete workers read not-ready.
- **Use rule C instead** (matches Everee on every paid worker checked):
  ready = link `tenants/{t}/everee_workers/c1_events_llc__{uid}` has
  `status == 'onboarding_complete'` or `apiObservedOnboardingCompleteAt`,
  OR the employment row has `evereeOnboardingStatus == 'complete'` /
  `payrollOnboardingCompletedAt` / `payrollStatus == 'complete'` /
  `status == 'active'` / `onboardingComplete === true`. **161 / 174** paid
  workers pass.
- **The other 13 are really unfinished**: live `GET /api/v2/workers/{id}`
  returns `onboardingStatus: IN_PROGRESS`, `onboardingComplete: false` for all
  13. **Everee pays C1 Events workers who haven't finished onboarding.**
  Decision 1 as written blocks those 13 from claiming until they finish —
  confirm with Greg (and check the 1099/W-9 exposure of paying unfinished
  contractors).
- **S1 must fall back to a live Everee GET** (same call as
  `evereeGetMyOnboardingStatus`) before refusing a claim: caches lag webhooks,
  and the check only runs on a refusal, so it's cheap. On a positive read,
  mirror it the way that callable does.

- **Client pre-render is allowed by rules**: workers can read their own
  `entity_employments` row (`resource.data.userId == uid`) and their own
  `everee_workers` link (`resource.data.firebaseUid == uid`) — single-doc
  gets by the known ids; any query must filter on that field to be
  list-provable.

## S3 COMMITTED 2026-09-11 (commit 4faec962) — deploy pending

`scoreTierPromotion` now returns `qualifies: total >= threshold &&
interviewScore100 != null` plus `blockedBy: 'no_interview'` (shared/ +
src/shared/; functions/src/shared is a symlink). 5 mocha tests in
`functions/src/__tests__/tierAutomation/workerTierScoring.test.ts`.
**⚠️ NOT YET DEPLOYED** (the deploy was held for Greg's OK): it takes effect
only when `scheduledOrchestrator` (ramp + hiring-plan sweeps) and
`scheduledScoringDistribution` (nightly promotion sweep) — the only callers —
are redeployed. Until then production still promotes on score alone.
Impact at ship: Tier 1 = 16 (all interviewed), Tier 2 = 172 (1 without an
interview — left as is, no demotion), pending proposals 1 (unaffected).

## Readiness, precisely

Employment row: `tenants/{t}/entity_employments/{uid}__{entityKey}`
(`workerOnboardingPipeline.ts`; entityKey `events` / `select` / `workforce`).
The onboarding engine sets `status: 'active'` + `onboardingCompletedAt` when all
required steps are satisfied (`entityEmploymentLifecycle.buildEngineSyncLifecycleFragment`);
the Everee webhook owns the completion signal. **Ready = row exists AND
`status == 'active'` (or `onboardingComplete === true`), AND headshot approved.**
⚠️ Slice 0 verifies this against known-paid Events workers before any gate ships —
a false "not ready" would lock working people out of claiming.

## Build slices

**S0 — Verify readiness signal (read-only).** Sample ~30 C1 Events workers paid
in the last 30 days + ~30 still at Everee `created`; confirm `status/onboardingComplete`
separates them cleanly. Also confirm workers can read their own
`entity_employments` row under current rules ([[feature_users_read_rules]]) —
the board pre-renders the button state from that read; the server gate is the backstop.

**S1 — Server claim readiness gate** (`claims/claimShift.ts` +
`claims/claimShiftPolicy.ts` pure fn + mocha tests; no new Cloud Function —
service cap). After the headshot gate, before tier: resolve the JO's hiring
entity (move `resolveOnboardingConfigForJobOrder` up), read the employment row.
- Events, no row → start `runStartOnCallEmploymentFlow` (`workerType:
  'entity_default'`, new triggerSource `claim_intent`) → throw
  `setup_required` `{ entityKey, stage: 'started' }`.
- Row exists, not ready → `setup_required` `{ entityKey, stage: 'in_progress' }`.
- Select (or any non-self-serve entity), no active row → `ineligible`
  `{ reason: 'not_hired' }` (client shows Apply).
- Add `setup_required` to the typed-code contract (web
  `formatClaimShiftError.ts`, app `claim_shift_error.dart`).

**S2 — Entity-wide Events auto-hire** (extend the existing
`onApplicationHiringSignalsChangedAutoOnboard`, no new function): when an
application leaves `in_progress` and its posting/JO `hiringEntityId ==
'c1_events_llc'`, run `runStartOnCallEmploymentFlow` whether or not a group is
attached (idempotent — short-circuits on an existing row). Kill switch
`tenants/{t}/settings/eventsAutoHire.enabled`. **Forward-only**: no backfill of
existing applicants on the 17 postings without a dry-run count + Greg's OK
(every hire sends an Everee invite SMS/email).

**S3 — Interview required for Tier 2** (`shared/` + `src/shared/` mirror):
`qualifies` also requires `interviewScore100 != null`; scorecard factor detail
reads "Interview required". Tests; redeploy every function importing it
(nightly tier sweep, `scheduledOrchestrator` sweeps — grep at build time).

**S4 — Web UI.** Claim row + sticky CTA show **Finish setup to claim** when the
worker's row for the posting's hiring entity isn't ready (`ShiftSelector`,
`JobPostingDetail`, `PublicJobsBoard`). Tap → payroll hub
(`/c1/workers/earnings`) with `returnTo` = posting + day; on return a ready
worker lands on the claim sheet. Signed-in unready workers see a pinned
"Finish setup to claim shifts — n of 3 done" card (photo approved · W-9 ·
direct deposit). Events job applies route to the payroll hub after submit
(today only group signups do); the interview is offered after setup. i18n EN/ES.

**S5 — App parity (same session, or a punch-list entry).**
`ClaimShiftBlockCode.setupRequired`; `_GigRowActionButton` label + route to
`AppRoutes.payroll` with return; board card; `quick_apply_flow.dart` Events
path → payroll first, prescreen offered after. Ships in the first app update
after 1.0.1 unless 1.0.1 is still open.

**S6 — App prompt at the ready moment.** When payroll completes on web, show a
one-time "You're ready to work — get the app for shift alerts" card (reuse
`WorkerAppDownloadBanner` platform detection). Low priority.

## Copy notes

- Button: **Finish setup to claim** (not "Requirements needed").
- Interview nudge must NOT promise earlier shift access while tier windows are
  OFF (`CLAIM_TIER_WINDOWS_ENABLED=false`). Until then: "Take the interview to
  qualify for Tier 2." Switch to the benefit copy when windows go on.

## Open items

- Select gigs with Claim on: readiness = active Select employment + client
  credential (see "Credential-gated claiming" in the tier spec) — S1 blocks
  with `not_hired`; the credential half stays with that spec.
- Illinois AEDT: entity-wide hire-everyone is not score-based (no AEDT
  exposure); the interview→Tier 2 rule is, and rides the existing Illinois notice.
