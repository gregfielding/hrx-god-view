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
| `EVERIFY_BASE_URL` | API base (default: `https://stage-everify.uscis.gov/api/v31`) |
| `EVERIFY_AUTH_URL` | OAuth token URL (default: `https://stage-everify.uscis.gov/oauth/accesstoken`) |
| `EVERIFY_WORKER_URL` | Cloud Task target URL (optional; else derived from project/region) |
| `EVERIFY_QUEUE` | Queue name (default: `everify`) |
| `EVERIFY_FAKE_PROVIDER` | `true` = use stub instead of real ICA API (preferred name) |
| `EVERIFY_EAAT_STUB` | Legacy; same as EVERIFY_FAKE_PROVIDER when true |
| `EVERIFY_EAAT_SCENARIO` / `EVERIFY_FAKE_SCENARIO` | Scenario: `employment_authorized`, `tnc`, `error` |

## Secrets

Set in Firebase / Secret Manager (ICA v31 username/password):

- `EVERIFY_WS_USERNAME` – Web Services username (e.g. `GFIE7857`)
- `EVERIFY_WS_PASSWORD` – Web Services password (reset in E-Verify Program Admin UI)

Legacy (deprecated): `EVERIFY_CLIENT_ID`, `EVERIFY_CLIENT_SECRET` (OAuth client-credentials).

### Phase 2 dry run (fixture)

Set `EVERIFY_STAGE_I9_FIXTURE_JSON` (Firebase config or Secret Manager) with a valid i9_case_flat JSON. Required fields:

- `first_name`, `last_name`, `date_of_birth`, `ssn`, `citizenship_status_code`
- `date_of_hire`, `case_creator_email_address`, `case_creator_name`, `case_creator_phone_number`

Example (redacted):

```json
{
  "first_name": "Test",
  "last_name": "User",
  "date_of_birth": "1990-01-15",
  "ssn": "123456789",
  "citizenship_status_code": "1",
  "date_of_hire": "2025-01-01",
  "case_creator_email_address": "admin@example.com",
  "case_creator_name": "Admin",
  "case_creator_phone_number": "5555555555"
}
```
