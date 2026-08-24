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
