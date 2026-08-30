# Native worker apps — Flutter (Greg's call, 2026-08-29)

> Context: the competitive review ("HRX should be the best software out
> there for gig workers") concluded native apps should ship fast. The
> initial recommendation was a wrapper (Capacitor) around the existing CRA
> worker UI. **Greg overrode: "i would prefer flutter build."**

## Decision

- **Flutter**, not a web-view wrapper, for the worker-facing iOS/Android
  apps.
- Scope: WORKER app first (Home/next shift, assignments + confirmations,
  earnings/payroll hub, profile/bank, prescreen interview). Recruiter/admin
  stays web.

## ⚠️ 2026-08-29 discovery: the app already exists — RESUME it

`../c1_app` (sibling repo) is a 186-file, 13-feature Flutter app, last
commit **2026-05-05** (22 commits, FA.1 phases). It has auth/assignments/
dashboard-action-items/jobs/notifications/screening/documents/profile and
OLD payroll (full-widget Everee), but none of the May→August web work
(payroll hub, bank editing, shrunken widget, the entire prescreen
interview, Home hero/strip, two-step signup). Plan: **gap-audit against
`docs/claude/flutter_worker_app_spec/` and bring it current — not a
rewrite.** Full web spec (every screen/field/error) lives in that
directory.

## Ground rules when this starts

- Backend is unchanged: Firebase Auth + Firestore + the existing callables
  (all onCall functions already have `cors: true`; Flutter uses the
  firebase SDKs directly, so CORS is moot).
- Push: FCM tokens already live at `users/{uid}/pushTokens` with
  `enabled` flags — the reminder dispatcher (workerShiftRemindersV2) sends
  push today; the app must register tokens in the same shape.
- Bilingual EN/ES from day one (see the cadence audit — English-only
  surfaces keep biting us). Reuse the i18n keys/strings from
  `i18n/locales/*.json` as the source of truth for copy.
- Deep links the SMS cadence already sends (`/c1/workers/assignments/…`,
  `/c1/workers/earnings`) must open in-app (universal links / app links).
- Everee: SSN + tax forms remain in the Everee onboarding widget (webview
  inside the app is acceptable for that step only); bank/identity are
  native HRX screens per the shrunken-widget doctrine
  ([[project_worker_onboarding_everee]]).

Related: [[project_worker_app_redesign]] (the web worker UI it will
mirror), [[project_shift_confirmation_cadence]] (confirm flows the app
should surface natively).
