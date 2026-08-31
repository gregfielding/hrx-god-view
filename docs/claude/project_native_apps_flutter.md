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


## Launch-readiness audit + code-side fixes (2026-08-30)

Greg: "What else is left to be done before we could actually launch?"
Audited the real repo state rather than a generic checklist.

**Fixed in code this pass** (c1_app 2ad2a92, hrx a2ef8bae):
- ☠️ `NSFaceIDUsageDescription` was MISSING while `local_auth` runs with
  `biometricOnly: true` — iOS terminates the process at the Face ID prompt.
  That was a live crash, not just a review risk.
- ☠️ `aps-environment` was absent from `Runner.entitlements` and
  `AppDelegate.swift` was the bare template (no APNs registration, no
  UNUserNotificationCenter delegate) — every push feature we shipped was
  inert in TestFlight/App Store builds regardless of the Dart wiring.
- ☠️ Android `POST_NOTIFICATIONS` was undeclared with targetSdk 35, so the
  Android 13+ runtime prompt never appeared.
- App-level `ios/Runner/PrivacyInfo.xcprivacy` added (pods ship their own;
  Runner had none). Must stay in sync with the App Store privacy label AND
  hrxone.com/privacy — Apple compares them.
- Crashlytics + Analytics added; there was NO crash reporting and no
  `runZonedGuarded`/`FlutterError.onError` at all. Collection is
  release-only. User identification is UID-only by policy — never name,
  phone, or email in an event or crash key.
- Signup consent: the app created accounts with no terms/privacy step while
  the backend (twilio.ts) stamped `termsOfUse`/`privacyPolicy` agreement
  records unconditionally. The stamp is now truthful.
- ☠️ Legal pages are SPA routes — a store crawler fetching /privacy gets
  "You need to enable JavaScript". `scripts/generate-legal-static.js` renders
  bilingual static twins at `/legal/{privacy,terms}.html` from the same i18n
  keys. **Store listings must use the /legal/*.html URLs.**
- Privacy policy now discloses camera/photos, push token, device id, and
  crash diagnostics (it covered only web-style data collection before).
- ☠️ Reviewer password was committed in 3 tracked files. Scrubbed, and
  `key.properties`/`*.jks`/`*.keystore` gitignored. **The old password is in
  git history — it must be rotated.**

**Still blocked on Greg's accounts** (see c1_app/RELEASE_CHECKLIST.md §D):
Android upload keystore (release build currently gets NO signing config →
unsigned bundle), iOS `DEVELOPMENT_TEAM` (zero occurrences in the pbxproj),
APNs auth key upload, the Apple team ID + SHA-256 fingerprints in the
association files (universal links cannot verify until then), version bump
per upload, and the two store privacy questionnaires.

### Canonical legal URLs (Greg, 2026-08-30)

Store listings use **`https://hrxone.com/legal/privacy.html`** and
**`/legal/terms.html`** — the static, crawlable twins generated by
`scripts/generate-legal-static.js` from `i18n/locales/*.json`.

☠️ Do NOT use `c1staffing.com/privacy` in a store listing: it's a separate,
older policy (effective 2024-08-01) with no camera/photo/push disclosure, and
Apple compares the privacy label against whichever URL is listed.

☠️ Edit the i18n source and re-run the generator — never hand-edit the
generated HTML, or the SPA and static versions drift.

In-app links (About & Legal, signup consent) intentionally point at the SPA
routes (`/privacy`, `/terms`) so workers get the language-aware version; same
i18n source, so the content is identical.

Still open: `c1staffing.com/support` 404s and both stores require a working
support URL.
