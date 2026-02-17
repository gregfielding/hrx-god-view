# HRX Always-On Translation Engine

### Auto-Translate Job Postings + Dynamic Content (Firestore + OpenAI + Cloud Tasks)

------------------------------------------------------------------------

## 1. Objective & Scope

**Scope (where translation applies):**

Translation applies to **every worker-facing layout**, not just the jobs board:

- **Worker view** (`/c1/workers/*`): **Dashboard**, **Inbox**, **Settings**, **My Assignments**, **My Applications**, **Jobs Board**, **Job Readiness**, **My Documents**, and any **future worker layouts** (e.g. Timesheets, Pay, Notifications).
- **Jobs board** (public and worker-facing): job postings list and detail when viewed by a worker or public user with Spanish preference.

Workers who select **Spanish** as their language must see **all** of the above in Spanish: both **dynamic content** (from Firestore, e.g. job titles, descriptions, assignment instructions) and **static UI strings** (labels like "Dashboard", "Welcome back", "View details", "Job Readiness", "Unlock more shifts", "My Assignments", "Find Work", etc.).

**Two kinds of content (both required for full Spanish experience):**

| Type | Examples | Where it lives | How it gets translated |
|------|----------|----------------|------------------------|
| **Dynamic (Firestore)** | Job posting title/description, assignment instructions, inbox message body | Firestore docs with `*_i18n` | Auto-translation engine (trigger → Cloud Tasks → OpenAI → write `.es`) |
| **Static UI** | "Dashboard", "My Assignments", "View details", "Unlock more shifts", "Finish your profile to unlock more roles" | App code or shared locale assets | Locale files / remote config / build-time translation; same keys for Web and Flutter |

Both Web and Flutter must use the **same** conventions so the experience is consistent: same `*_i18n` reads for dynamic content, same locale key strategy for static UI.

**Design for Flutter:**

- The same Firestore data model (`*_i18n`, `translationMeta`) is the source of truth for **dynamic** content. The Flutter app reads the same documents and displays `field_i18n[userLang]` or `field_i18n.en`. No separate API layer—both Web and Flutter consume Firestore directly.
- **Static UI** strings must be available in a form Flutter can consume (e.g. shared JSON per locale, or same keys in app assets). Phase 2 covers this for all worker layouts.

Build an always-on translation system that:

-   Automatically translates dynamic content (job postings first, then worksites, assignment instructions, etc.)
-   Triggers on document create/update
-   Uses OpenAI for EN → ES translation
-   Preserves placeholders (`{{firstName}}`, `{count}`, etc.)
-   Respects glossary + do-not-translate rules
-   Prevents overwriting manual edits
-   Scales to additional languages later
-   Works for both **Web (worker + jobs board)** and **Flutter** via the same Firestore schema

------------------------------------------------------------------------

## 1.1 Worker Layouts in Scope (Dashboard, Inbox, Settings, My Assignments, etc.)

Every layout under the worker experience must support Spanish when the worker’s language is Spanish. Below is the full set and how each is localized.

| Layout | Dynamic content (Firestore) | Static UI (labels, buttons, messages) |
|--------|-----------------------------|--------------------------------------|
| **Dashboard** | Next shift job title (from assignment/posting); card body text if from Firestore | "Welcome back", "Next shift", "View details", "Find more work", "Finish your profile to unlock more roles", "Job Readiness", "Documents", "Applications", "Unlock more shifts", "Not started", "Your recruiter will request anything needed", "View your applications" |
| **Inbox** | Message subject/body (if stored in Firestore) | "Inbox", nav labels, empty state, actions |
| **Settings** | — | "Settings", section titles, toggles, labels |
| **My Assignments** | Assignment title, instructions, shift description (Firestore `*_i18n`) | "My Assignments", "View Assignment", "Confirmed", "Placed", empty state, actions |
| **My Applications** | Application status / job title (from posting) | "My Applications", status labels, empty state, actions |
| **Jobs Board** | Job posting title, description, requirements, pay (Firestore `*_i18n`) — **Phase 1** | "Find Work", "Apply Now", filters, empty state, footer |
| **Job Readiness** | — | "Job Readiness", progress labels, steps, CTAs |
| **My Documents** | — | "My Documents", "Not started", upload labels, actions |
| **Future layouts** (e.g. Timesheets, Pay, Notifications) | Per layout (Firestore where applicable) | All on-screen strings |

- **Phase 1:** Dynamic content for **job postings** only (Firestore auto-translation).
- **Phase 2:** (1) Extend dynamic content to assignments, inbox, etc. (2) **Static UI strings for all of the above layouts** in a way that works for Web and Flutter (e.g. shared locale JSON or build-time keys).
- New worker layouts added later must follow the same pattern: dynamic content in Firestore with `*_i18n`, static UI in the shared locale/asset approach.

------------------------------------------------------------------------

## 2. Data Model Changes

### 2.1 Localized Field Convention

All worker-facing dynamic fields must follow this pattern:

    fieldName_i18n: {
      en: string
      es?: string
    }

**Phase 1 (job postings only)** — exact fields to auto-translate:

-   `postTitle_i18n` (en, es) — maps from current `postTitle`
-   `jobTitle_i18n` (en, es) — maps from current `jobTitle`
-   `jobDescription_i18n` (en, es) — maps from current `jobDescription`
-   `requirements_i18n` (en, es) — if stored as text or array-join
-   `payDetails_i18n` (en, es) — optional; e.g. pay disclaimer text

Later (worksites, assignments): `arrivalInstructions_i18n`, `uniform_i18n`, `ppe_i18n`, etc.

------------------------------------------------------------------------

### 2.2 Translation Metadata

Add a `translationMeta` object:

    translationMeta: {
      es: {
        sourceHash: string
        status: "auto" | "manual" | "draft"
        updatedAt: Timestamp
        model: string
      }
    }

------------------------------------------------------------------------

### 2.3 Manual Override Protection

If a recruiter manually edits Spanish, mark:

    translationMeta.es.status = "manual"

Auto translation must NOT overwrite manual content.

------------------------------------------------------------------------

### 2.4 Worker Language Preference (Web + Flutter)

-   Store the worker’s language in **user profile**: e.g. `users/{userId}.preferredLanguage` = `"en"` | `"es"` (and later more).
-   **Web (worker view + jobs board):** When rendering a job posting or any localized content, use:
    -   `preferredLanguage = user.preferredLanguage || 'en'`
    -   Display: `field_i18n[preferredLanguage] ?? field_i18n.en ?? legacyField`
-   **Flutter:** Same rule: read `preferredLanguage` from user doc or local settings; for each document use `*_i18n[lang] ?? *_i18n.en`.
-   No translation runs in the client—only choosing which key to display. Same schema for Web and Flutter.

------------------------------------------------------------------------

## 3. Firestore Trigger (Enqueue Translation Jobs)

### 3.1 Target Collection

    tenants/{tenantId}/job_postings/{jobId}

------------------------------------------------------------------------

### 3.2 Trigger Logic

Create Cloud Function:

    onJobPostingWrite

Trigger:

    onWrite("tenants/{tenantId}/job_postings/{jobId}")

Logic:

1.  Detect fields ending in `_i18n` (Phase 1: postTitle_i18n, jobTitle_i18n, jobDescription_i18n, requirements_i18n, payDetails_i18n).
2.  Compare `before` and `after` **only for `*_i18n.en`** (and for presence of `*_i18n.es`).
3.  **Anti-loop (critical):** Treat the write as “translation-related only” if the **only** changes are to:
    -   Any `*_i18n.es` value, and/or
    -   `translationMeta`
    If so, **do not enqueue** a task (the translation worker wrote these; re-enqueueing would be redundant or looping).
4.  Otherwise, if for any watched field:
    -   `*_i18n.en` changed, OR
    -   `*_i18n.es` is missing,
    and for that doc/language `translationMeta.es.status !== "manual"`:
    → Enqueue **one** task containing all fields that need translation.
5.  **Never** call OpenAI or perform translation inside the trigger.

------------------------------------------------------------------------

## 4. Translation Queue System

Use **Cloud Tasks**.

### 4.1 Task Payload Structure

    {
      tenantId: string,
      collectionPath: string,
      docId: string,
      fields: [
        {
          fieldPath: "title_i18n",
          sourceText: string
        }
      ],
      sourceLang: "en",
      targetLang: "es"
    }

------------------------------------------------------------------------

## 5. Translation Worker Function

Create HTTP function:

    processTranslationJob

------------------------------------------------------------------------

### 5.1 Worker Flow

1.  Load document
2.  For each field:
    -   Verify manual override not set
    -   Compute source hash
    -   Compare to stored hash
    -   Skip if unchanged
3.  Batch texts into single OpenAI call
4.  Validate placeholders
5.  Write translations
6.  Update `translationMeta`
7.  Log translation event

------------------------------------------------------------------------

## 6. Source Hash Logic

Prevent unnecessary translations.

Use:

    SHA256(sourceText)

Store:

    translationMeta.es.sourceHash

Only translate if hash differs.

------------------------------------------------------------------------

## 7. Placeholder Protection Rules

Must preserve:

-   `{{variable}}`
-   `{variable}`
-   `%s`
-   URLs
-   Emails

If mismatch → reject translation and log error.

------------------------------------------------------------------------

## 8. Glossary Support

Add tenant-level glossary (single doc per tenant):

Collection:

    tenants/{tenantId}/translation_settings

Document ID:

    default

Fields:

    {
      glossary: {
        "Assignment": "Asignación",
        "Worksite": "Lugar de trabajo",
        "Job Readiness": "Preparación laboral"
      },
      doNotTranslate: [
        "C1 Staffing",
        "HRX",
        "PPE"
      ],
      tone?: "neutral" | "casual"   // optional, for future prompt tuning
    }

Translation worker loads `tenants/{tenantId}/translation_settings/default` before translating and injects glossary + doNotTranslate into the OpenAI prompt.

------------------------------------------------------------------------

## 9. OpenAI Prompt Design

System prompt:

    You are a professional localization engine.
    Translate English to neutral Latin American Spanish.
    Preserve placeholders exactly.
    Do not translate glossary terms incorrectly.
    Return JSON only.

User payload format:

    {
      "items": [
        {
          "key": "title_i18n",
          "text": "Janitor"
        }
      ],
      "glossary": {...},
      "doNotTranslate": [...]
    }

Response format:

    {
      "items": [
        {
          "key": "title_i18n",
          "translated": "Conserje"
        }
      ]
    }

Must validate JSON before writing.

------------------------------------------------------------------------

## 10. Cost Controls

Implement:

-   Batch up to 20 fields per request
-   Max 2000 tokens per batch
-   Retry 3 times
-   Dead-letter queue for failures
-   Per-tenant daily translation counter

------------------------------------------------------------------------

## 11. Security Rules

Ensure only:

-   Cloud Functions service account
-   Admin users

Can modify `_i18n` fields and `translationMeta`.

------------------------------------------------------------------------

## 12. Logging

Log every translation event to:

    translation_logs/{logId}

Include:

-   tenantId
-   docPath
-   fields translated
-   token usage
-   model used
-   duration
-   status

------------------------------------------------------------------------

## 13. Rollout Plan

### Phase 1 (dynamic content: job postings only)

-   Implement Firestore auto-translation for `tenants/{tenantId}/job_postings/{jobId}` (postTitle, jobTitle, jobDescription, requirements, payDetails).
-   Jobs board and worker view that show job postings will display Spanish when the worker’s language is Spanish (using `*_i18n.es`).
-   Test with staging tenant; verify manual override protection and no trigger loops.

### Phase 2 (all worker layouts: more dynamic content + static UI)

-   **Dynamic (Firestore):** Extend `*_i18n` and auto-translation to worksites, assignments, and any other worker-facing Firestore content (e.g. inbox message bodies if applicable).
-   **Static UI:** Introduce a single approach for **all** worker layout strings (Dashboard, Inbox, Settings, My Assignments, My Applications, Jobs Board, Job Readiness, My Documents) so that every label, button, and message is translatable. Deliverable must work for both **Web** and **Flutter** (e.g. shared locale JSON keyed by string ID, or build-time extraction with same keys in both apps). All strings listed in Section 1.1 must be covered so the full worker experience is available in Spanish.

### Phase 3

-   Add French (and optionally more languages) for both dynamic and static.
-   Optional: CI build-time or script to auto-translate static UI keys into locale files from a source language.

------------------------------------------------------------------------

## 14. Future Expansion

Later:

-   Auto-detect language mismatch
-   Real-time recruiter note translation
-   Translation A/B testing
-   Tone personalization
-   Admin UI: Settings → Localization

------------------------------------------------------------------------

## 15. Success Criteria

-   **Phase 1:** Posting a job in English auto-generates Spanish for job postings within seconds; workers with Spanish selected see job board content in Spanish.
-   **Phase 2:** All worker layouts (Dashboard, Inbox, Settings, My Assignments, My Applications, Job Readiness, My Documents, Jobs Board) are fully available in Spanish (dynamic content + static UI); same behavior on Web and Flutter.
-   Manual Spanish edits are preserved (no overwriting when status is manual).
-   No duplicate translations on minor updates; no trigger loops.
-   Placeholders remain intact in translated text.
-   System scales cleanly to more languages and new worker layouts.

------------------------------------------------------------------------

## 16. Phase 1 Implementation Plan (Job Postings Only)

Phase 1 covers **only** dynamic Firestore content for **job postings**. Static UI (Dashboard, Inbox, My Assignments, etc.) and other dynamic content (assignments, worksites) are **Phase 2** (see Section 1.1 and Section 13).

Target for Phase 1: **worker view + jobs board** show job posting title, description, requirements, etc. in Spanish when worker language is Spanish; same Firestore data works for Flutter.

---

### A) Schema + conventions

1. **Exact Phase 1 fields** on `tenants/{tenantId}/job_postings/{jobId}`:
   - `postTitle_i18n`: `{ en: string, es?: string }`
   - `jobTitle_i18n`: `{ en: string, es?: string }`
   - `jobDescription_i18n`: `{ en: string, es?: string }`
   - `requirements_i18n`: `{ en: string, es?: string }` (if applicable)
   - `payDetails_i18n`: `{ en: string, es?: string }` (optional)
2. **Backfill:** When creating/updating a post, if only legacy fields exist (`postTitle`, `jobDescription`, etc.), backfill into `*_i18n.en` and keep legacy fields for now (no breaking changes). Recruiter UI can continue writing legacy fields; trigger or a one-time job can populate `_i18n.en`.
3. **Metadata:** Add `translationMeta.es`: `{ sourceHash, status: "auto"|"manual"|"draft", updatedAt, model }`. When a human edits Spanish in admin/recruiter UI, set `translationMeta.es.status = "manual"` so auto-translation does not overwrite.

---

### B) Cloud Tasks queue

1. Create queue **`translation-es`** (region same as Cloud Functions, e.g. `us-central1`), with sane retry (e.g. 3 retries, exponential backoff).
2. Add a **shared enqueuer** (e.g. `functions/src/translation/enqueueTranslationTask.ts`): `enqueueTranslationTask(payload)` that creates a task targeting the HTTP worker URL. Payload shape as in Section 4.1.

---

### C) Firestore trigger (enqueue only)

- **Function:** `onJobPostingWrite`
- **Trigger:** `onWrite("tenants/{tenantId}/job_postings/{jobId}")`
- **Logic:**
  - Diff `before` vs `after` only for `*_i18n.en` and presence of `*_i18n.es`.
  - If the only changes are `*_i18n.es` and/or `translationMeta` → **do nothing** (anti-loop).
  - Else if any watched `*_i18n.en` changed or `*_i18n.es` is missing, and `translationMeta.es.status !== "manual"` → enqueue **one** task with all fields that need translation.
- **Never** call OpenAI in the trigger.

---

### D) HTTP worker (Cloud Tasks target)

- **Function:** `processTranslationJob` (HTTP, callable by Cloud Tasks).
- **Steps:**
  1. Validate task auth (Cloud Tasks OIDC token or shared secret).
  2. Load the job posting doc and `tenants/{tenantId}/translation_settings/default` (glossary, doNotTranslate).
  3. For each field to translate: skip if `translationMeta.es.status === "manual"`; compute `sourceHash = sha256(sourceText)`; skip if hash matches stored `translationMeta.es.sourceHash` and `es` exists.
  4. Build **one** OpenAI request with multiple items; apply glossary and doNotTranslate in the prompt.
  5. Validate **placeholder parity** (placeholders in EN must appear in ES; reject and log if not).
  6. Write updates: set each `*_i18n.es`; update `translationMeta.es` with `{ sourceHash, status: "auto", updatedAt, model }`.
  7. Write a log entry to `translation_logs` (tenantId, docPath, fields, token usage, model, duration, status).

---

### E) Tenant translation settings

- **Path:** `tenants/{tenantId}/translation_settings/default`
- **Fields:** `glossary` (map), `doNotTranslate` (array), optional `tone`.
- Worker loads this doc before translating and injects into the OpenAI prompt.

---

### F) Security rules

- Clients (Web/Flutter) must **not** be able to set `translationMeta` or `*_i18n.es` arbitrarily (only admin or backend). Service account can write all. Read access to `*_i18n` and `translationMeta` for workers is allowed so they can display the correct language.

---

### Deliverables (Phase 1)

1. Cloud Tasks queue config + enqueuer utility.
2. Firestore `onWrite` trigger that **only** enqueues tasks, is loop-safe, and ignores translation-only writes.
3. HTTP worker `processTranslationJob` that translates the Phase 1 fields into `.es`, applies glossary/doNotTranslate, validates placeholders, writes `translationMeta.es`, and logs to `translation_logs`.
4. Tenant `translation_settings/default` schema + read logic in worker.
5. Minimal Firestore rules updates to protect translation fields.

Keep new logic in new files where possible (e.g. `functions/src/translation/`).

---

### Test plan & checklist

1. **Create** a job posting with only `*_i18n.en` (or legacy fields that backfill to `_i18n.en`) → confirm `*_i18n.es` is added within a short time.
2. **Update** e.g. `jobDescription_i18n.en` → confirm `jobDescription_i18n.es` refreshes.
3. Set `translationMeta.es.status = "manual"` and edit `jobDescription_i18n.es` by hand → confirm a later edit to `jobDescription_i18n.en` does **not** overwrite `jobDescription_i18n.es`.
4. **Anti-loop:** After the worker writes `*_i18n.es` and `translationMeta`, confirm the trigger does **not** enqueue another task (e.g. check queue or logs).
5. **Placeholders:** Include `{{firstName}}` in a description → confirm it appears unchanged in the translated ES text.

---

### Worker / Flutter display (after Phase 1)

- **Web (jobs board + worker views):** When loading a job posting, use `preferredLanguage = user.preferredLanguage || 'en'`. For each localized field use `postTitle_i18n[preferredLanguage] ?? postTitle_i18n.en ?? postTitle` (and same for other fields). No translation call—only key selection.
- **Flutter:** Same: read `preferredLanguage`; for each doc use `*_i18n[preferredLanguage] ?? *_i18n.en` so the app works seamlessly with the same Firestore data.

------------------------------------------------------------------------

END OF SPEC
