# Worker dashboard action items — portable contract (Profile + job requirements)

**Canonical product spec:** *Worker Action Items Architecture* (PDF) — profile gates, ordering, max **3** visible cards, SMS split; **plus** production addendum (TempWorks, compliance, assignment confirmation).

**Web implementation**

| Area | Path |
|------|------|
| Profile fact evaluators | `src/utils/workerProfileActionItemFacts.ts` |
| Compliance signal derivation | `src/utils/workerComplianceActionDerivers.ts` |
| Job signals (assignments, TempWorks fields) | `src/utils/workerJobRequirementSignals.ts` |
| Builder (merge global priority → cap 3) | `src/utils/workerDashboardActionItems.ts` |
| Firestore dismissals | `src/utils/workerDashboardDismissals.ts` |
| SMS context | `src/utils/workerSmsAlertsContext.ts` |
| Profile photo | `src/utils/workerProfilePrerequisites.ts` → `userDocHasProfilePhoto` |
| UI | `src/components/worker/home/WorkerDashboardActionItems.tsx` |
| Dashboard data load | `src/pages/c1/workers/dashboard.tsx` |
| i18n | `public/i18n/locales/en.json`, `es.json` → `dashboard.actionItems.*` |

**Profile IDs:** `confirm_date_of_birth`, `verify_phone_number`, `add_tax_identity_last4`, `confirm_home_address`, `add_profile_photo`, `add_emergency_contact`, `sms_opt_in`, `re_enable_sms_notifications`.

**Job-requirement IDs (addendum):** `assignment_confirmation_required`, `complete_tempworks_onboarding`, `background_check_action_required`, `background_check_issue_requires_action`, `drug_screen_schedule_required`, `drug_screen_reschedule_required`, `everify_action_required`.

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
920 `assignment_confirmation_required` → 900 `everify_action_required` → 880 `drug_screen_reschedule_required` → 860 `background_check_issue_requires_action` → 800 `complete_tempworks_onboarding` → 720 `background_check_action_required` → 700 `drug_screen_schedule_required` → 650 `confirm_date_of_birth` → 640 `verify_phone_number` → 610 / 600 profile important → 590 re-enable SMS → 400 / 390 recommended → 100 `sms_opt_in`.

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

- **Background applicant:** `backgroundChecks` row `hrxStatus === 'awaiting_applicant'` (and not `error` on that row).
- **Background issue:** `hrxStatus === 'error'`.
- **Drug schedule / reschedule:** drug-related `lastServiceComponent` / `providerServiceOrderStatus` lines + status substring rules in `deriveWorkerComplianceSignals` (conservative).
- **E-Verify worker action:** `everify_cases.status` in `tnc` | `further_action_required`.

Dashboard loads `backgroundChecks` with `candidateId == uid`, `tenantId == tenantId`, and `everify_cases` for `userId == uid`. Query failures fall back to empty compliance flags (assignments + TempWorks still apply).

---

## 4. Dismissals / snooze

- **Firestore:** `workerProfile.dashboard.dismissedActionItems.{add_profile_photo|add_emergency_contact}`.
- **Local snooze:** `worker_sms_warning_dismiss_until_${uid}` — **`sms_opt_in` only**.

---

## 5. Dev logging

`NODE_ENV !== 'production'`: `console.debug('[WorkerDashboardActionItems]', …)`.
