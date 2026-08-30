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
- **Phone-OTP sign-in** — app is email+password ONLY; web is phone-first
  with number-change recovery. Biggest auth gap.
- The 26-step prescreen interview (nothing exists).
- Quick apply + acks gate + two-step signup parity (apply_screen is the
  old wizard, 2521 lines — needs diff vs spec 02).
- Payroll help tickets; support assistant (support screen is static).
- Foreground push display (NO onMessage handler — notifications while
  foregrounded are dropped on Android).
- Nav parity decisions for Greg: labels (Dashboard/Find Work/My
  Assignments/My Account vs web Home/Find Shifts/Schedule/Profile),
  tab ORDER (app swaps Payroll/Profile), conditionally-hidden Payroll tab.
- Legacy resolver deletion (V2 §4) after flag soak; documents-upload
  reality (web is stub dialogs too); Android intent filters for payroll/
  screening deep links; theme alignment decision.

## Watchouts
- `.cursorrules` lies (freezed/Either/arb claims) — trust the map above.
- `payrollEvereeAccessProvider` hides the Payroll tab until provisioning
  loads — new Home earnings strip must not depend on the tab being visible.
- Sessions from evereeCreateOnboardingSession are single-use; never cache.
- `everee_payroll_setup_sheet.dart` + `everee_my_pay_sheet.dart` are dead
  (hardcoded channel name, legacy embedUrl) — delete when convenient.
