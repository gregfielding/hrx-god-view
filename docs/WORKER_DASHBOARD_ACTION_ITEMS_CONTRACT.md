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

---

## 6. V2 — server-written snapshot

**Status:** Phased rollout behind `REACT_APP_WORKER_DASHBOARD_ACTION_ITEMS_V2`.

The same logic — gates, score table, dedupe — has migrated server-side to
mirror the per-assignment readiness pattern at
`tenants/{tenantId}/assignments/{id}.readinessSnapshotV1`. Adding a new
action-item ID is a backend-only change; web and Flutter just render
whatever's in the snapshot.

### 6.1 Where it's persisted

| Field | Path |
|------|------|
| Snapshot | `users/{uid}.workerDashboardActionItemsV1` |

Shape: see `WorkerDashboardActionItemsSnapshotV1` in `src/shared/workerDashboardActionItemsV1.ts` (web) and `functions/src/readiness/workerDashboardActionItemsTypes.ts` (server). The `items` field is the **full** sorted list — clients slice 3 for the home card and may render the rest on a "View all" page without an extra read.

### 6.2 Server modules

| Area | Path |
|------|------|
| Pure model | `functions/src/readiness/workerDashboardActionItemsModel.ts` |
| Firestore loader (admin SDK) | `functions/src/readiness/workerDashboardActionItemsLoadContext.ts` |
| Idempotent recompute | `functions/src/readiness/workerDashboardActionItemsRecompute.ts` |
| 6 triggers + 1 callable | `functions/src/readiness/workerDashboardActionItemsTriggers.ts` |
| Parity tests | `functions/src/__tests__/readiness/workerDashboardActionItemsModel.test.ts` |

### 6.3 Triggers

All triggers are `onDocumentWritten`, region `us-central1`, no retry, capped at 5 instances. Each is gated on a narrow "what changed" fingerprint so unrelated writes don't recompute.

| Trigger | Document | When it fires |
|---|---|---|
| `syncWorkerDashboardActionItemsOnUserWrite` | `users/{uid}` | Predicate-input fields changed (DOB, phone, address, last4SSN, photo, emergencyContact, smsOptIn, smsBlockedSystem, smsSystemUnavailable, `notificationSettings.smsUnavailable`, `workerProfile.dashboard.dismissedActionItems`, `onboarding.tempworks*`, `workEligibilityAttestation`). Gated on `isC1WorkerScope(after)`. |
| `syncWorkerDashboardActionItemsOnAssignmentWrite` | `tenants/{tid}/assignments/{id}` | `status`, `confirmedAt`, `declinedAt`, `startDate`, `startTime` changed. Recomputes for `userId` on the doc. |
| `syncWorkerDashboardActionItemsOnBackgroundCheckWrite` | `backgroundChecks/{id}` | `hrxStatus` / `requestedPackageName` / `lastServiceComponent.{status,serviceName}` / `orderCompleted` / `finalReportReady` / applicant portal URL changed. Recomputes for `candidateId` + `tenantId` on the doc. |
| `syncWorkerDashboardActionItemsOnEverifyCaseWrite` | `tenants/{tid}/everify_cases/{id}` | `status` changed. Recomputes for `userId`. |
| `syncWorkerDashboardActionItemsOnApplicationWrite` | `tenants/{tid}/applications/{id}` | `workerAiPrescreenReminderSentAt` / `workerAiPrescreenReminderLastOutcome` changed. Recomputes for `userId` (or `candidateId`). |
| `syncWorkerDashboardActionItemsOnInterviewWrite` | `users/{uid}/interviews/{id}` | Any write where `interviewKind === 'worker_ai_prescreen'`. |

Plus a recruiter-facing callable `syncWorkerDashboardActionItemsV1({ uid, tenantId })` for explicit force-refresh and tests. Permission gate matches `syncHrxReadinessSnapshotV1` (HRX, tenant role Recruiter/Manager/Admin, recruiter flag, or security level ≥ 4); workers may refresh their own snapshot.

### 6.4 Idempotency

`recomputeWorkerDashboardActionItemsForUser` computes a stable `inputsHash` (canonical JSON + djb2) from the input bag the model reads. If the hash matches what's already on the user doc, the write is skipped. Existing-hash → next-snapshot re-rendering should be effectively free.

### 6.5 Tenant scoping

Today the worker home is single-tenant. The recompute resolver picks (in order): `userDoc.activeTenantId` → `userDoc.tenantId` → `C1_TENANT_ID` (`BCiP2bQ9CgVOCTfV6MhD`). Workers with multiple tenants in `tenantIds[]` still get a single snapshot under the resolved tenant. If/when we need per-tenant snapshots, the brief proposes `users/{uid}.workerDashboardActionItemsV1.byTenant.{tid}` — discuss with Greg before implementing.

### 6.6 What stays client-only

- **SMS snooze.** `worker_sms_warning_dismiss_until_{uid}` localStorage key — per-device. Clients filter `sms_opt_in` from the snapshot when their local snooze is active.
- **3-cap.** `WORKER_DASHBOARD_ACTION_ITEMS_HOME_CAP` (3) is applied at render time so a future "View all" surface doesn't need an extra read.
- **i18n strings.** Snapshot stores i18n KEYS; clients localize.

### 6.7 JSON key contract (cross-platform)

The Firestore field keys below are part of the contract — clients can rename their parser fields freely (e.g. Dart can call this `tier`), but the **map keys read off `users/{uid}.workerDashboardActionItemsV1.items[i]` must match exactly**:

| JSON key | Type / Enum | Notes |
|---|---|---|
| `id` | `WorkerDashboardActionItemId` | One of the 17 IDs in §3 / `src/shared/workerDashboardActionItemsV1.ts`. |
| `category` | `'blocking' \| 'important' \| 'recommended' \| 'snoozable'` | Priority tier. **Key is `category`, not `tier` / `priority`.** Flutter parser must `map['category']`. |
| `titleKey`, `descriptionKey`, `primaryLabelKey`, `secondaryLabelKey` | string (i18n key) | Localize on the client. |
| `primaryKind` | `'navigate' \| 'enable_sms' \| 'assignment_accept' \| 'tempworks_open'` | |
| `secondaryKind` | `'dismiss_firestore' \| 'snooze_sms' \| 'assignment_decline'` | Optional. |
| `href` | string | Web route. Flutter maps to its equivalent via `app_routes.dart`. Optional (some items have no link, e.g. SMS opt-in). |
| `priorityScore` | number | Server-applied from §2 score table. Higher wins. |
| `sourceReason` | string | **Diagnostics only — never render to the worker.** |
| `qaEvaluatedFields` | map | **Diagnostics only — never render to the worker.** |

Top-level snapshot keys:

| JSON key | Type | Notes |
|---|---|---|
| `sourceVersion` | number (1) | Bump on shape change. |
| `items` | array | Full sorted list (highest `priorityScore` first). Clients slice the home cap (3). |
| `inputsHash` | string | djb2 of the canonical input bag — for change detection only. Don't render. |
| `updatedAt` | Firestore Timestamp | Web reads via `.toDate()`. |

### 6.8 Operations folklore (recurring confusions worth pinning)

- **"100% of C1 workers are gated on `confirm_date_of_birth`" is not a bug — it's CRM shell records.** When you scan `users` filtered by `tenantId == BCiP2bQ9CgVOCTfV6MhD` (or `activeTenantId == ...`), a large fraction of the docs are 20-character Firestore-auto-IDs (`00B1aKvp5iOGSVglIhNv`-shape) without a `dob`/`dateOfBirth`/`phone`/onboarding fields. Those are CRM-imported leads that exist in `users` but never went through Firebase Auth or onboarding. The DOB gate fires on them with `qa.reason === 'missing'`, surfacing only `confirm_date_of_birth` (score 650). Real authenticated workers have 28-character Auth UIDs (`TWXMM1mOJHepmk80Qsx128w9AiS2`-shape) and a populated `dob`. Before suspecting the DOB predicate, partition the histogram by "has a `dob` field" — see `.scratch/inspectWorkerDashboardActionItemsV1.js` and `.scratch/debugDobShape.js` (both gitignored, regenerable). The 2026-05-08 V2 backfill saw ~60% of all docs in the DOB-gated bucket purely because of this shell population.
- **Phone gate must never swallow job items.** Tests in `case 7` of `workerDashboardActionItemsModel.test.ts` pin this against a synthetic fixture matching the production-observed shape. If you change the gate code, those tests are the canary.
- **`updatedAt` shape mismatch during local backfill.** If a one-off Node script that writes `workerDashboardActionItemsV1` errors with `Couldn't serialize object of type "ServerTimestampTransform"`, the script and the recompute helper are using different `firebase-admin` major versions (root `node_modules` vs `functions/node_modules`). Force the script to load admin from `functions/node_modules/firebase-admin` — see the existing `.scratch/backfillWorkerDashboardActionItemsV1.js` for the pattern.

### 6.9 Web rollout

Hook: `useWorkerDashboardActionItemsV1` in `src/hooks/useWorkerDashboardActionItemsV1.ts`. Behind `REACT_APP_WORKER_DASHBOARD_ACTION_ITEMS_V2 === 'true'` the dashboard reads the snapshot; otherwise (or when the snapshot hasn't been computed yet for that worker) the page falls back to the legacy in-memory builder.

The legacy builder (`src/utils/workerDashboardActionItems.ts`) and its dependencies stay in the tree for one release after V2 ships. After two weeks of stable telemetry, delete the file and its unit tests. Flutter does not depend on the legacy builder or the V1→legacy adapter — both are web-internal — so this cleanup can ship independently of the Flutter V2 cutover.
