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

**Support URL = `https://www.c1staffing.com/support`** (built 2026-09-05 in
Squarespace, Greg's session; both store listings point at it — ASC version
"Support URL", Play store-settings "Website"). It is a Not-Linked page with one
Code Block holding self-contained HTML/CSS (EN + ES: sign-in by SMS code,
applying, schedule, pay, account/deletion, contact `support@c1staffing.com` +
`(424) 500-4692`); source kept in this repo at
`docs/claude/assets/c1staffing-support-page.html` — edit there, then paste into
the block (Pages → Not Linked → Support → Edit → pencil on the block).
The site footer links Terms / Privacy / Support.

**`c1staffing.com/privacy` now 301s to `hrxone.com/legal/privacy.html`** via
Settings → Developer Tools → URL Mappings (`/privacy -> https://hrxone.com/legal/privacy.html 301`);
the old 2024 Squarespace policy page was re-slugged to `/privacy-2024` (still
enabled, unlinked) so the mapping isn't shadowed. One policy, one source of
truth — no more contradiction for store review. `/terms` still serves the
Squarespace Terms of Use page (not flagged as conflicting).

Squarespace automation notes: c1staffing.com is site
`lilac-smilodon-jj54.squarespace.com` (7.1, Fluid Engine). Code Blocks use
CodeMirror 6 — load HTML by dispatching a synthetic `paste` ClipboardEvent on
`[role=dialog] .cm-content` (typing triggers auto-close tags); the block
starts 3 columns wide — drag the top-right handle to the right edge; page
settings auto-prefix the URL slug with `/` (type `privacy-2024`, not
`/privacy-2024`).

## Store console state (2026-09-05, Claude drove both consoles in Greg's Chrome)

**App Store Connect** (app id 6808699956 "C1 Staffing Workforce", iOS 1.0
"Prepare for Submission"): screenshots (6.5" set), promo text, description,
keywords, support URL, App Review sign-in (demo phone `+1 555 555 0100` /
code `246810`, review notes), App Information (subtitle "Gig and Career
Opportunities", category Business, content rights = no third-party content,
age rating questionnaire → 4+), App Privacy label (14 data types, published;
policy URL `/legal/privacy.html`), price Free, availability **United States
only** (sidesteps the EU DSA trader-status block), auto-release after
approval. `ITSAppUsesNonExemptEncryption=false` is in Info.plist so no export
prompt. **Left for Greg:** upload `build/ios/archive/Runner.xcarchive` via
Xcode Organizer, pick the build on the version page, then "Add for Review".

**Google Play Console** (developer account "C1 Staffing" 7277616738972403924,
app 4971983647122091628, package `com.c1staffing.worker`): privacy policy,
sign-in details (same demo creds), Ads=No, Target audience 18+, Data safety
(13 types, no sharing, delete-account URL `https://hrxone.com/delete-account`),
Advertising ID=Yes/Analytics (Firebase Analytics merges `AD_ID` into the
manifest — verified in the merged manifest), Government/Financial/Health =
none, category Business, contact `support@c1staffing.com` + hrxone.com,
store listing (EN copy, 512 icon, feature graphic, 7 phone screenshots),
Production countries = US. **Left for Greg:** (1) Content rating — the IARC
questionnaire starts with an "I agree to the IARC Terms of Use" checkbox
(all answers are "No" → Everyone); (2) upload
`build/app/outputs/bundle/release/app-release.aab` (71 MB — over the browser
tool's 10 MB upload cap) to Production → Create new release, then Send for
review from Publishing overview.

**`/delete-account` page** (`src/pages/DeleteAccount.tsx`, deployed
1c468e1c): Google requires a public URL naming the app, the request steps and
what is deleted vs retained. It documents the app's Profile → Delete account
request flow (`account_deletion_requests/{uid}`) plus the support@ path, EN/ES
inline (not i18n — legal copy outside the app shell). Keep it in sync with
DeletionRequestsPage.tsx retention rules.

### Play Console browser-automation footguns
- "Start declaration"/"Start" buttons ignore accessibility-ref clicks —
  click by screenshot coordinate. Checkboxes/radios/textboxes inside dialogs
  DO accept ref clicks (use `find` after the dialog opens).
- Data-safety per-type dialogs open 4–10 s after the click and their sticky
  header collapses on the first click after a scroll (swallowing it) — wait,
  then use refs, never blind coordinate chains (one mis-timed chain saved
  Email address with the wrong purposes and needed a fix).
- Text fields need real key events (`click` + `type`); `form_input` fills the
  box but the framework doesn't register the change (contact details).
- Asset uploads: no `<input type=file>` exists until "Add assets" is clicked;
  hook `HTMLInputElement.prototype.click` to suppress the native picker,
  then `file_upload` into the captured input and click "Add" in the library
  panel. Phone screenshots must be 16:9 or 9:16 — the 1320×2868 captures
  were padded to 1613×2868 with `sips --padToHeightWidth 2868 1613`
  (`store/screenshots/play/`).
- App Store Connect: age-rating and privacy questionnaires are ref-driven
  and reliable; the privacy "linked/tracking" pages repeat per data type.
