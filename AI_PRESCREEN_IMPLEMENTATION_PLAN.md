# AI pre-screen — v1 implementation plan

Operational plan for **delayed outreach**, **eligibility**, **worker surfaces**, and **per-application tracking**. Reuses existing lifecycle, reminder, and dashboard patterns. Does not redesign the worker app.

**Related specs:** `AI_PRESCREEN_SCORING_AND_ELIGIBILITY.md` (scoring + conceptual eligibility), `docs/WORKER_DASHBOARD_ACTION_ITEMS_CONTRACT.md` (action items), `docs/I9_SUPPORTING_DOCUMENTS_ARCHITECTURE.md` (style reference for triggers only).

---

## 1. Worker interview eligibility helper

### 1.1 Files (parity with scoring)

| Role | Path |
|------|------|
| **Server source of truth** (scheduled job, optional callable) | `functions/src/workerAiPrescreen/evaluateWorkerAiPrescreenEligibility.ts` |
| **Client mirror** (dashboard / optional UI hints) | `src/utils/workerAiPrescreenEligibility.ts` |

Keep the **exported function and types identical** between the two (same approach as `scoreWorkerAiPrescreen` / `workerAiPrescreenScore.ts`). Add a small shared test fixture file or duplicate assertions in `src/utils/__tests__/` + `functions/src/workerAiPrescreen/__tests__/` if you want drift protection.

### 1.2 Exact input / output

**Input** (v1):

```ts
export type WorkerAiPrescreenEligibilityInput = {
  userDoc: Record<string, unknown> | null | undefined;
  /** Optional; used only if resume detection lives on application in your tenant. */
  applicationDoc?: Record<string, unknown> | null | undefined;
};

export function evaluateWorkerAiPrescreenEligibility(
  input: WorkerAiPrescreenEligibilityInput,
): WorkerAiPrescreenEligibilityResult;
```

**Output** (align with `AI_PRESCREEN_SCORING_AND_ELIGIBILITY.md` § “Eligibility Output Shape”):

```ts
export type WorkerAiPrescreenEligibilityResult = {
  eligibleForInterview: boolean;
  reason:
    | 'eligible'
    | 'missing_contact'
    | 'missing_location'
    | 'missing_experience_signal'
    | 'missing_work_auth_baseline'
    | 'incomplete_profile';
  missingFields: Array<'phone' | 'location' | 'resume_or_work_history' | 'work_authorization'>;
};
```

### 1.3 Final v1 eligibility rule (practical funnel balance)

**Intent:** Match the spirit of `AI_PRESCREEN_SCORING_AND_ELIGIBILITY.md` but **avoid over-gating** applicants who just submitted and have not verified SMS yet.

| Check | Pass condition (v1) | Notes |
|-------|---------------------|--------|
| **Contact** | Same as “usable phone” for SMS triggers: `phoneE164` **or** normalizable US `phone` (10 digits) — **do not** require `phoneVerified === true` for invite eligibility. | Dashboard may still show `verify_phone_number`; pre-screen invite should not wait on verification. |
| **Location** | Reuse **`isWorkerHomeAddressComplete`** from `src/utils/workerProfileActionItemFacts.ts` (and the same logic server-side, either duplicated or imported from a tiny shared helper copied into functions). | One coherent definition with profile “confirm home address”. |
| **Experience signal** | **Either** a resume pointer on the user profile your app already uses (e.g. storage path / resume metadata field — use the same field the profile UI uses), **or** at least one employment history entry with non-empty employer **or** job title (reuse whatever structure `UserProfile` / employment v2 already reads). | If neither field exists in data, fail open to “experience unknown” only when both are genuinely absent; prefer lenient OR. |
| **Work authorization baseline** | `userDoc.workAuthorization === true` **or** a non-empty explicit work-auth field if your canonical model uses `workAuth` / similar string enum (treat “unset” as fail). | Aligns with assignment readiness “work authorization” concept in `shared/buildAssignmentReadiness.ts` without pulling the whole graph into v1. |

**Recommendation:** If **location** OR **experience** is missing, set `eligibleForInterview: false` with the corresponding `missingFields` entry, but **still run the ~1h delayed job** and send the **profile-completion nudge** (see §2), not silence. Only skip scheduling when it would be meaningless (e.g. no `userId` on application).

This keeps **conversion** reasonable: phone is not blocked on verification; work auth is a single boolean/enum gate; location matches an existing product rule.

---

## 2. Delayed outreach flow

### 2.1 Trigger source — application becomes `submitted`

**Canonical hook:** Firestore **`onDocumentUpdated`** on  
`tenants/{tenantId}/applications/{applicationId}`  
when **`after.status === 'submitted'`** and transition is real (e.g. `before.status !== 'submitted'` or first write — mirror guards used in `functions/src/applicationSmsTriggers.ts` `onApplicationStatusChanged`).

**Implementation style:** Add a **dedicated function** in a new module (e.g. `functions/src/workerAiPrescreen/scheduleWorkerAiPrescreenReminder.ts`) and **invoke it from the existing** `onApplicationStatusChanged` handler **early** (after validation, before heavy SMS work), **or** register a second trigger on the same path. Prefer **single trigger file** + internal helper call to avoid duplicate cold starts and double reads — e.g. `applicationSmsTriggers.ts` calls `maybeScheduleWorkerAiPrescreenReminder({ tenantId, applicationId, before, after })`.

**Do not** change when application “thanks” SMS fires; pre-screen scheduling is orthogonal.

### 2.2 Scheduled processor pattern (mirror `applyWizardReminder`)

**Reference:** `functions/src/applyWizardReminder.ts`

- **`onUserCreatedScheduleApplyWizardReminder`:** `onDocumentCreated` sets `applyWizardReminderDueAt` when pending flag is set.  
- **Pre-screen analogue:** On transition to `submitted`, **write scheduling fields on the application doc** in the same transaction or immediately after eligibility is not needed for *scheduling* — schedule everyone, then **branch on eligibility inside the processor** when the job runs (simpler than re-running eligibility on write).

**Processor:** new scheduled function e.g. `processWorkerAiPrescreenReminders` using `onSchedule` from `firebase-functions/v2/scheduler` with **`every 10 minutes`** (same cadence as apply wizard).

**Query:** `collectionGroup('applications')` with:

- `workerAiPrescreenReminderPending == true`
- `workerAiPrescreenReminderDueAt <= now`
- `status == 'submitted'` (optional safety filter)

**Limit:** batch size ~50–75 per run (same order of magnitude as apply wizard).

**Index:** add a **composite** `COLLECTION_GROUP` index on `applications`:

- `workerAiPrescreenReminderPending` (ASC)
- `workerAiPrescreenReminderDueAt` (ASC)

(Plus `tenantId` ASC if you filter by tenant in v2; v1 can rely on group query + limit.)

### 2.3 Firestore fields on the application doc (queue)

All on **`tenants/{tenantId}/applications/{applicationId}`**:

| Field | Type | Purpose |
|-------|------|---------|
| `workerAiPrescreenReminderPending` | `boolean` | Queue membership; set `true` when scheduling; cleared when processed or aborted. |
| `workerAiPrescreenReminderDueAt` | `Timestamp` | `now + 1h` at schedule time (same delay as spec / apply wizard pattern). |
| `workerAiPrescreenReminderSentAt` | `Timestamp` \| absent | Set when SMS (and/or in-app notification) successfully dispatched; idempotency helper. |
| `workerAiPrescreenReminderLastOutcome` | `'eligible_invite' \| 'ineligible_nudge' \| 'skipped' \| 'error'` \| absent | Debugging / analytics; optional but small. |
| `workerAiPrescreenReminderLastError` | `string` \| absent | Same pattern as `applyWizardReminderLastError`. |

**Optional deferral** (only if needed): `workerAiPrescreenReminderDeferrals` + short defer when phone missing — mirror `applyWizardReminder` deferral; otherwise skip SMS and set `skipped` with one retry next day (v1 can **skip deferral** and only send when phone exists).

### 2.4 Dedupe behavior

1. **Schedule-time:** Only set `workerAiPrescreenReminderPending` and `workerAiPrescreenReminderDueAt` if not already scheduled for this application wave — e.g. if `workerAiPrescreenReminderSentAt` already set, no-op. If application is re-submitted later, product decision: **one invite per application id** is enough for v1 (do not reset sent flags on re-submit unless product asks).

2. **Send-time:** Use **`markLifecycleEventIfFirst`** from `functions/src/messaging/lifecycleDedupe.ts` with a stable key, e.g.  
   `dedupeKey: \`worker_ai_prescreen_reminder__${tenantId}__${applicationId}\``  
   `eventType: 'worker_ai_prescreen_reminder_sent'`  
   so retries / duplicate scheduler ticks do not double-send.

3. **After successful send:** `workerAiPrescreenReminderPending = false`, set `workerAiPrescreenReminderSentAt`, clear transient error fields.

4. **Completion:** Sending the invite does **not** mean pre-screen is done; completion is derived separately (§4).

---

## 3. Worker entry surfaces

### 3.1 Dashboard action item

**Contract:** Extend `docs/WORKER_DASHBOARD_ACTION_ITEMS_CONTRACT.md` in the same PR as code.

**Implementation:**

- New id: **`complete_ai_prescreen`** (or `worker_ai_prescreen_pending` — pick one and keep stable).
- **Files:** `src/utils/workerDashboardActionItems.ts`, `src/utils/workerProfileActionItemFacts.ts` (only if facts are shared), `src/components/worker/home/WorkerDashboardActionItems.tsx`, `public/i18n/locales/en.json` + `es.json` under `dashboard.actionItems.*`.
- **Show when:** Worker has at least one application (for active tenant) with `status === 'submitted'`, `workerAiPrescreenReminderSentAt` set, **no** completed pre-screen for that `applicationId` (§4), and optional tenant feature flag on.
- **Primary action:** `navigate` to  
  **`/c1/workers/prescreen?applicationId=<applicationId>`**  
  (already supported by `WorkerAiPrescreenPage.tsx` via `useSearchParams`.)
- **Priority score:** Place **below** assignment / compliance emergencies, **above** snoozable profile polish — e.g. **~550** (between phone/address gates and photo). Tune after QA.

### 3.2 Direct pre-screen deep link

**Already implemented:** `C1_WORKER_AI_PRESCREEN_PATH` + query param `applicationId`.

**Outreach (SMS / email):** Build URL with `applicationId` and use existing worker URL helpers pattern (`buildApplyWizardResumeUrl` in `functions/src/utils/workerUrls.ts` — add sibling **`buildWorkerAiPrescreenUrl({ applicationId })`** returning absolute URL for Twilio).

### 3.3 Optional application badge

**Where:** Worker applications list (route `/c1/workers/applications` — locate table/card component in `src/pages/c1/workers/`).

**Rule:** If that application has invite sent and no completed pre-screen for that id, show chip **“Pre-screen”** / i18n `nav.prescreen` (existing key). **Optional** in v1 — ship if low effort.

### 3.4 WorkerNav — final decision (v1)

**Decision: gate, do not remove.**

- **Keep** `nav.prescreen` in `src/components/worker/WorkerNav.tsx` so workers who bookmark the flow are not stranded.
- **Gate visibility** with a single boolean: e.g. `activeTenant.workerAiPrescreenNavEnabled === true` **OR** user has a pending prescreen action (same predicate as dashboard card). Hide when tenant disables feature **and** user has nothing pending.
- Avoid hard removal: reduces support burden and preserves deep links from SMS.

---

## 4. Storage / completion tracking

### 4.1 Pending vs complete (per application)

| State | Definition (v1) |
|-------|------------------|
| **Not scheduled** | `workerAiPrescreenReminderPending !== true` and no `workerAiPrescreenReminderSentAt`. |
| **Pending (queued)** | `workerAiPrescreenReminderPending === true` and `workerAiPrescreenReminderDueAt > now`. |
| **Invite sent / action requested** | `workerAiPrescreenReminderSentAt` set and reminder pending cleared. |
| **Complete** | At least one doc in `users/{uid}/interviews` with `interviewKind === 'worker_ai_prescreen'` and **`applicationId` === this application’s id**. |

### 4.2 Smallest additional fields

- **Queue:** fields in §2.3 on the application (unavoidable for the scheduled query pattern).
- **Completion:** **No new field required** if every submit path passes `applicationId` into `submitWorkerAiPrescreenInterview` (callable already accepts `applicationId` and stores it on the interview — see `functions/src/workerAiPrescreen/submitWorkerAiPrescreenInterview.ts`).

**Client:** `WorkerAiPrescreenPage` already reads `applicationId` from the query string and passes it to `submitWorkerAiPrescreenInterview` (`src/pages/c1/workers/WorkerAiPrescreenPage.tsx`); keep that contract for any new entry points (SMS, dashboard).

**Edge case:** Legacy interviews without `applicationId`: treat as “completed for user” but not tied to a specific application; dashboard card should use **application-scoped** query only.

### 4.3 Optional denormalization (not v1)

`applications.workerAiPrescreenCompletedAt` — only add if recruiter lists need zero subcollection reads; defer.

---

## 5. Exact implementation order

1. **Eligibility module** — `evaluateWorkerAiPrescreenEligibility` (functions + client copy) + unit tests; no triggers yet.
2. **Application fields + Firestore index** — document shape + `firestore.indexes.json` composite for collection group query.
3. **Schedule on `submitted`** — wire into `onApplicationStatusChanged` (or sibling internal call): set `workerAiPrescreenReminderPending`, `workerAiPrescreenReminderDueAt = now + 1h`.
4. **Scheduled processor** — `processWorkerAiPrescreenReminders`: load user + application, run eligibility, send SMS via existing worker messaging (`sendWorkerMessageInternal` / orchestrator pattern used in apply wizard), include deep link; `markLifecycleEventIfFirst`; update application fields.
5. **Callable / page** — ensure `applicationId` is always submitted with prescreen completion.
6. **Dashboard action item** — builder + i18n + score; load minimal application list or denormalized flag on user (prefer querying applications by `userId` / `candidateId` for active tenant only on dashboard — reuse existing dashboard data fetch if present).
7. **WorkerNav gate** — feature flag + pending predicate.
8. **Optional** — application list badge; profile nudge copy for ineligible branch.
9. **Docs** — update `WORKER_DASHBOARD_ACTION_ITEMS_CONTRACT.md` + one-line cross-link from `AI_PRESCREEN_SCORING_AND_ELIGIBILITY.md` to this file.

---

## 6. Env / feature flags (v1)

- Reuse Twilio secrets already wired for `processApplyWizardReminders`.
- Tenant-level kill switch: recommend `tenant` document or existing feature flags pattern your app uses for worker experiments — document the exact field when implemented.

---

## 7. Explicit non-goals (v1)

- No change to `onWorkerI9SupportingDocumentExtract` or I-9 flows.
- No redesign of worker home layout beyond one action card.
- No automatic rejection of applicants based on eligibility; only **invite vs profile nudge** branching.
