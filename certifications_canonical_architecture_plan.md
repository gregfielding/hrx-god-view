# Certifications canonical architecture plan

**Status:** Architecture / migration design (no implementation in this document).  
**Ground truth audit:** [`certifications_schema_audit.md`](./certifications_schema_audit.md) (repository audit of `src/` + `functions/`).  
**Addendum (v1.1):** §11–§20 — execution-first hardening (engine centralization, confidence, guards, migration audit, UI operational rules, CEO directive).  
**Note:** If your team maintains a separate `user_certifications_schema_audit.md`, treat it as an alias of the same audit unless it diverges.

---

## 1. Executive summary

**What is broken today**

- Worker “certifications” are stored as **untyped arrays** on `users`, duplicated to **`workerProfile.credentials.certifications`**, with optional **`workerCompliance.certifications`** and a parallel **`worker_compliance_items`** collection for assignment readiness—**writes do not consistently hit all paths** (see audit §7).
- **Job requirements** are mostly **free-text strings** (`requiredCertifications`, `requiredLicenses`, posting `requirements.certifications`) matched with **substring / partial name** logic (`checkMissingCertifications`, `jobScoreV1`, `placementQualificationChipsModel`, `jobOrderSyntheticCertificationDemands`).
- **Approval**, **expiration**, and **upload vs attestation** are enforced **inconsistently** across UI (`certificationVerification.ts` pattern lists vs compliance type keys vs seed catalog names).

**Single biggest source of fragmentation**

- **No stable `certificationTypeId` (or equivalent)** end-to-end: three parallel naming universes—**`COMPLIANCE_ITEM_TYPES` keys**, **`credentialsSeed.json` names**, and **arbitrary strings** on jobs and user rows—bridged by **string matching**, not identity.

**Proposed future state (plain English)**

- Every worker certification is a **first-class document** with a **catalog-backed type**, structured fields (issuer, dates, number, jurisdiction), **upload + review state machine**, and **explicit evaluation** against job requirements.
- Jobs and job orders declare requirements using **the same catalog IDs** (plus policy: required vs preferred, upload vs attestation, approval vs pending).
- **Readiness**, **fit**, and **action items** read from **one evaluation layer** that maps worker records + requirements → **canonical statuses** (missing, approved, expired, etc.)—legacy arrays become **inputs to migration / read adapters** only until removed.

---

## 2. Canonical source of truth recommendation

### 2.1 Single canonical store for worker-owned certifications

**Recommendation:**  
**`users/{userId}/certification_records/{certificationRecordId}`** — one Firestore document per logical certification held (or once held) by the worker.

**Why not keep `users.certifications` as canonical**

- The audit documents **arrays without a enforced schema**, duplicate mirrors, and **no stable primary key** per cert—unsuitable for review workflows, queries (“all expiring next 30 days”), or audit.

**Why a subcollection under `users`**

- Certifications are **worker-owned data**; subcollections scale better than unbounded arrays, support **per-record security rules**, and map naturally to **one upload bundle + review history** per record.

### 2.2 Fate of existing fields/collections

| Location | Verdict | Role after migration |
|----------|---------|----------------------|
| **`users.certifications`** (array) | **Deprecate for decisioning** | **Legacy**; dual-read during phases 1–4; **stop writes** after dual-write cutover; **delete** in phase 5 after verified backfill completeness. |
| **`workerProfile.credentials.certifications`** | **Deprecate for decisioning** | **Legacy mirror** of the same array today; **remove from write patch** once clients write only to `certification_records`; optionally **derived snapshot** (denormalized summary) for backward-compat APIs for one release. |
| **`workerCompliance.certifications`** (map) | **Deprecate** | Audit shows **optional** second source in `jobReadinessReadModel`; **replace** with query of `certification_records` or a **materialized projection** doc if needed for perf. |
| **`tenants/{tenantId}/worker_compliance_items`** | **Repurpose, not delete** | Keep for **broader compliance** (I-9, drug screening as *screening products*, acknowledgments). For **credential-type** items that today represent “cert proof,” **migrate** to `certification_records` and **link** via `linkedComplianceItemId` **or** maintain a thin **pointer doc** during migration. Long-term: **readiness snapshot** should consume **certification_records** for cert gates; compliance items remain for **non-cert** or **legacy bridge** until fully cut. |

### 2.3 Fields that must stop driving product decisions (explicit)

Stop using for **eligibility / fit / placement blockers** (after migration + adapter removal):

- Raw **`name` string** equality / substring on user arrays vs job strings.
- **`jobReadinessResponses`** keys like **`certification-food-handler`** as a substitute for a stored cert record (may remain **UX nudges** only if product wants).
- **Resume parser** output written **directly** to `users.certifications` without creating **`certification_records`** with `source: resume_parse` and review rules.
- **`calculateApplicantFitScore`** “length of certifications array” **without** mapping to catalog + status.

### 2.4 Strong recommendation (one paragraph)

**The only canonical write target for durable certification evidence should be `users/{uid}/certification_records/{id}`.**  
`users.certifications` and `workerProfile.credentials.certifications` become **legacy**; `worker_compliance_items` remains the home for **non-certification compliance** and phased **linkage** to cert records; `workerCompliance.certifications` map is **retired** in favor of queries/materializations from `certification_records`.

---

## 3. Proposed canonical data model

### 3.A Certification catalog

**Purpose:** Controlled list of cert/license types for worker selection and job requirement pickers.

**Recommended fields**

| Field | Type | Notes |
|------|------|--------|
| `catalogEntryId` | string | Doc id (stable). |
| `key` | string | Stable snake_case key, e.g. `food_handler_card`. |
| `displayName` | string | UI label. |
| `shortName` | string? | Chips / mobile. |
| `category` | enum | e.g. `food_safety`, `healthcare`, `industrial`, `transport`, `general`. |
| `kind` | enum | `certification`, `license`, `permit`, `training`. |
| `hasExpiration` | boolean | |
| `requiresDocumentUpload` | boolean | Default policy; requirement can override. |
| `allowsSelfAttestation` | boolean | If true, worker can “claim” without file subject to policy. |
| `defaultValidity` | object? | `{ unit: 'year' \| 'month' \| 'day', value: number }` optional hint. |
| `issuerEntryType` | enum | `free_text`, `state_registry`, `national_registry`, `employer`. |
| `issuerSuggestions` | string[]? | Optional autocomplete. |
| `jurisdictionPolicy` | enum | `none`, `us_state`, `country`. |
| `active` | boolean | |
| `aliases` | string[] | **For migration matching** from old free-text + seed names. |
| `matchPatterns` | string[]? | Optional normalized regex/substrings for legacy import **only** (tight governance). |
| `readinessTier` | enum | `gate`, `signal`, `nice_to_have` — default weight in UX. |
| `ocrHints` | object? | **Future:** `{ preferredDocLayout: string, language: string[] }` placeholders. |
| `schemaVersion` | number | Catalog row versioning. |

**Where it lives**

- **Hybrid (recommended):**
  - **Global defaults:** versioned **static JSON** or **`config/certification_catalog_manifest`** in repo deployed with app (successor to `credentialsSeed.json` fragments).
  - **Firestore:** `tenants/{tenantId}/certification_catalog_entries/{id}` for **tenant-specific** labels, enable/disable, and **additional** entries; optional **`certification_catalog_global/{id}`** for ops-managed global entries without redeploy.
- **Why hybrid:** HRX already ships **`credentialsSeed.json`**; tenants need **custom** certs without deploy. **Deploy** still validates new global types via CI.

---

### 3.B Worker certification record

**Path:** `users/{userId}/certification_records/{certificationRecordId}`

| Field | Type | Notes |
|------|------|--------|
| `certificationRecordId` | string | == doc id. |
| `userId` | string | Denormalized. |
| `tenantId` | string? | **Owning tenant for review** when reviews are tenant-scoped; null = global/worker-only until claimed. |
| `catalogEntryId` | string | **FK to catalog** (global key resolved via tenant overlay). |
| `workerEnteredLabel` | string? | Only if catalog allows “other” or pre-migration. |
| `issuerName` | string? | |
| `issueDate` | date? | ISO or Firestore Timestamp. |
| `expirationDate` | date? | |
| `credentialNumber` | string? | License/cert number. |
| `jurisdiction` | string? | e.g. state code. |
| `evidence` | object | `{ storagePath, contentType, uploadedAt, fileName }[]` — versioned uploads. |
| `extraction` | object? | **Future:** raw + normalized extraction (see §8). |
| `review` | object | See **review status** below. |
| `computed` | object? | Denormalized: `{ status: RecordStatus, expirationStatus }` updated by triggers. |
| `source` | enum | See **source enum** below. |
| `extractionConfidence` | number? | 0–1 for AI paths. |
| `legacyImportIds` | string[]? | Traceability to old array index / firebase doc. |
| `createdAt`, `updatedAt`, `lastEvaluatedAt` | timestamps | `lastEvaluatedAt` for batch expiry jobs. |

#### Record status (`RecordStatus`)

| Value | Meaning |
|-------|---------|
| `draft` | Worker started, not submitted. |
| `pending_review` | Submitted, needs recruiter action (if required by policy). |
| `active` | Usable per policy (may still be attestation-only if allowed). |
| `expired` | Past expiration (computed or manual). |
| `rejected` | Recruiter rejected evidence. |
| `superseded` | Replaced by newer record for same catalog type (optional). |
| `revoked` | Admin revoked. |

#### Review status (`ReviewStatus`) — sub-object on record

| Value | Meaning |
|-------|---------|
| `not_required` | Attestation-only path or catalog does not require review. |
| `submitted` | Awaiting review. |
| `approved` | |
| `rejected` | `rejectionReason` required. |

#### Source (`CertificationSource`)

| Value | Meaning |
|-------|---------|
| `worker_upload` | Worker UI upload. |
| `worker_attestation` | Claim without file (if allowed). |
| `resume_parse` | Parser / AI. |
| `admin_manual` | Recruiter created. |
| `import_legacy` | Migration script from `users.certifications`. |
| `job_readiness_feed` | C1 feed flows. |
| `apply_wizard` | Apply path. |
| `integration` | Future vendor API. |

---

### 3.C Certification requirement record

Requirements should be **normalized** on the entities that already drive hiring:

**A. Job posting (public apply)**  
- Embeddable array **or** subcollection `job_posts/{id}/certification_requirements/{reqId}` if many.

**B. Job order (recruiter)**  
- `job_orders/{id}` fields **replaced** with structured array `certificationRequirements: CertificationRequirement[]` (or subcollection for audit history).

**C. Assignment (optional override)**  
- `assignments/{id}` optional `certificationRequirementOverrides[]` **or** inherit only from job order.

**`CertificationRequirement` shape**

| Field | Type | Notes |
|------|------|--------|
| `requirementId` | string | Stable id (generated). |
| `catalogEntryId` | string | **Required** — ties to catalog. |
| `scope` | enum | `required`, `preferred`. |
| `evidencePolicy` | enum | `upload_required`, `attestation_allowed`, `either`. |
| `reviewPolicy` | enum | `must_be_approved`, `pending_ok_for_apply`, `pending_ok_for_assignment` (product-tunable). |
| `expirationPolicy` | enum | `must_be_valid`, `grace_days`, `warn_only`. |
| `gracePeriodDays` | number? | |
| `waivable` | boolean | |
| `assignmentOnly` | boolean | If true, enforced at assignment vs apply. |

**Deprecate:** parallel **`requiredCertifications: string[]`** / **`requiredLicenses: string[]`** as *sources of truth* — migrate to structured entries; **keep strings read-only** during migration for display.

**`requiredCertificationComplianceIds`:** **Deprecate** once `catalogEntryId` + `certificationRecordId` linking exists; during migration map old ids → catalog entries.

---

### 3.D Readiness / match interpretation layer

**Evaluation output per (worker, requirement)** — not stored as source of truth long-term; **computed** (cached on snapshot):

| Status | Use |
|--------|-----|
| `missing` | No record or no matching catalog type. |
| `attested_only` | Claim without evidence when upload required by policy. |
| `uploaded_pending_review` | Evidence present, review not approved. |
| `approved` | Passes review + expiration policy. |
| `rejected` | Recruiter rejected. |
| `expired` | Past expiration. |
| `expiring_soon` | Inside window (e.g. 30 days). |
| `invalid_for_requirement` | Wrong catalog id / jurisdiction / class mismatch. |
| `waived` | Explicit waiver on file. |
| `preferred_unmet` | Preferred only — never blocks hard gates. |

**Feeds**

- **Job readiness / home checklist:** aggregate + **action items** for top blockers (missing, expired, pending review when blocking).
- **Assignment readiness (`readinessSnapshotV1` / `buildAssignmentReadiness`):** same evaluator; **severity** from policy (**hard_block** vs **warning**) — today certs are often **warnings**; product may promote specific certs to **block** per tenant.
- **Job/applicant fit (`jobScoreV1` et al.):** use **same evaluator**; scoring weights from requirement `scope` + `preferred`.
- **Action items:** driven from **evaluation** + **dashboard policy** (not raw arrays).

---

## 4. Proposed collection/path architecture

### 4.1 Concrete paths

| Path | Purpose |
|------|---------|
| `certification_catalog_global/{catalogEntryId}` | Optional Firestore global entries (ops-editable). |
| `tenants/{tenantId}/certification_catalog_entries/{catalogEntryId}` | Tenant overlay / custom types. |
| `users/{userId}/certification_records/{recordId}` | **Canonical worker certifications.** |
| `tenants/{tenantId}/certification_review_queue/{recordId}` | **Optional** index collection for “pending review” queries (doc id = record id, `userId`, `submittedAt`); **or** query collection group on `certification_records` with `review.status == submitted` and composite indexes. |
| `job_posts/{jobPostId}` | Structured `certificationRequirements[]` (or subcollection). |
| `tenants/{tenantId}/job_orders/{jobOrderId}` | Same. |
| `tenants/{tenantId}/assignments/{assignmentId}` | Inherits + optional overrides. |
| `tenants/{tenantId}/worker_compliance_items/{itemId}` | **Retained** for I-9/drug/etc.; **optional** `certificationRecordId` link field for bridge. |

### 4.2 Multi-tenant behavior

- **Worker is global** (`users/{uid}`): certification **records** live under the user; **`tenantId`** on the record indicates which tenant’s review policy applies when certification is **job- or employer-scoped**.
- Same worker for multiple tenants: **duplicate or shared record** policy:
  - **Recommended default:** **one record per `(userId, catalogEntryId, credentialNumber?)`** globally; **tenant-specific review** via **`reviewsByTenant: { [tenantId]: ReviewStatus }`** *only if* product requires different approval per employer—else single **`review`** to reduce complexity.
- Start with **single `tenantId` + single review** per record; expand if legal requires per-employer proofs.

### 4.3 Upload metadata

- Store **file references** on **`certification_records.evidence[]`**; **raw OCR payloads** in subcollection **`users/{uid}/certification_records/{id}/extractions/{extractionId}`** if large — **see §8**.

---

## 5. Current-state → future-state mapping

| Current source | Action | Why |
|----------------|--------|-----|
| `users.certifications` | **Migrate → deprecate** | Backfill into `certification_records`; stop decisioning on array. |
| `workerProfile.credentials.certifications` | **Deprecate** | Mirror removal after dual-write ends. |
| `workerCompliance.certifications` map | **Deprecate** | Replace with queries/materialized view. |
| `tenants/{tid}/worker_compliance_items` | **Keep + migrate linkage** | Still needed for non-cert; cert-like rows **link** to `certification_records` or **migrate** record ownership. |
| Job order `requiredCertifications` / `requiredLicenses` strings | **Migrate** | Map strings → `catalogEntryId` via aliases; store structured requirements. |
| `requiredCertificationComplianceIds` | **Deprecate** | Replace with `catalogEntryId` + record id matching. |
| Apply wizard Yes/No cert answers | **Migrate** | Create **attestation** or **draft** `certification_record` per answer + catalog mapping. |
| Readiness response keys (`jobReadinessResponses`, `workerProfile.readiness.responses`) | **Reduce** | Nudges only; **not** readiness source once records exist. |
| Resume parser outputs | **Migrate** | Create records with `source: resume_parse`, `pending_review`. |
| Job readiness feed uploads (`JobReadinessFeed`) | **Migrate** | Write **only** `certification_records` (+ dual-write temporarily). |
| `credentialsSeed.json` | **Replace by** catalog pipeline | Import as initial catalog rows. |
| `COMPLIANCE_ITEM_TYPES` | **Align** | Map **credential** types 1:1 to `catalogEntryId`; screenings stay separate. |
| `jobRequirementPacksV1` `requiredCerts` | **Migrate** | Point to **`catalogEntryId`** list not raw strings for scoring. |

---

## 6. Migration plan

### Phase 0 — Canonical model introduced

- **Goal:** Ship **schema + empty collections** + feature flag `CERT_RECORDS_READ_ENABLED`.
- **Code:** Add types, security rules skeleton, **no user-facing change** to prod behavior.

### Phase 1 — Dual-write / read adapter

- **Goal:** All **new** writes from primary UIs also create/update **`certification_records`**; **legacy arrays** still written for compatibility.
- **Read:** Single **`getWorkerCertificationsUnified(user)`** adapter merges **records** + legacy with **precedence: records win** on conflict.
- **Still reads legacy:** all existing screens until switched.

### Phase 2 — Catalog normalization

- **Goal:** Deploy **catalog** (global + tenant); import **`credentialsSeed` + compliance credential keys**; admin UI to **map aliases**.
- **Canonical:** `catalogEntryId` resolution for imports.

### Phase 3 — Requirement normalization

- **Goal:** Job order / posting UIs write **`certificationRequirements[]`**; **parallel** keep legacy strings **read-only copy** for old clients.

### Phase 4 — Decisioning migration

- **Goal:** **Fit**, **readiness snapshot**, **placement allowlist**, **home action items** use **evaluator** only.
- **Legacy:** adapter feeds evaluator until backfill complete.
- **worker_compliance_items:** snapshot reads **certification_records** for cert gates; compliance items for screenings.

### Phase 5 — Legacy cleanup

- **Goal:** Remove **dual-write**, strip **`users.certifications`** from schema (or empty + archived), remove string-based **job** requirements.

### Migration risks

| Risk | Mitigation |
|------|-------------|
| String matching drift | **Alias table** + manual mapping report before cutover. |
| Duplicate records | Backfill key = `(catalogEntryId, credentialNumber, issuer)` heuristic + merge tool. |
| Stale mirrors | **Phase 1** monitoring: diff adapter vs legacy nightly job. |
| Old job postings | **Read adapter**: interpret old strings via **aliases** only—never silent fuzzy match in prod without logging. |
| Recruiter confusion | **UI labels**: “Legacy requirement string — map to catalog” banner. |
| No expiration on legacy | **Unknown expiry** → `expirationDate: null` + policy **“treat as expiring_soon unknown”** or force re-upload. |

---

## 7. Canonical decisioning rules (policy proposal)

### 7.1 Worker has cert but no upload

- **Attestation allowed** (catalog + requirement): record can be **`active`** with **`evidence: []`** and **`review.not_required`** or auto-approved per tenant policy → **counts** for readiness/fit per **`evidencePolicy`**.
- **Upload required:** **does not** satisfy **`upload_required`** gates → evaluator = **`attested_only`** or **`missing`**; may **count for partial fit** only if policy says “soft signal.”
- **Action item:** **Yes** — “Upload proof for {displayName}” when gate requires upload.

### 7.2 Upload but not reviewed

| Context | Policy (recommended default) |
|---------|-------------------------------|
| Job fit (marketing / score) | **Pending** may count **partial credit** (e.g. 70%) or **zero for hard reqs** — **tenant config**. |
| Job readiness (apply) | **`pending_ok_for_apply`** on requirement → allowed; else **blocked** or **warning**. |
| Assignment readiness | **`must_be_approved`** common for placement → **warning** or **block** per tenant. |
| Action items | **Always show** “Under review” when `submitted`. |

### 7.3 Approved but expired

- **Readiness / placement:** **Does not satisfy** **`must_be_valid`**.
- **Timing:** **Day after** `expirationDate` (or end-of-day UTC — pick one globally).
- **Warnings:** **`expiring_soon`** within **30 days** (configurable) → action item + **watchout** not blocker.

### 7.4 Rejected

- **Treat as** **`missing`** for gates; **action item** “Resubmit proof” with reason.
- **Retain** history for audit (same record or superseding record).

### 7.5 Wrong / similar cert

- **Primary:** **`catalogEntryId` exact match**.
- **Secondary:** **alias list** on catalog + **admin override** “accepts as” on requirement (rare).
- **No** silent fuzzy match in **hard gates**; fuzzy only for **fit suggestions** with logged confidence.

### 7.6 Assignment exists; cert later expires

- **Readiness downgrade** on next snapshot run (scheduled **daily** + **on record update**).
- **Action item** to worker + optional **notify** recruiter (out of scope for cert schema—use existing messaging orchestrator).
- **Auto-unassign** — **not default**; **policy** per tenant if ever needed.

---

## 8. OCR / AI future-proofing

- **`extraction.raw`** (JSON) — vendor-native OCR payload references; **immutable** per run.
- **`extraction.normalized`** — `{ issuerName?, credentialNumber?, expirationDate?, jurisdiction? }` with **`fieldConfidence`** map.
- **Worker-entered vs machine-extracted:** store **both** on record; **`discrepancies: { field, worker, extracted }[]`** for reviewer UI.
- **Review queue:** prioritize **low confidence** + **required** jobs.
- **Core schema unchanged** when OCR improves—only **extraction** sub-objects grow.

---

## 9. Recommended UI behavior (high level)

**Worker:** pick **catalog type** → enter **issuer / dates / number** → upload → **track status** (pending / approved / rejected / expired) → **replace** evidence on same record (versioned).

**Recruiter:** **review queue**, **approve/reject** with reason, filters **expiring / missing / wrong type**, badge **attested vs verified**.

**Job builder:** pick **catalog entries**, set **required/preferred**, **upload vs attestation**, **review strictness**, **expiration rules**.

---

## 10. Final recommendation

### Recommended final architecture

- **Canonical collections:** `users/{uid}/certification_records/{id}` + **catalog** (hybrid global/tenant).
- **Canonical requirement:** structured **`certificationRequirements`** on postings / job orders (assignments inherit/overrides).
- **Powers readiness:** **evaluation layer** (pure functions + cached snapshot fields).
- **Powers fit:** same evaluator + scoring weights.
- **Legacy:** `users.certifications`, mirrored credentials array, string job lists, unstructured compliance map — **deprecated** after migration.

### First implementation step (single best)

**Introduce `certification_records` + catalog seed import + dual-write from `LicensesAndCertsTab` (and one apply path) only** — **no** change to job orders, scoring, or snapshots yet. Add **read adapter** used **only** by a **dev/admin “preview”** or **feature-flagged** profile tab showing **side-by-side legacy vs canonical** until parity verified.

This maximizes **data capture** with **low blast radius** and avoids rewriting **fit/readiness** before there is data to evaluate.

---

## 11. Non-negotiable principles

1. **Certifications are NOT profile data — they are operational eligibility gates**  
   They directly control:
   - **job visibility** (who may see or apply),
   - **assignment eligibility** (who may be placed),
   - **auto-advance / auto-reject** (downstream automation).  
   Treat them like **background checks** — governed, audited, blocking where policy says so — not “resume fluff.”

2. **No silent pass-through**  
   A certification must always resolve to a **deterministic status** in decisioning. There is no **“maybe valid”** for gates, automation, or eligibility.

3. **No string matching in production decisioning**  
   String / substring / alias matching is allowed **only** in:
   - **migration** (import, backfill, one-shot mappers),
   - **debug / admin tools** (with explicit logging).  
   It must **never** run in:
   - **readiness**,
   - **scoring**,
   - **auto-advance**,
   - **assignment eligibility**.  
   Production paths use **catalog identifiers** (`catalogEntryId`) and **resolved evaluation** only.

4. **One cert = one record = one truth**  
   No duplicate semantics across `users.certifications`, `workerProfile.credentials`, parallel attestations, and uploads for the same logical credential. The canonical record is the single source; mirrors are deprecated or derived snapshots only.

---

## 12. Certification Readiness Engine (CRITICAL)

Readiness today is **fragmented** across helpers and heuristics. This plan requires a **single engine** that every product surface consumes.

### New concept

```ts
evaluateCertificationRequirement({
  requirement,
  certificationRecords,
}) => CertificationEvaluationResult
```

### Output shape

```ts
type CertificationEvaluationResult = {
  status:
    | 'missing'
    | 'attested_only'
    | 'pending_review'
    | 'approved'
    | 'expired'
    | 'rejected'
    | 'invalid';

  passesHardRequirement: boolean;
  passesSoftRequirement: boolean;

  blocking: boolean;

  reason: string;

  certificationRecordId?: string;
};
```

**Note:** `pending_review` here is the **evaluation vocabulary** for “evidence submitted, not yet approved when approval is required.” It aligns with the record/review model in §3 (see `uploaded_pending_review` in §3.D — naming should be unified in implementation so evaluation status maps 1:1 to product copy).

**Responsibilities**

- Inputs: **structured** `CertificationRequirement` + canonical **`certification_records`** (and, during migration, **only** what the legacy adapter exposes as **pre-normalized** inputs — never raw string compare in the engine).
- Output: **one row per requirement** with explicit **blocking**, **reasons**, and **record id** when applicable.

---

## 13. Hard rule — blocking logic must be centralized

**Rule:** **Only** this evaluation layer may determine:

- **readiness** (apply / home / worker journey),
- **assignment eligibility**,
- **auto-advance eligibility**,

for certification-backed rules.

**Remove / replace over time** scattered logic in:

- `checkMissingCertifications`
- `jobScoreV1`
- `placementQualificationChipsModel`
- `jobOrderSyntheticCertificationDemands`

**Pattern:** Those modules become **callers** of `evaluateCertificationRequirement` (or a batch `evaluateCertificationsForJob(user, jobOrder)`), not parallel implementations. Until migration completes, **thin adapters** may map legacy inputs **into** the engine; they must not reintroduce string matching for gates.

---

## 14. Auto-action integration

### Certifications → Action Items

Map **evaluation status** to **worker/recruiter-facing actions** (exact copy is product-tunable):

| Status | Action |
|--------|--------|
| `missing` | Upload certification |
| `attested_only` | Upload proof required |
| `pending_review` | Waiting for approval |
| `rejected` | Resubmit certification |
| `expired` | Upload updated certification |
| `expiring_soon` | Renew certification soon |

Action item payloads must carry **`catalogEntryId`**, **`requirementId`**, **`certificationRecordId`**, and **`reason`** so deep links and automation are deterministic.

### Certifications → Automation

Define a single predicate used by placement / onboarding automation:

**`isEligibleForAutoAdvance(user, jobOrder)`**

Must assert:

- **All REQUIRED** certification requirements evaluate to **`status === 'approved'`** (per policy for “approved” including expiration validity).
- **No required** certification is in **`missing`**, **`rejected`**, or **`expired`** (and **`invalid`** / **`attested_only`** when upload or catalog match is mandatory).

Soft / preferred certs **must not** satisfy hard gates unless explicitly configured.

---

## 15. Certification Confidence Layer (differentiator)

Introduce **`certificationConfidence`**: `'high' | 'medium' | 'low'` on the evaluation result (or on the record + propagated).

| Condition | Confidence |
|-----------|------------|
| Approved **and** parsed evidence **and** extracted fields **match** worker/registry expectations | **high** |
| Approved **but** no reliable OCR/parse match (manual approval, thin extraction) | **medium** |
| Attestation only | **low** |
| Pending review | **low** |

**Feeds**

- **Scoring** — weight or cap contribution of cert signals by confidence.
- **Recruiter UI** — badges, sort order, “verify first” cues.
- **Automation thresholds** — e.g. auto-advance only when required certs are **approved** with **≥ medium** or tenant-defined rules.

---

## 16. Prevent future fragmentation

### 16.1 Write guard

**All writes** to durable certification evidence go through **`createOrUpdateCertificationRecord()`** (name illustrative).  

**Never** as a steady-state pattern:

- direct writes to **`users.certifications`**,
- partial cert blobs scattered across unrelated docs without a record.

### 16.2 Read guard

**All production reads** for decisioning go through **`getCanonicalCertificationRecords(userId)`** (or batch variant), returning **`certification_records`** merged with a **migration adapter** only while legacy exists.

### 16.3 Lint / dev rule (optional, high leverage)

- Flag direct references to **`user.certifications`** and **`workerProfile.credentials.certifications`** outside **migration** and **adapter** modules.
- Treat new usages as **errors** in CI for paths that affect readiness/scoring.

---

## 17. Migration safety — dual-read validation

During migration, run a **`compareLegacyAndCanonicalCerts(user)`** validation (batch or on-demand):

- Compare legacy-derived view vs canonical records for:
  - **missing certs** in one side,
  - **mismatched names** / catalog resolution,
  - **missing expiration** where expected,
  - **different counts** / duplicates.

**Persist summary** under:

`users/{uid}.certMigrationAudit`

Include **timestamps**, **diff summary**, and **severity** for support and cutover gating. Mismatches drive **manual fix or re-import**, not silent acceptance.

---

## 18. Performance (scale)

### Materialized snapshot (optional Phase 2+)

`users/{uid}.certificationSummary` (illustrative):

```ts
{
  total: number;
  approved: number;
  missingRequired: number; // scoped to “current hiring context” or global — product decision
  expiringSoon: number;
  lastUpdatedAt: timestamp;
}
```

**Used for:** worker/tenant **tables**, **filters**, **dashboards** — updated by triggers or scheduled rollup from **`certification_records`**, not by scanning legacy arrays.

---

## 19. UI tightening — operational, not decorative

### Worker

- Cannot mark **“I have this cert”** without **selecting a catalog type** (or explicit “other” path with **admin-review** rules).
- Cannot complete **readiness** when **upload is required** and evidence is **missing** or **rejected** per policy.

### Recruiter

- Sees stable aggregates: **Approved**, **Pending**, **Missing**, **Expired** — backed by **engine output**, not ad-hoc filters on strings.
- Can **approve**, **reject** (with reason), **request re-upload** — all tied to **`certificationRecordId`**.

### Job readiness

- Must show **exact** cert gate failure: e.g. **“Forklift certification — upload proof”** with **catalog display name** and **requirement scope**.
- **Forbidden as a steady state:** generic **“Certifications incomplete”** without **which requirement** and **which action**.

---

## 20. Final CEO-level directive

Certifications are a **core control system**, not a data model.

This architecture must ensure:

- **deterministic eligibility**,
- **auditability**,
- **automation readiness**.

If any part of the system allows **ambiguity** — string matching for gates, **duplicate storage** of truth, or **undefined status** in decisioning — it is considered a **defect**.

---

## Document control

| Version | Date | Notes |
|---------|------|--------|
| 1.0 | 2026-04-21 | Initial architecture plan from `certifications_schema_audit.md`. |
| 1.1 | 2026-04-21 | Addendum §11–§20 — execution, engine centralization, confidence, guards, migration audit, performance snapshot, UI, directive. |
