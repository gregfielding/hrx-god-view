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
applying, schedule, pay, account/deletion, contact `hello@c1staffing.com` +
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

**`https://www.c1staffing.com/app` — app landing page (built 2026-09-05, Not
Linked / footer-only until the stores approve).** Duplicate of the Support
page's full-width Code Block, source in this repo at
`docs/claude/assets/c1staffing-app-page.html` (hero + two phone screenshots
embedded as base64 JPEG from `c1_app/store/screenshots/`, feature cards, "how
it works", EN + ES, contact strip). The two "coming soon" pills under the
buttons are placeholders — **swap them for the real App Store / Google Play
badge links when Apple and Google approve** (search the file for
`APP STORE BADGES`). "Browse open shifts" points at
`https://hrxone.com/c1/jobs-board`; change to app.c1staffing.com at the domain
flip ([[project_app_domain_migration]]). Also fixed the same session: About
page had the "How quickly can C1 Staffing provide workers?" FAQ twice
(removed one), and "banquet servers, etc.." on Home + Services → "and more."

**`/locations` rebuilt 2026-09-06** (Greg: "make us look nationwide and
legitimate"): the page was a single coverage-map image with no text. It is now
one full-width Code Block — source `docs/claude/assets/c1staffing-locations-page.html`
— with the same map (Squarespace CDN URL), a stats strip, four regional
market columns, services, and a request-staff band. Every market listed comes
from real worksite states/cities in `tenants/BCiP2bQ9CgVOCTfV6MhD`
job_orders / job_postings / assignments (probe: `functions/.scratch/probe_markets.ts`
— 34 states, top: CA, MO, IL, TX, TN, NY, PA, MN). "30+ states" and
"24–48 hrs" are the defensible claims; no branch addresses were invented.

**Site-wide "C1 Black" pass + homepage restructure (2026-09-06, Greg: "add
more black replacing the blue… make the site wide change").** Site Styles →
Colors palette is now white `#FFFFFF`, light `#F5F5F5`, accent `#FFC700`, dark
accent `#1C1E22`, black `#111214` (the old navy is gone); Fonts = Inter Tight
700 headings, Inter paragraphs + buttons (Greg asked about San Francisco —
not licensable for web, Inter is the closest Google face). Website → Custom
CSS holds `docs/claude/assets/c1staffing-custom.css` (source of truth; it
re-skins the three Code Block pages `.c1s/.c1a/.c1l` to the palette and
forces Inter on buttons). Homepage now: hero "Staffing that shows up." +
Paragraph-1 subline + two buttons side by side ("Request staff" → /contact,
Primary; "Find work" → jobs board, Secondary/outlined; blocks
`block-ecabf8e029924c832947` / `block-0404db6139baa74e90b7`), then a new
numbers strip section (Code Block, `c1staffing-home-numbers.html`: 30+ states
/ 24–48h / 100s of events / W-2), quote band, services, worker section whose
button now reads "Browse open shifts" (`block-49bac39f9af76f85494c`), then a
new charcoal app-promo section (Code Block, `c1staffing-home-app.html`, 80 KB
with two base64 phone shots; "coming soon" pills → real badges after store
approval, same as /app), contact, footer. Mobile layout was hand-tuned only
in the hero (Request-staff block widened so the pill stays on one line, Find
work moved below it). ☠️ Editing the mobile layout is NOT isolated: after the
mobile hero tweak the desktop hero came back with the text block stretched
to ~350 px, both buttons ~120 px lower, and the section 6 rows taller (row
count went 10 → 16). Fix was: desktop view → shrink the text block's bottom
handle, drag both buttons back up, Edit Section → Row Count 10. After ANY
mobile-view edit, re-open desktop view, reload the live page, and check block
rects before calling it done.

Fluid Engine drag notes (2026-09-06): `left_click_drag` on a block's resize
handle starts the drag but the editor never sees the mouseup — the grid stays
in `drag-is-active-over-grid`, every later click is ignored, and only Save +
reload the editor recovers. What works is synthetic mouse events from JS in
the editor iframe: `mousedown` on the handle (the `div` with a React
`onMouseDown`, found via `elementsFromPoint`), ~12 `mousemove` steps
30 ms apart on whatever is under the pointer, then `mouseup` at the target —
same recipe moves a block when started on its body (the `.fe-block` wrapper;
avoid the bottom/side handles of the *selected* block, which resize instead).
Fire-and-forget the drag (store the promise result on `window`) and poll
10–20 s later: a `Runtime.evaluate` that awaits the drag times out because
the editor renderer stalls for seconds per mousemove, especially with the
80 KB app block on the page. Handles and drop targets can be off-screen
(negative clientY works), but the `mousedown` target must be on-screen, and
JS `scrollTo` on the iframe only lands after a real wheel tick. New sections
come in with Fill Screen ON + 22 rows: Edit Section → Fill Screen off, Row
Count = content rows (numbers strip 8, app promo 18, hero 10). Button block
dialog: `form_input` on the Text field reverts (controlled input) — click the
field, `cmd+a`, `type`. Button style Primary/Secondary lives in the block
toolbar's "Primary" dropdown.

☠️ **Fluid Engine desktop layouts scale proportionally from ~1300px down to
768px** (the phone layout only kicks in below 768). Pills keep their pixel
width while their grid cells shrink, so the two hero buttons collided on
iPads and small laptops. Fixed in Custom CSS with two media queries that
re-place `.fe-block-<id>` (stack on 768–1023, wider one-row cells on
1024–1299). ☠️ **Squarespace Custom CSS is compiled as LESS**: `grid-area:
7 / 2 / 9 / 8` was published as `grid-area: .0486` (division). Use the
longhands `grid-row-start/end`, `grid-column-start/end` (or `~"7 / 2 / 9 / 8"`)
— and always curl the published `static1.squarespace.com/static/custom-css/…/custom.css`
after saving, because the editor's live preview applies the raw text and
looks right even when the compiled output is garbage. The Custom CSS panel
is CodeMirror 5: `document.querySelector('.CodeMirror').CodeMirror.setValue()`
edits it, SAVE is the small text button at the top-left (a real coordinate
click; `find`-ref clicks and `el.click()` were ignored).

Squarespace automation notes: c1staffing.com is site
`lilac-smilodon-jj54.squarespace.com` (7.1, Fluid Engine). Code Blocks use
CodeMirror 6 — load HTML by dispatching a synthetic `paste` ClipboardEvent on
`[role=dialog] .cm-content` (typing triggers auto-close tags); the block
starts 3 columns wide — drag the top-right handle to the right edge; page
settings auto-prefix the URL slug with `/` (type `privacy-2024`, not
`/privacy-2024`). Big HTML (100 KB+) is too large for a tool parameter and
`fetch('http://127.0.0.1…')` from the editor hangs (private-network block) —
instead inject `<input type=file id=claude-upload>` into the editor document
with JS, `file_upload` the .html into it, then `await input.files[0].text()`
and dispatch the paste. Editing a text block: double-click the paragraph,
set a DOM Range on the exact text node with JS, then `type` the replacement
(keyboard selection with End/Home is document-wide on macOS). The editor
iframe only scrolls after a real `hover` + wheel `scroll`; JS scrollTo lands
late. Site-wide text animations hide h1/p (`opacity:0`) until they enter the
viewport, so headless screenshots show "empty" sections — real visitors see
them. Page-list drag-and-drop into Main Navigation does not work via
`left_click_drag`; use the page's settings or leave it Not Linked.

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
prompt. The store version string was changed from `1.0` to **`1.0.0`** to
match the builds' CFBundleShortVersionString (pubspec `1.0.0+N`).

☠️ **"TestFlight Internal Only" uploads can never be submitted.** All seven
Sep-4 Organizer uploads (builds 1–8) were distributed with that option — the
ASC API shows `buildAudienceType: "INTERNAL_ONLY"` and the version page's
"Add Build" dialog lists them greyed out with no explanation. Diagnose with
`fetch('/iris/v1/builds?filter[app]=6808699956&fields[builds]=version,buildAudienceType,processingState')`
from the ASC page. Fix: Organizer → Distribute App → choose the
**"App Store Connect"** tile (Xcode 15's name for the TestFlight & App Store
audience — there is no tile literally called "TestFlight & App Store"; the
"TestFlight Internal Only" tile is the trap) → audience `APP_STORE_ELIGIBLE`;
let Xcode's "Manage Version and Build Number" bump to the next unused build
number. Today's archive (`build/ios/archive/Runner.xcarchive`, 1.0.0 (8),
code identical to build 8) was copied to
`~/Library/Developer/Xcode/Archives/2026-09-05/` so Organizer lists it.
**Done 2026-09-05 5:55 PM:** Greg uploaded it as build 9 (processed VALID,
`APP_STORE_ELIGIBLE`; the "Upload Symbols Failed" dSYM warnings for the
Firebase frameworks are harmless). Claude attached build 9 to version 1.0.0
and saved. **Greg submitted 2026-09-05 8:40 PM PT** — version 1.0.0 is
**Waiting for Review** (verify with
`fetch('/iris/v1/apps/6808699956/reviewSubmissions?fields[reviewSubmissions]=state,submittedDate')`).
Auto-release after approval is on; rejections land in ASC → App Review and
at g.fielding@ (the App Review contact). To ship a new build while waiting,
"remove this version from review" first.

☠️ **"Add for Review" has hidden prerequisites** that only surface when it's
pressed (Greg hit both 2026-09-05): (1) the **Copyright** field on the
version page is required (`2026 C1 Staffing LLC`); (2) because the Runner
target has `TARGETED_DEVICE_FAMILY = "1,2"`, Apple requires a **13-inch iPad
screenshot set** even for an iPhone-first app. Fixed without a new build:
the existing simulator build (`build/ios/iphonesimulator/Runner.app`) was
installed on the "iPad Pro 13-inch (M5)" simulator via `xcrun simctl
install/launch`, status bar overridden (`simctl status_bar … override --time
9:41`), signed in with the demo account, and captured with `xcrun simctl io
<udid> screenshot` → 2064×2752 PNGs in `c1_app/store/screenshots/ipad13/`
(4 uploaded via the hidden `input[type=file]` under "Choose File"). If we
ever want to drop iPad, change the device family to `1` — but that needs a
new build number and re-upload, so do it for 1.0.1, not now.

**Google Play Console** (developer account "C1 Staffing" 7277616738972403924,
app 4971983647122091628, package `com.c1staffing.worker`): privacy policy,
sign-in details (same demo creds), Ads=No, Target audience 18+, Data safety
(13 types, no sharing, delete-account URL `https://hrxone.com/delete-account`),
Advertising ID=Yes/Analytics (Firebase Analytics merges `AD_ID` into the
manifest — verified in the merged manifest), Government/Financial/Health =
none, category Business, contact `hello@c1staffing.com` + hrxone.com,
store listing (EN copy, 512 icon, feature graphic, 7 phone screenshots),
Production countries = US, Content rating (IARC questionnaire submitted
2026-09-05 6:04 PM on Greg's "do it for me" — category "All Other App Types",
Online Content = Yes because job postings are fetched content, everything
else No → ESRB Everyone / PEGI 3 / USK 0 / IARC 3+ / ClassInd L; the Terms
tick was done on his explicit instruction), and a Production release draft
"1.0.0 (8)" with en-US release notes. **Greg dragged
`build/app/outputs/bundle/release/app-release.aab` in (71 MB — over the
browser tool's 10 MB upload cap) and pressed Send for review 2026-09-05
~7:10 PM** — Publishing overview shows "Changes in review" (Production
1.0.0 (8) full rollout, US, en-US listing, content rating). Play holds every
change until that button is pressed; first-submission review is typically
1–7 days. Watch `hello@c1staffing.com` / the Play Console inbox for policy
questions (the sign-in-details demo creds are what the reviewer uses).

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

## Store status check (2026-09-09, Claude read both consoles in Greg's Chrome)

**Apple: iOS 1.0.0 (build 9) REJECTED 2026-09-06 5:16 PM** — submission
`3da6eb76-6ed4-40ca-90e4-2a35d6fe38d5`, state `UNRESOLVED_ISSUES`, reason
"Guideline 2.1 - Information Needed - New App Submission" (new developer
account with limited review history; NOT a bug/crash/metadata rejection).
Apple wants, both as a reply on the submission thread AND pasted into the
App Review Information → Notes field:
1. A screen recording on a PHYSICAL device (latest iOS) starting at app
   launch, showing the typical flow incl. signup/login AND account deletion
   (Profile → Delete account request), and any UGC reporting/blocking.
2. Purpose + target audience (problem solved, value).
3. Setup/access instructions incl. demo creds (already in notes: phone
   `+1 555 555 0100` / code `246810`).
4. External services list (Firebase Auth/Firestore/Functions/FCM/
   Crashlytics/Analytics, Twilio SMS codes, Everee payroll webview,
   AccuSource, E-Verify/WorkBright, Google Maps if used).
5. Regional differences (US-only; confirm consistent behavior).
6. Regulated-industry documentation (staffing agency — state the business;
   no licensed content).
Resubmit: reply on the thread ("Reply to App Review" on the submission
details page) → the version page's "Update Review"/Resubmit; the same
build 9 can be reused (no code change requested).

**Google Play: still "Changes in review"** (Production 1.0.0 (8), US, app
status Draft / update status In review, last updated Sep 6). No policy
messages. Android developer verification banner: "All of your apps have been
successfully registered" (the Sep 30 deadline is satisfied). Non-blocking
warning on the release dashboard: "App optimization is below our threshold —
Obfuscation (2%)", fix by Feb 2027 (enable R8 minify/shrinkResources in
`android/app/build.gradle` release config for 1.0.1).

### ☠️ Build 9 / Play 1.0.0 (8): SIGN-UP WAS DEAD (found 2026-09-09 from Greg's device recording)

Greg recorded the App-Review walkthrough on his iPhone (new-account path)
and the sign-up form stopped at "Address lookup is unavailable. Missing
Google Places API key." with Continue disabled forever. Cause: the app reads
`GOOGLE_PLACES_API_KEY` / `GOOGLE_MAPS_API_KEY` via `String.fromEnvironment`
(compile-time `--dart-define`), and BOTH store builds on 2026-09-05 were
built with no defines at all (`ios/Flutter/Generated.xcconfig` had only the
Flutter version defines). Address validation is required by
`SignupAddressState.canContinue`, so no new worker could ever register from
either store build — an App Review reviewer creating an account would have
hit it too. Firebase was unaffected (it initializes from the native
GoogleService-Info.plist / google-services.json, not the defines).

Fix (c1_app cb1e586): `tool/build_release.sh` builds ipa + appbundle with
`--dart-define-from-file=.env.release.json` (gitignored via `.env.*`; holds
`GOOGLE_PLACES_API_KEY`). **Never build a store binary without it.** Key
requirements: Places API (New) `places.googleapis.com`,
`geocoding-backend.googleapis.com`, `static-maps-backend.googleapis.com` on
hrx1-d3beb (all enabled). The app's HTTP calls carry no iOS/Android app
identity headers, so the key must be API-restricted only (no
application restriction). "API key 4" (085f4da8…, created 2026-04-07,
API-restricted to the Maps family incl. places.googleapis.com; its
`iosKeyRestrictions` is an EMPTY object, which in practice does not block
header-less requests) is what `.env.release.json` holds — verified
2026-09-09: sign-up address autocomplete returned suggestions from the
iOS simulator build. Creating a dedicated key via `gcloud services api-keys
create` was blocked by the Claude permission classifier; do it from the
console if we ever want to rotate.

Same session, from the recording: cell phone is now prefilled on the
sign-up form from the number typed at sign-in; the code screen's "Send a new
code / Use a different number" row wraps instead of clipping; sign-up page
horizontal padding 24→8pt (the section card adds 16 on top); the
Delete-account dialog no longer claims it "opens your email app" (it files
`account_deletion_requests/{uid}`). Version is `1.0.0+10` — ASC keeps
version string 1.0.0 (rejected versions accept a new build), Play gets a new
Production release 1.0.0 (10) replacing the in-review one.

Also found on the simulator the same day: **"Sign in with email instead"
was a dead link in build 9** — the router's `unauthenticated` redirect
allowed only `/login`, `/signup`, `/forgot-password`, so `/login/email`
bounced straight back (c1_app a616a1d adds it).

Recording findings that need no code: Greg's phone showed a BBC News banner
mid-recording (turn on Do Not Disturb), and the sign-in flow sends the SMS
code BEFORE it knows whether the number has an account (by design —
`sendOtp` then `checkOtp` returns candidates/none).

## QA pass 2026-09-09 (Greg's device recordings + Claude on the iPhone 17 Pro simulator)

Greg recorded two device walkthroughs and then asked for a full simulator
pass (sign-up → apply → interview → every Profile screen). Everything below
is fixed in c1_app unless marked OPEN. Build for the stores = **1.0.0+10 or
later** (see "Build 9 sign-up was dead" above); rebuild both binaries with
`tool/build_release.sh` after the last commit before uploading.

**Sign-up / sign-in**
- Sign-up after a phone sign-in with no account now lands on Home: the
  server creates the account phone-verified via `checkOtp({signup:true,
  recoveryToken})` (functions 7034fa45, deployed) and the app links the
  email/password credential afterwards (c1_app cb0e5d9). Before, the app
  created an email/password user with `phoneVerified:false` and the router
  forced the legacy Phone Verification screen — a second SMS code for a
  number verified a minute earlier.
- "Create account" on the email sign-in screen now routes through the phone
  sign-in (015c6ff); the email-first client sign-up path is only reachable
  from a verified number.
- "Sign in with email instead" was a dead link (router allowed only
  /login, /signup, /forgot-password when signed out) — a616a1d.
- Phone prefilled + locked on the sign-up form; "Use a different number" no
  longer clips; padding fixed (cb1e586, a616a1d).
- QA test phone: `+15555550101` / `246810` added to
  `app_config/phone_auth.testPhones` (same fixed-code mechanism as the demo
  `+15555550100`). Throwaway accounts created with it must be deleted
  afterwards (auth user + users doc + tenant application) — see cleanup
  script `functions/.scratch/cleanup_qa_account_20260909.ts`.

**Jobs board**
- "Nearest" now works: (a) the app reads `homeAddress.latitude/longitude`
  (sign-up's shape) and prefers the home address over device GPS
  (00c4342); (b) 127 of 207 active postings had NO coordinates and their
  worksite location doc was missing (job-order → posting conversions) —
  backfilled with the server geocoding key
  (`functions/.scratch/backfill_posting_coords_20260909.ts`, dry-run with
  `DRY=1`). Then made permanent (Greg pushed back on "re-run it
  periodically" — 602b3354): job orders keep their coords as
  `worksiteCoordinates` (self-backfilled by the recruiter JO page; 99 of 164
  open JOs had it, 0 had `worksiteAddress.coordinates`). The existing
  `syncJobOrderWorksiteToPostings` trigger now resolves coordinates
  (JO.worksiteAddress.coordinates → JO.worksiteCoordinates → location doc →
  server geocode with `GOOGLE_MAPS_SERVER_KEY`, state-matched), writes them
  back onto the JO (`worksiteAddress.coordinates` + `worksiteCoordinates` +
  `worksiteCoordinatesSource`) and re-stamps every linked posting; it also
  fires for any JO write while the JO still lacks coordinates. One-off
  `functions/.scratch/stamp_jo_coords_20260909.ts` stamped all 164 open JOs
  (99 from worksiteCoordinates, 65 geocoded, 0 unresolved). Web
  `convertJobOrderToPosting` / JobPostingDetail and the app's job repository
  also read `worksiteCoordinates` directly.

**Apply wizard**
- E-Verify "are you comfortable" question REMOVED (app bd665b0 + web
  f61cff50, hosting deployed): asks about work authorization before an
  offer. Postings that require E-Verify show the E-Verify participation
  badge (small, bottom) on job detail in both apps instead
  (`assets/branding/everify.png` = `public/img/everify.png`).
- Removed: the E-Verify line on the requirements step, the "available to
  start date" field. Footer reads "Skip" on any empty optional step
  (resume, photo, skills, education, certifications), "Submit" on the last
  step. Choice buttons are outlined until selected, solid when selected.
  Apply header shows worksite city/state instead of "Location to be
  confirmed". Photo step: the in-card "Skip for now" (which only revealed
  a note) is gone; the footer Skip advances.

**Quick interview (prescreen)**
- Job-specific interviews (position packs trim the opening block) failed
  at submit with "opening_target_work_types must be an array of strings":
  the app sent nothing for trimmed multi-select keys, the server requires
  arrays; the web's answer state starts with `[]`. App now always sends
  every multi-select key as an array (b4a59bb).
- Second server rejection right behind it: "Missing or invalid field:
  motivation" — the 13-step fast path never asks motivation/pressure, and
  the server validates every REQUIRED_KEY as a string. App now seeds every
  required string key with '' (web `emptyAnswers()` shape) and conditional
  clears blank instead of dropping keys. Keep `prescreenRequiredStringKeys`
  + `prescreenMultiSelectKeys` in `prescreen_flow.dart` in sync with the
  server's REQUIRED_KEYS.
- System/app-bar Back steps to the previous question (PopScope); it only
  leaves from the first question. Greg's back-tap on the last step had
  dumped him on Home. Verified on the simulator.
- SnackBars: `SnackBarBehavior.fixed` DOES render (verified: "Work
  experience added"); floating never did. Keep fixed.

**Profile**
- ☠️ HARD CRASH on Add Work Experience / Add Education: entries carried
  `FieldValue.serverTimestamp()` inside the array and Firestore iOS throws
  FIRInvalidArgumentException (app killed to the home screen). Never put
  serverTimestamp() inside an array element — `Timestamp.now()` there
  (71490f6 + the education serializer follow-up).
- Home Address editor opened EMPTY for app-created accounts: it read
  `homeAddress.line1/postalCode/coordinates.*` while sign-up wrote
  `street/zip/latitude/longitude`. Editor reads both; sign-up now also
  writes `homeAddress.coordinates{lat,lng}` + `homeLat/homeLng` (510ae74).
- Certification uploads were ALL permission-denied: the app wrote
  `users/{uid}/certifications/{file}` but the Storage rule is
  `users/{uid}/certifications/{certSlug}/{fileName}` (web shape). Fixed +
  failures now show a dialog (d6357fd).
- ☠️ Floating SnackBars never rendered anywhere in the shell (verified on
  video: saves, validation errors and the upload failure were all silent).
  `SnackBarThemeData.behavior` = fixed renders. Belt-and-braces: profile
  saves pop back to the list on success; save failures and the deletion
  request are dialogs.
- Personal details: phone shown formatted; the "last 4 of SSN" subtitle
  removed (the field doesn't exist; last4SSN is an Everee mirror).
- OPEN (design nit): Profile → preferences only offers Hospitality /
  Industrial (matches the web's legacy target-industry subset).

**OPEN after the pass**
- No way back into a PENDING interview: leaving it (draft auto-saved) shows
  nothing on Home or on the submitted job ("Application Submitted" only).
  The web surfaces a "finish your interview" action item; the app's action
  items didn't for this account. Needs a dashboard item or a button on the
  submitted job.
- Trimmed-interview submit verified by unit test
  (`test/features/prescreen/prescreen_submission_test.dart`) + the array
  error gone on-device; the string-key fix was not re-run end-to-end.
- Foreground push toast uses a floating SnackBar via the root messenger —
  re-check it renders now that the theme is fixed-style.
- QA cleanup: `functions/.scratch/clear_qa_0101_20260910.ts` (Firestore:
  users doc, tenant applications, interviews, deletion request, consent).
  ☠️ The Admin SDK Auth calls FAIL locally with "identitytoolkit requires a
  quota project" even after `gcloud auth application-default
  set-quota-project`, and the 2026-09-09 script swallowed that error
  (`.catch(() => null)`) and reported the QA Auth user "gone" — it was
  never deleted, so the next sign-up with +15555550101 silently reused the
  old uid (2026-09-10). Delete Auth users via REST with the gcloud user
  token + quota header instead, and never `.catch(() => null)` a lookup
  you use to prove deletion:
  `curl -X POST https://identitytoolkit.googleapis.com/v1/projects/hrx1-d3beb/accounts:delete -H "Authorization: Bearer $(gcloud auth print-access-token)" -H "x-goog-user-project: hrx1-d3beb" -H "Content-Type: application/json" -d '{"localId":"<uid>"}'`
  (look up first with `accounts:lookup` `{"phoneNumber":["+1555…"]}`).
  ☠️ In zsh don't name the shell variable `UID` (read-only).

**Store status**: Apple 1.0.0 (9) rejected 2.1 (info needed) — reply draft
in `c1_app/store/APP_REVIEW_REPLY_2026-09.md`; Play 1.0.0 (8) still in
review. Both need the new build (10+) uploaded; Play's in-review release
gets replaced by a new Production release.

## Keyboard dismissal (2026-09-10, Greg: "keyboard stays up, tapping off doesn't close it")

☠️ Flutter does NOT unfocus a text field on an outside touch on iOS/Android
(`EditableTextTapOutsideAction`: "On mobile platforms, we don't unfocus on
touch events"), and the app had zero dismissal code — any tapped field kept
the keyboard until the screen was left. Fix (c1_app, build 13+):
- `lib/shared/widgets/keyboard_dismiss_on_tap.dart`, mounted once in the
  MaterialApp `builder` (above the Navigator → covers routes, dialogs,
  sheets). A `Listener` (never enters the gesture arena) on pointer-down:
  if a text field owns focus and the touch is not inside a
  `RenderTapRegion` with `groupId == EditableText`, unfocus. So empty-space
  taps, buttons, tabs and scroll starts all close the keyboard; tapping
  field→field just moves focus (no flicker); Autocomplete option lists and
  the selection toolbar are inside `TextFieldTapRegion`, so they still work.
- Multi-field forms (sign-up, personal details, cert / experience /
  education sheets, replace-bank-account sheet, phone recovery) set
  `textInputAction: TextInputAction.next` on every field but the last, so
  the return key walks the form and Done on the last field closes it.
  Phone/number keyboards on iOS have no return key — the tap-outside rule
  is what closes those.
- Don't add per-screen `GestureDetector(onTap: unfocus)` wrappers; the root
  handles it. Autofocus stays only on sign-in steps (phone, SMS code,
  recovery name), where typing is the screen's whole purpose.
Web needs no change (browsers dismiss natively).

## One top bar: back arrow lives in the shell bar (2026-09-10, Greg: "real estate is valuable, especially with the keyboard up")

Inner screens used to draw their own 56pt AppBar (back arrow + page title)
under the shell bar (EN|ES · logo · help · bell). Now (c1_app, build 13+):
- `WorkerShellScaffold` shows a back arrow LEFT of EN | ES whenever the
  current path is not the tab's root page (`branch.routes.first.path`).
  Visibility is path-based on purpose: the branch Navigator hasn't rebuilt
  when the shell bar builds, so `canPop()` lags a frame and left a stale
  arrow on tab roots. Tap = `maybePop()` on the current branch navigator
  (honours `PopScope`: the interview steps back a question, headshot
  capture hands its photo back), or `goBranch(index, initialLocation:
  true)` when there is nothing to pop (deep link into a detail page) —
  same as the old job/assignment `_navigateBack`.
- Every inner `Scaffold.appBar` goes through
  `shellAwareAppBar(context, AppBar(...))`
  (`lib/shared/widgets/worker_page_app_bar.dart`). Inside the shell
  (`WorkerShellChrome` InheritedWidget wraps `navigationShell`) it returns
  null → no second row. Exceptions kept as slim rows: an AppBar `bottom`
  (Documents' TabBar) and real `actions` (Notifications' "Mark all as
  read"). A `LanguageSelector` action is dropped (duplicate of EN|ES).
  Outside the shell (sign-in, sign-up, unlock) the AppBar renders as before.
- Page titles are gone inside the shell (same call Greg made for tab roots
  on 2026-09-04). Each page's body already opens with its context line.
- NEW inner screens must use `shellAwareAppBar` — a bare `AppBar` brings
  the second row back.
- Shipped as **1.0.0 (13)** (2026-09-10, c1_app fbb5638): keyboard
  dismissal + single top bar. 11 and 12 were never uploaded. Archive:
  `~/Library/Developer/Xcode/Archives/2026-09-10/C1 Staffing 1.0.0 (13).xcarchive`.
  Widget tests: `test/shared/worker_page_app_bar_test.dart`.
- Tests: `test/shared/keyboard_dismiss_on_tap_test.dart` covers iOS focus /
  dismissal / field-to-field and that the shell drops the title row.

## Third-party AI consent (2026-09-10, Greg: "consent at sign-up, build 14")

Why: App Store guideline 5.1.2(i) requires disclosing, and getting explicit
permission for, personal data sent to a third-party AI. Worker-app features
that call Anthropic (Claude): Get help answers (`workerSupportAssistant`),
resume reading (`parseResumeHttp` → `parseResumeCore`), the prescreen
answer-quality check (`claudeNarrativeQuality` via
`composePrescreenAiBundle`), and recruiter fit scoring
(`calculateApplicantFitScore`). Interview outcomes (advance / review / hold /
reject) are all RECOMMENDATIONS for a recruiter
(`recommendedActionsPhase1`) — nothing hires or rejects automatically; keep
it that way or the App Review reply becomes false.

Design:
- Record: `users/{uid}.userAgreements.aiProcessing = {agreed, version:
  '2026-09-10', timestamp, source}`.
- Asked: optional unchecked checkbox at sign-up — app `SignupEntryScreen`
  (sent as `aiConsent` to `checkOtp`, stamped server-side in
  `resolvePhoneSignup`; legacy email path stamps client-side) and web
  `PhoneSignupGate` (same `aiConsent` payload). Existing app accounts with
  no record get a one-time Allow / Don't allow dialog from
  `WorkerShellScaffold` (waits for the language dialog). Changeable in app
  Profile → About & Legal (`SwitchListTile`).
  Helper: c1_app `lib/features/profile/presentation/widgets/ai_consent.dart`.
- Enforced server-side on an EXPLICIT decline only
  (`functions/src/utils/aiProcessingConsent.ts`): support assistant returns
  an escalate-to-a-person answer, resume parse returns 403
  `ai_processing_declined`, prescreen uses the rules evaluator, fit score
  returns a neutral 50. `loadAiProcessingDeclined` fails CLOSED on a read
  error. Accounts that never chose (existing web workers) keep current
  behavior, covered by the privacy policy; the app always asks first.
- Privacy policy: `legal.privacy.s3L7` (use) + `s4L4` (Anthropic sharing,
  no training, decline path), EN/ES, Privacy.tsx renders them, static
  `/legal/privacy.html` regenerated. Last updated 2026-09-10.
- ☠️ A NEW AI call on worker data must check `aiProcessingDeclined` first.
- Tabs renamed the same day: Schedule → Assignments, Payroll → Pay (app
  `navSchedule`/`navPayroll`, web `nav.myAssignments`/`nav.payroll`).
- Demo account (Alex Rivera, +15555550100) has a San Jose home address
  (distances show) and NO AI choice on purpose — reviewers see the one-time
  prompt. If testing flips it, remove `userAgreements.aiProcessing` again.

## Store status 2026-09-10 (evening)
- ☠️ **Google Play published 1.0.0 (8) to Production (US) on 2026-09-10.**
  Build 8 has no Places key, so sign-up is dead on the live Android app.
  Fix = Play Console → Production → Create new release → build-14 AAB.
  Managed publishing is OFF: any saved listing edit goes live after review.
- Store screenshots refreshed on build 14 (`c1_app/store/screenshots/`,
  commit e7372af): iPhone 6.9" + 6.5" + Play 9:16 (7, EN+ES) and iPad 13"
  (5, incl. Assignments). ASC version 1.0.0 iPhone 6.5" + iPad 13" sets
  replaced. Play phone screenshots deliberately NOT swapped yet — do it
  with the build-14 release so the live listing matches the live build.
- Chrome's file_upload only reads the session's working dir: copy files
  into `functions/.scratch/` first. ASC's visible "Choose File" is a
  button; the real target is the hidden `input[type=file]` (find it by
  "hidden file input" — the first ref returned is the button).
- ASC shows a "Review New Social Media Questions on Age Ratings" banner;
  check App Information → Age Rating before resubmitting.
