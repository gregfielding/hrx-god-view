# Flutter worker app — clone spec (index)

> Greg 2026-08-29: "deep dive audit of every page, layout, screen, field,
> action item, error message that a worker sees on the web. We need to then
> build a clone with Flutter." Four parallel source audits, full detail in
> the numbered files. THIS index also records the big discovery below.

## ⚠️ The Flutter app already EXISTS — resume, don't greenfield

`../c1_app` (sibling directory to hrx-god-view, own git repo) is a real
Flutter project: **186 Dart files, 13 feature modules** (applications,
assignments, auth, dashboard, documents, employment, jobs, notifications,
payroll, profile, readiness, screening, support), typed callable client,
worker shell scaffold, App Store submission checklist + screenshots.
**Last commit 2026-05-05** (22 commits, phases FA.1.P1–P4), with a few
uncommitted local edits.

**Already built** (verify before reusing — 4 months stale): phone OTP auth
(sendOtp/checkOtp), assignments + respondToAssignment (8 call sites),
dashboard action-items v1 renderer, jobs, notifications, screening hub,
documents, profile basics, old payroll (evereeGetPayHistory + FULL-widget
evereeCreateOnboardingSession ×5).

**Missing everything from the May→August web sprint** (zero hits in Dart):
- Payroll hub redesign (`/earnings` picker landing, payday strip, per-entity
  setup checklist) + pay-statement detail (`evereeGetPayStatement`)
- Shrunken-widget flow: bank-first card + ReplaceBankAccountDialog
  (`evereeAdminGetWorker` write-through) + payment-issue banners
- **The entire AI prescreen interview** (26 steps, answer bank, address gate)
- Home hero + earnings strip; two-step signup / quick apply / acks gate
- Payroll help tickets, support assistant updates
- Approved-not-hired vocabulary, bilingual copy passes, this week's fixes

**Plan of record: gap-audit c1_app against this spec, then bring it
current — not a rewrite.** First session on it: pub get/build it, read its
README + docs/, diff its screens against files 01–04, produce the punch
list.

## Spec files (what the web does TODAY, field-level)

1. [01_shell_auth_home.md](01_shell_auth_home.md) — theme tokens, bottom
   tabs, app bar + language dialog, WorkerRoute guard, phone-OTP login
   (all steps incl. number-change recovery), email login, setup-password,
   Home (hero, payment banner, earnings strip, action-item catalog with
   scores/kinds, upcoming list), notifications inbox.
2. [02_jobs_apply_interview.md](02_jobs_apply_interview.md) — jobs board
   (filters, card, quick-apply decision tree), posting detail (gig
   ShiftSelector, offer confirm sheet, multi-day dialog, status matrix),
   apply wizard (accountOnly mode, auto-skips, step-12 acks, submission
   writes, terminal landings), the 26-step interview + dynamics + answer
   bank, screening page, my applications.
3. [03_assignments_employment_documents.md](03_assignments_employment_documents.md)
   — schedule (calendar/list/archive), assignment details (ICS byte
   contract, maps, staff-instruction inheritance + linkification,
   recruiter sms: links, self-cancel), my-employment hub/bridge + I-9
   uploads, documents tabs (stub-CTA reality), readiness (orphaned wizard
   + live action-items snapshot).
4. [04_payroll_profile_support.md](04_payroll_profile_support.md) —
   earnings hub, Everee embed **iframe bridge (the #1 webview port
   risk: injected postMessage object + MessageChannel or EMB-102)**,
   pay history/statement, bank editing (ABA checksum, single-warning
   validation), payroll tickets, support assistant, profile hub + all
   section editors (600ms-debounce autosave, no validation), delete
   account (App Store requirement), i18n/theme/push cross-cutting.

## Cross-cutting build rules
- Backend unchanged: same Firestore paths, same callables. Everee SSN/tax
  stays in the widget (webview) per shrunken-widget doctrine.
- Bilingual day one: reuse public/i18n/locales/{en,es}.json as assets; port
  the "local language change this session wins over Firestore" rule.
- Light theme only (web worker theme has no dark mode) — single ThemeData.
- Push: same users/{uid}/pushTokens/{token} shape (platform ios/android);
  BUILD the foreground toast (web never did).
- Deep links to handle: /c1/workers/assignments/{id} (+?intent=accept),
  /c1/workers/earnings(/{tid}), /c1/workers/prescreen?applicationId=…,
  /c1/jobs-board/{id}, /setup-password?oobCode=….
- Each spec file ends with a "gaps to NOT inherit" list (hardcoded EN,
  dead code, silent failures, alert()/confirm(), the step-7 cert
  off-by-one) — fix these in Flutter; consider fixing web too.

Related: [[project_native_apps_flutter]] (decision doc — updated with the
c1_app discovery), [[project_worker_app_redesign]],
[[project_worker_onboarding_everee]], [[project_shift_confirmation_cadence]].
