# c1_app gap punch list (Phase 0 output, 2026-08-29)

> Source: full architecture map of ../c1_app (186 files) diffed against the
> web spec (files 01–04). Phase 0 verdict: **tree compiles** (one analyzer
> quirk fixed with an explicit type), tests runnable, May WIP (Action Items
> V2 migration) is ~done behind a default-off flag and worth finishing.

## App idioms (follow these, not the .cursorrules)
- Riverpod v2 classic (no codegen — freezed/json_serializable declared but
  UNUSED; write plain classes, `factory fromMap(id, map)` with multi-key
  fallbacks + `rawData`, enums with `wireValue` + `unknown`).
- go_router 14 `StatefulShellRoute.indexedStack`, router created ONCE with
  refreshListenable bump pattern (never recreate on snapshots).
- Callables: Request/Result/Callable trio over `TypedCallableClient`;
  errors → `CallableFailure`; "callable with Firestore fallback" idiom.
- ONE `users/{uid}` listener (`workerUserDocSessionProvider`) — derive,
  never open a second.
- i18n: `AppStrings` getters (EN/ES ternary) via `appStringsProvider` +
  key-map escape hatch (`dashboardActionItemString`) for server i18n keys.
- UI: `AppSectionCard`/`SectionTitle`/`MetaText`/`StatusChip`/
  `EmptyStateView`/`SkeletonList` + `AppSpacing`/`AppRadii`.
- Theme: ink `#111111` primary + gold `#FFC700` secondary (matches web
  workerTheme since wave 5, 2026-08-30 — colorScheme, FilledButton, and
  bottomNavigationBarTheme all ink-led; gold is selected-state/badge only).
  Poppins retained (web uses system stack — open question).

## Already solved (reuse, don't rebuild)
- ✅ Everee WebView bridge (`payroll_embed_screen.dart`): dynamic channel
  name, EMB-201/202 experience swap (cap 3), session-expiry re-mint,
  completion → pop (webhook canonical). The #1 port risk is DONE.
- ✅ Orphaned-but-written callable trios: `evereeGetPayHistory`,
  `evereeGetPayStatement`, `evereeEnsureWorker` (employment/data/callables).
- ✅ respondToAssignment w/ headshot-gate bottom sheet; deep-link parser +
  pending-deep-link resume; push token registration + tap routing;
  biometric lock; language preference chain.
- ✅ Action Items V2: entity/parser/repo/provider/section done behind
  `ENABLE_WORKER_ACTION_ITEMS_V2` (default false); i18n maps added.

## ✅ Phase 1 SHIPPED 2026-08-29 (c1_app commits 8d830a9 + 37d464e)

Everything below landed same-day: hub rebuild (auto-redirect removed,
payday strip, recent pay, setup checklist, payment-issue banner), pay
history + statement screens (NET headline), bank editing (BankAccountForm
+ sheet, ABA util, evereeAdminGetWorker write-through), embed preflight +
bank-first card + bankPush notice + already-finished escape, Home hero +
earnings strip + banner, ~50 EN/ES strings, routes + deep-link parser
(/earnings aliases). Action Items V2 flag default ON. Dead everee sheets
deleted; pay callables moved employment→payroll. 83/83 tests green.

**Theme decision RESOLVED (Greg): black + gold.** design_tokens.dart now
carries web workerTheme values (ink #111111, gold #FFC700, bg #FAFAF8,
hairline #E6E6E3); white app bar with ink text; native splash regenerated
#111111. `brandBlue` kept as a legacy ALIAS of ink (prefer `brandInk` in
new code). Poppins font retained for now (web uses system stack — open
question). Android intent filters for the new pay routes still TODO.

## Phase 1 build list (original, for reference) — DONE
1. Commit the May WIP + analyzer fix (it's coherent lint cleanup + the V2
   migration); flip V2 flag default → true (backend snapshots live in prod;
   web reads them today). Legacy resolver deletion stays deferred.
2. Payroll hub rebuild (`payroll_index_screen`): drop single-entity
   auto-redirect (web removed 8/28); add payday strip (`nextPayday` Friday
   util), recent-pay list (wire evereeGetPayHistory), per-entity setup
   checklist (needs `tenants/{t}/everee_workers where firebaseUid==uid` —
   readinessMirror ssn/bank fields), settings cards, payment-issue banner.
3. Pay history + statement screens (new routes) wiring
   evereeGetPayStatement (gross-vs-net headline: use NET consistently —
   fixing the web inconsistency).
4. Bank editing: payroll-settings screen + replace-bank dialog + ABA
   checksum util + NEW `evereeAdminGetWorker` callable trio
   (setDefaultBankAccount write-through).
5. Embed upgrades: NEW `evereeGetMyOnboardingStatus` preflight → bank-first
   card before ONBOARDING (bankAccount rides session callable once) +
   bankPush failure notice.
6. Home: hero (welcome + next shift), earnings strip (last pay + payday),
   PaymentIssueHomeBanner.
7. AppStrings EN+ES for all of the above; routes + deep-link parser
   entries (pay-history, payroll-settings) + Android intent filters note.

## Phase 2+ (not in Phase 1)
- **Phone-OTP sign-in** — ✅ SHIPPED 2026-08-29 (c1_app e1d1fbe): 6-step
  machine (send/check OTP callables, candidate pick, phone-change
  recovery, new-worker names+DOB+language), last-login-method memory,
  email login kept as secondary.
- The 26-step prescreen interview — ✅ SHIPPED 2026-08-29 (c1_app
  8c434f1): flow engine (nav gating, fast-path/expanded narrative,
  dyn_job_* substitution, transport dedupe + synthetic yes, answer-bank
  coverage, 9-word validation), 482 generated bilingual copy keys, plan +
  submit callables, full wizard screen incl. zero-delta confirm card;
  dashboard action items now deep-link into it. 10 unit tests.
- Quick apply + acks gate — ✅ SHIPPED 2026-08-29 (c1_app 4f29909 +
  817d523): pure gates (quick_apply_gates.dart), submitQuickApplication
  port (quick_apply_repository.dart — deliberately NOT ported:
  jobScoreSummary, smart-group geo update, activity log), decision-tree
  flow behind both job-detail CTAs, stable ?section= wizard jump,
  wizard requirements step made gate-coherent (top-level
  comfortablePass* writes + per-item additional-screening /
  screening-package questions). REMAINING from this cluster: Maybe
  option + Maybe-detail prompts in the wizard step, transport icon
  chips, two-step signup parity, account-only wizard mode (route
  exists but dead-ends).
- Interview parity with web INT-2 — ✅ SHIPPED 2026-08-30 (c1_app
  d4b50b6): entry attribution, savedSession restore (drafts win over
  bank seeds, follow-up keys mapped to the web's reserved
  __followup_* so drafts resume CROSS-DEVICE), debounced fail-open
  saveProgress on all inputs + step advance, bilingual resume banner.
  Note: riverpod 3.3.2 migration also landed same day (4254ecc, other
  session) — cold-boot race fix.
- Payroll help tickets; support assistant (support screen is static).
- Foreground push display — ✅ SHIPPED 2026-08-29 (c1_app c1136a2):
  onMessage in-app toast + shared push→model mapper + root scaffold
  messenger key; Android intent filters added for payroll/earnings/
  prescreen/pay-history/payroll-settings deep links.
- Nav parity — ✅ RESOLVED by Greg's 2026-08-30 "match the web"
  instruction (wave 2, dc0ad18): web labels (Home/Find Shifts/Schedule/
  Payroll/Profile), web tab order, Payroll unconditional, logo-only
  AppBar with bell + 9+ badge.
- Legacy resolver deletion (V2 §4) after flag soak; documents-upload
  reality (web is stub dialogs too); Android intent filters for payroll/
  screening deep links; theme alignment decision.


## ✅ Parity waves 1–6 SHIPPED 2026-08-30 (screen-by-screen audit session)

Greg: "work independently… screen by screen, matching content and
functionality with our web app." Four audit passes (shell/home, jobs/apply,
assignments/employment/documents, payroll/profile/support) produced a
graded gap list; six fix waves landed same-day, all pushed, 124/124 tests.

- **Wave 1 (756c080)**: quick-apply union merge (shiftIds/Dates/Assignments
  union + status-downgrade guard — fixed a self-introduced E4 data bug),
  post-submit inline prescreen handoff (?entry=apply_wizard_inline),
  dyn_pos_* position-pack keys EN/ES + promptParams interpolation.
- **Wave 2 (dc0ad18)**: dashboard denylist/today filtering, web nav parity
  (labels, order, unconditional Payroll), deep-link fallthrough for action
  items.
- **Wave 3 (a4a4f39)**: assignment status mapper (pending→offerPending,
  worker-cancelled, in_progress), recruiter-read hardening, clock-in URL
  tile, startTime/endTime combined datetimes, account-deletion request doc
  (account_deletion_requests/{uid}, web parity).
- **Wave 4 (800672e)**: showPayRate gate on board cards, Gig chip, isPast
  gig rows (24h-after-end, overnight-aware) disable Apply as "Past",
  withdraw confirm dialogs, worker_cancel decision on offer declines.
- **Wave 5 (bac93cc)**: last-4 SSN fully read-only (editor field + hub
  display removed; retired add_tax_identity_last4 card dropped — backend
  retired it 2026-08-21), certifications dual-write to canonical
  workerProfile.credentials.certifications, ☠️ fixed
  FieldValue.serverTimestamp() inside array elements (Firestore rejects
  sentinels in arrays — cert add/delete was failing at runtime),
  emergency-contact clear, profile Language row → app-language sheet (was
  misrouting to spoken-languages), notifications filter chips + once-per-
  visit auto-mark-all-read (web P0 parity), recent pay 5→10, ink theme
  swap + bottomNavigationBarTheme (the shell uses BottomNavigationBar, so
  the old M3 navigationBarTheme never applied).
- **Wave 6 (eceb2be)**: B1 board eligibility (job_board_eligibility.dart:
  private hidden / restricted needs group intersection / DNR
  accountId+parentAccountId / separation hiringEntityId — workers could
  previously see barred postings; repo also no longer drops unknown
  visibility values the web shows), canonical
  workerProfile.preferences.{shiftPreferences,shift} dual-write + read.

Remaining flagged gaps (graded, unfixed) live in the session's
"C1 Worker App Parity" artifact — biggest: B2 gig job orders absent from
the board query, first-login language dialog, Home hero/un-gating parity,
support desk, documents 3-tab, calendar view, i18n on status matrix +
wizard steps, favorites, skills/bio editors, About & Legal.

## ✅ Parity waves 7–10 SHIPPED 2026-08-30 (second autonomous block)

- **Wave 7 (4b1809e)**: B2 — gig job orders (jobType=='gig',
  status=='open') merged into the board stream (deduped vs postings'
  jobOrderId, status forced 'active', worksite address/coords/name
  hydrated from locations, fail-open combineLatest — no rxdart, hand
  combineLatest2 in the repo); jobDetailProvider runs the board
  eligibility gate (deep links can't open barred postings); gig-row
  buttons/labels localized (17 strings); favorites (device-local
  shared_preferences, web localStorage parity, riverpod 3 Notifier)
  with heart toggle + filter chip.
- **Wave 8 (89d403e)**: first-login EN/ES language dialog (no
  preferredLanguage on user doc → non-dismissable modal, web WorkerAppBar
  parity; syncs via language preference controller); Home hero card
  (WorkerDashboardHero port — next shift or no-shift state) replacing the
  bare welcome + duplicate next-assignment card. Un-gating verified
  already done (no payrollEvereeAccess gates remained).
- **Wave 9 (dbb41c7)**: ?intent=accept opens the offer ack sheet /
  ?intent=decline runs the decline flow on job detail (idempotent,
  pending-only, params threaded through all 3 route builders); **My
  Employment RESTORED** (asg#6 — FA.1.P1 deleted the screens but the web
  kept serving /c1/workers/my-employment, so I-9 links dead-ended;
  restored from b81601d^, patched valueOrNull→value (riverpod 3),
  backgrounds-compliance→screening, dead Everee sheets→payroll hub;
  routes + deep-link parser re-pointed); multi-day offer accept now
  day-scoped (was picking an arbitrary same-shiftId sibling). Once-per-JO
  ack cache: VERIFIED NO GAP — web resets acks each sheet open.
- **Wave 10 (4e99354)**: skills editor (dual-write workerProfile.skills),
  bio editor (professionalBio), Notification Preferences screen (4
  toggles, smsOptIn/smsBlockedSystem side-writes; set(merge) preserves
  system-stamped siblings the web's whole-map write clobbers), About &
  Legal (terms/privacy/sms-privacy + version via package_info_plus, NEW
  DEP). Profile hub rows for all four.

☠️ Riverpod 3 gotchas hit: StateNotifierProvider needs
`flutter_riverpod/legacy.dart` (prefer modern Notifier for new code);
`valueOrNull` is gone — use `.value`.

**Standing rule (Greg, in CLAUDE.md)**: any worker-facing web view change
now requires a same-session Flutter update or a punch-list entry here.

## ✅ Waves 11–14 SHIPPED 2026-08-30 (feature block, Greg: "Do Wave 11-14")

- **Wave 11 (c1_app 65f8552; hrx e1e5ac08)**: in-app shift-confirmation
  card on Home — gold-bordered Confirm / Can't-make-it when an upcoming
  assignment's `cortConfirmation.state == 'pending'`. Backend:
  `respondToAssignment` gained `cadence_confirm` / `cadence_cancel`
  decisions via NEW `functions/src/cadence/appConfirmationWrites.ts` —
  an app-channel mirror of the SMS reply writes (cortConfirmation,
  escalation/reminder cancellation, recruiter alert +
  needsRecruiterAttention on cancel). ☠️ Deliberately NOT a refactor of
  cadenceReplyHandler (no SMS-webhook redeploy mid-pilot); the reply
  handler stays canonical if they drift. Full placementsApi bundle
  (11 functions) deployed.
- **Wave 12 (a6f9ba9)**: documents center — Compliance | Credentials |
  Job Files tabs at the documents route (web /c1/workers/documents
  parity): onboarding.checklist with web expiration rules + compliance %,
  synthesized work-eligibility item, credentials rows linking the app's
  WORKING editors, screening-orders read-only list, job files walked
  applicationIds → application → job_order staffInstructions (fail-open).
- **Wave 13 (17b0ca2)**: Schedule month-calendar tab (first tab, web
  default) — day dots in the web color language (confirmed blue →
  assignment detail; offered green / submitted goldenrod → posting), day
  bottom sheet, legend; schedule tab labels localized. Home gains the
  web's Upcoming Assignments list (next 3, whole row navigates).
- **Wave 14 (d274eac; hrx 23996d77)**: support desk — Greg's call: NOT
  freeform AI chat (grounded chat = v2 needing its own guardrails).
  Topic-tagged tickets (payroll / shifts_jobs / app_issue / other) on the
  payroll-help rails: `payroll_create_ticket` takes an allowlisted
  `topic` (default payroll; non-payroll skips the payroll AI diagnosis),
  app gets my-requests list + create sheet + live thread on
  /c1/workers/support/:ticketId. workerSupportAssistant deployed.
- Also: sign-in language selector rewritten to the web's EN | ES toggle
  (all auth screens); selector removed from the shell app bar (web is
  logo + bell; language lives in Profile).

## ✅ Polish pass + support re-engineering (2026-08-30, final block)

**Polish (c1_app 397d943, 5da86a2, 6b0ac31)** — 136/136 tests:
- Assignment-surface i18n sweep (offer sheet, decline dialog, every offer
  snackbar in both the flow and the schedule screen).
- O*NET skills autocomplete (842-entry list bundled as an asset).
- Per-shift W-2 / 1099 chips on board cards + an explainer card on job
  detail, derived from hiringEntityId with workerTypeLabels.ts's rule.
  ☠️ Unknown entity renders NOTHING — never guess a tax classification.
- Wizard comfort answers are tri-state Yes/No/**Maybe** with the follow-up
  explanation field; Maybe only counts as answered once explained.
- ☠️ **Career weekly schedules never rendered**: `weeklySchedule` is a
  day-keyed MAP, but the provider tested `is String`, so every career
  posting showed a blank schedule. Ported formatWeeklyScheduleSummary to
  Dart (9 tests) and added the 2+-shift picker with preferredShiftId.
- ☠️ Transport values were app-only ('Public Transportation', 'Carpool')
  and unrecognized by the web. Now the web's canonical five, with icon
  chips and legacy normalization on load.
- /apply/:tenantId with no posting no longer dead-ends; it mirrors the
  web's "Finish your profile" and routes to the profile hub.

**Support (c1_app 5ae2755; hrx 217b6ad6)** — see
[[project-payroll-help-desk]] for the full decision. One help door,
grounded assistant, one queue, no dead ends; standalone web Q&A retired.

## Watchouts
- **Cold-start Riverpod race — MITIGATED, not fully fixed (c1_app
  013ada7, 2026-08-29)**: intermittent cold-boot red screen "Concurrent
  modification during iteration: _HashMap<ProviderElementBase, Object>".
  riverpod 2.6.1 internals: `_maybeRebuildDependencies` runs
  `visitAncestors((e) => e.flush())` over `_dependencies` and a flush
  can re-add to that map mid-iteration (element.dart:337/834). Mitigation
  that helped a lot: side-effect bootstrap providers moved from
  ref.watch-in-build to a one-shot post-frame ref.read
  (`_startSideEffectProviders`). Frequency went from ~2-of-3 cold
  launches to rare (11+ consecutive clean launches; one recurrence seen
  after). ☠️ DO NOT retry the remount-on-error "self-healing root": in a
  warm VM the remount re-races deterministically and strands the app on
  a blank screen (tested, reverted). Bisect verdict (2026-08-29 late,
  corrected): NO commit is implicated — under identical late-night
  machine load, pre-Phase-2 e1d1fbe reds 2/5 and 817d523 reds 3/5;
  earlier "clean" runs were low-load luck (and 6 console-pty "clean"
  attempts were void — macOS has no `timeout`, nothing launched). The
  race is PRE-EXISTING and purely load/timing-dependent: red frequency
  tracks how starved the machine is, not the code revision. Debug JIT
  is worst-case; release AOT boots faster but first-launch-after-install
  is exactly what a new worker does — treat the riverpod 3 migration
  (2.6.1 is the last 2.x) as a Phase 2 blocker before TestFlight, and
  re-test boot rates on a quiet machine.
- `.cursorrules` lies (freezed/Either/arb claims) — trust the map above.
- `payrollEvereeAccessProvider` hides the Payroll tab until provisioning
  loads — new Home earnings strip must not depend on the tab being visible.
- Sessions from evereeCreateOnboardingSession are single-use; never cache.
- `everee_payroll_setup_sheet.dart` + `everee_my_pay_sheet.dart` are dead
  (hardcoded channel name, legacy embedUrl) — delete when convenient.

## 2026-09-02 — available-shift calendar feed: qualifying filter

Web fix (Danny's Oakland report): the My Schedule calendar's grey
"available" feed (other shifts on engaged job orders,
`src/pages/c1/workers/assignments.tsx`) now mirrors the jobs board's
qualifying filter — skip shifts with `status` ∈
{closed, cancelled, canceled, filled} or `hidden === true`. A closed
(handpick-only) shift was showing on workers' calendars but vanishing on
click-through. The c1_app does NOT yet surface other-shifts on its
schedule (provider reads only the worker's own assignment shifts), so no
app change needed today — but when the app gains that feed, it MUST
apply the same qualifying filter.

## 2026-09-03 — hide stale "Starts <date>" chip on job detail

Web fix (JobPostingDetail.tsx, hero date chip): when a posting's
startDate is before today, the "Starts {date}" / "Estimated start"
fallback chip is suppressed (gig with future shifts already shows
"Next shift" instead). Danny: ongoing Oakland Arena gig showed
"Starts 6/6/2026" months after start. c1_app: apply the same guard
wherever the job header renders a start-date chip/label.
