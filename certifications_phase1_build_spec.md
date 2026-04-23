# Certifications — Phase 1 implementation build spec

**Status:** Engineering execution spec — **foundation only**; **no** broad refactors.  
**Sources:** [`certifications_canonical_architecture_plan.md`](./certifications_canonical_architecture_plan.md), [`certifications_schema_audit.md`](./certifications_schema_audit.md), current `src/` layout.  
**Version:** 1.3 — mandatory hardening (catalog immutability, mirroring contract, normalizer order, UTC dates, engine/adapter boundaries, manifest lock, Phase 1A stop).

**v1.3 rule index:** **`catalogEntryId`** immutability + manifest lock — **§4.1** · legacy **`certificationRecordId`** mirroring (failure visible) — **§5.3** · **`normalizeLegacyCertificationRow`** order + unmapped legacy — **§5.4–5.4.1** · recruiter vs worker review defaults — **§5.5** · unified adapter duplicates + **`console.warn`** — **§6** · UTC dates + engine contracts — **§7** · **§14** go/no-go before **1B** · **§13** execution **STOP**.

---

## 1. Phase 1 objective

### What we are building now

- **Canonical data model** for worker-held certifications as Firestore documents: **`users/{uid}/certification_records/{recordId}`**, with **frozen enums** and a minimal, versioned document shape (`schemaVersion`).
- **Catalog seed / import strategy** that derives a stable **`catalogEntryId`** space from existing **`src/data/credentialsSeed.json`** (plus metadata needed for matching and engine defaults). Phase 1 is **repo-delivered catalog**, not a tenant Firestore editor.
- **Dual-write** from **exactly two** call sites: one **recruiter/admin** surface and one **worker** surface (see §5).
- **Unified read adapter** **`getWorkerCertificationsUnified`** — pairs canonical records + legacy **`users.certifications`** (no merging of duplicate same-**`catalogEntryId`** rows — §6).
- **Pure Certification Readiness Engine** (TypeScript only — **no Firestore** inside): **`evaluateCertificationRequirement`** (+ small batch helper) with deterministic outputs for tests and future wiring.
- **Migration audit tooling**: **`compareLegacyAndCanonicalCerts(userId)`** and optional batch driver; results persisted on the user doc for support/QA (see §8).

### What we are explicitly NOT building yet

- Job order / posting **`certificationRequirements[]`** migration, **`requiredCertifications`** / **`requiredLicenses`** string deprecation, or assignment overrides.
- Changes to **`checkMissingCertifications`**, **`jobScoreV1`**, **`placementQualificationChipsModel`**, **`jobOrderSyntheticCertificationDemands`**, readiness snapshots, or **action-item** pipelines.
- **OCR / extraction** payloads, **`extractions`** subcollections, or **auto-advance** / automation hooks tied to certs.
- **`tenants/{tenantId}/certification_review_queue`** (or any dedicated review index collection).
- **Full removal** of **`users.certifications`** or **`workerProfile.credentials.certifications`** writes; **ESLint bans** on legacy fields.
- **worker_compliance_items** ↔ **`certificationRecordId`** linking (bridge stays future).

### Why this sequence is safest

Canonical **writes** and **reads** land behind **small, testable modules** before any **eligibility** consumer switches. Dual-write limits blast radius; the **unified adapter** and **audit diff** prove parity **before** scoring/readiness cutover. The engine ships **pure** and fully unit-tested without coupling to production decisioning.

---

## 2. Exact code deliverables (repo-aligned)

Create the **`src/utils/certifications/`** and **`src/types/certifications/`** folders as the Phase 1 home. **Do not** spray helpers across unrelated packages.

| Deliverable | Path / module | Responsibility |
|-------------|----------------|----------------|
| **Frozen enums + branded doc ids (optional)** | `src/types/certifications/certificationEnums.ts` | String union exports for all Phase 1 vocabularies (§3). |
| **Canonical record types** | `src/types/certifications/certificationRecord.ts` | `CertificationRecordV1` (fields that go on Firestore); `EvidenceFileRef`, `ReviewState`, etc. |
| **Catalog manifest entry types** | `src/types/certifications/certificationCatalogManifest.ts` | `CatalogManifestEntry`, `CertificationCatalogManifestV1`. |
| **Minimal requirement type (engine-only)** | `src/types/certifications/certificationRequirement.ts` | `Phase1CertificationRequirement` only — **not** wired to job orders in Phase 1. |
| **Firestore timestamp aliases** | `src/types/certifications/certificationRecordFirestore.ts` | Serialize/deserialize helpers if needed (`Timestamp` vs ISO). |
| **Seed → manifest builder** | `src/utils/certifications/buildCatalogManifestFromSeed.ts` | Reads **`src/data/credentialsSeed.json`**; produces **`src/data/generated/certificationCatalogManifest.v1.json`** (**§4.1** — locked file, no runtime regen). |
| **Catalog resolve helpers** | `src/utils/certifications/resolveCatalogEntry.ts` | After normalized input: **`catalogEntryId`** from seed **`id`** / aliases only (**§4.1**). |
| **UTC date helper** | `src/utils/certifications/normalizeDateToISODateString.ts` (or `dateIso.ts`) | Strip time; **YYYY-MM-DD** for all expiration / comparison paths (**§7**). |
| **Write API** | `src/utils/certifications/createOrUpdateCertificationRecord.ts` | `setDoc`/`updateDoc` on **`users/{uid}/certification_records/{id}`**; **`deleteCertificationRecord`** sibling if delete path needs hard delete vs tombstone (Phase 1: **prefer deleteDoc** on recruiter/worker delete when legacy row removed). |
| **Canonical read** | `src/utils/certifications/getCanonicalCertificationRecords.ts` | `collection(db, 'users', uid, 'certification_records')` + `orderBy('updatedAt','desc')` (index as needed). |
| **Unified read adapter** | `src/utils/certifications/getWorkerCertificationsUnified.ts` | Contract §6. |
| **Confidence (pure)** | `src/utils/certifications/deriveCertificationConfidence.ts` | Input: record + review + evidence counts + catalog flags; output: **`CertificationConfidence`** (§3.4, §7). |
| **Engine** | `src/utils/certifications/evaluateCertificationRequirement.ts` | Single requirement + best matching record (caller supplies) → **`CertificationEvaluationResult`**. |
| **Batch helper** | `src/utils/certifications/evaluateCertificationsForRequirements.ts` | Buckets records by **`catalogEntryId`** outside engine, then calls **`evaluateCertificationRequirement`** per pair (pure). |
| **Migration compare** | `src/utils/certifications/compareLegacyAndCanonicalCerts.ts` | §8. |
| **Audit writer** | `src/utils/certifications/writeCertMigrationAudit.ts` | Writes **`certMigrationAudit`** on **`users/{uid}`** (merge-safe). |
| **Legacy row normalizer** | `src/utils/certifications/normalizeLegacyCertificationRow.ts` | Strict pipeline §5.4 → then **`resolveCatalogEntry`**; never resolve raw strings. |
| **Path helpers** | `src/data/firestorePaths.ts` (extend) | e.g. `userCertificationRecords: (uid: string) => \`users/${uid}/certification_records\`` — **single source of path strings**. |
| **Security rules** | `firestore.rules` | Match block for **`users/{userId}/certification_records/{recordId}`** — same access model as parent user doc for app roles (mirror existing `users/{uid}` patterns). |
| **Indexes** | `firestore.indexes.json` | Only if composite queries are introduced (e.g. `catalogEntryId` + `updatedAt`); **add when query shape is fixed**. |
| **Admin/recruiter integration** | **`src/pages/UserProfile/components/LicensesAndCertsTab.tsx`** | After successful add/update/delete (and storage upload/delete), call **`createOrUpdateCertificationRecord`** / delete when flag on (§5). |
| **Worker integration** | **`src/components/apply/steps/EducationStep.tsx`** | Same on certification array mutations (**§5 — today’s worker path**). |
| **Optional preview UI** | Same tab or `src/pages/dev/...` | Feature-flagged read-only comparison **legacy vs unified** (no scoring). |

**Tests:** `src/utils/certifications/__tests__/*.test.ts` + **`src/utils/certifications/__fixtures__/`** (§9).

**Optional (later in Phase 1C, not blocking 1A/1B):** `functions/src/certifications/` callable **only if** server-side audit batch is required; **default Phase 1** is **client-triggered** audit from internal tools to avoid new deploy dependencies.

---

## 3. Canonical status enum freeze (Phase 1)

**Rule:** One vocabulary **per layer**. Do **not** use `uploaded_pending_review` anywhere in code — it appeared in the architecture doc as evaluation prose only. **`pending_review`** is the single evaluation label for “submitted, awaiting approval when approval matters.”

### 3.1 `CertificationRecordStatus` (stored on `certification_records`)

**TypeScript:**

```ts
export type CertificationRecordStatus =
  | 'draft'
  | 'pending_review'
  | 'active'
  | 'expired'
  | 'rejected'
  | 'superseded'
  | 'revoked';
```

| Value | Meaning |
|-------|---------|
| `draft` | Started; not submitted for review when review is required. |
| `pending_review` | Submitted; awaits recruiter decision **when** policy requires review. |
| `active` | Usable row (includes attestation-only when allowed **and** review not pending). |
| `expired` | Past validity (computed or manual). |
| `rejected` | Recruiter rejected evidence (see also **`review.status`**). |
| `superseded` | Replaced by newer record (optional in Phase 1; prefer **`superseded`** over deleting if product wants history). |
| `revoked` | Admin revoked. |

### 3.2 `CertificationReviewStatus` (sub-object **`review.status`**)

```ts
export type CertificationReviewStatus =
  | 'not_required'
  | 'submitted'
  | 'approved'
  | 'rejected';
```

| Value | Meaning |
|-------|---------|
| `not_required` | No approval step for this path/catalog. |
| `submitted` | Awaiting review. |
| `approved` | Approved. |
| `rejected` | Rejected; **`rejectionReason`** string required when status is `rejected`. |

### 3.3 `CertificationEvaluationStatus` (engine output **only** — not persisted)

**This is the “evaluation / readiness” vocabulary** used by **`evaluateCertificationRequirement`**. It **overlaps conceptually** with record status but is **not** 1:1 (e.g. **`missing`** has no record).

```ts
export type CertificationEvaluationStatus =
  | 'missing'
  | 'attested_only'
  | 'pending_review'
  | 'approved'
  | 'rejected'
  | 'expired'
  | 'expiring_soon'
  | 'invalid'
  | 'waived'
  | 'preferred_unmet';
```

**Naming note:** Architecture doc used **`invalid_for_requirement`** — Phase 1 code uses short **`invalid`** (wrong `catalogEntryId` / jurisdiction mismatch for the requirement). **`waived`** reserved; if not implemented, engine may return **`missing`** with reason code in **`reason`**.

**Dropped / do not use in code:** **`uploaded_pending_review`**.

### 3.4 `CertificationConfidence`

```ts
export type CertificationConfidence = 'high' | 'medium' | 'low';
```

| Value | Phase 1 deterministic rule (inputs: `EngineCertificationRecordInput` + catalog `requiresDocumentUpload` / `allowsSelfAttestation`) |
|-------|------------------------------------------------------------------------------------------------------------------------------------------|
| `high` | `review.status === 'approved'` **and** (`evidenceFilesCount > 0` **or** catalog does not require upload for this gate). |
| `medium` | Requirement satisfied with **attestation** where **`either`** / **`attestation_allowed`** and record is **`active`** with `review.not_required` or approved without file when upload optional. |
| `low` | **`draft`**, **`pending_review`**, **`attested_only`** when upload was required, **`rejected`**, or any ambiguous path. |

**No** ML / OCR weighting in Phase 1. Ignore **`extractionConfidence`** on record until OCR phase.

### 3.5 `CertificationSource` — **Phase 1 freeze (persisted on `certification_records`)**

Phase 1 writes **only** these three values. Do **not** persist **`apply_wizard`** (or any other entry-point label) on `source` in Phase 1.

```ts
/** Persisted on Firestore documents in Phase 1 — three values only. */
export type CertificationSourcePhase1 = 'admin_manual' | 'worker_upload' | 'worker_attestation';
```

| Write path | `source` value |
|------------|----------------|
| Recruiter / admin — **`LicensesAndCertsTab`** | **`admin_manual`** |
| Worker — **`EducationStep`** with an uploaded file (`fileUrl` present) | **`worker_upload`** |
| Worker — **`EducationStep`** without a file (attestation / claim path) | **`worker_attestation`** |

**Reserved for later phases (do not write in Phase 1):** `resume_parse`, `import_legacy`, `job_readiness_feed`, `integration`, and any **`apply_wizard`** string on `source`.

**Future analytics (Phase 2+):** Optional **`sourceContext`**: `'apply_wizard' | 'profile' | 'job_readiness_feed' | …`** may be added on the record if entry-point granularity is needed. **Phase 1** omits this field.

---

### 3.6 Record identity — `certificationRecordId` (Phase 1)

**Rule (frozen):**

1. **Generate a random** Firestore document id for each new **`certification_records`** doc (use Firestore `doc(collection(...)).id` or `uuid` — **not** a deterministic hash of `(uid, catalogEntryId, …)` for Phase 1).

2. On **successful dual-write**, persist that id on the matching legacy array element:

   **`users.certifications[].certificationRecordId`** (see §5.3).

3. **Updates** and **deletes** use this id for **`setDoc`/`updateDoc`/`deleteDoc`** on **`users/{uid}/certification_records/{certificationRecordId}`**, avoiding inference from name/catalog alone.

**Why random id + legacy pointer:** Stable pairing for edit/delete, cleaner migration audit, and less bug risk than deterministic ids colliding when users add multiple certs of the same catalog type over time.

---

### 3.7 Legacy array extension (temporary, Phase 1)

Each element of **`users.certifications[]`** may include:

```ts
/** Set when dual-write succeeded; links legacy row ↔ canonical doc. */
certificationRecordId?: string;
```

**When set:** Dual-write succeeded for that row; unified adapter and audit should **prefer** this for pairing.

**TypeScript:** Extend the local **`Certification`** / legacy row type where certifications are typed (e.g. **`LicensesAndCertsTab`**, **`EducationStep`**) to allow this optional field.

---

## 4. Exact collection / path decisions

| Data | Phase 1 path | Decision |
|------|----------------|----------|
| **Catalog** | **Repo:** `src/data/credentialsSeed.json` → **generated** `src/data/generated/certificationCatalogManifest.v1.json` (or adjacent path). **`catalogEntryId`** — **§4.1** immutability rules. **No** Firestore `certification_catalog_global` / **`tenants/.../certification_catalog_entries`** **required** in Phase 1. |
| **Certification records** | **`users/{userId}/certification_records/{certificationRecordId}`** — **only** canonical durable store for certs in Phase 1. |
| **Tenant review queue** | **Later (Phase 2+).** Phase 1: **optional** query on subcollection `where('review.status','==','submitted')` **if** product needs a list; **no** separate queue collection. |
| **Extraction subcollections** | **Not** in Phase 1. |
| **Migration audit** | **On user document:** field **`certMigrationAudit`** (typed blob, **`schemaVersion: 1`**). **Not** a top-level collection in Phase 1. |

**Add to `firestorePaths.ts`:** helpers for **`certification_records`** subcollection and document refs — avoid string duplication.

### 4.1 `catalogEntryId` immutability + manifest lock

**`catalogEntryId` (mandatory):**

- **`catalogEntryId` must NEVER change** once generated for a seed row.
- It must be **deterministic from seed** and **identical across local, staging, and prod** (same manifest input → same ids).
- **Implementation:** If the seed row has **`id`**, use it directly as **`catalogEntryId`** (preferred). **Do not** derive from **`displayName`** unless unavoidable; **never** regenerate in a way that changes existing ids.
- If a seed entry’s **name** changes later: **keep the same `catalogEntryId`**, add the **old name** to **`aliases`** in the manifest, **never** mutate ids.

**Generated manifest (mandatory):**

- **Commit** the generated **`certificationCatalogManifest.v1.json`** (or fixed filename) to the repo.
- **Do not** regenerate automatically at **runtime** in Phase 1 — consumers read the **checked-in** file. Regeneration is **explicit** (script **`npm run build:cert-manifest`** or documented manual step) and must pass **CI diff** when seed changes.
- **Optional:** a **checksum comment** at the top of the generated JSON (if tooling supports it) for quick eyeball verification.

---

## 5. Dual-write scope — exactly two entry points

### 5.1 Recruiter / admin — `LicensesAndCertsTab`

**File:** [`src/pages/UserProfile/components/LicensesAndCertsTab.tsx`](src/pages/UserProfile/components/LicensesAndCertsTab.tsx)

**Why this surface**

- Single place for **admin/recruiter CRUD** on a worker’s certifications when viewing **`uid`**.
- Already tied to **`credentialsSeed.json`** (Autocomplete options) and **`certificationVerification.ts`** (upload-required behavior).
- Audit confirms writes to **`users/{uid}`** with field **`certifications`** (array).

**What it writes today (legacy)**

- **`users.{uid}.certifications`**: array of objects `{ name, issuer?, expirationDate?, fileUrl?, fileName?, uploadedAt?, ... }`; **`updateDoc`** replace whole array on add; **`arrayRemove`** on delete.
- **Storage:** `users/{uid}/certifications/{certSlug}/{timestamp}-{fileName}`.
- **Note:** This tab **does not** currently show **`buildCanonicalWorkerProfileWritePatch`** in the audited snippet — Phase 1 **does not require** adding **`workerProfile.credentials.certifications`** here unless product insists; **scope = match current behavior + canonical**. If another code path mirrors profile, that remains **out of Phase 1** unless the same function is already called (verify before expanding).

**Phase 1 canonical writes (behind flag)**

1. Resolve **`catalogEntryId`** from selected **seed** option (match **`name`** → manifest entry / **`id`**). Run legacy row through **`normalizeLegacyCertificationRow`** (§5.4) before matching.
2. **`createOrUpdateCertificationRecord`** with **`source: 'admin_manual'`**, **`certificationRecordId`** = new random id (§3.6), evidence from **`fileUrl`**, dates, **`recordStatus`** / **`review`** per §5.5.
3. **After** successful creation/update of **`certification_record`**, **`updateDoc`** the legacy **`certifications`** entry with **`certificationRecordId`** (§5.3 — **not optional**).
4. On delete: **`deleteDoc`** on **`certification_records/{certificationRecordId}`** using the id from the legacy row, then remove the legacy element as today.

**Legacy writes:** **unchanged** (except adding / clearing **`certificationRecordId`** on dual-write paths) until explicit cutover milestone.

### 5.2 Worker — `EducationStep`

**File:** [`src/components/apply/steps/EducationStep.tsx`](src/components/apply/steps/EducationStep.tsx)

**Why this surface**

- Audit lists it as the **inline certification add** path with **`updateDoc(users/{uid}, { certifications })`** and shared quick-add patterns with the profile.
- Used from **apply wizard** and **Qualifications** flows (**`QualificationsStep`** / profile), giving **one integration** for **worker-entered** certs without touching **`JobReadinessFeed`**, **`RequirementsAcknowledgementStep`**, or **resume parser** in Phase 1.

**What it writes today (legacy)**

- **`users.{uid}.certifications`** (full array replace or debounced `updateDoc`); storage path same pattern as tab.

**Phase 1 canonical writes**

- On each add/update/remove that mutates **`certifications`**, mirror with **`createOrUpdateCertificationRecord`** / delete.
- **`source`:** **`worker_upload`** if **`fileUrl`** present, else **`worker_attestation`** only (§3.5 — **not** `apply_wizard`).
- Persist **`certificationRecordId`** on the legacy row **after** successful canonical write — **mandatory** (§5.3); failure path must not silently succeed.
- **`recordStatus`** / **`review`:** §5.5.
- **`tenantId`:** pass **when available** from context (optional field on record).

### 5.3 `certificationRecordId` mirroring — **required** for all dual-write paths

**Hard requirement:** On every dual-write path, **after** the **`certification_record`** document is **successfully** created or updated, the code **MUST** write **`certificationRecordId`** onto the matching legacy **`users.certifications[]`** element. This is **not** optional.

- If updating the legacy row with **`certificationRecordId`** **fails**: **log** an error (**`console.error`** in dev + structured object; hook optional error tracking), **do not** treat the operation as fully successful without surfacing failure, and **do not** silently continue as if mirrored.
- Operators must be able to observe **orphaned canonical docs** / **missing pointers** via logs and audits.

If the **canonical** write fails, do **not** set **`certificationRecordId`** on legacy (or roll back per product policy).

| Field | Type | Purpose |
|-------|------|--------|
| **`certificationRecordId`** | `string` | Same as Firestore doc id under **`certification_records`**; enables update/delete pairing and audit. |

### 5.4 `normalizeLegacyCertificationRow` (required helper)

**File:** `src/utils/certifications/normalizeLegacyCertificationRow.ts`

**Strict order (mandatory):** Run steps **in this sequence** — **never** resolve catalog against raw input.

1. **Normalize strings** — trim; treat all-whitespace as empty; collapse internal whitespace on **`name`**; optional fields **`null`** / omitted when empty.
2. **Normalize dates** — via **`normalizeDateToISODateString()`** (or equivalent): **YYYY-MM-DD** UTC where parseable; strip time **before** any comparison downstream.
3. **Then** resolve **`catalogEntryId`** via **`resolveCatalogEntry`** / manifest (exact / alias list only — **no** fuzzy match in Phase 1).

Use in dual-write paths, unified adapter legacy ingestion, and migration tooling.

### 5.4.1 Unknown / unmapped legacy catalog

If a normalized legacy certification **cannot** be mapped to the catalog:

- **Do not** guess; **do not** fuzzy-match silently.
- Return **`catalogEntryId = null`**, **`provenance = 'legacy_only'`**, and add **`mergeWarnings` / warnings** entry **`unmapped_legacy_name`** (see §6).

---

### 5.5 Review and record status defaults (Phase 1 — frozen)

These defaults avoid implementation guesswork. **Worker-entered data must never be auto-approved in Phase 1** — only recruiter/admin manual entry may default to approved.

#### Recruiter / admin — `LicensesAndCertsTab` (`source: 'admin_manual'`)

- **Default:** **`review.status = 'approved'`** and **`recordStatus = 'active'`** when the recruiter saves the cert row.
- **Rationale:** Data is entered in an admin/recruiter context; Phase 1 treats it as **recruiter-trusted** without a second approval queue.
- **Exception:** If the existing UI surfaces **`verificationStatus`** as “pending” for upload-required certs, map those rows to **`review.status = 'submitted'`** and **`recordStatus = 'pending_review'`** until a future review workflow exists (match current semantics; document in PR if this branch is implemented).

#### Worker — `EducationStep` (`source: 'worker_upload'` \| `worker_attestation`) — **never auto-approved**

| Condition | `review.status` | `recordStatus` | Notes |
|-----------|-----------------|----------------|--------|
| **File present** (`worker_upload`) | **`submitted`** | **`pending_review`** | Never default to **`approved`** for worker uploads in Phase 1. |
| **No file** (`worker_attestation`) **and** catalog **`allowsSelfAttestation === true`** | **`not_required`** | **`active`** | Only when policy allows attestation without upload; still **not** “recruiter-approved” — attestation path is structurally allowed. |
| **No file** **and** catalog **does not** allow self-attestation (upload required by catalog) | **`submitted`** | **`pending_review`** | Store honestly; **engine** treats as **`attested_only`** for upload gates until a file exists. |

**Engine:** For worker attestation when upload is required by policy, **`evaluateCertificationRequirement`** yields **`attested_only`** (not satisfied for upload gates) as appropriate.

#### Explicitly excluded from Phase 1 dual-write

- **`src/pages/c1/workers/JobReadinessFeed.tsx`**
- **`src/components/apply/steps/RequirementsAcknowledgementStep.tsx`**
- **`functions/src/resumeParser.ts`** (server)
- **`src/pages/JobPostingDetail.tsx`** quick fixes

List these as **Phase 1E** backlog after audit green.

---

## 6. Unified read adapter — `getWorkerCertificationsUnified`

**Module:** `src/utils/certifications/getWorkerCertificationsUnified.ts`

### Signature (contract)

```ts
export type UnifiedCertificationProvenance = 'canonical' | 'legacy_only' | 'merged';

export type UnifiedCertificationListItem = {
  /** Stable row id for React keys and support tooling */
  unifiedId: string;
  /** Canonical catalog id; null if legacy free-text could not be resolved */
  catalogEntryId: string | null;
  displayName: string;
  issuer?: string | null;
  /** ISO date string YYYY-MM-DD or null */
  expirationDate?: string | null;
  evidenceFileUrls: string[];
  provenance: UnifiedCertificationProvenance;
  certificationRecordId?: string;
  recordStatus?: CertificationRecordStatus;
  reviewStatus?: CertificationReviewStatus;
  /** Non-fatal issues (e.g. name match uncertain) */
  mergeWarnings?: string[];
};

export type GetWorkerCertificationsUnifiedResult = {
  items: UnifiedCertificationListItem[];
  canonicalCount: number;
  legacyOnlyCount: number;
  /** Dev/support warnings (unmapped legacy, ambiguous merges) */
  warnings: string[];
};

export async function getWorkerCertificationsUnified(
  uid: string,
  opts?: { tenantId?: string | null },
): Promise<GetWorkerCertificationsUnifiedResult>;
```

### Behavior (normative)

1. **Read** `users/{uid}` → **`certifications`** (legacy array).
2. **Query** **`users/{uid}/certification_records`** (all docs for Phase 1; paginate later if needed).
3. **Precedence:** For each **canonical** doc, if a **legacy** row corresponds to the same **`catalogEntryId`** (or **`certificationRecordId`** on the legacy object after dual-write), **merge**: field-level **canonical wins** for structured data; legacy fills gaps only for display (`mergeWarnings` if conflict).
4. **Duplicates (Phase 1 — no record merge):** If **multiple** legacy rows **or** multiple canonical docs resolve to the same **`catalogEntryId`**, **do not** merge or collapse rows into one durable record. The adapter selects **one** “best” row for display/evaluation (**deterministic rule**: document in code — e.g. newest **`updatedAt`**, then **`certificationRecordId`** tie-break), **ignores** the others for unified list / engine hand-off, and sets **`mergeWarnings: ['duplicate_catalog_entry_ignored']`** (or similar). This keeps Phase 1 deterministic; dedupe is **not** a Phase 1 goal.
5. **Legacy-only / unmapped** (no manifest match after §5.4): **`catalogEntryId: null`**, **`provenance: 'legacy_only'`**, **`unifiedId: legacy:<index>`**, **`warnings`** / **`mergeWarnings`** includes **`unmapped_legacy_name`** (see §5.4.1).
6. **Canonical-only** (post–dual-write, legacy not yet cleaned): **`provenance: 'canonical'`** or **`merged`** if shadow legacy still exists.
7. **`opts.tenantId`:** reserved for tenant-scoped review later; Phase 1 may ignore.

### Dev logging (mandatory)

In **`getWorkerCertificationsUnified`** and **`compareLegacyAndCanonicalCerts`** (audit), **`console.warn`** a **structured object** (not only strings) when encountering:

- **Unmapped legacy** names,
- **Duplicate** **`catalogEntryId`** / suspected duplicates,
- **Field mismatch** between paired legacy and canonical rows.

**Phase 1:** dev-oriented; **no silent failures** for these cases — logs supplement persisted audit fields.

### Phase 1 UI consumption

- **Safe:** profile “preview” panel, support tools, debug overlays.
- **Not safe yet:** **`jobScoreV1`**, placement, job order UIs — **do not wire** without Phase 3/4 sign-off.

---

## 7. Certification Readiness Engine (pure)

**Modules:** `evaluateCertificationRequirement.ts`, `deriveCertificationConfidence.ts`, `evaluateCertificationsForRequirements.ts`

### Date handling (mandatory)

- **`normalizeDateToISODateString()`** (or shared helper) is used for **all** expiration inputs and **all** comparisons.
- Compare **UTC calendar dates** only (**`YYYY-MM-DD`**); **strip** time components; **never** compare raw Firestore **`Timestamp`** / epoch values directly for “expired” / “expiring soon.”
- **`evaluateCertificationRequirement`** accepts **ISO date strings** for **`expirationDate`** and **`evaluationDate`**.

### Engine contract — **no matching inside engine** (mandatory)

**`evaluateCertificationRequirement` MUST:**

- Accept **at most one** pre-selected record (or **`null`**) that **already matches** the requirement’s **`catalogEntryId`** (exact).
- **Never** search a list of records, **never** iterate to “find” a match, **never** perform name/fuzzy matching — matching is **only** by **`catalogEntryId`** in **callers** (`getWorkerCertificationsUnified` / batch helper / future wiring).

**`evaluateCertificationsForRequirements`** may map *n* requirements to *m* records **outside** the per-requirement evaluator by pre-bucketing; the engine function itself stays **matching-free**.

### Input — requirement (Phase 1)

```ts
export type Phase1CertificationRequirement = {
  requirementId: string;
  catalogEntryId: string;
  scope: 'required' | 'preferred';
  evidencePolicy: 'upload_required' | 'attestation_allowed' | 'either';
  reviewPolicy: 'must_be_approved' | 'pending_ok_for_apply' | 'pending_ok_for_assignment';
  expirationPolicy: 'must_be_valid' | 'grace_days' | 'warn_only';
  gracePeriodDays?: number;
};

export type EvaluationContext = 'apply' | 'assignment' | 'generic';
```

### Input — certification record (narrow engine input)

The **caller** selects **at most one** “best” record per requirement **by** **`catalogEntryId`** (exact) **before** invoking the engine — **§7** “no matching inside engine.”

```ts
export type EngineCertificationRecordInput = {
  certificationRecordId: string;
  catalogEntryId: string;
  recordStatus: CertificationRecordStatus;
  review: { status: CertificationReviewStatus; rejectionReason?: string | null };
  evidenceFilesCount: number;
  expirationDate: string | null; // ISO date, end-of-day logic see below
  attestedWithoutFile: boolean;
};
```

**Building inputs from Firestore:** Map **`certification_records`** docs + catalog **`requiresDocumentUpload`**: **`attestedWithoutFile`** := `evidenceFilesCount === 0` **and** worker claims cert (record exists).

### Output

```ts
export type CertificationEvaluationResult = {
  status: CertificationEvaluationStatus;
  passesHardRequirement: boolean;
  passesSoftRequirement: boolean;
  blocking: boolean;
  severity: 'none' | 'warning' | 'blocking';
  reason: string;
  certificationRecordId?: string;
  confidence: CertificationConfidence;
};
```

### Deterministic business rules (Phase 1)

**Constants:** `EXPIRING_SOON_DAYS = 30`. **“Today”:** `evaluationDate` ISO date string passed into function (default **UTC date** from injected clock for tests).

**Expiration compare:** `expirationDate < evaluationDate` ⇒ treat as **expired** for **`must_be_valid`**. **`grace_days`:** not expired if `evaluationDate <= expirationDate + gracePeriodDays` (in days). **`warn_only`:** never **blocking** for expiration (still emit **`expiring_soon`** / **`expired`** with **`blocking: false`** where appropriate — see table).

| Situation | `status` | `blocking` | `severity` | `passesHardRequirement` |
|-----------|----------|------------|------------|-------------------------|
| No matching record | **`missing`** | `scope==='required'` → **true** | **blocking** if required else **warning** | false if required |
| Preferred only, missing | **`preferred_unmet`** | **false** | **none** | **true** (does not block hard gate) |
| Upload required by policy, no files | **`attested_only`** | **true** for required | **blocking** | false |
| Review `submitted` or record `pending_review`, **`reviewPolicy === must_be_approved`** | **`pending_review`** | **true** unless context relaxes (see below) | **warning** if `pending_ok_for_apply` and context `apply` | false until approved |
| Same as above but **`pending_ok_for_apply`** and **`evaluationContext === 'apply'`** | **`pending_review`** | **false** | **warning** | **true** (soft pass for apply only — product decision; **encode exactly in tests**) |
| **`pending_ok_for_assignment`** + context **`assignment`** | **`pending_review`** | **false** if policy says pending OK for placement; **else** blocking | per matrix | per tests |
| Approved, valid expiry | **`approved`** | false | none | true |
| Review `rejected` | **`rejected`** | required → true | blocking | false |
| Expired (must_be_valid) | **`expired`** | required → true | blocking | false |
| Expiring within **`EXPIRING_SOON_DAYS`** | **`expiring_soon`** | **false** | **warning** | **true** if not otherwise failed |
| Wrong id (caller mismatch) | **`invalid`** | true if required | blocking | false |
| Waived (future) | **`waived`** | false | none | true |

**`preferred_unmet`:** **`scope === 'preferred'`** and record missing or failed — **`blocking` always false**, **`passesHardRequirement` true**.

**Blocking vs warning (summary)**

- **blocking** ⇒ action items / hard gates **may** consume **`severity: 'blocking'`**.
- **warning** ⇒ show risk; **does not** fail **`passesHardRequirement`** unless **`blocking` true**.

**Confidence:** Always run **`deriveCertificationConfidence`** from final candidate record + outcome (§3.4).

**Purity:** **No I/O**; **no** stringMatching to **job** text.

---

## 8. Migration audit / comparison tooling

### Primary function

**`compareLegacyAndCanonicalCerts(uid: string): Promise<CertMigrationAuditResult>`**

**File:** `src/utils/certifications/compareLegacyAndCanonicalCerts.ts`

### Inputs

- Legacy: **`users/{uid}.certifications`**
- Canonical: all docs in **`users/{uid}/certification_records`**
- Manifest: for name → id mapping for legacy rows

### Output shape

```ts
export type CertMigrationAuditMismatchKind =
  | 'legacy_unmapped'
  | 'canonical_only'
  | 'count_mismatch'
  | 'field_mismatch'
  | 'expiration_missing_on_legacy'
  | 'duplicate_suspected';

export type CertMigrationAuditMismatch = {
  kind: CertMigrationAuditMismatchKind;
  detail: string;
  severity: 'info' | 'warning' | 'error';
};

export type CertMigrationAuditResult = {
  comparedAt: string;
  legacyCount: number;
  canonicalCount: number;
  mismatches: CertMigrationAuditMismatch[];
  summary: 'aligned' | 'needs_review';
};
```

### Persistence

**`writeCertMigrationAudit(uid, result)`** → `updateDoc(doc(db,'users',uid), { certMigrationAudit: { ...result, schemaVersion: 1 }, updatedAt })`  
**Merge** so other user fields are untouched.

### Mismatch classification

| Kind | Meaning | Default severity |
|------|---------|------------------|
| **`legacy_unmapped`** | Legacy `name` not mapped to **`catalogEntryId`** | warning |
| **`canonical_only`** | Record without legacy twin | info (expected during rollout) |
| **`count_mismatch`** | Paired count differs beyond threshold after id pairing | warning |
| **`field_mismatch`** | Paired but **expiration** / **issuer** differs materially | warning |
| **`expiration_missing_on_legacy`** | Catalog **`hasExpiration`** but legacy has no date | warning |
| **`duplicate_suspected`** | Multiple rows/docs for same **`catalogEntryId`** (no Phase 1 merge) | error |

#### `summary`: **`aligned`** vs **`needs_review`** (deterministic)

Set **`summary = 'needs_review'`** when **any** of:

| Rule | Rationale |
|------|-----------|
| Any mismatch with **`kind === 'duplicate_suspected'`** | Data-quality issue; human triage. |
| Any mismatch with **`kind === 'legacy_unmapped'`** | Legacy row could not be tied to catalog; blocking for clean migration. |
| **Two or more** mismatches with **`kind === 'field_mismatch'`** | Material drift between paired rows. |

**Do not** flip to **`needs_review`** for **`canonical_only` alone** during early rollout (expected while dual-write fills canonical without backfilled legacy twins).

Set **`summary = 'aligned'`** when none of the above rules fire and there are no **`severity: 'error'`** mismatches (individual **`field_mismatch`** / **`expiration_missing_on_legacy`** / **`count_mismatch`** alone, below the 2+ field threshold, may still leave **`aligned`** — operators read the **`mismatches`** array for detail).

### Optional batch

**`scripts/certMigrationAuditBatch.ts`:** reads UID list (file/stdin), runs compare, aggregates CSV — **dev/staging only**, Phase 1 optional.

---

## 9. Testing plan (Phase 1 gates)

| Area | Required tests |
|------|----------------|
| **Enum exhaustiveness** | `certificationEnums.test.ts` — assert all evaluation paths construct valid union (optional helper `assertNever`). |
| **Seed → manifest** | `buildCatalogManifestFromSeed.test.ts` — snapshot entry count, every **`id`** unique, **`catalogEntryId`** rule documented. |
| **Unified adapter** | `getWorkerCertificationsUnified.test.ts` — fixtures: canonical only, legacy only, merged pair, **duplicate `catalogEntryId`** (one winner + warning), unmapped name (`unmapped_legacy_name`). |
| **Expiration UTC** | `evaluateCertificationRequirement.test.ts` — boundary dates, **`grace_days`**, **`warn_only`**. |
| **Requirement matrix** | same — missing / attested_only / pending_review (policies) / approved / rejected / preferred_unmet. |
| **Confidence** | `deriveCertificationConfidence.test.ts` — matrix vs §3.4. |
| **Migration compare** | `compareLegacyAndCanonicalCerts.test.ts` — synthetic arrays + mock records. |
| **Legacy normalizer** | `normalizeLegacyCertificationRow.test.ts` — trim, dates, empty strings. |

**Fixtures:** `src/utils/certifications/__fixtures__/legacyCertArrays.ts`, `mockCertificationRecords.ts`.

**Coverage:** target **≥ 90%** line coverage on **`src/utils/certifications/**/*.ts`** excluding generated JSON.

---

## 10. Rollout plan

| Phase | Scope | Checkpoint |
|-------|--------|------------|
| **1A** | **Stop after:** enums + types → manifest generator → **committed** generated manifest → **`resolveCatalogEntry`** → **`normalizeLegacyCertificationRow`** + **`normalizeDateToISODateString`** → **`firestorePaths`** → **`firestore.rules`** → **tests** — **§13 final order**. **No** dual-write, **no** unified adapter beyond tests if flagged, **no** UI changes. | **Go/no-go §14** before **1B**. |
| **1B** | **`createOrUpdateCertificationRecord`**, **`getCanonicalCertificationRecords`**, **`getWorkerCertificationsUnified`**, unit tests. | Manual: dev user shows unified shape in console. |
| **1C** | Dual-write from **`LicensesAndCertsTab`** + **`EducationStep`** behind **`VITE_CERT_RECORDS_DUAL_WRITE`** (and optional Remote Config mirror for mobile if applicable). | Staging: records appear under **`certification_records`**; legacy unchanged. |
| **1D** | **`compareLegacyAndCanonicalCerts`** + **`writeCertMigrationAudit`** + internal “Run audit” control (admin-only). | **`certMigrationAudit`** visible on user doc. |
| **1E** | Engine **`evaluateCertificationRequirement`** + dev-only **`VITE_CERT_ENGINE_PREVIEW`** showing one canned requirement result (no scoring). | Product/legal sign-off on labels |

### Feature flags

- **`VITE_CERT_RECORDS_DUAL_WRITE`**: default **false** in prod until 1C validated.
- **`VITE_CERT_UNIFIED_READ_PREVIEW`**: optional UI for side-by-side legacy vs unified.
- **`VITE_CERT_ENGINE_PREVIEW`**: optional engine strip.

### Safe checkpoints

- After **1C**: spot-check N users — record count ≥ legacy mapped count; audit **no** unexpected **`field_mismatch`**.

### Rollback

- Disable **`VITE_CERT_RECORDS_DUAL_WRITE`** — legacy path unchanged.
- Canonical docs: **do not auto-delete** on rollback; optional admin script to remove **`certification_records`** for test users only.

---

## 11. Explicit out-of-scope (Phase 1)

- Job order / job posting **structured** certification requirements migration.
- **Scoring** (**`jobScoreV1`**, fit, synthetic demands, placement qualification chips).
- **Readiness snapshot** / **`buildAssignmentReadiness`** changes.
- **Action-item** generation rewires.
- **OCR**, **extractions** subcollections, **review queue UI** / collection.
- **`JobReadinessFeed`**, **`RequirementsAcknowledgementStep`**, **resume parser**, **`JobPostingDetail`** dual-write.
- **`workerProfile.credentials.certifications`** / **`workerCompliance.certifications`** normalization.
- **`worker_compliance_items`** cert bridging.
- Removing **`users.certifications`** writes or adding **ESLint** bans.
- **Multi-tenant** **`reviewsByTenant`** on one record.
- **Renewal / version chains / duplicate catalog ids:** Phase 1 **does not** merge multiple records sharing the same **`catalogEntryId`** (§6). Each upload creates **its own** doc; the unified adapter picks **one** for display/evaluation. Field **`superseded`** is **reserved** for later operational cleanup — **do not** build renewal-linking or merge logic in Phase 1.

---

## 12. Final “build first” recommendation

### Single best first coding task

**Land frozen TypeScript enums + `CertificationRecordV1` + `buildCatalogManifestFromSeed` output checked into `src/data/generated/` with a CI/script step that fails if seed changes without regenerating manifest.**  
Everything downstream imports **`catalogEntryId`** from **one** manifest — **no drift** before dual-write.

### Single biggest technical risk

**Pairing legacy array rows to canonical **`catalogEntryId`** without duplicated or wrong merges.** Mitigation: manifest **aliases**, optional **`certificationRecordId`** field backfilled onto legacy objects on write, and **warnings** in **`getWorkerCertificationsUnified`**.

### Single biggest data risk

**Dual-write skew** (legacy updated on a path that does not call **`createOrUpdateCertificationRecord`**). Mitigation: **only two** Phase 1 entry points, feature flag, **`certMigrationAudit`** before expanding scope.

---

## 13. Final execution order — Phase 1A (mandatory)

Use this **exact** sequence for **Phase 1A**. **STOP** after step **8** (tests); **do not** merge **1B** work until **§14** checklist passes and review.

1. **Enums + types** — `certificationEnums.ts`, **`CertificationRecordV1`**, catalog manifest types, legacy row type with **`certificationRecordId?: string`**.
2. **Catalog manifest generator** — `buildCatalogManifestFromSeed.ts`; **explicit** regen script; CI guard when seed changes.
3. **Generated manifest file** — commit **`src/data/generated/certificationCatalogManifest.v1.json`** (locked §4.1); optional checksum comment.
4. **Resolve helper** — **`resolveCatalogEntry.ts`** (deterministic; seed **`id`** preferred §4.1).
5. **Normalizer + date helper** — **`normalizeLegacyCertificationRow`** (order §5.4) + **`normalizeDateToISODateString`**.
6. **Firestore paths** — extend **`firestorePaths.ts`** for **`certification_records`**.
7. **Rules** — `firestore.rules` match for **`users/{userId}/certification_records/{recordId}`** (+ indexes only when query shape fixed).
8. **Tests** — unit tests for manifest, resolve, normalizer, date helper, rules-safe assumptions as applicable.

**After STOP:** **1B** proceeds with **`createOrUpdateCertificationRecord`**, **`getCanonicalCertificationRecords`**, **`getWorkerCertificationsUnified`**, **`evaluateCertificationRequirement`**, dual-write (**`VITE_CERT_RECORDS_DUAL_WRITE`**), migration audit — only per rollout §10 and **§14**.

**Not yet (until post–1A review):** Dual-write UI wiring, unified adapter in product, **`evaluateCertificationRequirement`** in production readiness/scoring (Phase 2 note §15).

---

## 14. Go / no-go checklist before Phase 1B

After **Phase 1A** (**§13**) is complete, confirm **all** before starting **Phase 1B**:

1. **Manifest** is stable, **committed**, and **not** regenerated at runtime (§4.1).
2. **`catalogEntryId`** values do **not** change between manifest regen runs for the same seed (deterministic §4.1).
3. **Types compile** cleanly across the repo (`tsc` / project build).
4. **No circular imports** introduced under **`src/utils/certifications/`** / **`src/types/certifications/`**.
5. **Tests pass** (CI / local).
6. **No UI changes** occurred in Phase 1A (profile tabs, apply steps unchanged).

Only then proceed to **Phase 1B** (canonical read/write, unified adapter, engine modules, etc., per §10).

---

## 15. Phase 2 integration note (safety)

**Phase 2** should introduce **`evaluateCertificationRequirement`** only in **side-by-side validation** (shadow / feature-flagged parity vs legacy behavior) **before** replacing any existing **readiness**, **scoring**, or **placement** production logic. That gated comparison is the safest bridge after Phase 1 foundation is stable.

---

## Document control

| Version | Date | Notes |
|---------|------|-------|
| 1.0 | 2026-04-21 | Initial Phase 1 build spec |
| 1.1 | 2026-04-21 | Implementation-ready: contracts, enum freeze, paths, rollout, repo-accurate writes |
| 1.2 | 2026-04-21 | Source enum freeze, record id + legacy extension, review defaults, normalizer, audit thresholds, renewal non-goal, implementation order, Phase 2 note |
| 1.3 | 2026-04-21 | Final hardening: catalog immutability + manifest lock; mandatory `certificationRecordId` mirroring + failure visibility; normalizer order + unmapped legacy; worker never auto-approved; UTC date helper; adapter duplicate policy + dev `console.warn`; engine pre-filter contract; Phase 1A execution order + §14 go/no-go before 1B |
