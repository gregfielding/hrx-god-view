# Certifications System Audit

**Scope:** Real code paths in this repository (`src/`, `functions/`, shared rules/config).  
**Date:** Based on repository state at audit time.  
**Purpose:** Map how certifications work today (no redesign proposals).

---

## 1. Certification Types

### 1.1 Compliance framework (structured type keys)

**File:** `src/types/compliance.ts`

- **`COMPLIANCE_ITEM_TYPE_KEYS`** — includes credential-style keys: `food_handler`, `cpr_bls`, `forklift_certification`, plus screenings/eligibility types.
- **`COMPLIANCE_ITEM_TYPES`** — human labels and `hasExpiration` per type (e.g. `forklift_certification` → label “Forklift certification”, `hasExpiration: true`).
- Used for **`WorkerComplianceItem`** and admin/compliance UI concepts; **not** the same as free-text `users.certifications[]` names.

**Nature:** Hardcoded TypeScript enums/constants; **not** loaded from Firestore as master data in this file.

### 1.2 Seed catalog (large list of license/cert names)

**File:** `src/data/credentialsSeed.json`

- JSON array of objects: `id`, `name`, `type` (`"License"` / `"Certification"` / …), `category`, `issuer`, `validity_period_years`, `required_for`, `verification_method`, `is_active`.

**Consumers (non-exhaustive):**

- `src/pages/UserProfile/components/LicensesAndCertsTab.tsx` — filters `is_active && type === 'Certification'` and `type === 'License'` for Autocomplete options; combined into `allCertificationOptions`.
- `src/pages/TenantViews/settings/CredentialTypesPlaceholder.tsx` (referenced in tree; placeholder UI).

**Nature:** **Static JSON** shipped with the app; **not** tenant-edited in Firestore in the audited paths (tenant “Required certifications” defaults use a different mechanism — see §1.4).

### 1.3 Quick-add / UI example strings (hardcoded)

| Location | Content |
|----------|---------|
| `src/pages/UserProfile/components/LicensesAndCertsTab.tsx` | `quickAddCertifications`: CNA, ServSafe Manager, Food Handler Card, CPR / First Aid, First Aid / CPR |
| `src/components/apply/steps/EducationStep.tsx` | Same style quick-add list (Food Handler Card, etc.) in copy |
| `src/constants/workerAiPrescreenOpeningSteps.ts` | Example: `{ value: 'forklift', label: 'Forklift' }` |
| `src/pages/TenantViews/CompanyDefaultsTabs/OptionTab.tsx` | Demo defaults: skills/licenses arrays including “Forklift Certification”, “TWIC Card” |
| `src/pages/TenantViews/FlexPositions.tsx` | Hardcoded role → `certifications` / `licenses` arrays (e.g. Forklift Driver) |
| `src/utils/jobReadinessOpportunityMap.ts` | Labels like “Food Handler certification”, “Forklift certification” for opportunity cards |

### 1.4 Tenant / company defaults

**File:** `src/pages/TenantViews/CompanyDefaultsTabs/RequiredCertificationsTab.tsx`

- Renders **`OptionTab`** with `sectionKey="certifications"` — option strings are **tenant-configured** via that shared component (store path determined inside `OptionTab`, not re-audited here in full detail).

### 1.5 Job scoring packs (requirement rubric, not UI catalog)

**Files:**

- `src/data/jobRequirementPacks.ts` — pack `nursing_w2` has must-have key **`certifications`** (“At least one certification / license”) as an **aggregate** profile gate, not a list of named certs.
- `src/data/jobRequirementPacksV1.ts` — per-pack **`requiredCerts`** string arrays (e.g. `nursing_w2`: `['RN', 'BLS']`); warehouse/general often `[]`.

### 1.6 Duplication / inconsistency (types)

- **Three parallel “universes”:**  
  (1) **`COMPLIANCE_ITEM_TYPES`** keys (`food_handler`, …),  
  (2) **`credentialsSeed.json`** display names,  
  (3) **free-text** strings on job postings / job orders / user profile rows.
- **String matching** bridges these in places (e.g. partial name match) rather than a single ID space everywhere (see §6).

---

## 2. Worker Input Flows

### 2.1 Application wizard

**File:** `src/components/apply/Wizard.tsx`

- Qualifications step holds **`qualifications.certifications`** (and related fields).
- **Save to Firestore:** `users/{uid}` with root field **`certifications`** (and `updatedAt`) in multiple code paths (e.g. ~1831–1852, ~2326); uses **`buildCanonicalWorkerProfileWritePatch`** where applicable so **`workerProfile.credentials.certifications`** can be set in parallel when that helper is used (see `src/utils/workerReadinessWriteModel.ts`).

**Related steps:**

- `src/components/apply/steps/QualificationsStep.tsx` — embeds **`SkillsTab`** / **`EducationSection`** with `userData` including `certifications`; updates go through **`queueProfileUpdate`** / **`buildCanonicalWorkerProfileWritePatch`** / `updateDoc`.
- `src/components/apply/steps/EducationStep.tsx` — **inline certification add** (dialog + optional file upload); can **`updateDoc(users/{uid}, { certifications: updated })`** when flushing immediately after upload.

**File:** `src/components/apply/steps/RequirementsAcknowledgementStep.tsx`

- For each required **license/certification** string from the job posting, collects **Yes / No / Maybe** and optional **upload** for upload-required labels.
- Uses **`buildCertificationUploadWritePatch`** / **`arrayUnion`** / **`buildCertificationReplaceWritePatch`** from `workerReadinessWriteModel.ts` so writes hit **`certifications`** and **`workerProfile.credentials.certifications`**.

### 2.2 Job posting detail (logged-in worker fixing gaps)

**File:** `src/pages/JobPostingDetail.tsx` — **`handleRequirementFix`**

- For **`category === 'licenses'`** (or similar branch): **Yes** → **`arrayUnion({ name: label })`** on `certifications`; **No** → filters out matching cert objects unless they have **`fileUrl`** (keeps uploaded proofs).

### 2.3 Worker profile (recruiter/admin view of worker)

**File:** `src/pages/UserProfile/components/LicensesAndCertsTab.tsx`

- **CRUD** on **`users.{uid}.certifications`** array only (see §3).
- **Storage upload path:** `users/{uid}/certifications/{certSlug}/{timestamp}-{fileName}`.
- Optional fields on each entry: **`name`**, **`issuer`**, **`expirationDate`**, **`fileUrl`**, **`fileName`**, **`uploadedAt`**, **`verificationStatus`** (comment: recruiter/admin).

**File:** `src/pages/UserProfile/components/QualificationsTab.tsx`

- Reuses apply **`QualificationsStep`** / **`EducationStep`** in profile context for editing qualifications including certifications.

### 2.4 C1 worker home / job readiness feed

**File:** `src/pages/c1/workers/JobReadinessFeed.tsx`

- **Cert prompt keys:** `food_handler`, `alcohol`, `forklift`, `other` with mapped display names (e.g. forklift → “Forklift Certification”).
- **Upload:** writes to **`users/{uid}`** with:
  - **`certifications`**: array append with `{ name, fileName, fileUrl, uploadedAt, source: 'job_readiness' }`
  - **`workerProfile.credentials.certifications`**: same array (duplicate write).

### 2.5 Resume parsing (server)

**File:** `functions/src/resumeParser.ts`

- Zod schemas include **`certifications`** array; merged profile patch can set **`updates.certifications`** / **`patch.certifications`** when AI extraction returns certs.

### 2.6 AI scoring / fit (server)

**File:** `functions/src/calculateApplicantFitScore.ts`

- Treats **`userData.certifications`** as a list (+length) for bonus points; logs first few **`name`** fields.

### 2.7 Compliance items (parallel track)

**Collection:** `tenants/{tenantId}/worker_compliance_items` (see `functions/src/readiness/hrxReadinessSnapshotLoadContext.ts`)

- Loaded for assignment readiness; **not** the same document as `users.certifications` array entries (see §3 and §5).

---

## 3. Firestore Data Model

### 3.1 Primary worker storage: `users/{uid}`

| Field | Shape | Notes |
|-------|--------|--------|
| **`certifications`** | **`any[]`** in `UserProfile` (`src/types/UserProfile.ts`) | **Primary legacy/root store.** Elements are often objects `{ name, ... }` or historically strings (handled in utilities). |
| **`workerProfile.credentials.certifications`** | Mirror / canonical target | Set by **`buildCanonicalWorkerProfileWritePatch`** when `partial.certifications` is supplied (`workerReadinessWriteModel.ts`). |
| **`workerCompliance.certifications`** | Object map (values normalized in `jobReadinessReadModel.ts`) | Referenced in **`READINESS_INPUT_DOMAIN_MAP`** / **`getCanonicalCertifications`** — optional second source. |
| **`jobReadinessResponses`** | Map of question id → `{ value, ... }` | Used e.g. for improvement tasks / food-handler style questions (`jobReadinessTasks.ts`). |
| **`workerProfile.readiness.responses`** | Nested responses | Used by home readiness (`homeReadinessModel.ts`) for “in_progress” without array certs. |

**Types:** There is **no** single shared TypeScript interface enforced for every element of `users.certifications` across the app; **LicensesAndCertsTab** uses a local **`Certification`** interface with optional **`verificationStatus`**.

### 3.2 Firebase Storage

**Rules:** `storage.rules` — `match /users/{userId}/certifications/{certSlug}/{fileName}` (authenticated user owns writes).

**Pattern in code:** `users/{uid}/certifications/{slug}/{timestamp}-{originalName}`.

### 3.3 Job / hiring requirements (employer-facing)

**File:** `src/types/recruiter/jobOrder.ts` (actual recruiter app model)

- **`requiredLicenses: string[]`**
- **`requiredCertifications: string[]`**
- **`requiredCertificationComplianceIds?: string[]`** — optional **`worker_compliance_items` doc IDs** for allowlisting readiness rows.

**Legacy / alternate model:** `src/types/NewDataModel.ts` — **`JobOrder.certifications: string[]`** (authoritative comment in file; may not match all live `job_orders` docs).

**Job postings:** Wizard / posting flows use nested **`requirements.certifications`** (seen in `Wizard.tsx`); stored on whatever document backs public postings (exact collection name varies — **Wizard** reads `posting?.requirements?.certifications`).

### 3.4 Assignment readiness snapshot inputs (server)

**File:** `functions/src/readiness/hrxReadinessSnapshotLoadContext.ts`

- Reads **`tenants/{tenantId}/worker_compliance_items`** for user; maps each relevant row to **`{ key: docId, label, complete }`** where **`complete`** ← status `complete` / `approved` / legacy **`completed`**.
- **`mergeJobOrderSyntheticCertificationDemands`** merges JO **`requiredCertifications`**, **`requiredLicenses`**, **`requiredCertificationComplianceIds`** with compliance rows (see `src/shared/jobOrderSyntheticCertificationDemands.ts`).

### 3.5 Applications / assignments / onboardingInstances

- **Audited grep-driven finding:** certification **writes** in apply flows target **`users/{uid}`** heavily; **application** documents may duplicate some state depending on submit handlers — **not** fully enumerated here without tracing every submit path. No single `applications.certifications` schema file was found in the same first-class way as `users.certifications`.

---

## 4. UI Surfaces

### 4.1 Worker-facing

| Surface | File(s) | Capabilities |
|---------|---------|----------------|
| Apply Wizard — Qualifications | `QualificationsStep.tsx`, `Wizard.tsx` | Edit certs as part of qualifications; saves to user doc |
| Apply — Education (certs subsection) | `EducationStep.tsx` | Add cert + optional file; immediate Firestore flush on upload |
| Apply — Requirements acknowledgement | `RequirementsAcknowledgementStep.tsx` | Yes/No/Maybe + uploads for required cert **strings** |
| Job posting detail | `JobPostingDetail.tsx` | Quick fix: add/remove cert by **label** |
| Profile hub — Qualifications tab | `QualificationsTab.tsx` | Same building blocks as apply |
| Licenses & Certs tab | `LicensesAndCertsTab.tsx` | Full add/edit/delete; expiration, issuer, optional upload, **`verificationStatus`** display |
| C1 Job Readiness feed | `JobReadinessFeed.tsx` | Guided cert uploads (Food Handler, Alcohol, Forklift, Other) |
| Home readiness checklist | `homeReadinessModel.ts` | **“Add certifications”** item — complete if **any** cert in canonical or legacy array, or readiness response |
| Improvement tasks | `jobReadinessTasks.ts`, `ImprovementTaskCard.tsx` | “Certification” tasks; uses **`userDoc.certifications`** length and **`jobReadinessResponses`** |

**Modal display:** `src/pages/UserProfile/components/CertificationsModal.tsx` — read-only list with download / expiry indicators (props passed in).

### 4.2 Admin / recruiter

| Surface | Notes |
|---------|--------|
| User profile tabs | `LicensesAndCertsTab` when viewing worker `uid` |
| Company defaults — Required certifications | `RequiredCertificationsTab.tsx` → `OptionTab` |
| Tenant credential types placeholder | `CredentialTypesPlaceholder.tsx` (settings) |

### 4.3 Approval / verification

- **`LicensesAndCertsTab`** supports **`verificationStatus`** on entries for upload-required flow (`certificationVerification.ts` defines **`missing` \| `uploaded` \| `verified` \| `expired`**).
- **`isUploadRequiredCert`** in `certificationVerification.ts` uses **substring patterns** (food handler, cpr, forklift, etc.) — not tied to `COMPLIANCE_ITEM_TYPE_KEYS`.

---

## 5. Job Requirements Integration

### 5.1 Can a job require certifications?

**Yes**, as **string lists**:

- Recruiter **job orders:** `requiredCertifications`, `requiredLicenses`, optional `requiredCertificationComplianceIds`.
- **Job postings / apply:** `requirements.certifications` (and licenses) consumed in `Wizard` / `RequirementsAcknowledgementStep`.
- **Flex demo data:** `FlexPositions.tsx` hardcodes role templates.

### 5.2 Where requirements are stored

- **Primary (recruiter):** `job_orders` fields on **`JobOrder`** interface (`src/types/recruiter/jobOrder.ts`).
- **Scoring packs:** `JOB_REQUIREMENT_PACKS_V1` / `getRequirementPackV1` — **`requiredCerts`** for **job match score**, independent of job order strings unless wired elsewhere.

### 5.3 Enforcement vs display

| Mechanism | Enforcement |
|-----------|-------------|
| **`buildAssignmentReadiness`** (`src/shared/buildAssignmentReadiness.ts`) | Cert rows are **`severity: 'warning'`**, not hard block; comment in file: **“flexible warnings; no blocking enforcement in UI”**. |
| **Placement chips** | `placementQualificationChipsModel.ts` — **red blockers** for incomplete **`cert_*`** only when **allowlisted** against **that job order’s** required strings/IDs (explicit policy). |
| **Job Match Score v1** | `jobScoreV1.ts` — **`eligible`** can be **false** if **`requiredCerts`** marked hard importance and worker name match fails (**substring** match on **`user.certifications`** names only). |
| **`checkMissingCertifications`** | `src/utils/checkMissingCertifications.ts` — **pure function** returning missing strings; caller-dependent whether it blocks. |
| **Home / onboarding checklist** | Informational / progress; certification step can be **in_progress** via **`workerProfile.readiness.responses`**. |

### 5.4 Readiness snapshot / assignment

**File:** `functions/src/readiness/hrxReadinessSnapshotLoadContext.ts`

- **`certifications`** passed to shared builder = **compliance items** + **synthetic** demands from job order strings.
- **`complete`** for compliance rows: status **`complete` / `approved`** or legacy **`completed` boolean**.

**File:** `src/shared/jobOrderSyntheticCertificationDemands.ts`

- If JO lists a required string but no matching **`worker_compliance_items`** row exists, adds **synthetic** missing row (`complete: false`).

---

## 6. Validation Logic

| Location | What it does |
|----------|----------------|
| `src/utils/checkMissingCertifications.ts` | Compare **required** string list to **user** cert **names**; exact + partial match before `(` in required label |
| `src/utils/certificationVerification.ts` | **`isUploadRequiredCert`**, **`getCertificationVerificationStatus`**, **`findProfileCertForRequirement`** — pattern-based |
| `src/utils/jobReadinessReadModel.ts` | **`buildJobReadinessReadModel`**, **`getCanonicalCertifications`** — merges `workerProfile.credentials.certifications`, `workerCompliance.certifications` map, fallback **`users.certifications`** |
| `src/utils/jobScoreV1.ts` | **`getWorkerCertNames`** — **root `certifications` only**; substring match vs pack **`requiredCerts`** |
| `src/utils/homeReadinessModel.ts` | **`hasCertifications`** — checks **both** `workerProfile.credentials.certifications` **and** root **`certifications`** |
| `src/components/worker/profile/readinessPrompts.ts` | **`userDoc.certifications`** only (not canonical path) |
| `src/shared/jobOrderSyntheticCertificationDemands.ts` + `placementQualificationChipsModel.ts` | Label normalization / substring rules for JO vs snapshot rows |
| `functions/src/calculateApplicantFitScore.ts` | Length / presence bonus on **`userData.certifications`** |

**Strict vs advisory:** Placement blockers and job score can be **strict** in narrow contexts; **assignment readiness** struct treats certs as **warnings**; **string** matching everywhere implies **soft** consistency.

---

## 7. Current System Issues

1. **Multiple storage paths for the “same” concept:** root **`certifications`**, **`workerProfile.credentials.certifications`**, optional **`workerCompliance.certifications`**, plus **`tenants/.../worker_compliance_items`** for readiness. Not all writes update all paths; **JobReadinessFeed** double-writes array to two paths; **LicensesAndCertsTab** writes **root only** in the audited snippet.

2. **No single source of truth for type IDs:** compliance **`food_handler`** vs seed **“Food Handler Card”** vs arbitrary job strings vs partial substring matchers.

3. **Multiple ways to “have” a cert:** structured objects with file; **`{ name }` only** from Yes flows; **readiness question responses** without array entries; **resume import** strings/objects.

4. **Scoring vs readiness divergence:** **`jobScoreV1`** reads **`user.certifications`**; **`getCanonicalCertifications`** prefers **`workerProfile.credentials`** first — potential **stale or divergent** score if only one path updated.

5. **Readiness prompts** (`readinessPrompts.ts`) only inspect **`userDoc.certifications`**, ignoring canonical credentials path → **false “missing” prompts** if data only under **`workerProfile.credentials`**.

6. **Job order `requiredCertificationComplianceIds`** depends on **`worker_compliance_items`** doc IDs matching snapshot **`cert_<id>`** keys — operational coordination required; synthetic **`cert_required_*`** keys when no item exists.

7. **Expiration:** UI and **`certificationVerification`** support expiration; **enforcement** is inconsistent (display vs “expired” status vs assignment blocking).

8. **Duplicate / legacy trees:** `recovered_from_hosting/` contains parallel copies of several files (e.g. `EducationStep`, `QualificationsStep`) — risk of **drift** if edits happen in wrong tree (audit focused on active `src/`).

9. **Tenant “credential types”:** mix of **OptionTab**-driven lists, **`credentialsSeed.json`**, and compliance types — **three** configuration layers.

10. **Assignments:** No evidence in audited slices that **assignment creation** is **blocked** solely by missing certifications at the API level; placement UI uses **readinessSnapshotV1** + allowlist policy instead.

---

## Appendix: Key file index

| Area | Files |
|------|--------|
| Types | `src/types/compliance.ts`, `src/types/UserProfile.ts`, `src/types/recruiter/jobOrder.ts`, `src/types/jobScore.ts` |
| Seed / packs | `src/data/credentialsSeed.json`, `src/data/jobRequirementPacks.ts`, `src/data/jobRequirementPacksV1.ts` |
| Write patches | `src/utils/workerReadinessWriteModel.ts` |
| Matching / verify | `src/utils/checkMissingCertifications.ts`, `src/utils/certificationVerification.ts` |
| Read models | `src/utils/jobReadinessReadModel.ts`, `src/utils/homeReadinessModel.ts` |
| Assignment / placement | `src/shared/buildAssignmentReadiness.ts`, `src/shared/jobOrderSyntheticCertificationDemands.ts`, `src/utils/placementQualificationChipsModel.ts` |
| Server readiness | `functions/src/readiness/hrxReadinessSnapshotLoadContext.ts` |
| Resume / score | `functions/src/resumeParser.ts`, `functions/src/calculateApplicantFitScore.ts` |
| Apply / profile UI | `src/components/apply/Wizard.tsx`, `RequirementsAcknowledgementStep.tsx`, `QualificationsStep.tsx`, `EducationStep.tsx`, `LicensesAndCertsTab.tsx`, `JobPostingDetail.tsx`, `JobReadinessFeed.tsx` |
