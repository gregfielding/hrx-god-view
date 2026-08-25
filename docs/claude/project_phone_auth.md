# Phone-number auth for workers (phone = identity)

> Decision (Greg + Mark, independently, 2026-08-21): workers sign up and sign in with their phone
> number (OTP), not email + password. Staff keep email/password. Companion to
> [[project_worker_onboarding_everee]] and [[project_recruiter_roster_adoption]].
>
> **Status 2026-08-25: Slices 0–1 SHIPPED.** Decisions resolved: 1B (JIT claim) and — contrary to
> the 2A recommendation below — **2B: our OWN Twilio Verify OTP + custom tokens** (Firebase's
> invisible reCAPTCHA threw image challenges + `auth/invalid-app-credential` at Greg; Twilio also
> enables the household picker Firebase's 1-phone-1-account model can't do). Live: `/login/phone`
> (linked from Login as "Sign in with your phone instead") → `sendOtp`/`checkOtp({signIn:true})` →
> `resolvePhoneSignIn`: one match → claim + custom token for the EXISTING uid; same-person dupes →
> survivor rule (Everee-complete → lastPaidAt → updatedAt); household-shared phone → picker with
> email under each name; staff excluded unless Auth phoneNumber opt-in; audits to
> `phone_signin_audit`. SMS reads "Your C1 verification code". Side effect: the ~3,700
> no-credential Auth users can now sign in (claim needs no password provider).
> **Slice 2 (phone-first SIGNUP) is the open gap** — all four signup surfaces below still run
> `createUserWithEmailAndPassword` with NO resolve-by-phone first (the duplicate factory is still
> on), and /login/phone's no-account path bounces to the password wizard at /c1/apply.

## Ground truth (2026-08-21)

- Pure web app (CRA, no Capacitor/RN wrapper) → Firebase phone auth on web = invisible reCAPTCHA.
- Firebase Auth **phone provider already enabled**; authorized domains include hrxone.com, app.hrxone.com.
- Six auth entry points: `src/pages/Login.tsx`, `src/components/AuthDialog.tsx` (jobs-board signup),
  `src/components/apply/Wizard.tsx` (step 0 creates the account — password + confirm), `OnboardingProfileForm.tsx`,
  `src/pages/UserOnboarding.tsx`, `src/pages/SetupPassword.tsx` (invite claim), plus `functions/src/auth/inviteUser.ts`.
  All four self-service paths mint NEW Auth uids when a Firestore doc already exists → see
  [[feedback_auth_uid_orphan_footgun]] — phone auth must go through ONE shared "resolve account by phone" path.
- Firestore users: 13,907 (13,894 workers, 13 staff). Valid 10-digit phone 13,738; no phone 138; unparseable 31.
  **13,016 unique-phone accounts**; **346 phones shared by 722 accounts** (largest group 13 — a placeholder
  number); Venue Smart alone has 12 duplicate-phone pairs.
- Firebase Auth: 13,804 users — password provider 10,006, phone provider 107, **~3,700 with no provider**
  (migrants/invitees who never set a password — cannot log in today).
- SMS: Twilio in prod (shift_invite / bulk paths), EN/ES i18n exists, `preferredLanguage` on users.

## Design

**Identity = E.164 phone.** One phone ↔ one worker account. Email becomes optional metadata (needed only
for Everee's record and tax docs — collect it later in the concierge flow if missing, or let Everee's
embed collect it).

### Two decisions for Greg

1. **How existing accounts get their phone attached** (the migration):
   - **(A) Bulk backfill** — set Auth `phoneNumber` on the 13,016 unique-phone accounts now. Fast, but
     attaches *unverified* numbers: a typo'd phone on file lets whoever owns that number OTP into the
     account. ~Recommended against.
   - **(B) Just-in-time claim (recommended)** — worker enters phone → OTP succeeds (phone possession proven)
     → callable `claimAccountByPhone` finds the Firestore account(s) with that phone → exactly one: set that
     uid's Auth `phoneNumber`, mint a custom token for the EXISTING uid, delete the throwaway phone-auth uid →
     signed in as themselves, history intact. Multiple matches: show first-name choices ("Which one is you?
     Ana I. / Ana M.") then merge later via admin tool; none: proceed to sign-up. Dups resolve themselves
     at claim time; no blind mass write.
2. **OTP provider:**
   - **(A) Firebase phone auth (recommended)** — already enabled, fraud/abuse protection built in, free tier
     then ~$0.01–0.06/SMS US, invisible reCAPTCHA on web (rarely prompts), EN/ES SMS templates via Firebase.
   - **(B) Custom OTP over our Twilio + custom tokens** — full control of copy/sender, no reCAPTCHA, but we
     own rate limiting, replay/abuse defense, and code storage. Only worth it if reCAPTCHA measurably
     blocks workers.

### Slices

- **Slice 0 — DONE 2026-08-21:** last-4 SSN removed from the wizard; mirrored from Everee instead
  (`evereeReconcileWorker` write-through → `users/{uid}.last4SSN` + `taxIdentity{source:'everee',
  tinVerificationStatus}`); `add_tax_identity_last4` dashboard nag retired. Deployed (11 fns + hosting).
- **Slice 1 — Phone login (workers), behind a flag.** Login page gets "Continue with phone" (default for
  workers; staff link stays email). `signInWithPhoneNumber` + invisible reCAPTCHA → `claimAccountByPhone`
  (JIT, decision 1B) → land on dashboard. Email/password remains as fallback during rollout.
- **Slice 2 — SHIPPED 2026-08-25.** `checkOtp({signup:true, firstName, lastName, preferredLanguage,
  signupSource, signupGroupId, jobContext})` → `resolvePhoneSignup`: existing phone → sign-in claim
  path with `existing:true`; none → rehire gate (exact phone, generic denial) → Auth user minted
  with verified phone (no password; `auth/phone-number-already-exists` → reuse orphan uid) + users
  doc in wizard base-profile shape (email NULL/optional; applyResumeSnapshot preserved for the SMS
  resume reminder) + audit `signup_created` + custom token. Client: shared
  `src/components/apply/PhoneSignupGate.tsx` in wizard step 0 (passwords gone, Continue gated on
  auth, legacy branch neutralized, email optional) + AuthDialog Create tab (email/password now
  sign-in-only); /login/phone no-account → /c1/apply?phone= prefill. ⚠️ The OTP leg needs a human
  phone to E2E-test: claim path testable with any existing worker phone; CREATE path needs a
  never-used number. Refined same day (Greg): **conversion-first step 0** = first/last/phone/DOB + OTP gate ONLY
  (fits one phone screen); email (optional) + address moved to step 1 POST-code — supersedes the
  2026-08-07 address-at-creation rule (abandoned signups now leave claimable accounts; the
  applyWizardReminder SMS chases completion). Language dropdown removed — the page EN|ES toggle
  is saved server-side at signup. Apply shell runs the workerTheme (canon fonts/ink, quiet
  EN|ES toggle, 760px form). Original design for reference: Wizard step 0: name + phone → OTP → (if phone already has an account →
  sign in, never create a second) → address/DOB/language → account exists with NO password. Email field
  optional. Same for AuthDialog (jobs-board) and group landing pages. This kills duplicates at the source.
- **Slice 3 — Recovery + admin tools.** "New phone number?" flow (OTP on new number + recruiter approval or
  email fallback); admin "merge duplicate accounts" (move assignments/entries/Everee link to the survivor,
  retire the other; reuse `retired_duplicate` pattern from everee_workers); phone-change audit log.
- **Slice 4 — Retire passwords for workers.** SetupPassword/invite flows send an OTP link instead; password
  reset emails off for role ≤ 4; `inviteUser` creates accounts with phone only.

### Guardrails
- Never create an Auth user in any path without first resolving by phone (one shared helper, server-side).
- Rate-limit claim/OTP per phone + per IP; log every claim (uid, phone hash, ip, ua) to an audit collection.
- Staff (securityLevel ≥ 5) excluded from phone-claim; admins keep email/password (+ future MFA).
- Roll out by user group / tenant flag first (e.g. Rosa's group landing), then default.

### Metrics
Sign-up completion rate (account created → address → first assignment visible), login success rate,
support tickets "can't log in", duplicate accounts created per week (target 0).

### 2026-08-25 (later) — conversion cuts after Greg's live E2E review
Greg watched a full production signup and cut the wizard to what staffing ops actually reads
(weighed against Instawork/Wonolo/Indeed Flex norms — none ask these at signup):
- **Removed permanently**: MilestoneProgress bar (stuck at 0% through auto-skipped steps; short
  flows don't need one), step 3 E-Verify comfort (E-Verify is ops-disabled anyway — see
  project_everify_disabled.md), step 10 bio (comes from résumé), step 11 shift preferences and
  the final-step "When can you start?" date (admin side never reads either). `visibleStepIndices`
  base array is now `[0,1,2,4,5,6,7,8,9,12]`; the switch cases + step components' dead code deleted.
- **Slimmed**: résumé step (h6 + one-line subtitle + dropzone, `hideTitle` on ResumeUpload);
  headshot step (title + one line + centered ~240px Take/Upload buttons + one hint — tips list,
  info alerts, in-step skip buttons all gone). One nav CTA: "Skip for now" on steps 2/5 replaces
  the old dual skip buttons.
- **Transport chips** (kept — "how you get to work is important"): flex-wrap `gap:1`, 36px,
  selected = `color="secondary"` (C1 gold bg + ink text per worker canon).
- **☠️ Step-eviction bug + guard**: completing the final step's last unanswered field (tapping a
  transport chip) flipped `needsRequirementsStep` false and the recompute EVICTED step 12 while
  the worker stood on it, bouncing them back to an earlier step. Guard: `lastActualStepRef`
  (previous render's actualStep) — never filter step 12 out when it's the current step. Any new
  "skip if complete" filter must consider the same live-eviction hazard.
- **Post-submit**: signed-in workers now land on `/c1/workers/dashboard` (real app chrome,
  bottom nav) via PostSubmitRedirect (1.5s "You're all set! 🎉"), replacing the dead-end card
  under the signup header. Apply.tsx header is auth-aware: "Sign up" → "Finish your profile"
  once the OTP gate signs them in.
- **Layout canon**: wizard now matches C1WorkerLayout — `maxWidth {sm:720}`, `px {xs:2, sm:3}`
  page gutter, content on a hairline card (12px radius, #E9E9E5 border) over `background.default`.
- **☠️ Test-account cleanup**: laptop admin-SDK **Auth** ops fail as `auth/internal-error`
  (Firestore ops work fine) — a cleanup script can print "deleted" while the Auth user survives;
  this happened twice with Testina (+19255550188). Always delete/verify via Identity Toolkit REST
  (`gcloud auth print-access-token` + `x-goog-user-project: hrx1-d3beb`, `accounts:delete` then
  `accounts:lookup` to confirm empty) — same footgun as the invite flow in project_conventions.md.

### 2026-08-25 (evening) — phone-first /login flipped + Slice 3 SHIPPED
- **/login is now the phone OTP screen** (LoginGate): email/password moved to `/login/email`,
  `/login/phone` stays as a never-redirecting alias. `c1LastLoginMethod` (localStorage, stamped
  only on SUCCESSFUL sign-in — Login, PhoneLoginPage, PhoneSignupGate) bounces email users
  straight to `/login/email`, so staff pay nothing for the flip. Phone login honors auth-guard
  deep links (`state.from`, worker routes only). SetupPassword's post-reset buttons → `/login/email`.
- **Slice 3 — phone-change recovery, live E2E-verified on prod**: sign-in no_account now returns a
  single-use 10-min `recoveryToken` (phone_signin_pending, `purpose:'recovery'`, 5-attempt cap) →
  "My number changed" form (name + DOB) → `checkOtp({phoneChange:true, recoveryToken,...})` →
  `resolvePhoneChange` matches by DOB equality (`dob`/`dateOfBirth` iso) + normalized name
  (first 3-prefix, last exact), staff/merged excluded → `phone_change_requests` (staff-read-only
  rules, tenantId-stamped; one pending per number). Staff queue: **/users/phone-changes** (Users
  hub tab). Approve/reject ride workerSupportAssistant (`phone_change_approve`/`_reject`,
  phoneChangeCore.ts): moves phone on users doc + Auth (strips a doc-less orphan holder; creates
  the Auth user if the doc never had one), arrayUnions `previousPhones`, audits
  `phone_signin_audit` (`phone_change_requested/_approved/_rejected/_no_match`), SMS-confirms the
  worker on the new number (EN/ES). NEVER auto-approved — name+DOB is weak proof.
- **☠️ AuthContext staff-default footgun (fixed at source)**: a users doc with `role` but NO
  `securityLevel`/`tenantIds` falls into AuthContext's last-resort `setSecurityLevel('5')` —
  fresh phone signups were treated as STAFF client-side, bounced to admin /dashboard, and crashed
  (useGoogleStatus outside provider). `resolvePhoneSignup` now stamps `securityLevel: '2'`
  (applicant). The AuthContext '5' default itself is untouched (changing it risks locking out
  legacy staff docs) — any future account-creation path MUST stamp securityLevel.
- **☠️ DOB fix**: step 0 auto-filters once authed, so its save-on-Next never runs — DOB died in
  localStorage. PhoneSignupGate now sends `dob`; resolvePhoneSignup normalizes → `dob` iso.
- **☠️ Browser-pane test-session zombie**: `indexedDB.deleteDatabase('firebaseLocalStorageDb')`
  is BLOCKED while the app holds its connection — "cleared" sessions resurrect on reload (a
  deleted uid's zombie session even crash-looped). Clear the `firebaseLocalStorage` OBJECT STORE
  contents instead, then navigate.
- Remaining Slice 3 scope NOT built: admin merge tool for the ~722 same-phone duplicate accounts
  (survivor rule already routes their sign-ins correctly; merge is data hygiene). Slice 4
  (retire worker passwords, invites via OTP link) also open.

### 2026-08-25 (night) — jobs-board apply unified with the phone-first flow
- `/apply/:tenantSlug/:jobId` (the URL every jobs-board Apply button hits when
  logged out) now wraps the shared wizard in the same worker-canon shell as
  /c1/apply: workerTheme, EN|ES toggle, "Apply" title (the wizard's posting
  header carries job title/pay/location). Same PhoneSignupGate step 0 —
  signup from a posting IS the signup flow, followed only by job questions.
- Requirements step asks ONLY unanswered questions: each section (E-Verify,
  drug, background, languages, physical, uniform, custom uniform, PPE,
  additional screenings, screening package, transport) gates on
  value-prefilled-from-profile + a touched-set so a question never vanishes
  mid-tap. 'Maybe' counts as answered only with its explanation (mirrors
  needsRequirementsStep). Repeat applicants stop re-answering "can you lift
  50 lbs" on every application.
- Yes/No/Maybe chips on canon: 36px, gold selected + ink text, no
  traffic-light colors or hover scale.
- **☠️ Root causes of "asks me every time" (both fixed)**: (1) requirement-chip
  answers queue in userProfileBatching with a **10-minute** flush (now 15s) and
  the unload flush dies mid-navigation — answers only ever persisted via full
  submit; (2) the auto-skip class of bug — a step that filters itself out the
  moment its data is complete never runs its save-on-Next (DOB at signup,
  ADDRESS at the address step). Address now persists to the users doc the
  moment it's complete. ANY new wizard step that auto-skips on completeness
  must persist its data at the moment of entry, not on step-exit.
- Requirements prefill is field-level + always-on (stale drafts no longer
  block profile answers), reading legacy fields + canonical workerAttestations
  (nested and dotted). Verified: a profile with physical=Yes + transport=Car
  applying to a new job sees ONLY that job's unanswered questions.
- Mobile: wizard card is full-bleed on xs — one 16px edge for headers and
  content (insets were stacking to 32px+).
- **2026-08-25 (late)**: 18+ enforced (PhoneSignupGate blocks the code send
  with an inline error; resolvePhoneSignup rejects server-side — AuthDialog
  path exempt since it collects no DOB). Email REQUIRED for job applications
  (step 1 stays visible until a valid email is on file, Next gates on it,
  email persists the moment it's valid); general signup keeps email optional.
  quick-apply already routes email-less users to the wizard via
  hasExistingApplicationData's email check. Job posting page: green
  'Apply For This Shift' CTA (renamed from 'I Can Work This Shift', EN/ES),
  one type scale (subtitle1-700 headers / body2 body), quiet text-style Maps
  link, compact 'Sign In' pill, and a page-level gutter for GUESTS (they
  render outside C1WorkerLayout — px only when !user or it doubles).
  NEXT UP (Greg): audit the admin /users/:uid page so the captured signup
  data (dob, email, transportMethod, attestations, previousPhones,
  signupSource, preferredLanguage) displays properly.

### 2026-08-25 — admin profile now displays what signup captures
- Overview → Qualifications card: **Application answers** section (all attestation
  Yes/No/Maybe with attested dates — canonical workerAttestations + dotted-key
  legacy + top-level comfortable* fallbacks — plus transport + per-job
  additional screenings), Languages chips (was computed-but-unrendered),
  Experience summary (yearsExperience/educationLevel were dead-code-only),
  cert expiration dates. Settings tab: read-only **Signup & consent** card
  (source/group, TOS/SMS/privacy stamps w/ version+date, previousPhones,
  lastPhoneSignInAt). Built from src/pages/UserProfile/utils/
  overviewQualificationsSnapshot.ts (applicationAnswers builder).
- Divergence fixes: admin DOB edit dual-writes dob+dateOfBirth; record-header
  address + quick-profile modal fall back to top-level zipCode/homeLat/homeLng;
  workHistory/workExperience reads are length-aware (signup seeds
  workHistory: [] which masked workExperience).
- Deletion queue chip split: red "Has payroll — retain" now ONLY for real
  Everee linkage (taxIdentity.source==='everee' || evereeWorkerId); SSN last-4
  alone shows amber "SSN on file — no pay history" (safe to hard-delete).
  Context: Grissett request 8/24 was flagged retain on SSN-only — actual
  procedure for such: Open profile → System Access → Delete → Mark completed.

## Signup completeness round (SHIPPED 2026-08-25)

- **Funnel analytics**: GA4 events `apply_step_viewed` / `apply_step_completed`
  / `apply_abandoned` / `apply_completed` (src/utils/applyWizardAnalytics.ts,
  mirrors prescreenAnalytics). Stable ids in `STEP_IDS` (Wizard.tsx, next to
  stepKeys); params carry stepId/stepIndex/totalSteps/jobId/signupSource.
  Read in GA4 funnel exploration — there is NO in-app funnel page.
  Verified live: events observed in window.dataLayer on prod.
- **Position interests — wizard step 13** (generic signups only; jobId flows
  skip it — applying IS the position signal). 8 category chips
  (POSITION_INTEREST_KEYS in PositionInterestsStep.tsx) → canonical
  `workerProfile.preferences.positionInterests` (write-model mapping +
  CANONICAL_PREFERENCE_KEYS entry). ☠️ Persists AT TAP, not just on Next:
  when 13 is the last visible step the button is handleSubmit and the
  on-Next save never runs (the auto-skip write-eater class, again).
  Already-answered workers and job applicants never see it
  (nested+dotted+top-level read, lastActualStepRef guard).
- **Emergency contact**: NOT built — it already exists end-to-end
  (dashboard action item `add_emergency_contact` → personal-details page;
  admin edit in ProfileOverview). The client homeReadinessModel checklist
  that lacks it appears to have zero render sites (dead model) — don't
  extend it without checking for a consumer first.
