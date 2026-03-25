# SourceDirect API — integration reference

Living reference for **AccuSource SourceDirect** (background screening) API work in this repo.  
Source material: **SourceDirect API Integration Guide** (partner PDF) plus **SourceDirect API V2** public documentation.

**Related in-repo docs**

- [`ACCUSOURCE_FIRESTORE_VERIFICATION_CHECKLIST.md`](./ACCUSOURCE_FIRESTORE_VERIFICATION_CHECKLIST.md) — Firestore paths, callable/webhook tests, expected fields for our AccuSource flows.

---

## Official documentation

- **SourceDirect API V2 (external overview):**  
  `https://sdapi.accusourcedirect.com/documentation/external.html`  
  Use this for exact request/response shapes, webhook payload schemas, and endpoint names as implementation proceeds.

When the PDF and the live docs disagree, **treat the live V2 docs as canonical** and update this file.

---

## Environments

| Environment | Base URL | Use |
|-------------|----------|-----|
| **Sandbox** | `https://sdapi-sandbox.accusourcedirect.construction/` | Initial integration, regression, and **ongoing** non-production testing (new SD releases land here first). |
| **Production** | `https://sdapi.accusourcedirect.com/` | Live customers only. |

**Requirement (from integration guide):** any non-production HRX environment must call **sandbox**, not production, to avoid breakage when SD ships changes.

---

## Authentication

- **Protocol:** OAuth 2.0 (partner receives **Client ID** and **Client Secret** per environment).
- **API calls:** HTTP **`Authorization: Bearer <token>`**.
- **Token lifetime:** **~30 minutes** — integrations must cache/refresh; do not assume a single long-lived token.
- **Tenancy:** Credentials are scoped at the **SourceDirect client** level. The guide recommends **one Client ID / Secret per downstream customer** where applicable, and a **settings UI** so each customer can configure their own credentials.
- **Secrets:** Store only in server-side or managed secrets (e.g. Cloud Functions config / Secret Manager); never embed in the web app bundle.

*Exact token endpoint and grant type live in SourceDirect API V2 docs — record them here once we wire the first call.*

---

## Mandatory integration requirements (checklist)

1. **Sandbox for non-prod** — Always; see [Environments](#environments).
2. **Package information** — Surface **live** package/service data from SD when the user places an order (see [Packages](#packages)).
3. **Accounting codes** — System must support **three levels**: **primary**, **secondary**, and **tertiary**, and send the correct codes on profile create (see [Accounting codes](#accounting-codes)).
4. **Testing** — Full end-to-end testing on **sandbox** plus a **final demo** with SD before production cutover.

---

## Packages

- Background offerings are bundled as **packages** in SourceDirect.
- **UX:** The list of orderable packages must be shown when the user starts a background check order from HRX.
- **Data:** **Prefer live retrieval** from SD (“Get packages and services” in API V2). If packages are cached locally, **IDs and names must stay in sync** with SD (coordinate with SD implementation); stale mappings cause **order errors**.

---

## Accounting codes

- Used for **org structure** (departments, divisions, locations, regions, etc.), **access**, and **billing/invoicing** in SD.
- SD models **three hierarchical levels**: **primary → secondary → tertiary**.
- **Requirement:** HRX must collect or derive the correct codes and send them on **profile creation** (“Get accounting codes” in API V2).

**HRX product intent:** use the **full** three-level model wherever SD supports it — not only for access control but for **internal accounting and reconciliation** (invoicing, cost centers, client rollups). Store codes at **account** level with **inheritance** to orders; allow **per-order override** when needed. See **`docs/ONBOARDING_CENTER_IMPLEMENTATION_PLAN.md`** §3.4.2.

---

## Profiles (orders / candidates)

In SourceDirect, **candidates / applicants / employees** are **Profiles**. Ordering a check is **creating a profile** (and related order semantics in V2).

| Mode | When to use | Behavior (summary) |
|------|-------------|---------------------|
| **Full profile** | HRX already has required data + authorization | Check can proceed immediately. |
| **Partial profile** | Missing required data | Applicant is invited to **MySource** to supply data; check starts after completion. |
| **Extended partial profile** | Some but not all data | Applicant reviews/corrects prefilled data and supplies gaps in **MySource**. **Recommended** when not using full profile — reduces duplicate entry. |

**PDF note:** Prefer **extended partial** over bare partial when you are not submitting a **full** profile.

Exact endpoint names: **“Create a new profile (full)”**, **“Create a new profile (Partial)”** in V2 (confirm extended partial endpoint naming in docs).

---

## Applicant communication (recommendations)

When placing an order:

1. Send **email** and **mobile phone** for the applicant when available.
2. If HRX stores a **preferred communication method**, pass it through per API contract.
3. If not, default to **both email and text** so the invitation uses both channels (wording per SD field requirements in V2).

---

## Webhooks (status → completion → reports)

SD pushes asynchronous updates to **HTTPS endpoints** we expose (typically secured and verified per V2). The integration guide references these **SourceDirect API V2** webhook topics:

| Webhook (V2) | Role |
|----------------|------|
| **`profile_status_change`** | Ongoing profile status updates (`profile_id`, `status`, `status_id`, `client_id`, package info). |
| **`profile_completed`** | Screening workflow completed (`completed_date`, `decision_source`, etc.). |
| **`final_report_ready`** | Final **background** report available (`final_report_url`, …). |
| **`drug_report_ready`** | **Drug** report available (may fire **before** full profile completion). |
| **`service_status_change`** | **Component-level:** when all orders for a **service** complete (`service_name`, `service_id`, per-service status). |

**Implementation:** One backend endpoint can fan in multiple event types, or split endpoints per event — match our security and idempotency patterns. Handle **`service_status_change`** for granular UI (e.g. per search type), not only profile-level status.

---

## Reports: display, import, or inline

After webhooks fire, three patterns:

### a. Display a link

- Payload includes URLs such as **`final_report_url`** / **`drug_report_url`** (exact field names in V2).
- Simplest UX: show links in HRX.
- **Caveat:** Opening the link may require **login to SourceDirect** unless **SSO** is configured with SD.

### b. Import and store (server-side)

- Call the V2 endpoints to **retrieve the profile final report PDF** and **retrieve the profile drug report PDF**.
- Store blobs or files in our storage layer; serve from HRX without sending users to SD.

### c. View in-app without SD login (PDF API)

- Same PDF retrieval APIs as (b).
- Use **`Content-Disposition: inline`** (or equivalent) so the browser displays PDF in-app, or stream bytes through our backend after auth.
- Matches the **“fetch with Bearer token → blob → open/download”** pattern from the integration guide.

### Example: browser fetch + blob (from integration guide)

Use the **PDF report URL** from V2 and a valid **Bearer token** (not for committing secrets to the client — this pattern belongs behind auth, or in a trusted shell only):

```javascript
const url = ''; // PDF report endpoint from API V2
const token = ''; // Bearer token (server-issued or server-proxied)

const fetchPdf = async () => {
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const blob = await response.blob();
  const blobUrl = URL.createObjectURL(blob);
  window.open(blobUrl);
};

fetchPdf();
```

Prefer **server-side proxy** for production so the token is not exposed to end-user browsers.

---

## Typical integration project schedule (SD guide)

| Phase | Duration (indicative) |
|-------|------------------------|
| Initial research | ~1 week |
| High-level design | ~1 week |
| Implementation | ~2–3 weeks |
| Testing | ~1–2 weeks |

---

## Support

- **Technical support:** `TechSupport@accusourcehr.com`

---

## HRX implementation notes (maintenance)

Use this subsection to track **our** wiring as code lands (avoid duplicating long procedural docs elsewhere).

| Topic | Status / pointer |
|-------|------------------|
| Cloud Functions (create, webhooks) | See `ACCUSOURCE_FIRESTORE_VERIFICATION_CHECKLIST.md` — e.g. `createAccusourceBackgroundCheck`, `apiIntegrationsAccusourceWebhooks`. **`service_status_change`** merges into `providerServiceOrderStatus` + `lastServiceComponent` on `backgroundChecks`. |
| PDF proxy (callable) | **`getAccusourceBackgroundCheckPdf`** — server fetches `GET .../profile/{id}/report` or `.../drugReport` with API key; returns **`pdfBase64`** to the staff UI (no key in browser). |
| Staff UI | **`/staff-onboarding`** → Background Checks tab: table, service chips, events list, PDF buttons. |
| Firestore model | `backgroundChecks/{id}`, events subcollection, `integrations_accusource_webhook_events` intake. |
| Order mode | e.g. `orderMode: "partial_profile"` — confirm when adding full / extended partial. |
| Env flags | `ACCUSOURCE_ENABLED`, base URL, keys — document in Functions env, not here. |

**Update this table** when endpoints, payloads, or env var names stabilize.

---

## Document history

| Date | Change |
|------|--------|
| 2026-03-24 | Initial reference from SourceDirect API Integration Guide (PDF) + screenshots; linked to existing Firestore verification checklist. |

Add a row for each substantive API or UX decision (webhook verification, token storage, package UX, accounting code UI).
