# HRX E‑Verify v31 (ICA) Client Refactor — Cursor Implementation Pack
**Goal:** Refactor your current Stage client-credentials OAuth approach to match the **ICA v31 Web Services** REST flow:
- `POST /authentication/login` → bearer token
- `POST /authentication/refresh` → refresh token (tokens expire after **2 hours**)
- `POST /cases` → create **draft** case (payload schema: `i9_case_flat`)
- `POST /cases/{case_number}/submit` → submit draft case for verification and receive workflow status

This pack is written so Cursor can implement it end-to-end with minimal back-and-forth.

---

## 0) Current state (what you have today)
You currently have:
- `functions/src/integrations/everify/everifyClient.ts` calling:
  - `EVERIFY_AUTH_URL` with OAuth2 client-credentials (`EVERIFY_CLIENT_ID/SECRET`)
  - `POST {EVERIFY_BASE_URL}/cases` with a **custom** payload `{ companyId, startDate, requestHash, metadata }`
- That does **not** match the ICA v31 REST specification in the PDF:
  - Login uses **username/password** (`login_request`)
  - Access token expires after **two hours** and can be refreshed via `/authentication/refresh`
  - Case creation requires `i9_case_flat` (I‑9 case fields, including SSN and document numbers)
  - Submission is a separate operation: `POST /cases/{case_number}/submit`

---

## 1) Source-of-truth references in your ICA PDF (for Cursor)
From the uploaded ICA PDF (`everify_ica_employer_web_service_v31_1_0.pdf`):

### 1.1 Login
- Operation: **Login**
- Endpoint: `POST /authentication/login`
- Body schema: `login_request`
- Token response includes `access_token` and `user_info`

**Schema: `login_request`**
- `username` (required, length 8, example `"ABCD1234"`)
- `password` (required, length 8–14, example `"aP@ssw0rd!"`)

### 1.2 Refresh token
- Operation: **Refresh Token**
- Endpoint: `POST /authentication/refresh`
- Header: `Authorization: Bearer <token>`
- Note: “Access tokens expire after two hours… generating a new token revokes the old one.”

### 1.3 Submit Case
- Operation: **Submit Case**
- Endpoint: `POST /cases/{case_number}/submit`
- Requires bearer token
- Requires case to be in `DRAFT` status
- Returns eligibility + case status; if authorized, returns `CLOSED` + `EMPLOYMENT_AUTHORIZED`

### 1.4 Create Case payload schema (`i9_case_flat`)
The Create Case request body uses `i9_case_flat`. Fields (from the schema definition pages) include:

**Required fields**
- `first_name`
- `last_name`
- `date_of_birth` (YYYY-MM-DD)
- `date_of_hire` (YYYY-MM-DD)
- `ssn` (required in schema; **HRX must NEVER store it**)
- `citizenship_status_code`
- `case_creator_email_address`
- `case_creator_name`
- `case_creator_phone_number`

**Common optional/conditional fields**
- `middle_initial`
- `other_last_names_used` (array)
- `employee_email_address` (must not equal `case_creator_email_address`)
- `phone_number` (format varies by schema variants)
- `employer_case_id` (your internal reference)
- `client_company_id` (optional; generally used for employer-agent/client setups)
- `client_software_version`
- `reason_for_delay_code`, `reason_for_delay_description`
- Document fields (conditional):
  - `document_a_type_code`, `document_b_type_code`, `document_c_type_code`, `document_sub_type_code`
  - `document_bc_number`
  - `expiration_date`, `no_expiration_date`
  - `us_passport_number`, `foreign_passport_number`, `visa_number`
  - `us_state_code`, `country_code`
  - `i551_number`, `i766_number`, `i94_number`, `alien_number`, `sevis_number`

---

## 2) Critical architecture decision (must implement)
Because `i9_case_flat` includes **SSN and document numbers**, HRX should **assemble the request payload just-in-time** and **never persist those sensitive fields**.

### 2.1 Add an I‑9 payload provider interface
Implement an internal interface that can supply `i9_case_flat` at runtime:

- `everifyI9Provider.ts` should export:
  - `resolveI9CasePayloadFromEmployment(...) -> I9CaseFlat` (returns the payload to send to E‑Verify)
  - This function **may** fetch from an external I‑9 vendor later.
  - For now, it can be a stub that pulls from a secure internal source or test fixtures in Stage.

**Do not** store SSN/document values in Firestore. If you must store temporarily for testing, store only in:
- local emulator-only fixtures, OR
- a locked-down encrypted store with extremely strict rules (not recommended for Phase 1).

---

## 3) Implementation plan (what Cursor should build)

### 3.1 Files to create/modify
**Modify**
- `functions/src/integrations/everify/everifyClient.ts`
- `functions/src/integrations/everify/everifyService.ts`
- `functions/src/integrations/everify/everifyConfig.ts`
- `functions/src/integrations/everify/everifyRedaction.ts`
- `functions/src/integrations/everify/everifySchemas.ts`
- `functions/src/integrations/everify/everifyAdapter.ts` (status mapping)
- `functions/src/integrations/everify/everifyTriggers.ts` (only to call the new service signature if needed)

**Add**
- `functions/src/integrations/everify/everifyAuth.ts` (token cache + login/refresh)
- `functions/src/integrations/everify/everifyI9Provider.ts` (payload resolver)
- `functions/src/integrations/everify/everifyHttp.ts` (shared fetch wrapper: retries/timeouts)

### 3.2 New env/secrets
Remove the OAuth2 client-credentials requirement for ICA REST.

Add:
- `EVERIFY_WS_USERNAME` (Secret Manager)
- `EVERIFY_WS_PASSWORD` (Secret Manager)
- `EVERIFY_BASE_URL` default Stage: `https://stage-everify.uscis.gov/api/v31`
- `EVERIFY_AUTH_BASE_URL` default Stage: `https://stage-everify.uscis.gov/api/v31`  
  (Auth endpoints are under the same base in ICA; use `/authentication/login` and `/authentication/refresh`.)
- Keep:
  - `EVERIFY_EAAT_STUB`, `EVERIFY_EAAT_SCENARIO` (your existing harness)

---

## 4) Code: Drop‑in implementations (Cursor should paste these in)

> **Note:** These are TypeScript examples for Firebase Functions Node 20. Adjust `fetch` imports if your runtime requires `node-fetch` (Node 20 typically supports global fetch).

### 4.1 `everifyHttp.ts` — standardized HTTP wrapper
```ts
// functions/src/integrations/everify/everifyHttp.ts
export type HttpOptions = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  url: string;
  headers?: Record<string, string>;
  body?: any;
  timeoutMs?: number;
  retries?: number; // simple retry on 5xx/429/network
};

function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

export async function httpJson<T>(opts: HttpOptions): Promise<T> {
  const {
    method,
    url,
    headers = {},
    body,
    timeoutMs = 15000,
    retries = 2,
  } = opts;

  let attempt = 0;
  let lastErr: any = null;

  while (attempt <= retries) {
    attempt++;
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const resp = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...headers,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(id);

      const text = await resp.text();
      const json = text ? JSON.parse(text) : null;

      if (resp.ok) return json as T;

      // Retry for transient errors
      if ((resp.status >= 500 || resp.status === 429) && attempt <= retries) {
        await sleep(250 * attempt);
        continue;
      }

      const err = new Error(`HTTP ${resp.status} ${resp.statusText}`);
      (err as any).status = resp.status;
      (err as any).body = json;
      throw err;
    } catch (e: any) {
      clearTimeout(id);
      lastErr = e;
      // Retry for network/abort
      if (attempt <= retries) {
        await sleep(250 * attempt);
        continue;
      }
      throw lastErr;
    }
  }

  throw lastErr;
}
```

### 4.2 `everifyAuth.ts` — ICA login + refresh with 2‑hour expiry cache
```ts
// functions/src/integrations/everify/everifyAuth.ts
import { httpJson } from "./everifyHttp";
import { getEverifyConfig, getEverifyCredentials } from "./everifyConfig";

type AuthResponse = {
  access_token: string;
  user_info?: any;
};

let cachedToken: { token: string; expiresAtMs: number } | null = null;

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
// Refresh earlier than expiry (90 min) to reduce 401 churn
const REFRESH_EARLY_MS = 90 * 60 * 1000;

export async function getAccessToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && now < cachedToken.expiresAtMs - REFRESH_EARLY_MS) {
    return cachedToken.token;
  }

  // If we have a token but it’s nearing expiry, attempt refresh first
  if (cachedToken) {
    const refreshed = await tryRefresh(cachedToken.token);
    if (refreshed) return refreshed;
  }

  // Otherwise login
  const loggedIn = await login();
  return loggedIn;
}

async function login(): Promise<string> {
  const cfg = getEverifyConfig();
  const creds = getEverifyCredentials(); // throws if missing

  const url = `${cfg.baseUrl}/authentication/login`;
  const body = {
    username: creds.username,
    password: creds.password,
  };

  const resp = await httpJson<AuthResponse>({
    method: "POST",
    url,
    body,
    timeoutMs: 15000,
    retries: 1,
  });

  if (!resp?.access_token) throw new Error("E-Verify login: missing access_token");

  cachedToken = {
    token: resp.access_token,
    expiresAtMs: Date.now() + TWO_HOURS_MS,
  };

  return resp.access_token;
}

async function tryRefresh(existingToken: string): Promise<string | null> {
  const cfg = getEverifyConfig();
  const url = `${cfg.baseUrl}/authentication/refresh`;

  try {
    const resp = await httpJson<AuthResponse>({
      method: "POST",
      url,
      headers: { Authorization: `Bearer ${existingToken}` },
      timeoutMs: 15000,
      retries: 0,
    });

    if (!resp?.access_token) return null;

    cachedToken = {
      token: resp.access_token,
      expiresAtMs: Date.now() + TWO_HOURS_MS,
    };

    return resp.access_token;
  } catch (e: any) {
    // If refresh fails (401 or otherwise), fall back to login
    return null;
  }
}
```

### 4.3 `everifyConfig.ts` — credentials and base URL
```ts
// functions/src/integrations/everify/everifyConfig.ts
import * as functions from "firebase-functions";

export type EverifyConfig = {
  baseUrl: string; // e.g. https://stage-everify.uscis.gov/api/v31
  eaatStub: boolean;
  eaatScenario?: string;
};

export type EverifyCredentials = {
  username: string;
  password: string;
};

export function getEverifyConfig(): EverifyConfig {
  const baseUrl =
    process.env.EVERIFY_BASE_URL ||
    functions.config()?.everify?.base_url ||
    "https://stage-everify.uscis.gov/api/v31";

  const eaatStub =
    process.env.EVERIFY_EAAT_STUB === "true" ||
    functions.config()?.everify?.eaat_stub === "true";

  const eaatScenario =
    process.env.EVERIFY_EAAT_SCENARIO ||
    functions.config()?.everify?.eaat_scenario ||
    undefined;

  return { baseUrl, eaatStub, eaatScenario };
}

export function getEverifyCredentials(): EverifyCredentials {
  const username = process.env.EVERIFY_WS_USERNAME;
  const password = process.env.EVERIFY_WS_PASSWORD;

  if (!username || !password) {
    throw new Error("Missing EVERIFY_WS_USERNAME / EVERIFY_WS_PASSWORD");
  }

  return { username, password };
}
```

### 4.4 `everifyI9Provider.ts` — JIT payload assembly (no Firestore storage of SSN/doc #)
```ts
// functions/src/integrations/everify/everifyI9Provider.ts
import { I9CaseFlat } from "./everifySchemas";

/**
 * IMPORTANT:
 * - Do NOT store SSN/doc numbers in Firestore.
 * - This function should fetch I-9 data from a secure source at runtime.
 *
 * Phase 1 options:
 * - Stage-only fixture (controlled) for development
 * - External I-9 vendor integration (future)
 */
export async function resolveI9CasePayloadFromEmployment(params: {
  tenantId: string;
  entityId: string;
  userEmploymentId: string;
  userId: string;
  // include start/hire date from employment/assignment
  dateOfHire: string; // YYYY-MM-DD
  caseCreator: {
    name: string;
    email: string;
    phone10: string; // 10 digits per schema
    phoneExt?: string;
  };
}): Promise<I9CaseFlat> {
  // TODO: Replace with real I-9 data fetch.
  // For now: throw unless a controlled Stage fixture env var is present.
  const fixture = process.env.EVERIFY_STAGE_I9_FIXTURE_JSON;
  if (!fixture) {
    throw new Error(
      "No I-9 payload source configured. Set EVERIFY_STAGE_I9_FIXTURE_JSON for Stage testing or implement I-9 provider."
    );
  }

  const data = JSON.parse(fixture);

  // Must return the `i9_case_flat` request schema
  return {
    ...data,
    date_of_hire: params.dateOfHire,
    case_creator_name: params.caseCreator.name,
    case_creator_email_address: params.caseCreator.email,
    case_creator_phone_number: params.caseCreator.phone10,
    case_creator_phone_number_extension: params.caseCreator.phoneExt,
  } as I9CaseFlat;
}
```

### 4.5 `everifyClient.ts` — create draft + submit (ICA-compliant)
```ts
// functions/src/integrations/everify/everifyClient.ts
import { httpJson } from "./everifyHttp";
import { getEverifyConfig } from "./everifyConfig";
import { getAccessToken } from "./everifyAuth";
import { I9CaseFlat, SubmitCaseResponse, CreateCaseDraftResponse } from "./everifySchemas";

export async function createDraftCase(payload: I9CaseFlat): Promise<CreateCaseDraftResponse> {
  const cfg = getEverifyConfig();
  const token = await getAccessToken();

  const url = `${cfg.baseUrl}/cases`;
  return await httpJson<CreateCaseDraftResponse>({
    method: "POST",
    url,
    headers: { Authorization: `Bearer ${token}` },
    body: payload,
    timeoutMs: 20000,
    retries: 1,
  });
}

export async function submitCase(caseNumber: string): Promise<SubmitCaseResponse> {
  const cfg = getEverifyConfig();
  const token = await getAccessToken();

  const url = `${cfg.baseUrl}/cases/${encodeURIComponent(caseNumber)}/submit`;
  return await httpJson<SubmitCaseResponse>({
    method: "POST",
    url,
    headers: { Authorization: `Bearer ${token}` },
    timeoutMs: 20000,
    retries: 1,
  });
}
```

---

## 5) Schemas & redaction (must update)

### 5.1 `everifySchemas.ts` — add minimal response types + whitelist raw fields
Your current schemas are OK, but add explicit types for:
- Create draft case response (must include `case_number`)
- Submit response (must include `case_status`, `case_status_display`, `case_eligibility_statement`)

Example:
```ts
// functions/src/integrations/everify/everifySchemas.ts
import { z } from "zod";

export const CreateCaseDraftResponseSchema = z.object({
  case_number: z.string(),
  case_status: z.string().optional(),
  case_status_display: z.string().optional(),
});

export type CreateCaseDraftResponse = z.infer<typeof CreateCaseDraftResponseSchema>;

export const SubmitCaseResponseSchema = z.object({
  case_number: z.string().optional(),
  case_status: z.string().optional(),
  case_status_display: z.string().optional(),
  case_eligibility_statement: z.string().optional(),
  // include referral fields if present (optional)
  ssa_referral_status: z.string().optional(),
  dhs_referral_status: z.string().optional(),
  dhs_referral_due_date: z.string().optional(),
});

export type SubmitCaseResponse = z.infer<typeof SubmitCaseResponseSchema>;

/**
 * i9_case_flat request payload — keep as a TS type for compile-time
 * and optionally a zod schema if you validate.
 * NOTE: do NOT log or persist the request payload.
 */
export type I9CaseFlat = Record<string, any>;
```

### 5.2 `everifyRedaction.ts` — switch to **whitelist** for stored raw
Do NOT store “redacted raw response” by blacklisting; whitelist is safer.

```ts
// functions/src/integrations/everify/everifyRedaction.ts
export function whitelistEverifyRaw(raw: any) {
  if (!raw || typeof raw !== "object") return raw;

  const allowed = [
    "case_number",
    "case_status",
    "case_status_display",
    "case_eligibility_statement",
    "ssa_referral_status",
    "dhs_referral_status",
    "dhs_referral_due_date",
    "dhs_referral_created_at",
    "dhs_referral_contact_by_date",
    "ev_star_referral_due_date",
    "ev_star_referral_created_at",
    "ev_star_referral_contact_by_date",
    // add more non-PII fields as needed
  ];

  const out: any = {};
  for (const k of allowed) {
    if (k in raw) out[k] = raw[k];
  }
  return out;
}
```

---

## 6) `everifyService.ts` — implement ICA two-step case creation
Refactor your `createCase()` to:
1) resolve I‑9 payload (JIT)
2) `createDraftCase(payload)`
3) `submitCase(case_number)`
4) map status → HRX status via adapter
5) write Firestore case doc + events

Pseudo:
```ts
// functions/src/integrations/everify/everifyService.ts
import * as admin from "firebase-admin";
import { createDraftCase, submitCase } from "./everifyClient";
import { resolveI9CasePayloadFromEmployment } from "./everifyI9Provider";
import { mapProviderStatusToHrx } from "./everifyAdapter";
import { whitelistEverifyRaw } from "./everifyRedaction";

export async function createAndSubmitCase(params: {
  tenantId: string;
  entityId: string;
  userId: string;
  userEmploymentId: string;
  assignmentId?: string;
  jobOrderId?: string;
  shiftId?: string;
  requestHash: string;
  dateOfHire: string; // YYYY-MM-DD
  caseCreator: { name: string; email: string; phone10: string; phoneExt?: string; };
}) {
  const db = admin.firestore();

  // 1) Build I-9 request payload (do NOT log payload)
  const i9 = await resolveI9CasePayloadFromEmployment({
    tenantId: params.tenantId,
    entityId: params.entityId,
    userEmploymentId: params.userEmploymentId,
    userId: params.userId,
    dateOfHire: params.dateOfHire,
    caseCreator: params.caseCreator,
  });

  // 2) Create draft
  const draft = await createDraftCase(i9);
  const caseNumber = draft.case_number;

  // 3) Submit
  const submitted = await submitCase(caseNumber);

  // 4) Normalize status
  const providerStatus = submitted.case_status || draft.case_status || "DRAFT";
  const status = mapProviderStatusToHrx(providerStatus, submitted.case_eligibility_statement);

  // 5) Persist case doc (NO PII)
  const caseRef = db
    .collection(`tenants/${params.tenantId}/everify_cases`)
    .doc(); // or deterministic if you want

  await caseRef.set({
    tenantId: params.tenantId,
    entityId: params.entityId,
    userId: params.userId,
    userEmploymentId: params.userEmploymentId,
    assignmentId: params.assignmentId || null,
    jobOrderId: params.jobOrderId || null,
    shiftId: params.shiftId || null,
    requestHash: params.requestHash,
    environment: "stage",
    everifyCaseNumber: caseNumber,
    status,
    providerStatus,
    submittedAt: admin.firestore.FieldValue.serverTimestamp(),
    lastCheckedAt: admin.firestore.FieldValue.serverTimestamp(),
    raw: whitelistEverifyRaw(submitted),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: false });

  // events...
  await caseRef.collection("events").add({
    tenantId: params.tenantId,
    entityId: params.entityId,
    userId: params.userId,
    userEmploymentId: params.userEmploymentId,
    assignmentId: params.assignmentId || null,
    type: "CASE_CREATED_AND_SUBMITTED",
    at: admin.firestore.FieldValue.serverTimestamp(),
    actor: "system",
    data: { providerStatus, status, caseNumber },
  });

  return { caseId: caseRef.id, caseNumber, status };
}
```

---

## 7) Update call paths (trigger + callable)

### 7.1 Trigger `processEverifyCaseFromEmployment`
Replace any call to the old OAuth-based create with:
- `createAndSubmitCase(...)`

**Key requirement:** `dateOfHire` must be available (from assignment start date or employment start date).
- You already require start date in eligibility; reuse that.

### 7.2 Callable `everifyCreateCase`
Same: call `createAndSubmitCase(...)` if eligible, and return `caseId/status/caseNumber`.

---

## 8) Poller updates (future-safe)
Your poller currently updates `lastCheckedAt` only. To evolve:
- Add a `GET /cases/{case_number}` operation (if present in ICA) or another status endpoint.
- Map status changes → event logs
- If `TNC`, set deadlines in `deadlines` and create tasks.

**Do not implement until you confirm the correct “get case status” operation in the ICA.**

---

## 9) Security checklist
- Never log the I‑9 payload.
- Never store SSN or document numbers in Firestore.
- Store only:
  - `everifyCaseNumber`
  - normalized status fields
  - whitelisted non‑PII raw response keys
- Ensure Firestore rules remain:
  - admin/HRX write
  - recruiters read
  - workers read own (and consider restricting fields further if you split “public vs private”)

---

## 10) Cursor “single prompt” (copy/paste)
```text
Refactor HRX E‑Verify integration to align with ICA v31 REST:
1) Replace OAuth client-credentials in everifyClient.ts with ICA auth:
   - POST {BASE}/authentication/login with {username,password} (login_request)
   - POST {BASE}/authentication/refresh with Authorization Bearer token
   - Cache token in memory; tokens expire after 2 hours; refresh early.
2) Implement ICA case creation workflow:
   - POST {BASE}/cases with i9_case_flat payload to create DRAFT and obtain case_number
   - POST {BASE}/cases/{case_number}/submit to submit for verification
   - Persist everifyCaseNumber, providerStatus, normalized HRX status, timestamps.
3) Add everifyI9Provider.ts to assemble i9_case_flat just-in-time (NO Firestore storage of SSN/doc numbers). For Stage, allow an env var EVERIFY_STAGE_I9_FIXTURE_JSON to supply the payload; do not log it.
4) Update everifyRedaction.ts to whitelist non-PII response keys for Firestore raw storage (case_number, case_status, case_status_display, case_eligibility_statement, referral status/date fields).
5) Update everifyService + processEverifyCaseFromEmployment + everifyCreateCase callable to use createDraftCase + submitCase.
Keep EAAT stub harness as fallback via EVERIFY_EAAT_STUB=true.
Add/rename secrets: EVERIFY_WS_USERNAME, EVERIFY_WS_PASSWORD, EVERIFY_BASE_URL (default stage).
```

---

## 11) Notes about your current Stage login trouble
You **do not** need website login.gov linkage to call Web Services.
Your email from E‑Verify included:
- **Web Service User ID**: `GFIE7857`
- “Password: you must update/reset inside Program Admin UI”
That WS credential pair is what `login_request.username/password` expects.

If you cannot reset WS password due to portal linking issues, you can still proceed:
- Ask E‑Verify support to manually reset WS password or confirm it
- Then you can login to `/authentication/login` via API even if GUI login.gov linkage is failing

---

## 12) Implementation acceptance criteria (Definition of Done)
- With Stage credentials set:
  - `POST /authentication/login` returns token
  - `POST /cases` returns `case_number`
  - `POST /cases/{case_number}/submit` returns a case status
- Firestore stores:
  - caseNumber, status/providerStatus, timestamps, whitelisted raw fields
- Firestore stores **no SSN/doc numbers**
- Trigger path works end-to-end in deployed environment (Cloud Tasks queue + worker URL)

