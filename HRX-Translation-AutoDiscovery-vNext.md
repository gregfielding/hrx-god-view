# HRX Auto-Translation vNext — “Translate All Worker-Facing Fields” (i18n Auto-Discovery)
**Goal:** Eliminate per-collection field lists by automatically translating **all worker-facing fields** that are explicitly marked as translatable via the `_i18n` convention.

> **Answer to your question:** **Yes** — we should apply the same rules to **job_orders** (and shifts, crm_companies, crm_locations).  
> The rule is: **If a field is worker-facing and should be bilingual, store it as `{field}_i18n.en`**. The engine will auto-generate `{field}_i18n.es`.

---

## 1) Core Principle (Future-Proofing)
### ✅ Translate only fields you explicitly mark
We **do not** translate “every string in the document” (too risky: names, addresses, IDs, emails, URLs, internal notes).

Instead:
- Any top-level key ending in `_i18n` is considered translatable.
- The value is expected to be an object like:
  ```json
  {
    "en": "English source text",
    "es": "Spanish translation"
  }
  ```
- The translation engine:
  - Detects all `*_i18n.en` strings
  - Translates them to `*_i18n.es`
  - Stores per-field hashes in `translationMeta.es.fieldHashes`
  - Respects `translationMeta.es.manualFields` (per-field locks)
  - Skips long content (> 8000 chars) and logs `skippedDueToLength`

**Outcome:** Add new worker-facing fields later (e.g., `parkingInstructions_i18n.en`) and translations happen automatically — no code change, no field list updates.

---

## 2) Apply This to Job Orders?
### ✅ Yes — and it’s the correct model
Job order docs are a major source of worker-facing content:
- instructions
- PPE / uniform
- where to report
- attendance policy
- parking / entry instructions
- supervisor notes
- shift-specific notes (often in `shifts` subcollection)

**Rule:** Any job order field you want shown in Spanish becomes `*_i18n.en` in the doc. The engine generates `.es`.

---

## 3) What Changes in the Codebase (High Level)
### Before (Phase 1)
- Hardcoded field lists for job_postings:
  - `postTitle_i18n`, `jobTitle_i18n`, etc.
- Trigger computed translation work based on that explicit list.

### After (vNext)
- No per-collection field lists.
- A generic “discover translatable fields” function scans doc data for:
  - keys ending in `_i18n`
  - with `value.en` as a non-empty string
- `needsTranslation()` uses auto-discovered fields.
- Worker continues to translate in batches and write back `*_i18n.es` + metadata.

---

## 4) Implementation Plan (Cursor Checklist)

### 4.1 Add Auto-Discovery Helper
**File:** `functions/src/translation/discoverI18nFields.ts`

**Responsibilities:**
- Input: Firestore doc `afterData` object and optional `manualFields` array
- Output: list of fieldPaths to translate, e.g.:
  - `["jobDescription_i18n", "instructions_i18n", "ppe_i18n"]`

**Rules:**
- Only consider keys that end with `_i18n`
- Ensure value is an object and `value.en` is a string
- Exclude any field in `manualFields`
- Optional: skip if `value.en` is empty/whitespace

### 4.2 Update `needsTranslation()` to Support Auto Mode
**File:** `functions/src/translation/needsTranslation.ts`

**Change:**
- Add overload/support for either:
  - a provided field list (legacy), OR
  - `autoDiscover=true` (new default)

**New behavior (recommended default):**
- Determine candidate fields from `discoverI18nFields(afterData, manualFields)`
- For each field:
  - Translate if:
    - `*_i18n.es` missing OR stale hash
    - not doc-level manual lock
    - not field-level manual lock

### 4.3 Update Trigger(s) to Use Auto-Discovery
**Phase 1 trigger:** `functions/src/triggers/onJobPostingWrite.ts`
- Remove dependency on Phase 1 field list
- Use `needsTranslation({ before, after, autoDiscover: true })`

### 4.4 Add Triggers for Additional Worker-Facing Docs (Phase 2)
Add minimal wrapper triggers that all use the same auto-discovery logic:

1) **Job Orders**
- Path: `tenants/{tenantId}/job_orders/{jobOrderId}`
- File: `functions/src/triggers/onJobOrderWrite.ts`

2) **Shifts**
- Path: `tenants/{tenantId}/job_orders/{jobOrderId}/shifts/{shiftId}`
- File: `functions/src/triggers/onShiftWrite.ts`

3) **CRM Companies (worker-visible portions only)**
- Path: `tenants/{tenantId}/crm_companies/{companyId}`
- File: `functions/src/triggers/onCrmCompanyWrite.ts`

4) **CRM Locations**
- Path: `tenants/{tenantId}/crm_companies/{companyId}/locations/{locationId}`
- File: `functions/src/triggers/onCrmLocationWrite.ts`

**All triggers follow the same steps:**
- if `TRANSLATION_ENABLED !== "true"` → return
- if `isTranslationOnlyWrite(before, after)` → return
- compute `fieldsToTranslate` via auto-discovery + hash checks
- if none → return
- enqueue **one** Cloud Task with payload `{ tenantId, docPath, fieldsToTranslate, lang: "es" }`

### 4.5 Worker (`processTranslationJob`) Stays the Same
It already supports:
- payload with docPath + fields list
- glossary/doNotTranslate settings
- per-field hashes
- per-field manual locks
- placeholder validation
- 8000 char guard + `skippedDueToLength` logging
- single Firestore update write

No major changes required.

---

## 5) Data Rules for Product/UX (So You Don’t Forget Later)
### 5.1 “Worker-Facing Content” Definition
A field should use `_i18n` if it’s displayed to workers in:
- worker portal (`/c1/workers/*`)
- jobs board list/detail (logged-in worker)
- forthcoming Flutter app

**Examples to mark as `_i18n`:**
- `instructions_i18n`
- `whereToReport_i18n`
- `ppe_i18n`
- `uniform_i18n`
- `parkingInstructions_i18n`
- `entryInstructions_i18n`
- `attendancePolicy_i18n`
- `shiftNotes_i18n`

### 5.2 “Never Translate” (leave as normal fields)
- company legal name / brand name
- addresses (street/city/state/zip)
- emails, phone numbers, URLs
- internal recruiter notes (unless explicitly meant for worker)

If you want labels in Spanish (e.g., “Worksite address”), translate the **UI strings**, not the underlying data.

---

## 6) Migration / Backfill Strategy (Minimal)
**Best practice:** When creating/updating worker-facing content, always write `*_i18n.en` as the canonical source.

For existing docs:
- Option A: Slowly normalize by writing `_i18n.en` during edits
- Option B: Run a one-time backfill script to copy legacy fields → `_i18n.en`
  - Example: `instructions` → `instructions_i18n.en`
  - Once copied, the triggers will translate automatically.

---

## 7) Tests to Add/Update (Jest/Mocha)
Add tests for auto-discovery logic:

1) `discoverI18nFields()`
- finds all `*_i18n` keys with non-empty `.en`
- skips missing `.en`
- skips fields present in `manualFields`

2) `needsTranslation()` with auto mode
- translates missing `.es`
- skips when hashes match
- respects doc-level manual status
- respects per-field manualFields exclusion

3) `isTranslationOnlyWrite()` remains unchanged
- still detects updates limited to `*_i18n.es` + `translationMeta`

---

## 8) Rollout Plan (Safe)
1) Convert **job_postings trigger** to auto mode (no list)
2) Deploy, test job_postings end-to-end
3) Add **job_orders trigger** (auto mode), deploy, test
4) Add **shifts trigger**, deploy, test
5) Add **crm_locations**, then (optional) **crm_companies**

Keep `TRANSLATION_ENABLED=false` until each step is deployed and verified.

---

## 9) Acceptance Criteria
- Adding a new field like `parkingInstructions_i18n.en` results in automatic Spanish translation without code updates.
- No translation loops occur (trigger ignores translation-only writes).
- Manual locks prevent overwrites for specified fields.
- Per-field hashes prevent redundant translations.
- Oversized fields are skipped and logged in `translation_logs.skippedDueToLength`.
- Worker portal + Flutter render Spanish using:
  `field_i18n[preferredLanguage] ?? field_i18n.en ?? legacyField`

---

## 10) One-Line Decision Summary
**Yes — apply these rules to job_orders.**  
Use `_i18n` as the explicit “worker-facing, translatable” marker and auto-discover those fields for translation across job_orders, shifts, and location instructions.

---
END OF SPEC
