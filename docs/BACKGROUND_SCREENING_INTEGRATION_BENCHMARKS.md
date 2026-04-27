# Background screening integration — benchmarks vs HRX plan

This note combines **SourceDirect API V2** ([external docs](https://sdapi.accusourcedirect.com/documentation/external.html)), common **ATS/HRIS integration patterns**, and a **gap check** against **`docs/ONBOARDING_CENTER_IMPLEMENTATION_PLAN.md`**.

---

## 1. What leading ATS / HR platforms emphasize

These themes show up repeatedly in vendor docs and integration guides (Workday-style “initiate + track,” Lever/Greenhouse partner flows, staffing ATS benchmarks). They are **product + compliance**, not only API plumbing.

| Theme | Why it matters |
|--------|----------------|
| **Single system of record for status** | Recruiters and compliance see the same stage (ordered → candidate action → in progress → complete / review) without re-keying. |
| **Bidirectional sync** | ATS updates when the CRA updates; candidate record stays authoritative for hiring decisions. |
| **Trigger discipline** | Checks often tie to **stage gates** (e.g. post-offer, post-assignment-confirm) to support **ban-the-box** and client policy—not “run on every application” by default. |
| **Consent & disclosure (FCRA / state)** | Written authorization and disclosures before ordering consumer reports; **employer** obligations are not fully delegated to the CRA or ATS. |
| **Adverse action workflow** | **Pre-adverse** → waiting period → **adverse** with documented reasons; audit trail of who did what and when. |
| **Audit trail** | Who **ordered**, who **viewed** reports, download history; supports litigation and client audits. |
| **Granular status** | Service- or component-level progress (criminal vs SSN vs drug), not only “file complete.” |
| **Document exchange** | Signed authorization, government IDs, forms—uploaded once and tied to the screening file. |
| **Drug / occupational health** | Scheduling (auto vs manual), clinic selection, **reason** (pre-employment vs DOT), chain-of-custody handoffs. |
| **Accounting / chargeback** | Codes rolled up to **client / cost center / location** for invoicing (matches SD accounting codes). |

**Integration archetypes** (vendor literature): **native marketplace** (low build, standardized audit) vs **custom API/webhook** (flexible, but **your** logging and compliance UX must be explicit). HRX is in the second bucket—quality depends on deliberate design.

---

## 2. SourceDirect API V2 — capabilities relevant to HRX

Summarized from the public OpenAPI-style documentation (OAuth **`client_credentials`**).

### Company

| Capability | Endpoint idea | Notes |
|------------|----------------|--------|
| **Accounting codes** | `GET .../company/accountingCodes` | Primary/secondary/tertiary; `isActive` filter. Must align with SD admin **“Number Of Allowed Accounting Codes”** (extra fields ignored if not configured). |
| **Live catalog** | `GET .../company/details` | **Packages**, **services**, **fees**, **per-service fields** (formats, options, `requiredFlag`). This is the real dropdown source—not static HRX labels alone. |
| **Decision sources (company)** | `GET .../company/decisionSources` | Values used when recording hiring decisions. |

### Profile (order / candidate file)

| Capability | Notes |
|------------|--------|
| **Create partial** | Applicant completes data in **MySource**; **`packageId`**; **`accountingCodes`** / **`accountingCode`** / **`accountingCodeId`**; **`clientId`** (originating platform reference). |
| **Create full** | Same file with subject + **`orders`**; service-specific arrays (**cred, edus, emps, pers, prof, dtdr**) when ordering those verification types. |
| **List / get profile** | Pagination; profile payload includes **`orders[]`** with **`statusId`**, **`serviceTypeAlias`**, costs, **`finalReportURL`** / **`drugResultURL`**, **`linkedProfileId`**. |
| **PDF reports** | `GET .../profile/{id}/report`, `.../drugReport`. |
| **Files** | **Upload** multipart (typed: MVR, authorization, drug ECOC, etc.); **list** and **download** files. |
| **Pre-adverse** | `POST .../profile/preAdverse` — **`profileId`**, **`email`**, **`reason`**. |
| **Decision on profile** | `GET .../profile/decisionSources`, `PATCH .../profile/{id}/decisionSources` — ties **decision source** to profile. |
| **Drug / clinical** | **`ecocEmail`** required when package includes drug/medical/clinical; **`drugScreenAutomaticScheduling`**, **`drugScreenApplicantScheduling`**, **`drugScreenReason`** (e.g. PRE), **`drugScreenTestingAuthority`** (DOT agencies); **`linkedProfileId`** to chain profiles. |

### Webhooks (inbound to HRX)

| Event | Use |
|-------|-----|
| **`profile_status_change`** | Pulse UI + notifications; includes **`status`**, **`status_id`**, **`client_id`**, package info. |
| **`profile_completed`** | Completion timestamp, **`decision_source`**. |
| **`final_report_ready`** | **`final_report_url`** (may need SSO/session). |
| **`drug_report_ready`** | Drug PDF / URL; can **precede** full profile completion. |
| **`service_status_change`** | **Component-level** completion (e.g. one county search)—finer than whole-profile status. |

**Operational:** return **200** quickly; process async (you already mirror into Firestore patterns).

---

## 3. Comparison with `ONBOARDING_CENTER_IMPLEMENTATION_PLAN.md`

### A) Already aligned or explicitly planned

| Practice | HRX plan |
|----------|-----------|
| OAuth + server-side calls | AccuSource client; no secrets in app. |
| Live **package/service** catalog | §3.3 `package_catalog` sync from **company/details**. |
| **Accounting codes** for reconciliation | §3.4.2 + national/child account inheritance. |
| **Webhooks** → `backgroundChecks` + events | §2.3, verification checklist doc. |
| **assignment `confirmed`** trigger + confirm modal | §3.4; per-assignment satisfaction + overrides §3.4.1. |
| **Worker** instructions, progress, notifications, Employment archive | §1, §3.6. |
| **PDF** retrieval / inline viewing | `SOURCEDIRECT_API_REFERENCE.md`. |
| **Partial vs full** profile modes | Mapper / `orderMode` in functions. |

### B) Gaps or under-specified (recommended follow-ups)

| Gap | Risk | Suggested direction |
|-----|------|----------------------|
| **FCRA / consent / disclosure UX** | Ordering without documented **authorization** and **disclosure** flow exposes employer clients. | Product: capture **consent artifacts** (timestamp, version, channel) on **`users`** or **`backgroundChecks`**; block auto-order until policy satisfied *or* explicit recruiter attestation. Legal owns copy. |
| **Pre-adverse & adverse action** | SD exposes **`/profile/preAdverse`**; plan does not define **recruiter workflow** (when to initiate, templates, timing). | Add phase: **Compliance actions** on screening detail: “Initiate pre-adverse” → stores **`reason`**, audit log; optional link to **decision source** update. |
| **DecisionSource** | SD: **get/set** decision source on profile; company-level list. | Map **HRX hiring outcome** (e.g. assignment/placement status) ↔ **`decisionSourceId`** where product requires it for client reporting. |
| **`service_status_change`** | Finer progress than profile-level only. | Extend webhook handler + worker “active screening” UI to show **component** progress when payload is present. |
| **Drug-specific fields** | **`ecocEmail`**, DOT **reason/authority**, scheduling flags—required or behavior changes per SD. | Resolver + **`createBackgroundCheck`** mapper must pass through **package-derived** requirements (not only `packageId`). |
| **File uploads** | Authorization / ID / state forms—**`uploadFiles`** with typed **contentType**. | Worker flow: “Upload signed authorization” → server proxies to SD with correct type; track **`fileId`** on `backgroundChecks`. |
| **Custom fields** | Packages can expose **`customFields`** with **`requiredFlag`**. | UI may need **dynamic form** from **company/details** for a package—not only static HRX forms. |
| **List profiles / reconciliation** | Backfill if webhook missed. | Scheduled **reconcile** job: `GET .../profile` with pagination vs Firestore. |
| **Report access audit** | Enterprise expectation: who opened PDF. | Log **view/download** events in HRX (user, time, `backgroundCheckId`). |
| **Ban-the-box / jurisdictional timing** | Not enforced by API. | Config: **earliest stage** to allow order (e.g. only post-offer or post-`confirmed`—you chose **confirmed** for v1). Document for multi-state clients. |

### C) “Bleeding edge” or advanced (optional roadmap)

| Topic | Notes |
|-------|--------|
| **Continuous / monitoring screening** | Subscription-style re-checks after hire; needs product policy + SD product support—not assumed in v1. |
| **Linked / chain profiles** | **`linkedProfileId`** for related orders (e.g. add-on screens)—useful for **multi-step** or **re-order** without duplicate subject friction. |
| **SSO into SD** | Report URLs may require login; **inline PDF** via API avoids; **SSO** with SD reduces friction if they support it for your clients. |
| **Score-only / tiered disclosure** | Some employers show **summary first**, full report after—policy + UX, partially supported by **service-level** statuses. |
| **Multi-CRA / vendor-of-record** | HRX is AccuSource-first; future: abstract **provider adapter** if second CRA is required. |
| **AI / risk signals on screening** | Use **only** if legally and contractually permitted; SD exposes things like **`profileRiskMatch`** in list payloads—treat as **sensitive** and policy-gated. |

---

## 4. Summary

- **Industry baseline:** consent, adverse action, auditability, granular status, and document handling are as important as “POST create profile.”
- **SourceDirect** already provides **pre-adverse**, **decision sources**, **service-level webhooks**, **file uploads**, and **drug/DOT** fields—**HRX should map these into phases**, not only the happy-path create + final PDF.
- **Our plan** is strong on **catalog**, **accounting**, **webhooks**, **assignment trigger**, **worker UX**, and **per-assignment** rules. The largest **intentional** follow-ups are **compliance workflow** (consent + pre-adverse + decision logging), **drug/custom-field** data completeness, **file upload**, and **audit/report access** logging.

---

## 5. Recommended implementation order (HRX ↔ gaps in §3B)

| Order | Deliverable | Closes |
|------|-------------|--------|
| **1** | Staff **Onboarding** page shell + **Background Checks** tab scaffold (`/staff-onboarding`) | **Done** — menu, route, tabs. |
| **2** | `backgroundChecks` **table + detail** + webhook hardening (`service_status_change`) | **Partial** — table + dialog + rules + index; webhooks / events timeline / PDFs next. |
| **3** | **Package catalog** sync from `GET .../company/details` + resolver on job order / posting | Real dropdowns. |
| **4** | **Assignment `confirmed`** → `planScreeningOrders` → confirm modal → create | Automation. |
| **5** | **Consent / disclosure** artifacts + gating before order | FCRA gap. |
| **6** | **Pre-adverse** + **DecisionSource** UX on screening detail | SD API parity + audit. |
| **7** | **File upload** proxy to SD + worker upload UX | Document exchange. |
| **8** | **Drug/DOT** field mapping (`ecocEmail`, reason, authority) from resolver | Order completeness. |
| **9** | **Report view audit log** | Enterprise audit trail. |
| **10** | Worker **dashboard** active screening module + notifications | Worker experience. |

Reorder as dependencies land (e.g. webhooks before table is fine).

---

*Last updated: 2026-03-24 — cross-ref: `ONBOARDING_CENTER_IMPLEMENTATION_PLAN.md`, `SOURCEDIRECT_API_REFERENCE.md`*
