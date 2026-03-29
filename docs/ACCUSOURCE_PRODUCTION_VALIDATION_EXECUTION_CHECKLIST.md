# AccuSource — production validation execution checklist (guardrails)

Step-by-step execution list for **controlled production validation** using:

- `ACCUSOURCE_ENVIRONMENT=production`
- `ACCUSOURCE_PRODUCTION_VALIDATION_HRX_ONLY=true` (default): **only `hrx: true`** users may submit orders; **assignment automation** cannot create production orders.

No new product features — ops / engineering validation only.

---

## 1. Exact env / secrets to set before validation

Set these on **Firebase Functions** (same mechanism you use today: **Firebase params** / `.env` copied by `functions/scripts/copyEnvFromRoot.js`, or **Secret Manager** where applicable).

**Important:** For project `hrx1-d3beb`, Firebase deploy also reads **`functions/.env.hrx1-d3beb`**, which **overrides** the same variable names in **`functions/.env`**. Stale lines there (e.g. `ACCUSOURCE_ENVIRONMENT=sandbox`) have caused production root `.env` to be ignored. Run **`npm run copy-env`** in `functions/` after editing root `.env`; the script merges param keys into `.env.<projectId>` from `.firebaserc` so deploy picks up production.

| Name | Required | Value / notes |
|------|----------|----------------|
| `ACCUSOURCE_ENABLED` | Yes | `true` |
| `ACCUSOURCE_ENVIRONMENT` | Yes | `production` or `prod` |
| `ACCUSOURCE_PRODUCTION_VALIDATION_HRX_ONLY` | Yes (validation window) | `true` — keep until go/no-go below |
| `SOURCEDIRECT_CLIENT_ID` | Yes (recommended) | **Production** client id from AccuSource |
| `SOURCEDIRECT_CLIENT_SECRET` | Yes (recommended) | **Production** client secret |
| `SOURCEDIRECT_TOKEN_URL` | Usually omit | Defaults to `https://sdapi.accusourcedirect.com/oauth/access_token` |
| `ACCUSOURCE_API_KEY` or `SOURCEDIRECT_API_KEY` | Only if not using OAuth | Static Bearer for **production** stack (must match env + base URL) |
| `ACCUSOURCE_BASE_URL` | Optional | Omit → `https://sdapi.accusourcedirect.com` per `config.ts`; set if vendor gives a different gateway |
| `ACCUSOURCE_WEBHOOK_SECRET` or `SOURCEDIRECT_WEBHOOK_SECRET` | Yes for webhook verification | Must match SourceDirect **production** webhook configuration |
| `ACCUSOURCE_COMPANY_DETAILS_PATH` | Optional | Override only if AccuSource specifies a non-default catalog path |
| `ACCUSOURCE_CREATE_PROFILE_PATH` | Optional | Override only if AccuSource specifies a non-default create path |

**Deploy:** Redeploy Functions after changing params/secrets so **callables** and **`apiIntegrationsAccusourceWebhooks`** pick up values.

**Do not use** sandbox OAuth credentials against production base URL (expect 401 / wrong catalog).

---

## 2. One production catalog sync verification checklist

Perform as a user who passes **`ensureAccusourceAdmin`** (tenant admin / manager / `super_admin` or security level ≥ 5 for the active tenant). HRX claim **not** required for sync.

- [ ] Open a user profile → **Backgrounds** → **Order screening (AccuSource)**.
- [ ] Click **Refresh packages** (calls `syncAccusourcePackageCatalog`).
- [ ] Callable returns `ok: true` and **`providerEnvironment`: `"production"`**.
- [ ] Firestore doc **`integrations_accusource/catalog`** has:
  - [ ] `providerEnvironment` == `production`
  - [ ] `syncStatus` == `ok`
  - [ ] `packages` array length **> 0** (if 0, fix SourceDirect company/packages or response normalization — stop here)
- [ ] Logs (GCP): message contains `[AccuSource][production][catalog]` and text `Package catalog sync completed`; structured fields include package/service counts and `accusourceEnvironment: "production"`.

---

## 3. One manual HRX-only production order test checklist

- [ ] Confirm `ACCUSOURCE_PRODUCTION_VALIDATION_HRX_ONLY=true` on deployed Functions.
- [ ] Sign in as a user with Firebase custom claim **`hrx: true`** (same as internal HRX staff elsewhere in the app).
- [ ] Open a real candidate/user profile → **Backgrounds** → **Order screening (AccuSource)**.
- [ ] Select a **production** package from the synced catalog (IDs must match catalog).
- [ ] **Submit order** (`createAccusourceBackgroundCheck`).
- [ ] UI returns success (no `permission-denied` / `failed-precondition` from validation guard).
- [ ] **Negative check (optional):** sign in as a **non-HRX** tenant admin and attempt submit → expect **`permission-denied`** with message referencing production validation (no provider order).

---

## 4. Exact Firestore fields and logs to inspect after the order

### Firestore — parent `backgroundChecks/{checkId}`

- [ ] `provider` == `accusource`
- [ ] `providerEnvironment` == `production`
- [ ] `clientId` == `HRX-BGC-{checkId}`
- [ ] `orderMode` == `partial_profile`
- [ ] `createdBy` == Firebase Auth UID of the HRX user
- [ ] `hrxStatus` in `submitted` / `awaiting_applicant` (success) or `error` (failure)
- [ ] `providerProfileId` present on success path (needed for webhooks / PDF)
- [ ] `syncError` null on success
- [ ] `requestedPackageId` / `requestedPackageName` (if sent) match UI selection

### Firestore — events `backgroundChecks/{checkId}/events/*`

- [ ] Document with type **`CREATE_DRAFT`**
- [ ] Then **`CREATE_SUBMITTED`** (success) or **`CREATE_ERROR`** (failure)

### Logs — every `createBackgroundCheckInternal` attempt (after integration enabled)

Structured logs use **`accusourceLog`** → prefix **`[AccuSource][production|sandbox][tag]`** and field **`accusourceEnvironment`**.

| When | Message (prefix) | Structured fields to verify |
|------|------------------|-----------------------------|
| Start of internal create (always, after enabled check) | `[…][create] createBackgroundCheckInternal: order attempt (pre-policy)` | `callerUid`, `invocationType` (`callable` \| `automation`), `hrxClaim` (`true`/`false` for callables; omitted for automation), `productionValidationHrxOnlyActive` (`true` only when env is production **and** validation param is on) |
| Production + validation + HRX allowed | `[…][policy] Production order allowed (HRX caller, validation mode).` | `callerUid`, `hrxClaim: true`, `reason: hrx_callable` |
| Production + validation + non-HRX | `[…][policy] Rejected non-HRX…` | `callerUid`, `hrxClaim: false`, `reason: hrx_claim_required` |
| Production + validation + automation | `[…][policy] Blocked automated…` | `callerUid`, `reason: automation_disabled_in_production_validation` |
| Provider create success | `[…][create] createPartialProfile succeeded` | `callerUid`, `backgroundCheckId`, `hrxStatus`, `hrxClaim`, `productionValidationHrxOnlyActive` |
| Provider create failure | `[…][create] createPartialProfile failed` | `callerUid`, `backgroundCheckId`, `error`, `hrxClaim`, `productionValidationHrxOnlyActive` |

**GCP query examples:**  
- Text: `createBackgroundCheckInternal: order attempt`  
- JSON: `jsonPayload.callerUid="…"` and `jsonPayload.productionValidationHrxOnlyActive=true`

---

## 5. Exact webhook verification steps

- [ ] In SourceDirect **production** admin, webhook URL = deployed **`apiIntegrationsAccusourceWebhooks`** HTTPS URL (project/region correct).
- [ ] Webhook signing secret in SourceDirect matches **`ACCUSOURCE_WEBHOOK_SECRET`** / **`SOURCEDIRECT_WEBHOOK_SECRET`** on Functions (if your deployment validates signatures per `webhooks.ts`).
- [ ] Trigger at least one event after the test order (vendor test send, or wait for natural profile/status event).
- [ ] Firestore **`integrations_accusource_webhook_events/{eventId}`**:
  - [ ] Row exists with `processingStatus` **`processed`** (matched) or **`ignored`** with `processingError` documented (unmatched)
- [ ] For matched events, parent **`backgroundChecks/{checkId}`** updates:
  - [ ] `lastWebhookAt`, `lastWebhookType`
  - [ ] `hrxStatus` / `providerStatus` / flags as applicable (`finalReportReady`, etc.)
- [ ] Mirror doc **`backgroundChecks/{checkId}/events/{eventId}`** exists with processed payload metadata.
- [ ] Logs: `[AccuSource][production][webhook]` lines for batch receive / processed / unmatched; `accusourceEnvironment: "production"`.

---

## 6. Go / no-go: disabling `ACCUSOURCE_PRODUCTION_VALIDATION_HRX_ONLY`

**Do not** set `false` until:

- [ ] Production catalog sync stable (`packageCount` > 0, correct packages).
- [ ] At least one HRX manual production order **succeeded** end-to-end (`providerProfileId`, `CREATE_SUBMITTED`, acceptable `hrxStatus`).
- [ ] Webhook path verified (matched event **or** documented vendor timeline if events are delayed).
- [ ] Stakeholders accept that **tenant admins** and **assignment automation** will be able to create **production** AccuSource orders after the flag flips.

**Go:**

- [ ] Set **`ACCUSOURCE_PRODUCTION_VALIDATION_HRX_ONLY=false`** on Functions (params / env).
- [ ] Redeploy Functions.
- [ ] Smoke-test: non-HRX tenant admin can submit **one** low-risk order **or** confirm automation run succeeds in staging-like tenant if you use it.

**No-go:**

- [ ] Leave **`ACCUSOURCE_PRODUCTION_VALIDATION_HRX_ONLY=true`**
- [ ] Keep investigating catalog, credentials, or webhook mismatch; optionally revert **`ACCUSOURCE_ENVIRONMENT`** to sandbox for non-prod projects only (do not mix sandbox creds with production URL).

---

## Related documents

- [`ACCUSOURCE_PRODUCTION_VALIDATION_RUNBOOK.md`](./ACCUSOURCE_PRODUCTION_VALIDATION_RUNBOOK.md) — narrative runbook
- [`ACCUSOURCE_FIRESTORE_VERIFICATION_CHECKLIST.md`](./ACCUSOURCE_FIRESTORE_VERIFICATION_CHECKLIST.md) — detailed field expectations
- [`SOURCEDIRECT_API_REFERENCE.md`](./SOURCEDIRECT_API_REFERENCE.md) — API reference
