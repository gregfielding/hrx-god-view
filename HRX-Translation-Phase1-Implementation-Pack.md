# HRX Always‑On Translation Engine — Phase 1 Implementation Pack (Cursor‑Ready)
**Scope:** Worker portal `/c1/workers/*` + Jobs Board (list + detail)  
**Collections:** `tenants/{tenantId}/job_postings/{jobId}`  
**Languages:** `en` source → `es` target  
**Pattern:** `*_i18n` + `translationMeta`  
**Queue:** Cloud Tasks `translation-es`  
**Functions:** Firestore trigger (enqueue only) + HTTP worker (OpenAI)  
**Tests:** Jest unit tests for loop‑safety + translation selection + placeholder parity

---

## 0) Assumptions (adjust if needed)
- Firebase Cloud Functions **Gen2**, Node **20**
- Using **firebase-functions v2** APIs
- Firestore path for postings: `tenants/{tenantId}/job_postings/{jobId}`
- OpenAI API key stored as secret (recommended) or env var

If your repo differs, keep the design but adjust imports/paths.

---

## 1) Firestore Schema (Phase 1 fields)

### 1.1 Worker language preference
Store on user profile:
```ts
// users/{userId}
preferredLanguage: "en" | "es"
```

### 1.2 Localized fields
Phase 1 job posting fields:
- `postTitle_i18n`
- `jobTitle_i18n`
- `jobDescription_i18n`
- `requirements_i18n`
- `payDetails_i18n` (optional)

Each field is:
```ts
fieldName_i18n: { en: string; es?: string }
```

### 1.3 Translation metadata
```ts
translationMeta: {
  es?: {
    sourceHash: string
    status: "auto" | "manual" | "draft"
    updatedAt: FirebaseFirestore.Timestamp
    model: string
  }
}
```

**Manual lock rule:** if Spanish edited by a human, set:
```ts
translationMeta.es.status = "manual"
```
Auto‑translation must not overwrite ES when locked.

### 1.4 Client display rule (Web + Flutter)
Render:
```ts
field_i18n[preferredLanguage] ?? field_i18n.en ?? legacyField
```
No client‑side translation.

---

## 2) Tenant Translation Settings (Firestore)

Single doc:
```
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

Worker should allow missing doc (treat as empty settings).

---

## 3) Files to Add (Functions)

Create folder:
```
functions/src/translation/
  ├── types.ts
  ├── fields.ts
  ├── hash.ts
  ├── placeholder.ts
  ├── isTranslationOnlyWrite.ts
  ├── needsTranslation.ts
  ├── settings.ts
  ├── openai.ts
  ├── logs.ts
  └── index.ts
```

And add:
```
functions/src/tasks/enqueueTranslationTask.ts
functions/src/triggers/onJobPostingWrite.ts
functions/src/http/processTranslationJob.ts
```

Add Jest tests:
```
functions/test/translation/isTranslationOnlyWrite.test.ts
functions/test/translation/needsTranslation.test.ts
functions/test/translation/placeholder.test.ts
```

---

## 4) Translation Module (shared utilities)

### 4.1 `functions/src/translation/types.ts`
```ts
export type SupportedLanguage = "en" | "es";

export interface I18nField {
  en: string;
  es?: string;
}

export interface TranslationMetaLang {
  sourceHash: string;
  status: "auto" | "manual" | "draft";
  updatedAt: FirebaseFirestore.Timestamp;
  model: string;
}

export interface TranslationMeta {
  es?: TranslationMetaLang;
}

export interface TranslationSettings {
  glossary?: Record<string, string>;
  doNotTranslate?: string[];
  tone?: string;
}

export interface TranslationTaskPayload {
  tenantId: string;
  docPath: string; // "tenants/{tenantId}/job_postings/{jobId}"
  fields: Array<{ fieldPath: string; sourceText: string }>;
  sourceLang: "en";
  targetLang: "es";
}
```

### 4.2 `functions/src/translation/fields.ts`
```ts
export const PHASE1_TRANSLATABLE_FIELDS = [
  "postTitle_i18n",
  "jobTitle_i18n",
  "jobDescription_i18n",
  "requirements_i18n",
  "payDetails_i18n",
] as const;

export type Phase1Field = typeof PHASE1_TRANSLATABLE_FIELDS[number];
```

### 4.3 `functions/src/translation/hash.ts`
```ts
import crypto from "crypto";

export function computeHash(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}
```

### 4.4 `functions/src/translation/placeholder.ts`
```ts
const PLACEHOLDER_REGEX = /{{.*?}}|{.*?}|%s/g;

export function extractPlaceholders(text: string): string[] {
  return text.match(PLACEHOLDER_REGEX) ?? [];
}

export function placeholdersMatch(source: string, translated: string): boolean {
  const a = extractPlaceholders(source).sort();
  const b = extractPlaceholders(translated).sort();
  return JSON.stringify(a) === JSON.stringify(b);
}
```

### 4.5 `functions/src/translation/isTranslationOnlyWrite.ts` (loop‑safety helper)
**Purpose:** Trigger must skip enqueue when only ES/meta changed.
```ts
import type { Phase1Field } from "./fields";
import { PHASE1_TRANSLATABLE_FIELDS } from "./fields";

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function isTranslationOnlyWrite(
  before: FirebaseFirestore.DocumentData | undefined,
  after: FirebaseFirestore.DocumentData
): boolean {
  if (!before) return false;

  const changedKeys = Object.keys(after).filter((key) => !deepEqual(before[key], after[key]));
  if (changedKeys.length === 0) return false;

  return changedKeys.every((key) => {
    if (key === "translationMeta") return true;

    if (PHASE1_TRANSLATABLE_FIELDS.includes(key as Phase1Field)) {
      const b = before[key];
      const a = after[key];
      if (!b || !a) return false;

      // translation-only: EN unchanged, ES or other subfields may change
      return b.en === a.en;
    }

    return false;
  });
}
```

### 4.6 `functions/src/translation/needsTranslation.ts`
**Purpose:** Determine fields requiring translation based on EN changes or missing ES (and not manual).
```ts
import { PHASE1_TRANSLATABLE_FIELDS, type Phase1Field } from "./fields";

export function getFieldsNeedingTranslation(
  before: FirebaseFirestore.DocumentData | undefined,
  after: FirebaseFirestore.DocumentData
): Array<{ fieldPath: Phase1Field; sourceText: string }> {
  const out: Array<{ fieldPath: Phase1Field; sourceText: string }> = [];

  const isManual = after?.translationMeta?.es?.status === "manual";

  for (const field of PHASE1_TRANSLATABLE_FIELDS) {
    const afterField = after?.[field];
    if (!afterField?.en) continue;

    const beforeField = before?.[field];
    const enChanged = !beforeField || beforeField.en !== afterField.en;
    const esMissing = !afterField.es;

    if ((enChanged || esMissing) && !isManual) {
      out.push({ fieldPath: field, sourceText: afterField.en });
    }
  }

  return out;
}
```

### 4.7 `functions/src/translation/settings.ts`
```ts
import type { TranslationSettings } from "./types";

export async function loadTranslationSettings(
  db: FirebaseFirestore.Firestore,
  tenantId: string
): Promise<TranslationSettings> {
  const ref = db.doc(`tenants/${tenantId}/translation_settings/default`);
  const snap = await ref.get();
  if (!snap.exists) return {};
  const data = snap.data() ?? {};
  return {
    glossary: data.glossary ?? {},
    doNotTranslate: data.doNotTranslate ?? [],
    tone: data.tone ?? "neutral",
  };
}
```

### 4.8 `functions/src/translation/openai.ts`
**Uses OpenAI for batch translation.**  
Install dependency in `functions/`:
```bash
npm i openai
```

```ts
import OpenAI from "openai";
import type { TranslationSettings } from "./types";

export interface TranslateBatchItem {
  key: string; // fieldPath
  text: string; // sourceText
}

export interface TranslateBatchResult {
  items: Array<{ key: string; translated: string }>;
}

function buildSystemPrompt() {
  return [
    "You are a professional localization engine.",
    "Translate English to neutral Latin American Spanish.",
    "Preserve placeholders exactly (e.g., {{firstName}}, {count}, %s).",
    "Respect the glossary and do-not-translate list.",
    "Return JSON only, with schema: { items: [{ key, translated }] }.",
  ].join("\n");
}

export async function translateBatchEnToEs(params: {
  client: OpenAI;
  items: TranslateBatchItem[];
  settings: TranslationSettings;
}): Promise<TranslateBatchResult> {
  const { client, items, settings } = params;

  const payload = {
    items,
    glossary: settings.glossary ?? {},
    doNotTranslate: settings.doNotTranslate ?? [],
    tone: settings.tone ?? "neutral",
  };

  const res = await client.chat.completions.create({
    model: "gpt-4.1-mini",
    temperature: 0.2,
    messages: [
      { role: "system", content: buildSystemPrompt() },
      { role: "user", content: JSON.stringify(payload) },
    ],
    response_format: { type: "json_object" },
  });

  const text = res.choices?.[0]?.message?.content ?? "{}";
  let json: any;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new Error(`OpenAI returned invalid JSON: ${text.slice(0, 200)}`);
  }

  if (!json.items || !Array.isArray(json.items)) {
    throw new Error(`OpenAI response missing items array: ${text.slice(0, 200)}`);
  }

  return { items: json.items };
}
```

> Model name is an example; use whichever model you standardize for production.

### 4.9 `functions/src/translation/logs.ts`
```ts
export async function writeTranslationLog(db: FirebaseFirestore.Firestore, log: Record<string, any>) {
  const ref = db.collection("translation_logs").doc();
  await ref.set({
    ...log,
    createdAt: new Date(),
  });
}
```

### 4.10 `functions/src/translation/index.ts`
```ts
export * from "./types";
export * from "./fields";
export * from "./hash";
export * from "./placeholder";
export * from "./isTranslationOnlyWrite";
export * from "./needsTranslation";
export * from "./settings";
export * from "./openai";
export * from "./logs";
```

---

## 5) Cloud Tasks: Queue + Enqueuer

### 5.1 Create queue (gcloud)
```bash
gcloud tasks queues create translation-es \
  --location=us-central1 \
  --max-attempts=5 \
  --min-backoff=10s \
  --max-backoff=300s \
  --max-doublings=5
```

Adjust region to match your functions.

### 5.2 Enqueuer helper `functions/src/tasks/enqueueTranslationTask.ts`
**Choose one auth approach:**
- **OIDC** (preferred): Cloud Tasks attaches a service account identity token
- **Shared secret** header (simpler)

Below shows **OIDC**. (If you choose secret header, replace accordingly.)

```ts
import { CloudTasksClient } from "@google-cloud/tasks";
import type { TranslationTaskPayload } from "../translation";

const tasks = new CloudTasksClient();

const PROJECT_ID = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT;
const LOCATION = process.env.TASKS_LOCATION || "us-central1";
const QUEUE = process.env.TASKS_QUEUE_TRANSLATION || "translation-es";
const WORKER_URL = process.env.TRANSLATION_WORKER_URL!; // set in env
const TASKS_SA_EMAIL = process.env.TASKS_SERVICE_ACCOUNT_EMAIL!; // set in env

export async function enqueueTranslationTask(payload: TranslationTaskPayload) {
  if (!PROJECT_ID) throw new Error("Missing PROJECT_ID");
  if (!WORKER_URL) throw new Error("Missing TRANSLATION_WORKER_URL");
  if (!TASKS_SA_EMAIL) throw new Error("Missing TASKS_SERVICE_ACCOUNT_EMAIL");

  const parent = tasks.queuePath(PROJECT_ID, LOCATION, QUEUE);

  const task = {
    httpRequest: {
      httpMethod: "POST" as const,
      url: WORKER_URL,
      headers: { "Content-Type": "application/json" },
      body: Buffer.from(JSON.stringify(payload)).toString("base64"),
      oidcToken: {
        serviceAccountEmail: TASKS_SA_EMAIL,
      },
    },
  };

  await tasks.createTask({ parent, task });
}
```

**Dependencies:**
```bash
npm i @google-cloud/tasks
```

---

## 6) Firestore Trigger (enqueue only, loop‑safe)

### 6.1 `functions/src/triggers/onJobPostingWrite.ts`
```ts
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { getFirestore } from "firebase-admin/firestore";
import { initializeApp } from "firebase-admin/app";

import { isTranslationOnlyWrite, getFieldsNeedingTranslation } from "../translation";
import { enqueueTranslationTask } from "../tasks/enqueueTranslationTask";

initializeApp();

export const onJobPostingWrite = onDocumentWritten(
  "tenants/{tenantId}/job_postings/{jobId}",
  async (event) => {
    const tenantId = event.params.tenantId as string;
    const jobId = event.params.jobId as string;

    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    if (!after) return;

    // 1) Anti-loop: skip if translation-only write
    if (isTranslationOnlyWrite(before, after)) return;

    // 2) Determine which fields need translation
    const fields = getFieldsNeedingTranslation(before, after);
    if (fields.length === 0) return;

    // 3) Enqueue one task with all fields
    const docPath = `tenants/${tenantId}/job_postings/${jobId}`;
    await enqueueTranslationTask({
      tenantId,
      docPath,
      fields: fields.map((f) => ({ fieldPath: f.fieldPath, sourceText: f.sourceText })),
      sourceLang: "en",
      targetLang: "es",
    });
  }
);
```

> This trigger never calls OpenAI.

---

## 7) HTTP Worker (OpenAI translation)

### 7.1 Auth notes
If you use Cloud Tasks OIDC:
- Verify the request JWT audience / issuer OR trust Cloud Run IAM (Gen2) by restricting invoker to the service account.

Simplest practical approach:
- Deploy Gen2 HTTP function with **invoker restricted** to your Tasks service account.
- Then you don’t need to parse JWT manually.

### 7.2 `functions/src/http/processTranslationJob.ts`
```ts
import { onRequest } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { initializeApp } from "firebase-admin/app";
import OpenAI from "openai";

import { computeHash, placeholdersMatch, loadTranslationSettings, translateBatchEnToEs, writeTranslationLog } from "../translation";
import type { TranslationTaskPayload } from "../translation";

initializeApp();

function isRetryable(e: any): boolean {
  const msg = String(e?.message || "");
  // Treat OpenAI / network / transient errors as retryable
  return (
    msg.includes("ETIMEDOUT") ||
    msg.includes("ECONNRESET") ||
    msg.includes("429") ||
    msg.includes("503") ||
    msg.includes("rate limit") ||
    msg.includes("temporarily")
  );
}

export const processTranslationJob = onRequest(async (req, res) => {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  // If you use shared-secret auth instead of OIDC, validate here.
  // Example:
  // if (req.header("x-hrx-secret") !== process.env.TRANSLATION_TASK_SECRET) return res.status(401).send("Unauthorized");

  let payload: TranslationTaskPayload;
  try {
    payload = req.body as TranslationTaskPayload;
  } catch {
    return res.status(400).send("Invalid JSON");
  }

  const { tenantId, docPath, fields, sourceLang, targetLang } = payload;
  if (!tenantId || !docPath || !Array.isArray(fields) || sourceLang !== "en" || targetLang !== "es") {
    return res.status(400).send("Invalid payload");
  }

  const db = getFirestore();
  const docRef = db.doc(docPath);

  const t0 = Date.now();

  try {
    const snap = await docRef.get();
    if (!snap.exists) return res.status(200).send("Doc missing (noop)");

    const data = snap.data() || {};

    // Load tenant settings (allow missing)
    const settings = await loadTranslationSettings(db, tenantId);

    // Global manual lock (doc-level). If you later want per-field manual locks, extend schema.
    const isManual = data?.translationMeta?.es?.status === "manual";
    if (isManual) return res.status(200).send("Manual lock (noop)");

    // Filter fields by hash + existence
    const work: Array<{ key: string; text: string; hash: string }> = [];
    for (const f of fields) {
      const fieldObj = data?.[f.fieldPath];
      const sourceText = (fieldObj?.en ?? f.sourceText ?? "").trim();
      if (!sourceText) continue;

      const hash = computeHash(sourceText);
      const prevHash = data?.translationMeta?.es?.sourceHash;
      const hasEs = Boolean(fieldObj?.es);

      // If ES exists AND hash matches, skip
      if (hasEs && prevHash === hash) continue;

      work.push({ key: f.fieldPath, text: sourceText, hash });
    }

    if (work.length === 0) return res.status(200).send("Nothing to do (noop)");

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // Translate in one batch
    const result = await translateBatchEnToEs({
      client,
      items: work.map((w) => ({ key: w.key, text: w.text })),
      settings,
    });

    // Validate + build update payload (single write)
    const update: Record<string, any> = {};
    let lastHash = "";
    let model = "gpt-4.1-mini";

    for (const item of result.items) {
      const w = work.find((x) => x.key === item.key);
      if (!w) continue;

      const translated = String(item.translated ?? "").trim();
      if (!translated) continue;

      if (!placeholdersMatch(w.text, translated)) {
        throw new Error(`Placeholder mismatch for ${item.key}`);
      }

      update[`${item.key}.es`] = translated;
      lastHash = w.hash;
    }

    if (Object.keys(update).length === 0) return res.status(200).send("No valid translations (noop)");

    // Write meta (single write)
    update["translationMeta.es"] = {
      sourceHash: lastHash,
      status: "auto",
      updatedAt: FieldValue.serverTimestamp(),
      model,
    };

    await docRef.update(update);

    await writeTranslationLog(db, {
      tenantId,
      docPath,
      fieldCount: Object.keys(update).filter((k) => k.endsWith(".es")).length,
      durationMs: Date.now() - t0,
      status: "success",
    });

    return res.status(200).send("OK");
  } catch (e: any) {
    await writeTranslationLog(getFirestore(), {
      tenantId,
      docPath,
      durationMs: Date.now() - t0,
      status: "error",
      error: String(e?.message || e),
    });

    // Cloud Tasks retries on 5xx only. Return 5xx only if retryable.
    if (isRetryable(e)) return res.status(503).send("Retryable error");
    return res.status(200).send("Non-retryable error (logged)");
  }
});
```

### Notes / Improvements (optional but recommended)
- Store per-field hashes instead of a single `translationMeta.es.sourceHash` to avoid collisions when only one field changes.
- Add rate limits / per-tenant budget in worker.
- Write translations into a `draft` status and require approval for compliance documents (not needed for Phase 1).

---

## 8) Function Exports

In `functions/src/index.ts` (or wherever you export functions), add:
```ts
export { onJobPostingWrite } from "./triggers/onJobPostingWrite";
export { processTranslationJob } from "./http/processTranslationJob";
```

---

## 9) Environment / Secrets

### Option A (simple): env var
Set `OPENAI_API_KEY` in functions environment.

### Option B (recommended): Secret Manager
Create secret and bind to worker function.

Example (conceptual):
```bash
echo -n "YOUR_KEY" | gcloud secrets create OPENAI_API_KEY --data-file=-
gcloud secrets add-iam-policy-binding OPENAI_API_KEY \
  --member="serviceAccount:YOUR_FUNCTIONS_SA" --role="roles/secretmanager.secretAccessor"
```

And bind in deployment (varies by your deployment method).

### Required env vars
- `TRANSLATION_WORKER_URL` (the HTTP function URL)
- `TASKS_SERVICE_ACCOUNT_EMAIL`
- `TASKS_LOCATION` (e.g., `us-central1`)
- `TASKS_QUEUE_TRANSLATION` (e.g., `translation-es`)
- `OPENAI_API_KEY`

---

## 10) Firestore Security Rules (minimal guidance)
Goal: Workers can read, but only backend (and optionally admins) can write Spanish/meta.

Pseudocode idea:
- Allow reads to job_postings for authenticated workers
- Disallow writes to `*_i18n.es` and `translationMeta` from worker clients
- Allow admins to set manual locks if needed

Implement rules consistent with your role system.

---

## 11) Jest Tests

### 11.1 Install Jest in `functions/`
```bash
npm i -D jest ts-jest @types/jest
npx ts-jest config:init
```

Ensure `package.json` has:
```json
{
  "scripts": {
    "test": "jest"
  }
}
```

### 11.2 `functions/test/translation/isTranslationOnlyWrite.test.ts`
```ts
import { isTranslationOnlyWrite } from "../../src/translation/isTranslationOnlyWrite";

describe("isTranslationOnlyWrite", () => {
  test("returns false on create (no before)", () => {
    expect(isTranslationOnlyWrite(undefined, { a: 1 })).toBe(false);
  });

  test("returns true when only ES changes", () => {
    const before = {
      postTitle_i18n: { en: "Hello", es: "Hola" },
      translationMeta: { es: { status: "auto", sourceHash: "x", model: "m", updatedAt: {} } },
    };
    const after = {
      postTitle_i18n: { en: "Hello", es: "Saludos" },
      translationMeta: { es: { status: "auto", sourceHash: "y", model: "m", updatedAt: {} } },
    };
    expect(isTranslationOnlyWrite(before as any, after as any)).toBe(true);
  });

  test("returns false when EN changes", () => {
    const before = { postTitle_i18n: { en: "Hello", es: "Hola" } };
    const after = { postTitle_i18n: { en: "Hello!!", es: "Hola" } };
    expect(isTranslationOnlyWrite(before as any, after as any)).toBe(false);
  });

  test("returns true when only translationMeta changes", () => {
    const before = { postTitle_i18n: { en: "Hello", es: "Hola" }, translationMeta: { es: { sourceHash: "a" } } };
    const after = { postTitle_i18n: { en: "Hello", es: "Hola" }, translationMeta: { es: { sourceHash: "b" } } };
    expect(isTranslationOnlyWrite(before as any, after as any)).toBe(true);
  });
});
```

### 11.3 `functions/test/translation/needsTranslation.test.ts`
```ts
import { getFieldsNeedingTranslation } from "../../src/translation/needsTranslation";

describe("getFieldsNeedingTranslation", () => {
  test("returns fields when ES missing", () => {
    const before = { jobTitle_i18n: { en: "Janitor" } };
    const after = { jobTitle_i18n: { en: "Janitor" } };
    const fields = getFieldsNeedingTranslation(before as any, after as any);
    expect(fields.map((f) => f.fieldPath)).toContain("jobTitle_i18n");
  });

  test("returns fields when EN changed", () => {
    const before = { jobDescription_i18n: { en: "Clean", es: "Limpiar" } };
    const after = { jobDescription_i18n: { en: "Clean floors", es: "Limpiar" } };
    const fields = getFieldsNeedingTranslation(before as any, after as any);
    expect(fields.map((f) => f.fieldPath)).toContain("jobDescription_i18n");
  });

  test("returns empty when manual lock", () => {
    const before = { jobTitle_i18n: { en: "Janitor" } };
    const after = { jobTitle_i18n: { en: "Janitor" }, translationMeta: { es: { status: "manual" } } };
    const fields = getFieldsNeedingTranslation(before as any, after as any);
    expect(fields.length).toBe(0);
  });
});
```

### 11.4 `functions/test/translation/placeholder.test.ts`
```ts
import { placeholdersMatch } from "../../src/translation/placeholder";

describe("placeholdersMatch", () => {
  test("matches when placeholders preserved", () => {
    expect(placeholdersMatch("Hi {{firstName}}", "Hola {{firstName}}")).toBe(true);
  });

  test("fails when placeholders removed", () => {
    expect(placeholdersMatch("Hi {{firstName}}", "Hola")).toBe(false);
  });

  test("matches braces placeholders", () => {
    expect(placeholdersMatch("You have {count} items", "Tienes {count} artículos")).toBe(true);
  });
});
```

---

## 12) Deploy & Manual Test Checklist

### 12.1 Deploy functions
Deploy both trigger + HTTP worker.

### 12.2 Set worker URL
After deploy, set `TRANSLATION_WORKER_URL` to the HTTP function URL.

### 12.3 Create job posting (EN only)
Write `*_i18n.en` fields, leave ES empty → confirm ES auto-populates.

### 12.4 Update EN
Update `jobDescription_i18n.en` → confirm ES refreshes.

### 12.5 Manual lock
Set `translationMeta.es.status = "manual"` and edit `jobDescription_i18n.es` → confirm EN updates do not overwrite ES.

### 12.6 Loop check
Confirm that worker updates do not enqueue endlessly:
- trigger skips translation-only writes
- Cloud logs show one task per EN edit

---

## 13) Cursor Instructions (how to use this file)
1) Paste this file into your repo root as:
   - `HRX-Translation-Phase1-Implementation-Pack.md`
2) In Cursor, say:
   - “Implement everything in this file. Create the files exactly with these paths. Then run tests.”

---

END
