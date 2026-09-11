# Illinois AI-in-hiring compliance (notice, human review, self-ID monitor)

> Built 2026-09-10 (Greg: "Do steps 1-3 on web and flutter app for all illinois
> postings… applicants will always speak to a real human before working. AI is
> just for prescreening and backoffice activity"). Companion to
> [[project_tier_system_claim_shift_spec]] (automatic tier promotion + the
> job-order hiring plan that made this necessary — JO #524 is Romeoville, IL)
> and [[project_tiered_shift_access]] (AEDT compliance note). Not legal advice —
> counsel review still open.

## Why
- **Illinois Human Rights Act, HB 3773 (eff. 2026-01-01)**: AI use in
  recruiting/hiring/promotion that has the *effect* of discriminating on a
  protected class is a civil-rights violation; zip codes can't proxy protected
  classes; employers must give notice of AI use. IDHR rules on notice
  content/timing were in draft — re-check whether they're final.
- **AI Video Interview Act** does NOT apply today (the "AI prescreen" is typed
  answers scored by deterministic rules, no video). **BIPA** does not apply
  (no voiceprints/face geometry). Both would if video/voice/face analysis is added.
- The tier scorecard is a fixed points formula — arguably outside HB 3773's AI
  definition — but the product is branded "AI" and the hiring plan now makes
  automated decisions, so we treat it as covered. General disparate-impact law
  applies regardless.

## Scope rule
Posting worksite state IL (`shared/illinoisAiHiring.ts` `isIllinoisPosting`:
top-level `state`, then `worksiteAddress.state`; "Illinois" → IL). Flutter mirror:
`lib/features/applications/domain/illinois_ai_hiring.dart`
(`isIllinoisState`, `isIllinoisPostingMap`). Notice version
`il-ai-notice-2026-09` in both — bump when the copy changes materially.

## 1. AI-use notice (before the AI step)
Copy (EN/ES): web `i18n/locales/*.json` `aiHiring.*`; app `AppStrings.aiHiring*`.
States that automated tools including AI handle prescreening and back-office
work (score prescreen answers + profile → tier → on-call pool), what data they
use, that a C1 recruiter speaks with every applicant before they work, and that
review/accommodation can be requested anytime. Shown on:
- **Posting detail** — web `JobPostingDetail` (above Location), app
  `JobDetailScreen` (under the hero). Covers quick apply (Apply is on that page).
- **Apply wizard last step** — web `Wizard.tsx` (not in account-only mode), app
  `ApplyScreen._buildReviewStep`.
- **Prescreen gate** — web `WorkerAiPrescreenPage`, app
  `PrescreenInterviewScreen` (`_Phase.notice`): blocks the questions until the
  worker taps Continue, then stamps `users/{uid}.aiHiringNotice
  {version, acknowledgedAt, source, applicationId}`. Lookup failures fall
  through to the interview (fail-open; the posting already showed the notice).
  Repeat interviewees who never reach the page still saw it on the posting/wizard.
- **Application detail** — app `ApplicationDetailScreen` (full card); web My
  Applications rows get an "Ask a recruiter" action (`AskRecruiterButton`).

## 2. Human review / accommodation requests
- Worker writes `tenants/{t}/recruiter_review_requests/{id}`
  `{tenantId, userId, kind: review|accommodation, details ≤2000, applicationId,
  jobId, jobOrderId, postingTitle, stateCode:'IL', status:'open', source: web|app,
  notifiedAt:null, createdAt, updatedAt}` (web `RecruiterReviewRequestDialog`,
  app `showRecruiterReviewRequestSheet`).
- Rules: create only own + exact key allowlist; read = owner or recruiting staff;
  update = recruiting staff; no delete. Details can be medical — never put them on
  the application doc (any signed-in user can read applications).
- **Alerts**: orchestrator subtask `ai_hiring_monitor_sweep` (hourly,
  ENABLE_AI_HIRING_MONITOR_SWEEP default on) queries `notifiedAt == null`, fills
  a missing jobOrderId from the posting, writes `dashboardFeed` via
  `notifyRecruitersOnWorkerEvent` (JO assigned recruiters; no details in the
  snippet) or falls back to tenant admins (level 7; details included since there's
  no JO page to read them on), then stamps `notifiedAt`/`notifiedRecipients`.
  Up to an hour of delay by design (no new Cloud Run services).
- **Recruiter UI**: JO → Applications tab status cell shows "Review requested" /
  "Accommodation request" chips (`ApplicantReviewRequests.tsx`, live query on
  jobOrderId + status open) → dialog with details + **Mark resolved**.

## 3. Voluntary self-identification + monitor
- **Storage**: top-level `eeo_self_identifications/{uid}`
  `{uid, raceEthnicity, sex, version:1, source, createdAt, updatedAt}` — rules:
  owner read/write with code allowlists, HRX read, no delete. Never on
  `users/{uid}` (recruiters can read users docs).
- **Not a revival of W.3** (2026-04-29 removed gender/veteran/disability from the
  apply wizard's Work Eligibility step; `WorkEligibilityStep.eeoRemoval.test.tsx`
  still locks that). This is a separate, optional, Illinois-invited form (web
  `VoluntarySelfIdDialog`, app `VoluntarySelfIdScreen` at
  `/c1/workers/profile/self-identification`), reached from the notice card only —
  no general profile entry on either surface (deliberately Illinois-scoped).
- **Codes**: race/ethnicity (EEO-1 categories + `two_or_more` + `decline`), sex
  (`male|female|nonbinary|decline`). Age band comes from DOB (`under_40` /
  `40_plus`), not asked.
- **Report**: the same sweep, self-gated to ~daily per tenant, writes
  `tenants/{t}/compliance_reports/ai_hiring_illinois`: IL postings, applicants
  (application status not in_progress/draft/deleted, deduped per worker),
  self-ID responses, and per dimension the promotion (Tier 1/2) and hire (live
  employment at the posting's hiring entity) rates with impact ratios vs the best
  group, `below_four_fifths` flags (< 0.8), `too_few` under 5 people,
  declined/unanswered counts, plus open request count. Pure math in
  `functions/src/compliance/aiHiringMonitor.ts` (mocha tests). Rules: read level
  6+, no client writes.
- **Web page**: Reports → Compliance → **Illinois AI Hiring Monitor**
  (`/reports/ai-hiring-illinois`, level 6).

## Open
- Counsel review of the notice copy; IDHR final notice rules.
- Self-ID response rates will start near zero — the monitor is only as good as
  participation; consider an invite after apply if rates stay low.
- `npm run i18n:check` was already failing on `craigslist.draft`
  (`src/shared/craigslist.ts`) before this work.
