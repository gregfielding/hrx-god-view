# E-Verify Integration

## Deploy without E-Verify (no creds yet)

E-Verify is **gated**: the integration (and its required secrets) is only loaded when `EVERIFY_ENABLED=true`. This lets you deploy the rest of your functions without being prompted for `EVERIFY_WS_USERNAME` / `EVERIFY_WS_PASSWORD`.

- **Default:** Do not set `EVERIFY_ENABLED`, or set `EVERIFY_ENABLED=false` in `.env` / `.env.<project>`. Deploys will succeed; E-Verify callables/triggers are stubbed and return a “disabled” message if called.
- **When you have creds:** Set `EVERIFY_ENABLED=true`, add the secrets (see below), then redeploy. E-Verify functions will use the real integration.

## Queue setup

Create the Cloud Tasks queue (required for trigger and retry):

```bash
gcloud tasks queues create everify \
  --project=YOUR_PROJECT \
  --location=us-central1
```

Or use `EVERIFY_QUEUE` env to specify a different queue name (default: `everify`).

## Config

| Env | Description |
|-----|-------------|
| `EVERIFY_ENV` | `stage` (default) or `prod` — must match the USCIS host you configure |
| `EVERIFY_BASE_URL` | API base (default: `https://stage-everify.uscis.gov/api/v31`). **Production:** set to the root from your [USCIS go-live letter](https://developer.uscis.gov/node/145) (not published publicly; confirm against your signed ICA). |
| `EVERIFY_AUTH_URL` | OAuth client-credentials URL used by legacy EAAT paths (default: stage). **Production:** use the token URL from your go-live letter if you use that flow. ICA username/password login uses `{EVERIFY_BASE_URL}/authentication/login`. |
| `EVERIFY_WORKER_URL` | Cloud Task target URL (optional; else derived from project/region) |
| `EVERIFY_QUEUE` | Queue name (default: `everify`) |
| `EVERIFY_FAKE_PROVIDER` | `true` = use stub instead of real ICA API (preferred name) |
| `EVERIFY_EAAT_STUB` | Legacy; same as EVERIFY_FAKE_PROVIDER when true |
| `EVERIFY_EAAT_SCENARIO` / `EVERIFY_FAKE_SCENARIO` | Scenario: `employment_authorized`, `tnc`, `error` |

## Secrets

Set in Firebase / Secret Manager (ICA v31 username/password):

- `EVERIFY_WS_USERNAME` – Web Services username (from E-Verify Program Admin)
- `EVERIFY_WS_PASSWORD` – Web Services password (reset in E-Verify Program Admin UI)

### Production go-live

1. Complete USCIS production access; you will receive **production Web Services credentials**, **API base URL**, and any **OAuth** endpoints by official email ([Go Live](https://developer.uscis.gov/node/145)).
2. Set `EVERIFY_ENV=prod`, `EVERIFY_BASE_URL` (and other URLs your ICA specifies) on the deployed function — **do not** leave `stage-everify` in the URL when `EVERIFY_ENV=prod` (deploy will fail fast).
3. Set `EVERIFY_I9_FIXTURE_JSON` to a **single-line** `i9_case_flat` for the employee you are verifying (name, DOB, SSN `###-##-####`, citizenship code, etc.). Today this is still **env-driven**, not per-user from Firestore; one wrong fixture creates cases against the wrong identity.
4. Deploy with `EVERIFY_ENABLED=true` and secrets `EVERIFY_WS_USERNAME` / `EVERIFY_WS_PASSWORD` from **production** Program Administrator.

### Phase 2 dry run (fixture)

Set `EVERIFY_I9_FIXTURE_JSON` (preferred) or `EVERIFY_STAGE_I9_FIXTURE_JSON` (legacy alias) in root `.env` → `functions/.env` via `copy-env`, or GCP env — valid **single-line** `i9_case_flat` JSON. Required fields:

- `first_name`, `last_name`, `date_of_birth`, `ssn` (**must be `###-##-####`**, not 9 digits; stage rejects `123-45-6789` and `111-11-1111`), `citizenship_status_code` (REST enum: `US_CITIZEN`, `NONCITIZEN`, `LAWFUL_PERMANENT_RESIDENT`, `ALIEN_AUTHORIZED_TO_WORK`, `NONCITIZEN_AUTHORIZED_TO_WORK`; legacy `"1"`–`"5"` is normalized server-side)
- `date_of_hire`, `case_creator_email_address`, `case_creator_name`, `case_creator_phone_number`

Example (redacted):

```json
{
  "first_name": "Test",
  "last_name": "User",
  "date_of_birth": "1990-01-15",
  "ssn": "890-12-3456",
  "citizenship_status_code": "US_CITIZEN",
  "date_of_hire": "2025-01-01",
  "case_creator_email_address": "admin@example.com",
  "case_creator_name": "Admin",
  "case_creator_phone_number": "5555555555"
}
```

## SOAP ICA path (`everifySoapCreateCase`)

The main product flow still uses **REST** (`everifyCreateCase`, poller). For **SOAP**, call **`everifySoapCreateCase`** with `tenantId` + `employeeData` (see `everifyTypes.ts`). WSDL is not public without credentials; **defaults are placeholders** — align element names, namespaces, and SOAPAction values with your **signed Interface Control Agreement**.

**Server-side entry point:** `createEverifyCase` in `everifyCases.ts` (auth SOAP → create case SOAP → write `tenants/{tenantId}/everify_cases/{caseId}` with redacted XML + Cloud Logging).

### Stage checklist

1. Set `EVERIFY_ENABLED=true` for the Functions build/deploy so E-Verify exports are not stubbed.
2. Store **Web Services** credentials only in Secret Manager: `EVERIFY_WS_USERNAME`, `EVERIFY_WS_PASSWORD` (never commit; rotate if exposed).
3. Default API base is `https://stage-everify.uscis.gov/api/v31`. SOAP POST URL defaults to `{EVERIFY_BASE_URL}/soap` unless you set `EVERIFY_SOAP_URL` from your ICA.
4. If auth/create fail with parse errors, copy exact envelope XML from your ICA into `EVERIFY_SOAP_LOGIN_ENVELOPE_TEMPLATE` and `EVERIFY_SOAP_CREATE_CASE_ENVELOPE_TEMPLATE`.

### Example callable payload (test)

```json
{
  "tenantId": "YOUR_TENANT_ID",
  "employeeData": {
    "firstName": "Test",
    "lastName": "User",
    "ssn": "890-12-3456",
    "dateOfBirth": "1990-01-01",
    "citizenshipStatus": "US_CITIZEN"
  }
}
```

Returns: `caseNumber`, `caseStatus`, `rawResponse` (`requestXml` / `responseXml`, redacted), `firestoreCaseId`.

| Env | Description |
|-----|-------------|
| `EVERIFY_SOAP_URL` | Full SOAP endpoint URL (optional; overrides base + path) |
| `EVERIFY_SOAP_PATH` | Path under `EVERIFY_BASE_URL` (default `/soap`) |
| `EVERIFY_SOAP_SERVICE_NS` | Namespace for `ev:` elements in default templates |
| `EVERIFY_SOAP_LOGIN_SOAPACTION` | SOAPAction for login |
| `EVERIFY_SOAP_CREATE_CASE_SOAPACTION` | SOAPAction for create case |
| `EVERIFY_SOAP_VERSION` | `1.1` (default) or `1.2` |
| `EVERIFY_SOAP_LOGIN_ENVELOPE_TEMPLATE` | Full XML; placeholders `{{username}}`, `{{password}}`, `{{ns}}` |
| `EVERIFY_SOAP_CREATE_CASE_ENVELOPE_TEMPLATE` | Full XML; placeholders include `{{sessionToken}}`, `{{firstName}}`, `{{lastName}}`, `{{ssn}}`, `{{dateOfBirth}}`, `{{citizenshipStatusCode}}`, `{{ns}}` |
