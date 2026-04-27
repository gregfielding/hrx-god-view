# E-Verify implementation summary

This document describes how **E-Verify is implemented in HRX today** (Cloud Functions, Firestore, admin UI, and supporting flows). It is meant as a **working summary** for engineering and ops. For deploy/env details and stage fixtures, see also [`functions/src/integrations/everify/README.md`](../functions/src/integrations/everify/README.md). Product-level design history lives in `HRX-EVerify-Master-Plan.md` and `HRX-EVerify-Done-For-Now-Master-Closeout.md` at repo root.

**Assumption:** If `EVERIFY_ENABLED=true`, secrets are set, the Cloud Tasks queue exists, and cases appear under `tenants/{tenantId}/everify_cases` with statuses updating over time, the integration is **operational** for the configured environment (stage vs prod). If the gate is off, all E-Verify exports are **stubs** that reject or no-op.

### Product / UX alignment (C1)

E-Verify is **not** a separate parallel onboarding subsystem for every hiring entity. In C1:

- **C1 Select LLC** — E-Verify is a **native, blocking part of Select onboarding** under **Work authorization** together with I-9. **100%** of Select workers are expected to complete this track when applicable.
- **C1 Workforce LLC** and **C1 Events LLC** — **No E-Verify** in the worker or entity-employment UX; progress and readiness **must not** treat E-Verify as required for those entities.

**Storage is unchanged:** `user_employments` and `everify_cases` remain the **system-of-record / detail** for case creation, webhooks, and ops. **Presentation:** surface case and I-9 employment context **inside Select employment** (see [`CANONICAL_ONBOARDING_STEP_MATRIX.md`](./CANONICAL_ONBOARDING_STEP_MATRIX.md)). Configure **`entities.everifyRequired: true`** only on Select entity documents so eligibility matches product.

---

## 1. Feature gate and exports

All E-Verify Cloud Functions are **lazy-loaded** only when `EVERIFY_ENABLED=true` at deploy/runtime. Implementation: [`functions/src/integrations/everifyGate.ts`](../functions/src/integrations/everifyGate.ts).

- When disabled: callables throw `failed-precondition` with a clear message; Firestore triggers are no-ops; the HTTP worker returns `503`.
- When enabled: the gate re-exports the real module from [`functions/src/integrations/everify/index.ts`](../functions/src/integrations/everify/index.ts).

**Root `functions/src/index.ts`** wires these names (among others): `everifyCreateCase`, `everifyCheckEligibility`, `everifyPingAuth`, `everifyDryRunCreateAndSubmit`, `everifyListCases`, `everifyRetryCase`, `everifyExceptionAction`, `everifyMarkEmployeeNotified`, `everifyMarkContested`, `everifyMarkReferralInitiated`, `everifyCloseCaseManual`, `everifySoapCreateCase`, `onUserEmploymentUpdatedEverify`, `onEverifyCaseUpdatedSyncOnboarding`, `processEverifyCaseFromEmployment`, `scheduledEverifyPoller`.

---

## 2. Data model (Firestore)

Paths also appear in [`src/data/firestorePaths.ts`](../src/data/firestorePaths.ts) (`everifyCases`, `everifyCase`, `everifyCasesPublic`, …).

### 2.1 `tenants/{tenantId}/everify_cases/{caseId}`

Canonical case document for recruiters/admins. Shape is defined in [`functions/src/integrations/everify/everifySchemas.ts`](../functions/src/integrations/everify/everifySchemas.ts) (`EverifyCase`), including:

- Links: `tenantId`, `entityId`, `userId`, `jobOrderId`, `shiftId`, `assignmentId`, `userEmploymentId`, optional `onboardingInstanceId`
- `environment`: `stage` | `prod`
- `status`: normalized HRX enum (`draft`, `ready`, `submitted`, `pending`, `employment_authorized`, `tnc`, `dhs_verification_in_process`, `further_action_required`, `final_nonconfirmation`, `closed`, `error`, …)
- `everifyCaseNumber`, `everifyCompanyId`, `providerStatus`, timestamps, `requestHash`, optional `raw` / `error`, TNC workflow (`everifyCaseActions`), worker-facing summary blob (`public`)

**Subcollection:** `events/{eventId}` — append-only-style audit (`EverifyCaseEvent`, types like `CASE_CREATED`, `STATUS_CHANGED`, TNC-related events).

### 2.2 `tenants/{tenantId}/everify_cases_public/{caseId}`

Trimmed mirror for **worker-safe** reads. Maintained by backend (e.g. `upsertEverifyCasePublicMirror` in `everifyService`). Firestore rules allow the worker to read when `resource.data.userId == request.auth.uid`.

### 2.3 `tenants/{tenantId}/user_employments/{employmentId}`

**Not** an E-Verify collection, but **eligibility and automation** depend on it:

- `i9Status` must be **`completed`** (lowercase) for eligibility and for the **auto-enqueue** trigger (see §4).
- Other fields (e.g. `userId`, `entityId`, `workerType`, `startDate`, `currentAssignmentId`) participate in `resolveEligibility` ([`everifyEligibility.ts`](../functions/src/integrations/everify/everifyEligibility.ts)).

### 2.4 Entity configuration

[`everifyEligibility.ts`](../functions/src/integrations/everify/everifyEligibility.ts) loads `tenants/{tenantId}/entities/{entityId}` and requires:

- `everifyRequired === true` (otherwise case creation is blocked with `ENTITY_EVERIFY_DISABLED`)
- `everifyCompanyId` (or fallback to `entityCode` or entity id) for the employer identifier sent to USCIS

Worker type for W-2 vs 1099 is taken from `user_employments.workerType` or `entities.workerType`; **E-Verify applies only to W-2** in this resolver.

---

## 3. Eligibility (server)

Implemented in [`functions/src/integrations/everify/everifyEligibility.ts`](../functions/src/integrations/everify/everifyEligibility.ts). Summary of **typical** requirements:

| Requirement | Notes |
|-------------|--------|
| Tenant + resolvable `entityId` | From input, `user_employments`, assignment, or job order |
| Entity exists and `everifyRequired` | Hard gate |
| W-2 | 1099 workers are not eligible |
| `user_employments.i9Status === 'completed'` | Same field used across onboarding and E-Verify UI copy |
| Assignment status (when assignment path is used) | `active`, `confirmed`, `hired`, or `placed` (see `ASSIGNMENT_ELIGIBLE_STATUSES`) |
| Start date | Required on the resolved employment/assignment path |
| `userId` | Required |

The function also computes a **`requestHash`** for idempotent duplicate detection (used before creating a new case).

---

## 4. Automated path: I-9 complete → Cloud Task → HTTP worker

1. **Trigger:** [`onUserEmploymentUpdatedEverify`](../functions/src/integrations/everify/everifyTriggers.ts) on `tenants/{tenantId}/user_employments/{employmentId}` **update**.
2. **Condition:** `i9Status` transitions **to** `completed` (was not completed before).
3. **Action:** `enqueueEverifyTask(tenantId, userEmploymentId)` creates a **Cloud Tasks** task (queue name from config, default `everify`; see `getEverifyQueueName` / `EVERIFY_QUEUE` in [`everifyConfig.ts`](../functions/src/integrations/everify/everifyConfig.ts)).
4. **Worker:** HTTP function [`processEverifyCaseFromEmployment`](../functions/src/integrations/everify/everifyHttpWorker.ts) (`POST`, invoker private). Body: `{ tenantId, userEmploymentId }`. It runs `resolveEligibility`, dedupes open cases / `requestHash`, then calls `createAndSubmitCase` with ICA credentials from Secret Manager.

**Emulator:** enqueue is **skipped** when Firebase emulators are detected (log only).

**Queue setup:** Documented in the integration README (`gcloud tasks queues create everify …`).

---

## 5. Manual / admin path: HTTPS callables

Primary implementation: [`functions/src/integrations/everify/everifyCallables.ts`](../functions/src/integrations/everify/everifyCallables.ts).

- **`everifyCheckEligibility`** — Validates eligibility and returns blocking reasons (used by UI before create).
- **`everifyCreateCase`** — Authenticated recruiter/manager/admin (or HRX); Zod-validated input (`EverifyCreateCaseInput`); runs `resolveEligibility`; prevents duplicate **open** cases; calls `createAndSubmitCase` with optional `i9Employee` payload from the client for REST submission.
- **`everifyRetryCase`** — Retry flow (also used from compliance UI).
- **Ops / TNC / exceptions:** `everifyExceptionAction`, `everifyMarkEmployeeNotified`, `everifyMarkContested`, `everifyMarkReferralInitiated`, `everifyCloseCaseManual`, etc.
- **Diagnostics:** `everifyPingAuth`, `everifyDryRunCreateAndSubmit`, `everifyListCases`.
- **Alternate ICA path:** `everifySoapCreateCase` — SOAP create (see README; REST remains the main product path).

**Auth to USCIS:** Web Services username/password via Firebase secrets [`EVERIFY_WS_USERNAME` / `EVERIFY_WS_PASSWORD`](../functions/src/integrations/everify/everifySecrets.ts) (never log).

**REST client / adapter:** [`everifyRestClient.ts`](../functions/src/integrations/everify/everifyRestClient.ts), [`everifyAdapter.ts`](../functions/src/integrations/everify/everifyAdapter.ts), token/login in [`everifyAuth.ts`](../functions/src/integrations/everify/everifyAuth.ts).

**I-9 employee payload:** Server merges document data from the callable with provider resolution in [`everifyI9Provider.ts`](../functions/src/integrations/everify/everifyI9Provider.ts). The README documents an **env-driven fixture** (`EVERIFY_I9_FIXTURE_JSON`) for stage/dry-run; **production identity data must match the real worker** — this is a known operational caveat.

---

## 6. Status polling and TNC

- **Scheduled poller:** [`scheduledEverifyPoller`](../functions/src/integrations/everify/everifyPoller.ts) runs **hourly** (`America/New_York`). It loads open cases per tenant, calls `getCaseStatus`, maps provider status through `mapProviderStatusToHrx`, appends events, handles TNC transitions via [`everifyTncHandler.ts`](../functions/src/integrations/everify/everifyTncHandler.ts), and refreshes the public mirror.
- **Redaction:** Raw provider payloads are whitelisted via [`everifyRedaction.ts`](../functions/src/integrations/everify/everifyRedaction.ts).

---

## 7. Sync to onboarding / employment UI

When an `everify_cases` document’s **`status` field changes**, [`onEverifyCaseUpdatedSyncOnboarding`](../functions/src/integrations/everify/everifyTriggers.ts) calls **`syncEverifyStatusToPipelineAndEmployment`** in [`functions/src/onboarding/workerOnboardingPipeline.ts`](../functions/src/onboarding/workerOnboardingPipeline.ts):

- Updates the **`e_verify`** step on `tenants/{tenantId}/worker_onboarding/{userId__entityKey}` when that pipeline exists.
- Writes **`everifyStatus`** on `tenants/{tenantId}/entity_employments/{userId__entityKey}`.

`entityKey` is derived from the entity’s display name (`select` / `events` / `workforce` heuristics in the pipeline module).

---

## 8. Firestore security rules

[`firestore.rules`](../firestore.rules) (tenant-scoped):

- **`everify_cases`:** Read for HRX or tenant recruiter-style roles; write for HRX or tenant admin. `events` subcollection matches.
- **`everify_cases_public`:** Read for HRX, tenant roles, **or** the worker (`resource.data.userId == request.auth.uid`); write admin-only.

---

## 9. Admin and worker UI (web)

| Surface | Path | Role |
|--------|------|------|
| **Compliance + E-Verify table** | [`src/pages/UserProfile/components/BackgroundsComplianceTab.tsx`](../src/pages/UserProfile/components/BackgroundsComplianceTab.tsx) | Lists `everify_cases` for the profile user; **Start E-Verify** flow calls `everifyCheckEligibility` + `everifyCreateCase`; manages `user_employments` (I-9 status, employment create); retry via `everifyRetryCase`. Matches the “Active orders & compliance items” style UI. |
| **Profile E-Verify card** | [`src/pages/UserProfile/components/EverifyComplianceCard.tsx`](../src/pages/UserProfile/components/EverifyComplianceCard.tsx) | Lighter-weight case listing / context. |
| **Tenant E-Verify ops** | [`src/pages/TenantViews/EverifyAdminOpsPage.tsx`](../src/pages/TenantViews/EverifyAdminOpsPage.tsx) | Tenant-level operations UI. |
| **Company defaults** | [`src/pages/TenantViews/CompanyDefaultsTabs/EVerifyTab.tsx`](../src/pages/TenantViews/CompanyDefaultsTabs/EVerifyTab.tsx) | Entity/tenant E-Verify defaults configuration. |
| **Apply flow (comfort copy)** | [`src/components/apply/steps/EVerifyComfortStep.tsx`](../src/components/apply/steps/EVerifyComfortStep.tsx), [`EVerifyComfortChip.tsx`](../src/components/EVerifyComfortChip.tsx) | Applicant-facing messaging, not case creation. |

Callable permission for manage operations aligns with **`canManageEverify`** in `everifyCallables.ts` (tenant Recruiter/Manager/Admin or HRX claim).

---

## 10. Configuration reference (short)

| Variable / secret | Purpose |
|-------------------|---------|
| `EVERIFY_ENABLED` | Must be `true` to load real integration (see gate). |
| `EVERIFY_WS_USERNAME`, `EVERIFY_WS_PASSWORD` | Secret Manager — ICA Web Services credentials. |
| `EVERIFY_ENV` | `stage` (default) or `prod`; must match API hosts. |
| `EVERIFY_BASE_URL`, `EVERIFY_AUTH_URL` | USCIS API / token endpoints (prod values from go-live letter). |
| `EVERIFY_QUEUE`, `EVERIFY_WORKER_URL` | Cloud Tasks queue name and optional worker URL override. |
| `EVERIFY_FAKE_PROVIDER` / `EVERIFY_EAAT_STUB` | Use stub provider instead of real USCIS (testing). |
| `EVERIFY_I9_FIXTURE_JSON` | Stage/dry-run employee payload (see README — **not** per-user Firestore yet). |

---

## 11. Known limitations (for “is it working?”)

1. **Gate:** If `EVERIFY_ENABLED` is not `true`, nothing real runs — callables error with the disabled message.
2. **Queue:** Missing Cloud Tasks queue causes enqueue failures (automation after I-9 complete).
3. **I-9 identity source:** REST path may rely on **fixture env** or merged admin-supplied fields; confirm production uses **correct per-worker** I-9 data per your compliance process.
4. **Two employment models:** E-Verify eligibility is anchored on **`user_employments`**. **`entity_employments`** receives **status mirror** for onboarding UI; keep both in sync with product expectations when debugging “case exists but UI wrong.”
5. **Entity key heuristic:** Onboarding sync uses `userId__entityKey`; entity key is derived from entity **name** string — ambiguous names can mis-target the pipeline doc.

---

## 12. Quick verification checklist

1. `EVERIFY_ENABLED=true` on deployed functions; secrets present.
2. Cloud Tasks queue `everify` (or `EVERIFY_QUEUE`) exists in the functions region.
3. Test entity has `everifyRequired: true` and valid `everifyCompanyId` (or fallback).
4. `user_employments` doc: W-2, `i9Status: completed`, start date, linked user/assignment as required by `resolveEligibility`.
5. Create case (manual callable from UI or auto via I-9 transition) → document in `everify_cases` → poller updates status → `entity_employments.everifyStatus` / pipeline step update on status change.

---

*Last updated from codebase review (implementation summary). Update this file when flows or env names change.*
