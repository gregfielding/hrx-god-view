# Worker dashboard action items — portable contract (Profile + job requirements)

**Canonical product spec:** *Worker Action Items Architecture* (PDF) — profile gates, ordering, max **3** visible cards, SMS split; **plus** production addendum (TempWorks, compliance, assignment confirmation).

**Web implementation**

| Area | Path |
|------|------|
| Profile fact evaluators | `src/utils/workerProfileActionItemFacts.ts` |
| Compliance signal derivation | `src/utils/workerComplianceActionDerivers.ts` |
| Job signals (assignments, TempWorks fields) | `src/utils/workerJobRequirementSignals.ts` |
| Builder (merge global priority → cap 3) | `src/utils/workerDashboardActionItems.ts` |
| AI pre-screen (post-reminder; suppressed for 30 days after any completed prescreen interview) | `src/utils/workerAiPrescreenDashboardActions.ts`, `src/hooks/useWorkerAiPrescreenSurfaceSignals.ts` |
| Firestore dismissals | `src/utils/workerDashboardDismissals.ts` |
| SMS context | `src/utils/workerSmsAlertsContext.ts` |
| Profile photo | `src/utils/workerProfilePrerequisites.ts` → `userDocHasProfilePhoto` |
| UI | `src/components/worker/home/WorkerDashboardActionItems.tsx` |
| Dashboard data load | `src/pages/c1/workers/dashboard.tsx` |
| i18n | `public/i18n/locales/en.json`, `es.json` → `dashboard.actionItems.*` |

**Profile IDs:** `confirm_date_of_birth`, `verify_phone_number`, `add_tax_identity_last4`, `confirm_home_address`, `add_profile_photo`, `add_emergency_contact`, `sms_opt_in`, `re_enable_sms_notifications`.

**Job-requirement IDs (addendum):** `assignment_confirmation_required`, `complete_tempworks_onboarding`, `background_check_action_required`, `background_check_issue_requires_action`, `drug_screen_schedule_required`, `drug_screen_reschedule_required`, `everify_action_required`, `worker_ai_prescreen_interview`, `worker_ai_prescreen_complete_profile`.

**Not on home dashboard (PDF initial list):** work authorization card, resume upload card.

---

## 1. Profile gates (Section 1 — applies to profile slice only)

1. **DOB:** If DOB missing, unparseable, or age &lt; 18 → profile slice is **only** `confirm_date_of_birth` (other **profile** rows suppressed).
2. **Phone:** Else if US phone not 10 digits or `phoneVerified !== true` → profile slice is **only** `verify_phone_number`.
3. **Else:** Build full profile list: `add_tax_identity_last4` → `confirm_home_address` → `add_profile_photo` → `add_emergency_contact` → SMS (one of re-enable / opt-in), ordered by tier (**important** → **recommended** → **snoozable**).

**Assignment confirmation is not blocked by profile gates** (addendum). Final list merges job + profile then sorts by global score (§5).

---

## 2. Global merge + max 3 (addendum)

Sort all candidates by **priority score** (higher first), then take **3**.

**Scores (highest → lowest):**  
920 `assignment_confirmation_required` → 900 `everify_action_required` → 880 `drug_screen_reschedule_required` → 860 `background_check_issue_requires_action` → 800 `complete_tempworks_onboarding` → 720 `background_check_action_required` → 700 `drug_screen_schedule_required` → 650 `confirm_date_of_birth` → 640 `verify_phone_number` → 610 / 600 profile important → 590 re-enable SMS → **550 `worker_ai_prescreen_interview` → 545 `worker_ai_prescreen_complete_profile`** → 400 / 390 recommended → 100 `sms_opt_in`.

---

## 3. Job requirement rules (addendum summary)

### Assignment confirmation

- **Show** when `tenants/{tenantId}/assignments/{id}` has `status` in `proposed` | `pending` | `offered` | `pending_confirmation` and no `confirmedAt` / `declinedAt`.
- **Primary:** `respondToAssignment` callable `decision: 'accept'`. **Secondary:** `decision: 'decline'`.
- Earliest `startDate` assignment wins if multiple.

### TempWorks (`users/{uid}.onboarding`)

- **Required:** `onboarding.tempworksOnboardingRequired === true`.
- **Verified (hide card):** `onboarding.tempworksRecruiterVerified === true` OR `onboarding.tempworksVerified === true`.
- **Started:** `onboarding.tempworksStartedAt` set (timestamp / string).
- **URL:** `onboarding.tempworksOnboardingUrl` (optional).
- **On primary click:** set `onboarding.tempworksStartedAt = serverTimestamp()` then open URL (or navigate to profile if no URL).
- **Copy:** not-started vs submitted (under review) use different i18n keys.

### Compliance (explicit signals only)

- **Background applicant:** AccuSource partial-profile nudge — **`shouldShowApplicantPortalCta`** from `backgroundCheckApplicantPortal.ts` (same gate as recruiter “Open / Copy” on User → Backgrounds). Roughly `hrxStatus === 'awaiting_applicant'` plus a portal URL, and **not** already advanced (`orderCompleted` / `finalReportReady` / terminal `hrxStatus`, etc.). Drug-line `awaiting_applicant` still maps to drug schedule, not this card.
- **Background issue:** `hrxStatus === 'error'`.
- **Drug schedule / reschedule:** drug-related `lastServiceComponent` / `providerServiceOrderStatus` lines + status substring rules in `deriveWorkerComplianceSignals` (conservative).
- **E-Verify worker action:** `everify_cases.status` in `tnc` | `further_action_required`.

Dashboard loads `backgroundChecks` with `candidateId == uid`, `tenantId == tenantId`, and `everify_cases` for `userId == uid`. Query failures fall back to empty compliance flags (assignments + TempWorks still apply).

### AI pre-screen (delayed SMS reminder follow-up)

Server-side scheduling and SMS are documented in `AI_PRESCREEN_IMPLEMENTATION_PLAN.md`. Dashboard cards are **client-derived** from application docs + `users/{uid}/interviews`.

- **Data:** applications where `userId == uid` or `candidateId == uid` (same queries as the pre-screen nav signal hook). Each application may carry `workerAiPrescreenReminderSentAt`, `workerAiPrescreenReminderLastOutcome` (`eligible_invite` | `ineligible_nudge`).
- **`worker_ai_prescreen_interview` (550):** application `status === 'submitted'`, reminder **sent**, `lastOutcome === 'eligible_invite'`, and **no** completed worker AI pre-screen interview for that `applicationId` (`users/{uid}/interviews` with `interviewKind === 'worker_ai_prescreen'` and matching `applicationId`). **Primary:** navigate to `/c1/workers/prescreen?applicationId=…`.
- **`worker_ai_prescreen_complete_profile` (545):** same except `lastOutcome === 'ineligible_nudge'`. **Primary:** navigate to `/c1/workers/profile`.
- **Tie-break:** if multiple applications qualify, the **oldest by `workerAiPrescreenReminderSentAt`** wins (v1 surfaces one card).
- **Hide:** when a qualifying interview row exists for that `applicationId`, or the application is not `submitted`, or the reminder was never sent, or outcome is not one of the two above.

---

## 4. Dismissals / snooze

- **Firestore:** `workerProfile.dashboard.dismissedActionItems.{add_profile_photo|add_emergency_contact}`.
- **Local snooze:** `worker_sms_warning_dismiss_until_${uid}` — **`sms_opt_in` only**.

---

## 5. Dev logging

`NODE_ENV !== 'production'`: `console.debug('[WorkerDashboardActionItems]', …)`.
