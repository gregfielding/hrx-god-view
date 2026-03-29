# AccuSource — controlled production validation runbook

Use this when **sandbox catalog data is unusable** and you need to validate against **SourceDirect production** with minimal blast radius. Assumes **no UI redesign** — the **Backgrounds** tab on a user profile remains the manual order surface.

**Step-by-step execution checklist (env, sync, HRX order, Firestore, webhooks, go/no-go):**  
[`ACCUSOURCE_PRODUCTION_VALIDATION_EXECUTION_CHECKLIST.md`](./ACCUSOURCE_PRODUCTION_VALIDATION_EXECUTION_CHECKLIST.md)

---

## 1. Production environment readiness (Functions)

Set **production** credentials and hosts on the **Firebase Functions** runtime (params / `.env` / Secret Manager — same pattern as today).

| Variable | Production expectation |
|----------|-------------------------|
| `ACCUSOURCE_ENVIRONMENT` | `production` (or `prod`) |
| `ACCUSOURCE_BASE_URL` | Omit to default to `https://sdapi.accusourcedirect.com`, or set explicitly if AccuSource gives a different gateway |
| `SOURCEDIRECT_CLIENT_ID` / `SOURCEDIRECT_CLIENT_SECRET` | **Production** OAuth pair from AccuSource |
| `SOURCEDIRECT_TOKEN_URL` | Usually omit — defaults to `https://sdapi.accusourcedirect.com/oauth/access_token` |
| `ACCUSOURCE_WEBHOOK_SECRET` or `SOURCEDIRECT_WEBHOOK_SECRET` | Matches the secret configured in SourceDirect **production** webhook UI |
| `ACCUSOURCE_ENABLED` | `true` |

**Sanity check:** After deploy, Cloud Logs filter: `jsonPayload.accusourceEnvironment="production"` and tag `[AccuSource][production]` — all AccuSource logs include the environment in the **message prefix** and structured field `accusourceEnvironment`.

---

## 2. Production catalog sync verification

1. Sign in as a user who passes **`ensureAccusourceAdmin`** (tenant admin / manager / `super_admin` role or security level ≥ 5 for the active tenant).
2. Open **Backgrounds** → **Order screening (AccuSource)** → **Refresh packages**.
3. Confirm:
   - Callable returns success and **`providerEnvironment: "production"`** in the response (and Firestore `integrations_accusource/catalog.providerEnvironment` is `production`).
   - **`packageCount` > 0** for the production company (if zero, fix AccuSource company setup or response shape — not an HRX-only issue).
4. In logs, look for:  
   `[AccuSource][production][catalog] Package catalog sync completed`  
   with structured counts.

---

## 3. One controlled manual production order (HRX only)

During validation, **only Firebase users with custom claim `hrx: true`** can submit orders in production.

1. Ensure **`ACCUSOURCE_PRODUCTION_VALIDATION_HRX_ONLY`** is **`true`** (default).  
   - This blocks **tenant** admins/managers from submitting **production** orders.  
   - It also **blocks assignment-based automation** from creating production orders (fail-fast with a clear error on the automation run doc).
2. Sign in as an **HRX** staff user (`hrx: true` in claims — same as rest of the app).
3. From **Backgrounds** on a real candidate profile, select a **production** package and **Submit order**.
4. Verify Firestore `backgroundChecks/{id}`:
   - `providerEnvironment: "production"`
   - `hrxStatus` / `providerProfileId` / events per `ACCUSOURCE_FIRESTORE_VERIFICATION_CHECKLIST.md`.

Logs:  
`[AccuSource][production][policy] Production order allowed (HRX caller, validation mode).`  
`[AccuSource][production][create] createPartialProfile succeeded`

---

## 4. Webhook and status verification

1. In SourceDirect **production**, confirm the webhook URL points at your deployed **`apiIntegrationsAccusourceWebhooks`** endpoint and the secret matches Functions env.
2. Trigger a webhook from SourceDirect (or wait for a natural event after the test order).
3. Confirm:
   - `integrations_accusource_webhook_events/{eventId}` intake rows
   - `backgroundChecks/{id}` updates (`lastWebhookAt`, `lastWebhookType`, `hrxStatus`, etc.)
   - Subcollection `backgroundChecks/{id}/events/{eventId}`

Logs use:  
`[AccuSource][production][webhook] ...`  
with `accusourceEnvironment: "production"` in structured payload.

---

## 5. After validation — open production to tenant admins (optional)

When you are satisfied:

1. Set **`ACCUSOURCE_PRODUCTION_VALIDATION_HRX_ONLY=false`** on Functions (and redeploy if using params).
2. **Tenant** admins (existing `ensureAccusourceAdmin` rules) can submit orders; assignment **automation** can create production orders again.

---

## 6. Log discovery (GCP)

Recommended filters:

- Text: `AccuSource` and `production`
- JSON: `jsonPayload.accusourceEnvironment="production"`

Tags in the message:

| Tag | Area |
|-----|------|
| `catalog` | `syncAccusourcePackageCatalog` |
| `create` | `createAccusourceBackgroundCheck` / partial profile |
| `http` | Outbound REST client |
| `oauth` | Token fetch |
| `webhook` | Inbound HTTP webhook |
| `pdf` | PDF callable |
| `policy` | Production validation guard (HRX-only / automation block) |

---

## Related docs

- [`SOURCEDIRECT_API_REFERENCE.md`](./SOURCEDIRECT_API_REFERENCE.md)
- [`ACCUSOURCE_FIRESTORE_VERIFICATION_CHECKLIST.md`](./ACCUSOURCE_FIRESTORE_VERIFICATION_CHECKLIST.md)
- [`ACCUSOURCE_PRODUCTION_READINESS.md`](./ACCUSOURCE_PRODUCTION_READINESS.md)
