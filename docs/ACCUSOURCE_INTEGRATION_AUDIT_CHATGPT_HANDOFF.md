# AccuSource / SourceDirect background screening — integration audit (handoff for ChatGPT)

**Audience:** Engineers or ChatGPT sessions that need a precise snapshot of **what exists in the HRX repo**, **what matches the E-Verify-style pattern**, **what appears to work**, and **what is failing** (e.g. catalog sync returning 0 packages).

**Repo:** `hrx-god-view` (Firebase + React + Cloud Functions v2).

**Related docs (in repo):**

- `docs/SOURCEDIRECT_API_REFERENCE.md` — environments, auth, packages, profiles, webhooks.
- `docs/ACCUSOURCE_FIRESTORE_VERIFICATION_CHECKLIST.md` — callable + webhook test expectations.
- `docs/ACCUSOURCE_PRODUCTION_READINESS.md` — vendor / production notes.
- `docs/FLUTTER_RESUME_UPLOAD.md` — unrelated to screening; resume only.

---

## 1. How this compares to E-Verify (pattern)

| Aspect | E-Verify (this repo) | AccuSource / SourceDirect |
|--------|----------------------|---------------------------|
| **Auth** | USCIS OAuth + case APIs | SourceDirect OAuth2 **client_credentials** (`/oauth/access_token`) **or** static Bearer (`ACCUSOURCE_API_KEY` / `SOURCEDIRECT_API_KEY`) |
| **Config** | Secrets + env on Functions | Same: `functions` params + `process.env`; see `getAccusourceConfig()` |
| **Outbound API client** | `everifyClient` + adapter | `AccusourceClient` (`accusourceClient.ts`) — `getCompanyDetails`, `createPartialProfile` |
| **Callables** | Many (`everifyInitiateCase`, etc.) | `syncAccusourcePackageCatalog`, `createAccusourceBackgroundCheck`, `testCreateAccusourceBackgroundCheck`, `getAccusourceBackgroundCheckPdf` |
| **Inbound async** | Poller + webhooks (as designed) | **HTTP webhook:** `apiIntegrationsAccusourceWebhooks` — normalizes payloads, writes `backgroundChecks/{id}` + `events` + optional intake collection |
| **Firestore** | Case docs, employment links | `backgroundChecks/{id}`, `integrations_accusource/catalog`, webhook event mirrors |
| **UI** | Compliance flows, status chips | **User profile → Backgrounds** (`BackgroundsComplianceTab`), package selector, order dialog; **Screenings queue**; **Staff onboarding** panel; account/job order defaults for package IDs |

**Conclusion:** AccuSource is built on the **same architectural idea** as E-Verify (server-only secrets, callables for actions, Firestore as source of truth for HRX state, webhooks for provider pushes). It is **less mature** than E-Verify in-repo: catalog ingestion depends on a **single REST shape**; **accounting codes** (required by vendor for full compliance) are **not fully wired** in the partial-profile payload yet; end-to-end **sandbox package population** is the current pain point.

---

## 2. Backend — what is implemented

### 2.1 Configuration (`functions/src/integrations/accusource/config.ts`)

- **Environments:** `sandbox` (default) vs `production`; drives default base URL:
  - Sandbox: `https://sdapi-sandbox.accusourcedirect.construction`
  - Prod: `https://sdapi.accusourcedirect.com`
- **Overrides:** `ACCUSOURCE_BASE_URL`, `ACCUSOURCE_ENVIRONMENT`, `ACCUSOURCE_ENABLED=false` to disable.
- **API key names accepted:** `ACCUSOURCE_API_KEY`, `SOURCEDIRECT_API_KEY`, legacy token env names.

### 2.2 OAuth / Bearer (`accusourceAccessToken.ts`)

- **Preferred:** `SOURCEDIRECT_CLIENT_ID` + `SOURCEDIRECT_CLIENT_SECRET` → token endpoint (default sandbox/prod URLs; override `SOURCEDIRECT_TOKEN_URL`).
- **Fallback:** static Bearer from config `apiKey`.
- **Guard:** refuses token URL pointing at **uscis.gov** (E-Verify) to prevent misconfiguration.
- **Cache:** in-memory token cache with refresh before expiry.

### 2.3 HTTP client (`accusourceClient.ts`)

- `request()` — attaches Bearer, JSON body for non-GET.
- `getCompanyDetails(isActive)` — **GET** `ACCUSOURCE_COMPANY_DETAILS_PATH` or default **`/api/v2/company/details?isActive=1`** (or `0` / `all`).
- `createPartialProfile(payload)` — **POST** `ACCUSOURCE_CREATE_PROFILE_PATH` or default **`/profiles`**.

### 2.4 Catalog sync (`syncPackageCatalog.ts`)

- **Callable:** `syncAccusourcePackageCatalog` (v2 `onCall`, `cors: true`).
- **Auth:** `ensureAccusourceAdmin` (tenant-scoped staff L5+ / HRX — see `accusourceAdminGate.ts`).
- **Preconditions:** integration enabled; `hasAccusourceOutboundAuth()`.
- **Flow:**
  1. Sets `integrations_accusource/catalog` merge: `syncStatus: 'pending'`.
  2. Calls `accusourceClient.getCompanyDetails(isActive)`.
  3. Normalizes via `normalizeAccusourceCompanyDetailsResponse` (`catalogNormalize.ts`).
  4. Writes `packages`, `services`, `syncStatus: 'ok'`, `lastSyncedAt`, `providerEnvironment`, counts, etc.
- **On error:** `syncStatus: 'error'`, `lastError`; throws `HttpsError` with 401 hint text for ops.

### 2.5 Normalization (`catalogNormalize.ts`)

- Expects raw JSON with **`payload`** as **array of companies** OR **`payload.companies`** array.
- For each company, reads **`packages[]`** and nested **`services`**; also top-level **`services`** on company.
- Builds deduped `packages` and `services` with stable `id` / `name` / `isActive` / `fee` / nested service list.
- **If the live API returns a different top-level shape**, `companies` may be **empty** → **`packages.length === 0`** even when HTTP **200** — this matches the UI symptom: **“Sync: ok” + 0 packages**.

### 2.6 Create order (`createBackgroundCheck.ts`)

- **Callable:** `createAccusourceBackgroundCheck`; **test:** `testCreateAccusourceBackgroundCheck`.
- **Auth:** same admin gate.
- **Flow:**
  1. Creates `backgroundChecks/{id}` draft (`hrxStatus: 'draft'`, `clientId: HRX-BGC-{id}`, `orderMode: 'partial_profile'`).
  2. Writes `events/create_draft_*`.
  3. Builds payload via `mapper.ts` → `accusourceClient.createPartialProfile`.
  4. On success: updates doc with `providerProfileId`, `applicantPortalLink`, `hrxStatus` `submitted` / `awaiting_applicant`, `CREATE_SUBMITTED` event.
  5. On failure: `hrxStatus: 'error'`, `CREATE_ERROR` event.

### 2.7 PDF (`getAccusourceBackgroundCheckPdf.ts`)

- Callable to fetch report PDF (implementation details in file; exported from `index.ts`).

### 2.8 Webhooks (`webhooks.ts`)

- **HTTP function:** `apiIntegrationsAccusourceWebhooks`.
- Parses vendor payloads (flexible `payload` / `data` nesting), signature/secret handling per implementation, updates `backgroundChecks` and subcollection `events`, idempotency via hashing — see file and `ACCUSOURCE_FIRESTORE_VERIFICATION_CHECKLIST.md`.

### 2.9 Exports (`functions/src/index.ts`)

Exports: `apiIntegrationsAccusourceWebhooks`, `createAccusourceBackgroundCheck`, `testCreateAccusourceBackgroundCheck`, `getAccusourceBackgroundCheckPdf`, `syncAccusourcePackageCatalog`.

---

## 3. Firestore — data model

| Path | Purpose | Client read | Client write |
|------|---------|-------------|--------------|
| `integrations_accusource/catalog` | Synced packages/services + `syncStatus`, `lastError`, `lastSyncedAt` | **Yes** (`request.auth != null` in rules) | **No** (Functions only) |
| `backgroundChecks/{checkId}` | Order state, provider ids, status | Tenant L5+ assigned (and HRX) | **No** (Functions only) |
| `backgroundChecks/{checkId}/events/{eventId}` | Audit / webhook trail | Same as parent | **No** |

Rules reference: `firestore.rules` — `match /integrations_accusource/{docId}` and `match /backgroundChecks/{checkId}`.

---

## 4. Frontend — what is implemented

- **`src/pages/UserProfile/components/BackgroundsComplianceTab.tsx`** — “Order screening (AccuSource)” dialog; calls **`syncAccusourcePackageCatalog`**; loads catalog via **`useAccusourceCatalog`** / Firestore `integrations_accusource/catalog`; surfaces messages for **0 packages**, **read failures**, **403**; E-Verify controls live alongside.
- **`src/components/recruiter/AccusourcePackageSelector.tsx`** — Package dropdown, “Refresh packages”, empty states.
- **`src/hooks/useAccusourceCatalog.ts`** — Subscribes or fetches catalog doc.
- **`src/types/accusourceCatalog.ts`** — Client types aligned with `catalogNormalize.ts`.
- **`src/utils/accusourceCatalogHelpers.ts`**, **`src/utils/screeningPackageDefaultsLoader.ts`** — Merge order: **job order → location_defaults → account** for default package fields (documented in UI copy).
- **`JobOrderForm` / `AccountOrderDetailsForm`** — Fields for AccuSource package overrides at job/account level.
- **`ScreeningsQueuePage.tsx`**, **`StaffOnboardingBackgroundChecksPanel.tsx`**, **`StaffOnboardingCenter.tsx`** — Tenant-wide / onboarding views of `backgroundChecks`.

---

## 5. What appears **working** (from code + user testing context)

- **UI shell:** Modal, refresh button, environment label (sandbox), sync status messaging, disabled submit without packages.
- **Callable wiring:** Frontend invokes catalog sync; Functions run admin gate + outbound auth checks.
- **Firestore rules:** Authenticated users can **read** `integrations_accusource/*`; **writes** are server-only (correct).
- **OAuth path:** Implemented with caching; misconfig guard for E-Verify URL confusion.
- **Create flow (when catalog + API agree):** Draft doc + partial profile POST + event trail is implemented.
- **Webhooks:** Receiver implemented with normalization and persistence pattern documented in checklist.

---

## 6. What is **not working** or **unverified** (current gaps)

### 6.1 Catalog sync returns **0 packages** (observed in UI)

**Symptoms:** “Sync finished but AccuSource returned 0 active packages” / empty package dropdown; may still show **sync ok** if HTTP succeeded and normalizer produced zero rows.

**Likely causes (check in order):**

1. **Sandbox credentials** are valid for **auth** but tied to a **company with no active packages** in SourceDirect.
2. **API response JSON shape** differs from what `normalizeAccusourceCompanyDetailsResponse` expects (`payload` vs `payload.companies`, field names for packages/services). **Capture raw `getCompanyDetails` response** in Functions logs or a one-off script and compare to `catalogNormalize.ts`.
3. **`isActive=1` filter** excludes everything — retry sync with `isActive: 'all'` or `0` if callable exposes it (input type supports it server-side; confirm UI passes it).
4. **Wrong base URL / environment** (sandbox key against prod host or vice versa) — usually **401**, not empty packages; but worth verifying.

### 6.2 Vendor-required features not fully modeled

Per `SOURCEDIRECT_API_REFERENCE.md`:

- **Accounting codes** (primary / secondary / tertiary) — **not fully implemented** in create payload for billing/access parity with SD.
- **Extended partial profile** — code path emphasizes **partial**; vendor recommends extended partial when not full profile.
- **Per-tenant SourceDirect credentials** — currently **global** Functions env; multi-tenant credential UI not described in code audited here.

### 6.3 Testing status

- **Automated:** No guarantee of CI e2e against real SD sandbox in repo from this audit.
- **Manual:** Checklist in `ACCUSOURCE_FIRESTORE_VERIFICATION_CHECKLIST.md` defines **expected** Firestore fields after callable + webhooks.
- **User screenshot (Mar 2026):** Sandbox, “Sync: ok”, **0 packages** — consistent with sections **6.1** above.

---

## 7. Environment variables (Functions runtime)

**Commonly needed:**

- `ACCUSOURCE_ENVIRONMENT` — `sandbox` | `production`
- `SOURCEDIRECT_CLIENT_ID`, `SOURCEDIRECT_CLIENT_SECRET` (recommended) **or** `ACCUSOURCE_API_KEY` / `SOURCEDIRECT_API_KEY`
- Optional: `ACCUSOURCE_BASE_URL`, `SOURCEDIRECT_TOKEN_URL`, `ACCUSOURCE_COMPANY_DETAILS_PATH`, `ACCUSOURCE_CREATE_PROFILE_PATH`, `ACCUSOURCE_WEBHOOK_SECRET` / `SOURCEDIRECT_WEBHOOK_SECRET`, `ACCUSOURCE_ENABLED`

**Firebase params:** `functions` `defineString` mirrors several of these — see `config.ts` and `accusourceAccessToken.ts`.

---

## 8. Recommended next steps (engineering)

1. **Log raw body** (sanitized) of `getCompanyDetails` on sync success when `packages.length === 0` to confirm schema vs `catalogNormalize.ts`.
2. **Vendor confirmation:** Sandbox company has **at least one active package**; confirm exact **GET** path and query params for “company details” in current V2 docs.
3. **Postman:** Use vendor Postman collection against same credentials as Functions (`docs/postman/README.md`).
4. **Wire accounting codes** into `mapper.ts` / partial profile when product defines where primary/secondary/tertiary live in HRX (account vs location vs job order).
5. **Webhook URL** registered in SourceDirect portal pointing to deployed `apiIntegrationsAccusourceWebhooks` with correct secret.

---

## 9. E-Verify (one-line pointer)

E-Verify integration lives under `functions/src/integrations/everify/` and `everifyGate.ts` exports; UI patterns for compliance live in the same **Backgrounds** tab alongside AccuSource. **Do not** reuse E-Verify OAuth URLs for SourceDirect — code explicitly blocks that mistake in `accusourceAccessToken.ts`.

---

## 10. Summary table for ChatGPT

| Item | Status |
|------|--------|
| OAuth / static Bearer to SourceDirect | Implemented |
| GET company details → Firestore catalog | Implemented; **empty catalog likely schema or sandbox data** |
| Normalized catalog in UI | Implemented |
| Create partial profile + Firestore `backgroundChecks` | Implemented |
| Webhook HTTP handler | Implemented |
| PDF callable | Exported |
| Firestore security for catalog + checks | Implemented |
| Accounting codes / full vendor checklist | **Incomplete** |
| End-to-end verified with real SD packages in sandbox | **Not confirmed** (0 packages in UI) |

---

*Generated from codebase audit; update this file when sync shape or vendor contract changes.*
