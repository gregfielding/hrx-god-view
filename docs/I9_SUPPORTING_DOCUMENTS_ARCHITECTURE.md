# I-9 supporting documents — architecture (V1)

Identity and work-authorization **supporting documents** for Form I-9 (List A / B / C style uploads) are **not** owned by an assignment or a hiring entity. The same file may satisfy verification across **multiple assignments** and **multiple entities** within one tenant.

This document separates **canonical ownership** from **optional workflow context** so storage, Firestore, and product flows stay consistent.

---

## A. Canonical document ownership

**Scope:** one logical document belongs to exactly **one tenant** and **one worker (user)**.

| Dimension | Rule |
|-----------|------|
| **Tenant** | `tenantId` — required everywhere (Firestore path prefix + document fields + Storage prefix). |
| **Worker** | `userId` — Firebase Auth / `users` doc id; required. |
| **Document id** | Stable id for this upload revision family (Firestore doc id); used in Storage path. |

**Not canonical for ownership:**

- `assignmentId` — must not be required to locate or authorize the file.
- `entityId` / `entityKey` — must not appear in the **core** Storage path or be required on the document for it to exist.

**Recommended Google Cloud Storage object layout**

```text
i9_docs/{tenantId}/{userId}/{documentId}/{filename}
```

- `documentId` matches the Firestore metadata document id (or a dedicated upload id if you split metadata from binary revisions — then keep a `storagePath` or `revision` model in Firestore; the path above is the recommended default).
- `filename` is the original or sanitized client filename for debugging; content addressing can still use `documentId` as the folder key.

**Recommended Firestore collection layout** (aligned with other tenant-scoped worker artifacts, e.g. `worker_compliance_items`):

```text
tenants/{tenantId}/worker_i9_supporting_documents/{documentId}
```

Each document **must** duplicate `tenantId` and `userId` as fields for queries and security-rule-friendly indexing (`where('userId', '==', uid)`).

---

## B. Optional workflow / request context

These fields exist only to explain **why** a document was uploaded or **where** it was last used in product flows. They must **not** be required for:

- listing all I-9 supporting docs for a worker in a tenant,
- recruiter review workflows,
- reuse on a new assignment or entity.

| Field | Purpose |
|-------|---------|
| `requestedForEntityId` | Optional. Hiring entity (or internal entity doc id) for which the upload was requested when the request was entity-scoped in UI. |
| `requestedFromAssignmentId` | Optional. Assignment that triggered or framed the upload request (traceability only). |
| `lastUsedForEntityId` | Optional. Last entity context where a recruiter or system referenced this document (denormalized convenience). |
| `lastUsedAt` | Optional. Timestamp for `lastUsedForEntityId` (or last reference generally). |

Updates to “last used” should be **non-destructive** patches; they do not change canonical ownership.

---

## Firestore metadata contract

### Required fields (core record)

| Field | Type | Notes |
|-------|------|--------|
| `tenantId` | string | Must match path tenant. |
| `userId` | string | Worker uid. |
| `documentType` | string | e.g. list category / internal enum (`list_a_passport`, `list_b_dl`, …). |
| `storagePath` | string | Full Storage object path. **Empty string** until the first worker upload (no placeholder paths). |
| `status` | string | `awaiting_upload` → `pending_review` → `approved` \| `rejected` (see workflow below). |
| `uploadedAt` | timestamp \| null | When the worker uploaded; **null** until first file. |
| `reviewedAt` | timestamp \| null | When a reviewer last completed an explicit review action. |
| `reviewedBy` | string \| null | Reviewer uid or staff id. |
| `rejectionReason` | string \| null | Required when `status === 'rejected'`; otherwise null or empty. |
| `retainUntil` | timestamp \| null | Retention / compliance horizon if policy requires it. |

### Optional fields (context only)

- `requestedForEntityId`
- `requestedFromAssignmentId`
- `lastUsedForEntityId`
- `lastUsedAt`

### Optional fields (v1 workflow / UX)

- `createdByUid`, `createdAt`, `updatedAt` — set by callables / clients for audit.
- `uploadedFileName`, `uploadedContentType` — optional metadata after upload (worker update).

---

## Callable workflow (v1)

| Callable | Role |
|----------|------|
| `createWorkerI9SupportingDocumentRequest` | Staff (`canManageOnboarding`): creates metadata with `status: awaiting_upload`, `storagePath: ''`, timestamps; logs `i9_supporting_document.request_created`. **Client admin create in Firestore is disabled** — use this or Admin SDK. |
| `ensureWorkerI9SlotsForMyEmploymentRecord` | **Worker** (callable): `tenantId` + `employmentRecordId` (`entity_employments` doc id). Verifies the employment belongs to `request.auth.uid`, skips Events/1099, then idempotently creates the same List B + List C rows as pipeline auto-create (`ensureListBandCI9RowsForEntityIfEmpty`). Used from the worker entity employment I-9 card when slots are missing. |
| `reviewWorkerI9SupportingDocument` | Staff: `decision: approved \| rejected`; rejection requires `rejectionReason`. Cannot approve if `storagePath` is still empty. Logs `i9_supporting_document.review_*`. |
| `getI9SupportingDocumentSignedUrl` | Worker self or staff: fails with `failed-precondition` if no file yet. |

### System auto-creation (first `worker_onboarding` per worker + entity key)

When `ensureWorkerOnboardingPipeline` creates the pipeline doc (`created === true`), `ensureWorkerI9SupportingRequestsOnPipelineCreate` (`functions/src/onboarding/ensureWorkerI9SupportingRequestsOnPipelineCreate.ts`) runs **before** `worker_onboarding_pipeline_started` messaging:

| Rule | Detail |
|------|--------|
| **Eligibility** | Employment is **W-2** (not 1099), resolved **`entityId`** is non-empty, and pipeline I-9 applicability is **`required` or `pending`** (same semantics as `computeStepApplicability` for step `i9` in `workerOnboardingPipeline.ts`). |
| **Idempotency** | If **any** row exists in `worker_i9_supporting_documents` for this `userId` with `requestedForEntityId === entityId`, **skip** (staff may have created List A–only or custom rows). |
| **v1 default shape** | **Two** rows: List B `list_b_drivers_license` + List C `list_c_ssn_card` (aligned with `src/constants/i9SupportingDocumentUi.ts`). Same required fields as the staff callable; `createdByUid`: `system:worker_onboarding_pipeline`. |
| **Manual UI** | Employment **Request I-9 documents** remains for List A paths, recovery, and extra requests. |
| **C1 Events LLC** | Pipeline `entityKey` **`events`**: no auto-created rows, no worker entity-employment I-9 upload block, and automation context sets `i9SupportingDocumentsApplicable: false` so templates can omit I-9 copy. **C1 Select / C1 Workforce** (`select` / `workforce`) keep the flow. |

**Worker re-upload after reject:** Client updates `storagePath`, `uploadedAt`, `status: pending_review`, optional `uploadedFileName` / `uploadedContentType`, and sets `rejectionReason`, `reviewedAt`, `reviewedBy` to **null** (Firestore rules allow this only for `rejected` → `pending_review`). Prefer explicit `null` values (not `deleteField`) so rules evaluate consistently.

### First UI surfaces (v1)

- **Implemented:** `I9SupportingDocumentsSection` on **User Profile → Backgrounds & compliance** (`BackgroundsComplianceTab`), for the profile `uid` as `workerUserId`.
- **Staff** (viewer ≠ worker, HRX or tenant Recruiter/Manager/Admin or security ≥ 4 in claims): **Request upload**, **Open** (signed URL), **Approve** / **Reject**.
- **Worker** (viewer === worker): **Upload** / **Replace file**, **Open**; status chips and copy explain re-upload clearing rejection and replace-while-review behavior.

---

## Implementation pointers (this repo)

- **Path helpers:** `p.workerI9SupportingDocuments(tenantId)`, `p.workerI9SupportingDocument(tenantId, documentId)` in `src/data/firestorePaths.ts`.
- **TS shape:** `src/types/i9SupportingDocumentV1.ts` — `I9SupportingDocumentV1Core` vs `I9SupportingDocumentV1OptionalContext` vs full `I9SupportingDocumentV1`.
- **Storage rules:** `i9_docs/{tenantId}/{userId}/{documentId}/{allPaths=**}` in `storage.rules` — worker-only direct read/write/delete on own `userId` + tenant binding + upload type/size caps; no broad staff Storage read.
- **Signed URLs (staff preview/download):** Callable `getI9SupportingDocumentSignedUrl` (`functions/src/onboarding/i9SupportingDocumentSignedUrl.ts`) — loads Firestore metadata, authorizes owner or `canManageOnboarding`, validates non-empty `storagePath` + prefix, issues v4 read URL (~15 min TTL).
- **Workflow callables:** `createWorkerI9SupportingDocumentRequest`, `reviewWorkerI9SupportingDocument` in `functions/src/onboarding/i9SupportingDocumentWorkflowCallables.ts`.
- **Web wrappers:** `src/services/i9SupportingDocumentCallables.ts` (`callCreateWorkerI9SupportingDocumentRequest`, `callReviewWorkerI9SupportingDocument`, `callGetI9SupportingDocumentSignedUrl`).
- **Web UI:** `src/components/i9SupportingDocuments/I9SupportingDocumentsSection.tsx`; document type labels `src/constants/i9SupportingDocumentUi.ts`; path helpers `src/utils/i9SupportingDocumentsUi.ts`.

---

## Document reader (Google Document AI) — v1

**Trigger:** Gen2 Firestore `onDocumentWritten` on `tenants/{tenantId}/worker_i9_supporting_documents/{documentId}` — `onWorkerI9SupportingDocumentExtract` (`functions/src/onboarding/i9SupportingDocumentExtractionTrigger.ts`). Runs when metadata changes such that a file is present (`storagePath` set under the canonical prefix). **Does not** change approval rules; reviewers remain the authority.

**Idempotency / loops:** Skips when the write is only an echo of `documentExtraction` / `updatedAt` (stable fields unchanged), or when extraction for the current `storagePath` is already in a terminal state (`extraction_complete`, `extraction_failed`, `extraction_unsupported`).

**Processor mapping (v1):**

| `documentType` | Document AI |
|----------------|-------------|
| `list_b_drivers_license` | US Driver License (pretrained), if `DOCUMENT_AI_PROCESSOR_US_DRIVER_LICENSE` is set |
| `list_a_us_passport` | **No API call** — `extraction_unsupported`. Google’s **US Passport Parser** is **private** (access request) and is being **discontinued**; HRX does not depend on it. Passports are reviewed manually. |
| *all other types* | **No API call** — `extraction_unsupported` (including `list_b_gov_id`, List C, I-766, etc.) |

**Configuration (environment / `functions/.env.<project>`):**

- `DOCUMENT_AI_PROJECT_ID` — optional; defaults to `GCLOUD_PROJECT` / `GCP_PROJECT` when building processor resource names.
- `DOCUMENT_AI_LOCATION` — e.g. `us` (must match where the driver-license processor was created).
- `DOCUMENT_AI_PROCESSOR_US_DRIVER_LICENSE` — full processor resource name (`projects/…/locations/…/processors/…`) **or** raw processor id (combined with project + location).

**IAM:** Cloud Functions runtime service account needs permission to call Document AI (e.g. `roles/documentai.apiUser`) on the project that owns the processors.

**Firestore field:** Server-written only — `documentExtraction` (see `I9DocumentExtractionBlock` in `src/types/i9SupportingDocumentV1.ts`). Clients do not write this block.

**Admin UI:** `I9SupportingDocumentsWorkspace` shows reader status and assistive extracted fields under the review status column and in the approve confirmation dialog.

---

## Production access model (V1)

### A. Storage Rules (summary)

- **Match:** `i9_docs/{tenantId}/{userId}/{documentId}/{allPaths=**}`.
- **Read / write / delete:** `request.auth.uid == userId` **and** `i9WorkerTenantOk()` (custom token `roles[tenantId]` **or** `users/{uid}` `activeTenantId` / `tenantId` matches path `tenantId`, with `firestore.exists` guard before `get`).
- **Writes:** `i9UploadOk()` — max 15MB; `image/*` or `application/pdf`.
- **Staff:** no direct Storage read on this prefix in v1; use callable signed URLs.

### B. Firestore Rules (expectations)

- **Read:** worker (`resource.data.userId == request.auth.uid`) **or** HRX / tenant role / `isAssignedToTenant(tenantId)` / security level 5 — unrelated authenticated users denied.
- **Create:** worker self with `tenantId`, `userId`, `storagePath` matching `^i9_docs/{tenantId}/{uid}/.+` **or** HRX / tenant admin proxy.
- **Update — worker:** immutable review fields (`reviewedBy`, `reviewedAt`, `rejectionReason`); `affectedKeys` limited to upload/context fields (not `retainUntil` — staff-only).
- **Update — staff:** immutable `userId`, `tenantId`, `storagePath`; `affectedKeys` limited to review/status/retention/last-used + `updatedAt`.
- **Delete:** HRX or tenant admin only.

### C. Callable: signed URL issuance

- **Name:** `getI9SupportingDocumentSignedUrl`.
- **Input:** `{ tenantId, documentId }`.
- **Steps:** load `tenants/{tenantId}/worker_i9_supporting_documents/{documentId}`; validate metadata (see D); require `request.auth.uid === userId` **or** `canManageOnboarding(auth, tenantId, uid)`; verify object exists in default bucket; return `{ url, expiresAt, storagePath }`.

### D. Minimum metadata validated before signing

- Document exists.
- `userId` non-empty; `meta.tenantId === tenantId` (path param).
- `storagePath` starts with `i9_docs/{tenantId}/{userId}/` (canonical layout).
- Optional hardening: reject if `status` is a terminal “void” state if product defines one (not required for URL crypto — authorization is the gate).

### E. Worker self-read on Storage in V1

**Yes:** workers may **read** their own objects under `i9_docs/...` via Storage Rules (same binding as write). Staff use signed URLs only; Firestore metadata remains authorization SoT for who may obtain a URL.

---

## Migration / anti-patterns

- Do **not** require `assignmentId` or `entityId` in the Storage path for v1.
- If legacy data used assignment-scoped paths, migrate by **copying** objects to `i9_docs/...` and writing new Firestore rows with optional context populated from legacy ids once.
