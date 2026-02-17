# HRX Always-On Translation Engine (Worker + Jobs Board Only)
### Auto-Translate Job Postings + Worker-Facing Dynamic Content (Firestore + OpenAI + Cloud Tasks)

---

## 1. Scope

This translation system applies **only** to worker-facing surfaces:

- **Worker Portal**: `/c1/workers/*`
- **Jobs Board**: list + job detail pages

**Goal:** Workers who choose Spanish see worker-facing content and job postings in Spanish.

### Flutter scope
Flutter uses the **same Firestore schema** (`*_i18n`, `translationMeta`) and reads the **same documents** as the web app.

- Flutter resolves UI text with `field_i18n[userLang]` (with fallback rules below)
- **No additional translation API** is required for Flutter beyond reading Firestore docs

---

## 2. Data Model Changes

### 2.1 Localized Field Convention

All worker-facing dynamic fields follow:

```ts
fieldName_i18n: {
  en: string
  es?: string
}
```

### Phase 1 — job_postings fields

Translate these fields in Phase 1 (aligned to current schema fields like `postTitle`, `jobTitle`, `jobDescription`, etc.)

- `postTitle_i18n`
- `jobTitle_i18n`
- `jobDescription_i18n`
- `requirements_i18n`
- `payDetails_i18n` (optional)

> Backfill rule: if legacy `postTitle` exists, set `postTitle_i18n.en = postTitle` (same for other fields). Keep legacy fields temporarily to avoid breaking clients.

---

### 2.2 Translation Metadata

Add a translation metadata object:

```ts
translationMeta: {
  es: {
    sourceHash: string
    status: "auto" | "manual" | "draft"
    updatedAt: FirebaseFirestore.Timestamp
    model: string
  }
}
```

---

### 2.3 Manual Override Protection

If a human edits Spanish, lock it:

```ts
translationMeta.es.status = "manual"
```

Auto translation **must NOT overwrite** Spanish content when status is `manual`.

---

### 2.4 Worker Language & Client Display Rules

Worker language is stored on the user profile:

```ts
users/{userId}.preferredLanguage = "en" | "es"
```

Web and Flutter both render worker-facing strings using:

```ts
field_i18n[preferredLanguage]
  ?? field_i18n.en
  ?? legacyField
```

**Important:**
- No client-side translation.
- Both platforms read localized content from Firestore.

---

## 3. Firestore Trigger (Enqueue Translation Jobs)

### 3.1 Target Collection (Phase 1)

```txt
tenants/{tenantId}/job_postings/{jobId}
```

---

### 3.2 Trigger Logic (Loop-Safe)

Create Cloud Function:

```txt
onJobPostingWrite
```

Trigger:

```txt
onWrite
```

**Rules:**
- The trigger enqueues work only. It must not call OpenAI.
- The trigger must be **anti-loop**:
  - Ignore writes where the only changes are `*_i18n.es` and/or `translationMeta`

**Should enqueue** is derived **only** from:
- changes to watched `*_i18n.en` fields, OR
- missing/stale Spanish for watched fields (and status is not `manual`)

**Algorithm:**
1. Detect Phase 1 fields: `postTitle_i18n`, `jobTitle_i18n`, `jobDescription_i18n`, `requirements_i18n`, `payDetails_i18n`
2. Compare `before` vs `after`:
   - If `*_i18n.en` changed → enqueue
   - Else if `*_i18n.es` missing and status !== `manual` → enqueue
3. If no watched fields need work → exit

---

## 4. Translation Queue System

Use **Cloud Tasks** (recommended).

### 4.1 Queue

- Name: `translation-es`
- Region: same as Cloud Functions (e.g., `us-central1`)
- Retry: sane defaults (3–5 retries, exponential backoff)

### 4.2 Task Payload Structure

```json
{
  "tenantId": "string",
  "docPath": "tenants/{tenantId}/job_postings/{jobId}",
  "fields": [
    {
      "fieldPath": "jobDescription_i18n",
      "sourceText": "string"
    }
  ],
  "sourceLang": "en",
  "targetLang": "es"
}
```

---

## 5. Translation Worker Function (Cloud Tasks Target)

Create HTTP function:

```txt
processTranslationJob
```

### 5.1 Worker Flow

1. Authenticate request (Cloud Tasks OIDC or shared secret header)
2. Load job posting doc
3. Load tenant settings doc (see Section 8)
4. For each field in payload:
   - Skip if `translationMeta.es.status === "manual"`
   - Compute `sourceHash = SHA256(sourceText)`
   - Skip if `translationMeta.es.sourceHash === sourceHash` AND `*_i18n.es` exists
5. Batch fields into a **single OpenAI request**
6. Apply glossary + do-not-translate
7. Validate placeholder/token parity
8. Write updates back:
   - set `*_i18n.es`
   - update `translationMeta.es` with `{sourceHash,status:"auto",updatedAt,model}`
9. Log event to `translation_logs/{logId}`

---

## 6. Source Hash Logic

Use:

```txt
SHA256(sourceText)
```

Store:

```txt
translationMeta.es.sourceHash
```

Only retranslate when sourceHash changes.

---

## 7. Placeholder Protection Rules

Must preserve **exactly**:

- `{{variable}}`
- `{variable}`
- `%s`
- URLs
- Emails

If mismatch → reject translation, do not write, log error.

---

## 8. Translation Settings (Tenant-Level)

Single settings doc:

```txt
tenants/{tenantId}/translation_settings/default
```

Example:

```json
{
  "glossary": {
    "Assignment": "Asignación",
    "Worksite": "Lugar de trabajo",
    "Job Readiness": "Preparación laboral"
  },
  "doNotTranslate": ["C1 Staffing", "HRX", "PPE"],
  "tone": "neutral"
}
```

Worker loads this doc before calling OpenAI.

---

## 9. OpenAI Prompt Design

System prompt:

```txt
You are a professional localization engine.
Translate English to neutral Latin American Spanish.
Preserve placeholders exactly.
Respect the glossary and do-not-translate list.
Return JSON only.
```

Request payload format:

```json
{
  "items": [
    { "key": "jobDescription_i18n", "text": "Clean floors..." }
  ],
  "glossary": { "Worksite": "Lugar de trabajo" },
  "doNotTranslate": ["HRX", "PPE"],
  "tone": "neutral"
}
```

Response format:

```json
{
  "items": [
    { "key": "jobDescription_i18n", "translated": "Limpiar pisos..." }
  ]
}
```

Validate JSON before writing.

---

## 10. Safeguards & Cost Controls

- Batch up to 20 fields per request
- Cap max tokens per batch (e.g., ~2000 output tokens)
- Retry 3 times
- Dead-letter / failure logging
- Optional per-tenant daily translation counter / budget

---

## 11. Security Rules

Ensure only:
- Cloud Functions service account, and
- Admin users

can modify `*_i18n.es` and `translationMeta`.

---

## 12. Logging

Log every translation event to:

```txt
translation_logs/{logId}
```

Include:
- tenantId
- docPath
- fields translated
- token usage
- model used
- duration
- status
- error details (if any)

---

## 13. Rollout Plan

### Phase 1
- Implement for `job_postings` (fields listed in 2.1)
- Test with staging tenant
- Verify manual override protection + anti-loop behavior

### Phase 2
- Extend to worksites
- Extend to assignments

### Phase 3
- Add more languages
- Add CI/build-time auto-translation for static UI keys (separate track)

---

## 14. Success Criteria

- Posting a job in English auto-generates Spanish within seconds
- Updating EN refreshes ES unless ES is manual-locked
- Trigger does not loop on ES/meta writes
- Placeholders remain intact
- Flutter and Web display the same localized content using preferredLanguage

---

## 15. Test Checklist (Phase 1)

1. Create job posting with only `*_i18n.en` fields → ES appears automatically
2. Update `jobDescription_i18n.en` → ES refreshes
3. Set `translationMeta.es.status = "manual"` and edit `jobDescription_i18n.es` → EN updates do NOT overwrite ES
4. Confirm trigger does not loop when ES/meta are written
5. Confirm placeholders survive (e.g., `{{firstName}}`)

---

## 16. Phase 1 Implementation Plan (Deliverables)

A) Schema + backfill for Phase 1 fields  
B) Cloud Tasks queue `translation-es` + enqueuer helper  
C) Firestore trigger that only enqueues and is loop-safe  
D) HTTP worker `processTranslationJob` (auth, settings, hash check, OpenAI, placeholder check, writeback, logs)  
E) Tenant `translation_settings/default` doc support  
F) Security rules updates for translation fields

---

## 17. Next Steps (Phase 1 — Recommended Order)

Do these in order so each step has what it needs. Adjust as needed for your repo (e.g. where you register Cloud Functions).

### Step 1: Translation module and types (≈30 min)

- Create `functions/src/translation/` (or equivalent).
- Add shared types: task payload (Section 4.2), Phase 1 field list constant (`POSTING_I18N_FIELDS`), and a small type for `translationMeta.es`.
- Add a helper to **detect “translation-only” writes**: given `before` and `after` snapshots, return true if the only changed keys are `*_i18n.es` and/or `translationMeta`. Use this in the trigger to avoid enqueueing on worker writeback.

### Step 2: Tenant translation settings (≈30 min)

- Define the schema for `tenants/{tenantId}/translation_settings/default` (glossary, doNotTranslate, tone).
- In the translation worker (Step 5), add a function to **load** this doc; if missing, use empty glossary and empty doNotTranslate so the worker still runs.
- Optional: add a minimal admin or script to create/update this doc for a tenant (can be deferred).

### Step 3: Cloud Tasks queue + enqueuer (≈1 hr)

- Create the **queue** `translation-es` in the same region as your functions (e.g. GCP Console or Terraform). Set retries (e.g. 3–5) and backoff.
- Implement **enqueueTranslationTask(payload)** that:
  - Creates a Cloud Task targeting the URL of `processTranslationJob`.
  - Uses OIDC or a shared secret for auth (same as worker will validate).
- Do **not** call this from the trigger yet until the trigger exists (Step 4).

### Step 4: Firestore trigger (≈1–2 hr)

- Add **onJobPostingWrite** (or name of choice) with `onWrite("tenants/{tenantId}/job_postings/{jobId}")`.
- In the handler:
  1. If Step 1’s helper says the write is “translation-only” → return immediately (no enqueue).
  2. Build the list of Phase 1 fields that need translation: either `*_i18n.en` changed or `*_i18n.es` missing (and `translationMeta.es.status !== "manual"`). Use `after` data; if a field exists only as legacy (e.g. `postTitle`), you can treat it as “no _i18n yet” and skip enqueue until backfill exists, or backfill in trigger—your choice.
  3. If the list is empty → return.
  4. Build the task payload (Section 4.2) with `sourceText` from each field’s `*_i18n.en` (or legacy fallback if you backfill on read).
  5. Call **enqueueTranslationTask(payload)**.
- **Never** call OpenAI or do translation in the trigger.

### Step 5: HTTP worker processTranslationJob (≈2–4 hr)

- Create **processTranslationJob** as an **HTTP** function (so Cloud Tasks can call it). Register it in your functions index.
- Implement in order:
  1. **Auth:** Verify the request comes from Cloud Tasks (OIDC token or shared secret). Reject with 401/403 if not.
  2. **Parse body:** Expect the payload from Section 4.2. Validate tenantId, docPath, fields, targetLang.
  3. **Load doc:** Fetch the job posting doc. If missing or not job_postings, log and return 400.
  4. **Load settings:** Use Step 2’s loader for `tenants/{tenantId}/translation_settings/default`.
  5. **Filter fields:** For each field in the payload, skip if `translationMeta.es.status === "manual"`. Compute `sourceHash = SHA256(sourceText)`; skip if hash already equals stored hash and `*_i18n.es` is present. Collect remaining fields.
  6. If no fields left after filtering → return 200 (nothing to do).
  7. **OpenAI:** Single request with batch of items; include glossary and doNotTranslate in the prompt. Use the request/response format from Section 9.
  8. **Placeholder check:** For each translated string, ensure placeholders (e.g. `{{...}}`, URLs) match the source. If not, log error and do not write that field (optional: write others).
  9. **Write:** Update the doc with each `*_i18n.es` and update `translationMeta.es` (sourceHash, status `"auto"`, updatedAt, model). Use a single Firestore update to avoid triggering the trigger again with partial writes (or ensure trigger ignores these writes via Step 1’s helper).
  10. **Log:** Write to `translation_logs/{logId}` (tenantId, docPath, fields, token usage, model, duration, status).
- Handle errors: return 5xx for retryable failures so Cloud Tasks retries; log and return 200 for “skip” cases so the task is not retried forever.

### Step 6: Schema and backfill strategy (≈1 hr)

- **Option A (recommended for v1):** When the **recruiter creates/updates** a job posting (in your existing code path), write both legacy fields and `*_i18n.en` (e.g. `postTitle_i18n = { en: postTitle }`). That way the trigger always sees _i18n.en and can enqueue. No one-off backfill required for new posts.
- **Option B:** Keep writing only legacy fields; add a **one-time or scheduled backfill** that copies `postTitle` → `postTitle_i18n.en`, etc., then the trigger can run on the next write or you run backfill then trigger manually.
- Ensure **read path** for jobs board and worker view uses the display rule from Section 2.4: `field_i18n[preferredLanguage] ?? field_i18n.en ?? legacyField`. Prefer doing this in one place (e.g. jobsBoardService or a small i18n helper) so Web and Flutter can mirror it.

### Step 7: Security rules (≈30 min)

- Update Firestore rules so that **only** the Cloud Functions service account (and optionally admin users) can write `*_i18n.es` and `translationMeta`. Workers (and Flutter) can **read** these fields. Clients must not be able to set `translationMeta.es.status = "manual"` unless they are admin (if you expose an admin UI later).

### Step 8: Wire worker language on the client (≈30 min)

- Ensure **worker language** is stored: `users/{userId}.preferredLanguage` = `"en"` | `"es"` (set from Settings or onboarding).
- In the **jobs board and worker views** that display job postings, resolve each localized field with the rule in Section 2.4. Use the same resolution in Flutter when it reads the same docs.

### Step 9: Test (use Section 15 checklist)

- Run through the Phase 1 test checklist (Section 15).
- Manually create a job posting with `*_i18n.en` only; confirm ES appears and trigger does not loop.
- Optionally add a unit test for the “translation-only write” helper and a small integration test for the enqueuer.

---

**Summary:** Steps 1–2 are prep; 3–4 add queue and trigger; 5 is the worker; 6–7 lock in schema and security; 8 makes the client show Spanish when preferred; 9 validates. After this, Phase 1 is done and you can extend to worksites/assignments (Phase 2) or add more languages (Phase 3).

---

END OF SPEC
