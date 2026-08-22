# Phone-number auth for workers (phone = identity)

> Decision (Greg + Mark, independently, 2026-08-21): workers sign up and sign in with their phone
> number (OTP), not email + password. Staff keep email/password. Companion to
> [[project_worker_onboarding_everee]] and [[project_recruiter_roster_adoption]]. Status: PLAN +
> slice 0 (last-4 SSN removal) shipped; slices 1–4 pending Greg's two decisions below.

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
- **Slice 2 — Sign-up = phone.** Wizard step 0: name + phone → OTP → (if phone already has an account →
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
