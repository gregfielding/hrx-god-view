# Worker app redesign — UX audit + agreed direction

> Audit 2026-08-23 (Greg's 8 concerns + code recon + Instawork/Wonolo/Qwick benchmark).
> Readable version: https://claude.ai/code/artifact/4e094570-118e-4cf4-a936-fc4df3b4ad2e
> Design north star = the phone-login page (`src/pages/PhoneLoginPage.tsx`): system fonts,
> white/near-black, one accent (C1 yellow), hairlines not shadows, EN|ES text toggle.
> Related: [[project_phone_auth]], [[project_worker_onboarding_everee]].

## Industry skeleton (all three benchmarks)
Bottom tab bar, 4–5 tabs: **Home · Jobs · Schedule · Earnings · Profile**. No hamburger, no
avatar menu (log out lives in Profile). Home = next shift card + grabbable shifts. Earnings =
native list of paid shifts + totals + fast-pay + tax docs (never partner-branded). Notifications
= push → deep link; minimal in-app list.

## Verdicts on Greg's 8
1. **Landing after login → Home** (`/c1/workers/dashboard`), not My Account — once #7 makes Home
   worth landing on. Both Login + PhoneLoginPage redirects.
2. **Account page** is an ATS candidate record (Resume/Bio/Certs/Experience/Education/Languages/
   Skills). Collapse that stack to one "Work profile" row; ADD Settings (language, notifications),
   Help & Support (page exists, hidden from nav), Log out, documents; later reliability/badges.
3. **Payroll links off the Account page** — Earnings is its own tab; "finish payroll setup" is a
   Home action item (task), not a place.
4. **Styling**: worker theme pass to phone-login language. Flatten MUI cards-in-cards, hairline
   dividers, system font stack, single yellow accent, EN|ES toggle replaces globe dropdown.
5. **Notifications**: kill the bell popover (overlaps content; "(50 unread)" is the QUERY CAP in
   `WorkerAppBar.tsx` `useWorkerNotifications(uid,{max:50})`, and nothing marks read so the badge
   never drops). List marks visible read; badge 9+; items deep-link.
6. **One nav**: bottom tab bar everywhere; delete sidebar (`WorkerNav`), avatar menu, and the
   dashboard's duplicate Jobs Board / My Account buttons.
7. **Action Items = work only**: applications / assignments / pay (+ compliance ONLY when it
   blocks a booked shift). Profile nags (photo, emergency contact, DOB, SMS opt-in) move to the
   profile completeness meter. Filter in the ONE server snapshot (see below).
8. **Payroll page**: "(SANDBOX)" was Greg's test account (its Everee link → sandbox tenant 2320);
   prod workers see prod. Real issues: Everee-branded wizard + tenant id leaked in URL
   (`/workers/payroll/2320`). Staged: now → route `/earnings`, auto-select tenant, id-free;
   next → native Earnings v1 (payment history via Everee API; embed only for bank/tax/stub
   moments); later → fully native onboarding via Everee complete-record API.

## Additional findings
- `/users/:uid` internal-profile leak to workers — FIXED + deployed 2026-08-23 (route gate waits
  for auth loading + treats unknown as worker; in-component redirect; both login redirects).
- Six worker routes are redirect shims (documents→profile, settings→profile/app-language,
  inbox→notifications, find-work→jobs-board…) — settle IA with the 5 tabs, delete shims.
- TWO action-item pipelines (server snapshot v1 + legacy client build behind a flag in
  `dashboard.tsx`) — keep the snapshot, delete legacy, enforce #7's filter server-side once.
- One CRA bundle serves admin + worker — cheap-Android load times; consider worker entry split
  before OnTrac recruiting push.
- Spanish second-class: EN default + globe dropdown; phone-login EN|ES pattern should be the one
  toggle and persist to `preferredLanguage` (phone login already writes it).
- No reliability loop (rating/streaks/show-rate) — the category's retention mechanic; OnTrac's
  no-show SLA will want it. P2.
- Support page exists (`workers/support.tsx`) but commented out of nav — needed as the front door
  for the payroll help-desk plans.

## P0 SHIPPED 2026-08-23 (commit 21b2bca2, 7 fns + hosting deployed)

- `WorkerBottomTabs` (Home · Find Shifts · Schedule · Earnings · Profile) — the ONE worker nav;
  `WorkerNav` sidebar unmounted, `WorkerAppBar` rewritten slim (C1 mark + bell→inbox, badge 9+,
  first-login language dialog kept), dashboard quick buttons removed.
- Work-only action feed enforced at the SERVER snapshot choke point
  (`workerDashboardActionItemsModel.ts` `PROFILE_NAG_IDS` filter) + mirrored in the legacy client
  builder; 27 tests updated to the new contract. Native (Flutter) apps read the same snapshot.
- `/c1/workers/earnings` (+`/:tenantId`) live; `/payroll*` redirects preserved. Both logins land
  workers on Home. Notifications page marks all read on open.
- Profile page already had Language / Reset password / Log out rows — avatar menu removal lost nothing.
- i18n gotcha: root `i18n/locales/*.json` edited AND copied to `public/` for the running dev server
  (prebuild copies on build — see [[feedback_i18n_source_of_truth]]).

**Native apps note (Greg 2026-08-23):** Flutter app exists at `~/Projects/hrxone_app` (firebase_core/
auth/storage wired). Build server-first so it ports: phone OTP = callables + custom token (no web
reCAPTCHA dependency), action-items = server snapshot, notifications via callables. Keep new worker
logic OUT of React components.

## Sequence
- **P0 — DONE (above).**
- **P1 (in progress)**: theme pass SHIPPED 2026-08-23 (system fonts per-variant incl. body1/button,
  ink text, warm ground, hairline cards r12, uniform CardContent 16, ink buttons, flat app bar,
  double-gutters removed, 5 pages on one h5+subtitle header canon, layout 720). Profile reorg
  SHIPPED 2026-08-23: identity card w/ stats row (aggregate over own timesheet_entries) +
  completeness only <100%; Work Profile = Skills/Certs/Languages/Availability + Experience hub
  (/profile/experience wraps resume/bio/work-history/education); Documents section (real documents
  page restored + pay-docs → Earnings); Settings adds Help & Support + About & Legal
  (/profile/about: terms/privacy/SMS + account-deletion REQUEST → `account_deletion_requests/{uid}`,
  client-immutable, rules deployed — ⚠️ NOTHING notifies staff of new requests yet; add a sweep or
  trigger before native launch). Remaining P1: native Earnings v1; delete legacy action-items path +
  route shims; blue-vs-ink/yellow accent decision; severity-tinted card borders decision.
- **P2**: native payroll onboarding (complete-record API); reliability/badges; bundle split.

**Awaiting Greg**: approve 5-tab structure + P0 list; naming ("Jobs Board" vs "Find Shifts").

## 2026-08-23 (later) — sub-page sweep, card padding root cause, action-items scope fix

- **Card padding root cause**: the base (admin) theme pads every `MuiCard` 24px; workerTheme
  deep-merges on top of it, so worker cards silently stacked 24 (Card) + 16 (CardContent) = 40px
  insets. workerTheme now sets `MuiCard.root.padding: 0` — **CardContent's 16px is the only card
  inset on worker surfaces**. Don't re-add padding on Card.
- **`WorkerPageHeader`** (`src/components/worker/WorkerPageHeader.tsx`) is the canonical sub-page
  header: back IconButton (44px target) + h5 + optional body2 description + optional right `action`
  slot. Used on every screen one level below the 5 tabs (profile sections/experience/about,
  documents, support, notifications, my-employment + detail, screening, applications, assignment
  details, Everee earnings embed, job detail arrow). Top-level tabs keep plain h5, no back.
- Buttons: worker outlined = 1.5px border; `size="small"` = 36px. Chips = 26px (small 22px) —
  metadata, not buttons. Jobs board: search Paper p:2, card grid spacing 2, no extra px (layout
  owns gutters).
- **Action items scope (Greg)**: only payroll setup (started, not completed), background checks
  (current + actionable), interview requests, and supporting docs for an upcoming assignment.
  Implementation: `deriveWorkerComplianceSignals` (client `workerComplianceActionDerivers.ts` +
  server mirror `workerDashboardActionItemsLoadContext.ts`) ignores background-check records
  untouched for 30+ days (`WORKER_COMPLIANCE_RECENCY_DAYS`); records without readable timestamps
  stay current. `background_check_issue_requires_action` NEVER deep-links to AccuSource (an errored
  order has nothing for the worker there; the old code even borrowed the portal link from a
  DIFFERENT record). Portal deep-link only on awaiting_applicant, and the R.10 expiry sweep's
  `expired: true` hides that item entirely.
- **Payroll item gating** (dashboard.tsx legacy builder — the LIVE pipeline; V2 flag
  `REACT_APP_WORKER_DASHBOARD_ACTION_ITEMS_V2` is OFF): completion truth on `everee_workers` docs
  lives in `status: 'onboarding_complete'`, `readinessMirror.onboardingStatus/onboardingComplete`,
  `apiObservedOnboardingCompleteAt` — top-level `onboardingComplete`/`onboardingStatus` DO NOT
  EXIST on these docs. Sandbox tenant 2320 and `smokeData: true` linkages are skipped.
  ⚠️ V2 parity gap: the server snapshot model has NO `complete_payroll_setup` item — port it
  before flipping the flag or the nudge disappears.

## 2026-08-23 (evening) — accent decision RESOLVED + Deletion Requests admin tab

- **Accent (Greg approved)**: worker palette primary = **ink #111111**, secondary = **C1 gold
  #FFC700**. NO blue on worker surfaces. Gold never carries text — it always pairs with ink ON it
  (badge, selected tints), never as type on white. Implemented at theme level (palette + chip
  colorPrimary/colorSecondary, tabs indicator, TextField focus ring, selected list rows gold tint,
  contained-hover glow killed) + bell badge color="secondary" + accepted-state buttons in
  jobs-board/job-detail. When adding worker UI: use `color="primary"` etc. normally — the theme
  resolves it to ink; don't hard-code hexes.
- **Deletion Requests tab** (`/users/deletion-requests`, `src/pages/DeletionRequestsPage.tsx`):
  table over `account_deletion_requests` joined with users docs. Shows a **"Has payroll — retain"**
  flag when Everee markers exist (`taxIdentity.source==='everee'`, `last4SSN`, `evereeWorkerId`) —
  those accounts must NOT be hard-deleted (retention); deactivate + mark completed with note.
  No-history accounts: same flow as removing a dup/unused profile — User Profile → System Access →
  Delete (`deleteUserCompletely` callable: recursive Firestore delete + Auth delete; level 6+).
  Rules: HRX may update only `status/processedBy/processedAt/note`; requests otherwise
  client-immutable; no client delete. Verified end-to-end in prod (dismiss flow) 2026-08-23.
  There is still NO push notification when a request lands — support must check the tab.

