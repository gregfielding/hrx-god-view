# AccuSource / SourceDirect — production readiness

Vendor handoff notes, contacts, and **pre-production questionnaire** (AccuSource requires answers before production cutover).  
Technical API details: [`SOURCEDIRECT_API_REFERENCE.md`](./SOURCEDIRECT_API_REFERENCE.md).

**Controlled production validation (HRX-only orders, log prefixes, automation pause):**  
[`ACCUSOURCE_PRODUCTION_VALIDATION_RUNBOOK.md`](./ACCUSOURCE_PRODUCTION_VALIDATION_RUNBOOK.md) · [`ACCUSOURCE_PRODUCTION_VALIDATION_EXECUTION_CHECKLIST.md`](./ACCUSOURCE_PRODUCTION_VALIDATION_EXECUTION_CHECKLIST.md)

---

## Vendor contacts

| Role | Contact |
|------|---------|
| **IT / integration support** | techsupport@accusourcehr.com |
| **Production & client setup** | implementation@accusourcehr.com |

**Pre-production requirement:** AccuSource will run an **end-to-end walkthrough** after the build is complete — either a **recording** you provide or a **live session** they record.

---

## Links (from vendor)

| Resource | URL |
|----------|-----|
| **API documentation (V2)** | https://sdapi.accusourcedirect.com/documentation/external.html |
| **Sandbox web UI (client)** | https://sandbox.accusourcedirect.construction/ |

**Sandbox UI login:** Issued by AccuSource per integration. **Do not commit usernames or passwords to git.** Store in your team’s secret manager (1Password, etc.) and share only through secure channels.

---

## Postman sample collection

AccuSource provided a Postman collection (e.g. `C1 Staffing Sample.postman_collection.json`) for sandbox API calls.

**Security:** That file type often embeds **OAuth client ID, client secret, and cached bearer tokens**. Treat it as **confidential**:

- Keep a master copy in **secure storage** (not the public repo).
- Prefer **Postman environment variables** for `client_id` / `client_secret` and clear stale tokens before sharing.
- If the file was ever copied into chat or an insecure path, ask AccuSource whether **credentials should be rotated**.

See [`docs/postman/README.md`](./postman/README.md) for repo conventions.

---

## Pre-production questionnaire (draft answers for AccuSource)

*Status key: **Done** = implemented in this codebase today · **Partial** = started or behind feature flags · **Planned** = on roadmap / spec only*

### 1. Is this a self service application for clients?

**Answer (draft):** HRX is a **staffing platform** used by **internal recruiters and operations** (tenant-scoped). **Employer clients** do not directly self-serve AccuSource credentials inside SourceDirect’s UI; **ordering and visibility** are mediated through HRX **staff-facing** flows (e.g. onboarding / background checks), with configuration and secrets managed **server-side**. *Refine with product if customer-facing self-serve credential entry is added later.*

### 2. Are you leveraging all webhook notifications, or only some (e.g. profile status change, profile complete, final report ready)?

**Answer (draft):** **Partial.** The integration **ingests** webhook payloads generically, maps **event types** to internal status projections, and applies **deep updates** for **`service_status_change`** (per-service/component status, including nested payload merge). Other event names are still mapped where they match string patterns (e.g. final report ready, drug report, completed). **Not every** SourceDirect webhook type may be explicitly tested yet — align the subscribed list in SourceDirect admin with [`webhooks.ts`](../functions/src/integrations/accusource/webhooks.ts) and expand handlers as new event types are enabled.

### 3. What kinds of errors is your integration prepared to handle, and how are they surfaced to users?

**Answer (draft):** **API / ordering:** server-side errors from profile create or PDF/report fetch are logged; user-visible surfaces should show **actionable failure** (e.g. order not created) in staff UI where callables return errors. **Webhooks:** unmatched profile → event stored as **ignored** with reason; processing errors logged. **Workers:** see status and documents through **in-app** assignment/onboarding UX as those screens mature. *Tighten copy for AccuSource review per your actual UI error strings.*

### 4. How are new credentials configured? Client self-serve vs internal/support?

**Answer (draft):** **OAuth client ID/secret** and API base URL are configured as **environment / secrets** on the **HRX backend** (Cloud Functions / Secret Manager), not in the client bundle. **Per-tenant** SourceDirect client linkage is part of the **onboarding / integration** model — confirm whether tenants will enter credentials in an **admin UI** or only **implementation** sets them. *Update after product decision.*

### 5. How are status updates communicated to clients?

**Answer (draft):** **Internally:** Firestore-backed **background check** records and **event** subcollections updated from webhooks. **Staff:** recruiter/staff onboarding UI. **Workers:** notifications and employment records per product roadmap. *Clarify “clients” as employer vs staffing customer vs worker for AccuSource.*

### 6. How is the final report delivered to the client?

**Answer (draft):** **Partial.** Server callable can fetch **report PDF** (and related PDFs) using **server-side** AccuSource credentials and return to authorized staff UI; **portal vs embedded** depends on product — workers may use **in-app** views plus links where applicable.

### 7. Portal login link vs protected time-limited URL (no auth)?

**Answer (draft):** HRX **does not** embed long-lived public report URLs in the web app. **Authorized** PDF retrieval uses **server-side** calls with **Bearer** tokens; any **candidate-facing** link behavior should match **FCRA / access policy** and SourceDirect’s recommended pattern. *Confirm with legal/compliance for worker-facing delivery.*

### 8. Drug and occupational health services?

**Answer (draft):** **Planned / partial.** Data model and webhooks can represent **drug** components; full **occ health** scheduling UX may be phased. State roadmap explicitly.

### 9. MVR service?

**Answer (draft):** **Planned** as part of package/service catalog — confirm **packages** pulled live from SourceDirect include MVR where sold.

### 10. Verification services?

**Answer (draft):** **Planned** — same as catalog-driven packages; implementation follows **company details / packages** API.

### 11. Parent / child functionality?

**Answer (draft):** **Planned.** Product spec calls for **national vs child account** behavior and cascading requirements — confirm alignment with SourceDirect **client hierarchy** before marking “yes” in production.

### 12. Accounting code fields?

**Answer (draft):** **Yes (intent).** Reference [`SOURCEDIRECT_API_REFERENCE.md`](./SOURCEDIRECT_API_REFERENCE.md) accounting codes section and onboarding plan; ensure **primary / secondary / tertiary** are sent on profile create when tenant data is available.

### 13. Pre-adverse action process?

**Answer (draft):** **Planned** — benchmarked in [`BACKGROUND_SCREENING_INTEGRATION_BENCHMARKS.md`](./BACKGROUND_SCREENING_INTEGRATION_BENCHMARKS.md); not a substitute for **legal workflow** design. Say **not yet automated end-to-end** unless/until built.

### 14. DecisionSource (adjudication) offering?

**Answer (draft):** **TBD.** API exposes **decision sources** at company level; HRX usage **not fully wired** — answer **evaluate / roadmap** unless product commits.

### 15. Live package retrieval from API (updates reflected without manual sync)?

**Answer (draft):** **Yes (requirement).** Product intent is **live** package/service retrieval from SourceDirect so catalog changes do not require manual HRX updates — implementation should prefer **GET company/details** (or equivalent) over static mappings. *Cite current code path once package picker is live.*

---

## Checklist before sending answers to AccuSource

- [ ] Product/legal review of worker vs client wording (questions 5–7).
- [ ] Confirm webhook subscription list in SourceDirect matches handlers under test.
- [ ] Confirm no secrets or sandbox passwords were pasted into tickets (rotate if needed).
- [ ] Schedule E2E demo / recording per vendor process.

---

*Last updated from vendor email package (contacts, docs URL, sandbox UI, questionnaire).*
