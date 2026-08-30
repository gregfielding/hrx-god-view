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
- Theme: brandBlue `#0F2D5C` + yellow `#F2C300` + Poppins — **differs from
  web worker theme (#111/#FFC700/system font)**. Build in APP tokens;
  re-theming is a separate product decision for Greg.

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
- Payroll help tickets; support assistant (support screen is static).
- Foreground push display — ✅ SHIPPED 2026-08-29 (c1_app c1136a2):
  onMessage in-app toast + shared push→model mapper + root scaffold
  messenger key; Android intent filters added for payroll/earnings/
  prescreen/pay-history/payroll-settings deep links.
- Nav parity decisions for Greg: labels (Dashboard/Find Work/My
  Assignments/My Account vs web Home/Find Shifts/Schedule/Profile),
  tab ORDER (app swaps Payroll/Profile), conditionally-hidden Payroll tab.
- Legacy resolver deletion (V2 §4) after flag soak; documents-upload
  reality (web is stub dialogs too); Android intent filters for payroll/
  screening deep links; theme alignment decision.

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
