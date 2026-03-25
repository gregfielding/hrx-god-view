# Onboarding center — implementation plan

Strategy for the new **main-nav “Onboarding”** area (security levels **5–7**), three tabs (**Tax & Payroll**, **E-Verify**, **Background Checks**), cascading **screening requirements**, and **automation** so we can flip on SourceDirect credentials without a large follow-on build.

This doc is the working blueprint; update it as decisions land.

**See also:** [`BACKGROUND_SCREENING_INTEGRATION_BENCHMARKS.md`](./BACKGROUND_SCREENING_INTEGRATION_BENCHMARKS.md) — SourceDirect API V2 vs industry ATS patterns, gap analysis, and advanced options.

---

## 1. Goals (from product brief)

1. **Single hub** for internal team onboarding/compliance operations, separate from worker-facing `/onboarding/profile` flows.
2. **Background Checks tab**: tenant-wide **table** of screenings (ordered checks), sortable/filterable columns (dates, types, statuses), **row → detail** with full screening record.
3. **Configurable requirements**: defaults at **account** (and hierarchy), overrides at **location**, **job order**, and **jobs board / posting** level; **user record** can show requirements and **manual order**.
4. **Automation**: when an assignment becomes **`confirmed`** (only trigger for now), **resolve** required packages and **create orders** after an **explicit confirm** step (see §3.4).
5. **Visibility**: results on **user profile**, quick reference from **application** / **assignment** contexts.
6. **API key readiness**: data model, UI, Cloud Functions, and webhooks wired so **turning on** AccuSource is mostly **configuration + testing**, not new features.
7. **Worker notifications**: workers receive **notifications** when checks/screenings are ordered and when **tasks** are required (complete portal, lab visit, document upload, etc.), aligned with existing **in-app / push** patterns where possible.
8. **Worker home (dashboard)**: at the **top** of the worker experience (below critical global banners such as SMS consent if present), a dedicated **“active screenings”** area shows **everything we know** to complete the next step: **instructions**, **site/lab name**, **appointment** time, **QR code** image/URL, **address** with **map** link, **MySource** / portal links, etc.—whatever the provider or HRX stores for that order type.
9. **Status & results on home**: a clear **progress model** (e.g. ordered → submitted → in progress → result available) so workers see **submitted** and then **incremental results** as webhooks update state; avoid dead-end copy.
10. **After completion**: **summary / result details** move to a **durable** place in the worker’s **Employment** area (`/c1/workers/my-employment` and profile **Employment** tab for admin view)—not only on the transient home card.

---

## 2. Current codebase inventory (relevant)

### 2.1 Navigation & access

- Sidebar items are built in **`src/utils/menuGenerator.ts`**. Internal tools for levels **5–7** are gated with patterns like **`accessRoles: ['tenant_5', 'tenant_6', 'tenant_7']`** (e.g. Finances & Budgeting) or inserted in the block that includes **Accounts → … → Users** (same section as **`text: 'Users'`**, **`to: '/users'`**).
- **`src/components/Layout.tsx`** already includes an icon mapping entry **`'Onboarding': <AssignmentTurnedInIcon />`** — the **menu label is not wired yet** in `menuGenerator.ts` (only the icon slot exists). Pick a **distinct** icon if “Onboarding” should not reuse the same glyph as **My Assignments** (also `AssignmentTurnedInIcon`).

### 2.2 Routing

- **`src/App.tsx`**: recruiter shell uses **`ProtectedRoute requiredSecurityLevel="5"`** + **`RecruiterAccessGuard`** for account/finance areas. New routes should follow the same pattern.
- **Avoid path collision**: **`/jobs/onboarding`** currently **redirects** to job orders (legacy stub). Worker flows use **`/onboarding/profile`** etc. **Recommendation:** use a dedicated path such as **`/staff-onboarding`** or **`/onboarding-center`** (not bare `/onboarding`) for the admin hub.

### 2.3 Background checks (AccuSource) — backend

- **Collection:** top-level **`backgroundChecks/{id}`** (not tenant-prefixed in current implementation) with **`events`** subcollection.
- **Callable:** `createBackgroundCheck` in **`functions/src/integrations/accusource/createBackgroundCheck.ts`** — builds draft, `orderMode: 'partial_profile'`, links **`tenantId`**, **`accountId`**, **`candidateId`**, **`jobOrderId`**, **`worksiteId`**, package fields, etc.
- **Webhooks:** **`functions/src/integrations/accusource/webhooks.ts`** — updates checks and uses collection group queries; see **`docs/ACCUSOURCE_FIRESTORE_VERIFICATION_CHECKLIST.md`**.
- **Types:** **`functions/src/integrations/accusource/types.ts`** — `HrxBackgroundCheckStatus`, `BackgroundCheckDocument`.

### 2.4 UI / profile today

- **`users/{uid}`** embeds summary arrays used in credentials UI: **`backgroundCheckOrders`**, **`drugScreeningOrders`**, **`additionalScreeningOrders`**, **`eVerifyOrders`** (see **`src/hooks/useWorkerCredentials.ts`**).
- **Job order / jobs board:** **`backgroundCheckPackages`** and compliance scoping live on **`JobOrderForm`**, **`GigJobsBoardToggle`**, etc. Static options come from **`src/data/screeningsOptions.ts`** (HRX labels/values, **not** SourceDirect package IDs).

### 2.5 Related systems (tabs 1 & 2)

- **Tax & payroll:** Phase 2 doc **`docs/PHASE2_SYSTEMS_ARCHITECTURE.md`** — payroll onboarding visibility vs provider-of-record; Firestore paths like **`worker_payroll_accounts`**, Everee under **`src/data/firestorePaths.ts`**.
- **E-Verify:** **`everify_cases`** / **`everify_cases_public`** paths; **`EverifyAdminOpsPage`** under tenant settings; profile cards like **`EverifyComplianceCard.tsx`**.

### 2.6 Assignment trigger (decided)

- Assignments use **lowercase** statuses in **`src/types/phase2.ts`**. **Automation (v1):** run only when status becomes **`confirmed`** — **not** on `active` or other transitions until product expands the rule.

### 2.7 Worker home & employment surfaces

- **Worker home** is **`src/pages/c1/workers/dashboard.tsx`** (`/c1/workers/dashboard`): vertical stack currently starts with **`SmsWarningBanner`**, welcome copy, **`ReadinessSummaryCard`**, **`NextStepsChecklist`**, onboarding pipeline tasks, jobs, applications snapshot, etc. The new **screening instructions + progress** block should sit **high in this stack** (immediately after SMS banner / welcome, or directly under welcome—product call) so it is the first actionable work item when a check is pending.
- **Worker Employment (C1):** **`/c1/workers/my-employment`** and **`/c1/workers/my-employment/:employmentId`** — **`src/pages/c1/workers/myEmployment.tsx`**, **`myEmploymentDetail.tsx`** — natural home for **completed** screening summaries per employment relationship.
- **Admin profile Employment:** **`src/pages/UserProfile/components/EmploymentTab.tsx`** — entity employments; completed check **records** can surface here (or linked subsections) for recruiters viewing the worker.
- **Notifications:** reuse patterns from **`docs/MESSAGING_NOTIFICATIONS_INVENTORY.md`** / FCM / worker inbox as applicable; new **notification types** for `screening_ordered`, `screening_action_required`, `screening_result_ready` (exact names TBD).

---

## 3. Proposed architecture

### 3.1 System of record vs summaries

| Concern | Proposal |
|--------|----------|
| **Authoritative screening order (AccuSource)** | Keep **`backgroundChecks`** as the **source of truth** for provider IDs, webhooks, reports, `hrxStatus`. |
| **Fast profile / credentials tab** | **Denormalize** a slim summary onto **`users/{uid}`** (existing arrays) **or** query **`backgroundChecks`** by `candidateId` + indexes — pick one strategy and stick to it to avoid drift. |
| **“Required packages” for an engagement** | **New tenant-scoped config** + **resolver** (see below), not only free-text arrays on job orders. |

**Recommendation:** treat **`backgroundChecks`** as canonical; **mirror** to user doc fields **via Cloud Functions** on create/update webhook (idempotent), so existing profile components keep working while the new hub reads full detail from `backgroundChecks`.

### 3.2 Cascading “required screenings” model

Represent requirements as **structured records** (package/service IDs + optional accounting code placeholders per SourceDirect) rather than only string labels from `screeningsOptions.ts`.

**Layers (merge order — last wins):**

1. **Tenant default** (optional): `tenants/{tid}/settings` or dedicated doc.
2. **Account** (`tenants/{tid}/accounts/{accountId}`): default packages for that customer — including **national vs child** account relationship (inherit from parent national account, then allow child overrides where modeled in CRM/recruiter accounts).
3. **Location override**: pattern already exists — **`recruiterAccountLocationDefaults`** in **`firestorePaths.ts`** (`locationKey` = company + location). Extend or add sibling doc for **screening defaults**.
4. **Job order**: existing **`scoping.compliance`** / **`backgroundCheckPackages`** — migrate toward **IDs** that match catalog + resolver output.
5. **Jobs board post**: posting keeps its own **background check** dropdown in UI; **if the posting is linked to a job order**, resolver **should pull** screening requirements from that **job order** (so posting stays in sync with the order of record). If there is **no** linked job order, use **posting-level** selections only.

**Resolver (callable or shared module):**  
`resolveOnboardingRequirements({ tenantId, accountId, nationalAccountId?, childAccountId?, locationKey?, jobOrderId?, postId? })` → `{ backgroundPackageRefs: [...], drug: [...], ... }` with traceability (“source: account”, “source: location”, “source: job_order”, “source: posting”, etc.).

### 3.3 Package catalog (dropdown “real data” before API key)

- **Long term:** sync **live packages** from SourceDirect (“Get packages and services”) per tenant/credentials — cache in e.g. **`tenants/{tid}/integrations/accusource/package_catalog`** with `syncedAt`.
- **Short term:** seed **placeholder** dropdowns that read from **Firestore catalog docs** (or static merge) so swapping to API-backed lists is a **sync job**, not a UI rewrite.
- **Important:** HRX **`screeningsOptions.ts`** is **not** a substitute for SD package IDs at order time; keep it for labels/help text until catalog mapping exists.

### 3.4 Automation: assignment `confirmed` → confirm modal → order (with deduplication)

**Decided behavior (v1):**

1. **Trigger only** when **`assignments.status`** transitions to **`confirmed`** (see §2.6).
2. **Server-side preflight** (callable or trigger-internal): `planScreeningOrdersForAssignment(assignmentId)` returns:
   - **`resolvedRequirements`**: packages/services after full resolver (account national/child, location, job order, posting).
   - **`alreadySatisfied`**: requirements **not** needing a new order (see §3.4.1).
   - **`toOrder`**: `resolvedRequirements − alreadySatisfied` (this is what the UI may charge).
3. **UX:** **Always** show a **Confirm** modal for the recruiter/internal user listing **only** `toOrder` (counts, package names, candidate). If `toOrder` is **empty** (“all required screenings already satisfied”), **skip** the modal and log/notify **optional** (“No new orders needed”).
4. **After confirm:** run **automated** `createBackgroundCheck` (or batch) **only** for `toOrder` items; write **audit** event on assignment.

**Idempotency (duplicate order prevention):** use stable keys scoped to **this assignment**, e.g. `tenantId + candidateId + sourceAssignmentId + packageId` (exact composite TBD). **Never** insert a second doc with the same key if one exists in a **non-terminal** state without explicit **manual override**.

### 3.4.1 “Already satisfied” — **per assignment**, completion-only, manual override

**Decided policy:**

1. **No cross-assignment reuse (default):** A screening that **completed** on a **prior** assignment **does not** satisfy requirements on a **new** assignment. Each new **`confirmed`** placement is evaluated **fresh** for ordering unless a human uses **manual override** (below). There is **no** automatic “12‑month reuse” or tenant-wide carryover.

2. **Satisfaction only when the check is completed:** `alreadySatisfied` applies **only** if there is a **`backgroundChecks`** row for **this `assignmentId`** (or explicit link field) with **matching package/service** and `hrxStatus` in the **terminal completed** set (e.g. `report_ready`, `completed` — exact set defined in code). **Not** satisfied by “in progress” or “passed attestation only.”

3. **Same assignment — in-flight:** If a check exists for **this assignment** with **non-terminal** status, treat as **pending** — **do not** create a duplicate; show **existing order** in confirm flow.

4. **Manual override (required):** Support admin actions such as **“waive / skip order for this requirement”** or **“force new order despite completed check”** (edge cases, corrections, client instruction). Overrides are **audited** (who, when, reason). Automation respects overrides on the assignment or requirement record.

| Approach | Use |
|----------|-----|
| **Canonical source** | **`backgroundChecks`** keyed by **`sourceAssignmentId`** (or equivalent) + `candidateId` + `tenantId` + package id. |
| **Cross-assignment** | **Never** auto-reuse completed checks across assignments (see (1)). |
| **User doc mirrors** | **`backgroundCheckOrders`** on `users/{uid}` can speed UI but **must not** be the only source — **reconcile** to `backgroundChecks`. |

**API shape:** `planScreeningOrdersForAssignment` should return human-readable reasons: e.g. `{ packageId, status: 'satisfied' | 'pending' | 'needed' | 'waived', reason: '…' }`.

### 3.4.2 SourceDirect accounting codes (billing & reconciliation)

**Decision:** use the **full** SourceDirect accounting model — **primary, secondary, and tertiary** codes — wherever SD expects them, so HRX can support **accurate accounting and reconciliation** (invoicing, cost centers, client rollups). Store codes at **account** (national/child as appropriate) with **inheritance** to orders; **override** per order when needed. Pass through on **`createBackgroundCheck`** / profile create per SD API. See also **`docs/SOURCEDIRECT_API_REFERENCE.md`** (Accounting codes).

### 3.5 Surfacing on application / assignment

- Store **`backgroundCheckIds[]`** or **latest `backgroundCheckId`** on **application** and/or **assignment** docs when an order is created (or link by query: `candidateId` + `jobOrderId`).
- UI: compact **status chips** linking to **`/staff-onboarding/background-checks/:id`** or user profile credentials section.

### 3.6 Worker experience: notifications, home instructions, progress, employment archive

**Principle:** workers should never wonder **what to do next** for an open screening. Staff tools remain on **`backgroundChecks`**; workers see a **redacted, task-oriented** projection.

#### A. Notifications

- **Triggers (examples):** order placed → “New screening required”; provider needs applicant action → “Complete your background portal”; lab scheduled → “Appointment tomorrow”; result ready → “Your screening result is available” (wording per compliance).
- **Channels:** in-app **notification feed** / **bell** (if present), **push** (FCM), optional **SMS** for urgent steps—follow existing HRX notification governance (quiet hours, opt-in).
- **Implementation sketch:** Cloud Function or client listener on **`backgroundChecks`** (worker-readable subset) + **user-scoped** docs under e.g. `tenants/{tid}/users/{uid}/notifications` or extend existing notification collections—**do not** expose full `backgroundChecks` to client; use **`tenants/.../worker_screening_tasks`** or mirrored fields on **`users/{uid}`** with strict security rules.

#### B. Worker home — “active screenings” module (top of dashboard)

- **Placement:** first primary content after **`SmsWarningBanner`** (and welcome line), or **between** welcome and **`ReadinessSummaryCard`**—either way **above** job readiness decks so screenings compete for attention when active.
- **Content model (union across order types):**  
  - **Title** (e.g. “Background check”, “Drug screen”).  
  - **Status stepper**: `ordered` → `action_needed` → `submitted` / `in_lab` → `processing` → `complete` / `cleared` / `review` (map from `hrxStatus` + provider flags).  
  - **Instructions** (rich text from admin or provider).  
  - **Site / location name**, **scheduled appointment** (ISO + timezone), **address**, **“Open in maps”** (Google/Apple maps deep link).  
  - **QR code** (image URL or data for client-side QR render).  
  - **Primary CTA**: link to **MySource** / scheduling portal / internal deep link.  
- **Data source:** extend **`BackgroundCheckDocument`** (or parallel **`screening_orders`** docs) with optional **`workerInstructions`**, **`appointmentAt`**, **`siteAddress`**, **`qrCodeUrl`**, **`mapsQuery`** — populated from webhooks, manual admin entry, or future scheduling integration. Fields may be **sparse**; UI shows only what exists.

#### C. Results while in flight vs complete

- **In flight:** home module shows **latest known status** and any **partial** results allowed by policy (some clients hide results until final).  
- **Terminal:** home module **collapses** or shows a one-line “Completed” with link **Employment**; full detail leaves the hero.

#### D. Employment tab / section (durable record)

- **Worker:** add a **“Screenings & compliance”** (or similar) subsection under **`C1WorkerMyEmploymentDetail`** / list row that lists **completed** checks with **date completed**, **type**, **outcome** (as allowed), PDF link if hosted by HRX.  
- **Recruiter admin on user profile:** **`EmploymentTab`** or credentials area shows the same **summary** for audit.  
- **Rule:** once `hrxStatus` is terminal (`completed`, `report_ready`, etc.), **mirror** a stable summary object onto **employment-scoped** or **user** summary arrays so the dashboard does not rely on long-lived hero state.

#### E. Security & privacy

- Workers **must not** read raw **`backgroundChecks`** if those docs contain PII or internal-only fields. Prefer **tenant-scoped worker-facing mirror** documents with Firestore rules, or callable **getMyScreeningSummary**.

---

## 4. UI delivery plan (suggested phases)

### Phase A — Shell (no provider dependency)

- **Done (code):** **menu item** “Onboarding” **below** “Users” (levels **5–7**, same `requiredRoles` as Users); route **`/staff-onboarding`**; page **`StaffOnboardingCenter.tsx`** with **three tabs**: **Tax and Payroll**, **E-Verify**, **Background Checks** (tabs 1–2 stub copy; tab 3 stub for future table).
- Tabs 1–2 remain **empty product-wise** until Everee/E-Verify scope lands.

### Phase B — Background Checks tab (data-first)

- **Done (code):** **`StaffOnboardingBackgroundChecksPanel`** on **`/staff-onboarding`** tab 3 — live **`onSnapshot`** query on **`backgroundChecks`** where **`tenantId == activeTenant.id`**, ordered by **`updatedAt` desc**; table + **detail dialog** with key fields + links to user profile and job order; **Firestore rules** for `backgroundChecks` + `events` subcollection (internal team **5+** per tenant); composite **index** `tenantId` + `updatedAt` in **`firestore.indexes.json`** (deploy indexes before prod).
- **Next:** **events** timeline in dialog, report PDF links when credentials exist, **`service_status_change`** in webhook handler for finer status.

### Phase C — Requirements UX + catalog

- Dropdowns on **account**, **location**, **job order**, **posting**, **user** backed by **resolver + catalog** (placeholders first, then API-backed list).
- Persist fields on the documents described in §3.2.

### Phase D — Automation + cross-links

- Cloud Function(s) for **assignment confirmed** → **resolve + create** (with confirm flag).
- Write **foreign keys** on application/assignment; profile **mirror** updates.

### Phase E — Worker UX (parallel or after Phase B data exists)

- **Notification types** + templates for screening lifecycle; wire to **`backgroundChecks`** / mirror updates.
- **`WorkerDashboard`**: new **ActiveScreenings** (name TBD) section at top per §3.6; hook to worker-safe data source.
- **Mirror doc or fields** for worker-readable instructions + progress (no direct client read of sensitive admin doc).
- **`C1WorkerMyEmployment` / detail** + optional **profile credentials** alignment: **completed** screening history.
- **i18n**: strings for statuses and CTAs (EN/ES parity with jobs work).

---

## 5. Product decisions (resolved)

| Topic | Decision |
|-------|-----------|
| **Hire / trigger** | **Only** when assignment status becomes **`confirmed`** (v1). Not `active` yet. |
| **National / child accounts** | Resolver respects **national vs child** account hierarchy; inherit defaults from parent where applicable, allow child overrides. |
| **Jobs board postings** | Posting keeps a **background check** dropdown. If posting is **linked to a job order**, requirements **pull from that job order**; otherwise use **posting-level** selections. |
| **Tax & Payroll tab** | **Empty** for now. |
| **E-Verify tab** | **Empty** for now. |
| **Confirm → automate** | **Always** show **Confirm** modal first, then **automated** ordering. Preflight computes **`alreadySatisfied`** vs **`toOrder`** (§3.4.1). |
| **Accounting (SourceDirect)** | Use **all** SD accounting levels (**primary, secondary, tertiary**) for **billing and reconciliation**; store on account with inheritance to orders, override when needed (§3.4.2). |
| **Reuse / satisfaction** | **Per assignment only**; **no** automatic reuse across assignments. **Completed** checks count toward `alreadySatisfied` **only** for **that** assignment. **Manual override** for waive/skip/force (§3.4.1). |

## 6. Open questions (remaining)

1. **Worker notifications:** Push + in-app only, or **SMS** for time-sensitive screening steps?
2. **Results on worker home:** Any **result** detail on dashboard vs **status only** until Employment?

---

## 7. Files likely to change (when coding starts)

| Area | Files / locations |
|------|-------------------|
| Menu | `src/utils/menuGenerator.ts`, possibly `src/components/Layout.tsx` (icon) |
| Routes | `src/App.tsx` |
| Page shell | New page e.g. `src/pages/StaffOnboardingCenter.tsx` (name TBD) |
| BG table/detail | New components + hooks querying `backgroundChecks` |
| Requirements | `RecruiterAccountDetails`, `AccountLocationDetail`, `RecruiterJobOrderDetail`, `GigJobsBoardToggle` / `EditJobPost`, `UserProfile` / credentials |
| Backend | `functions/src/integrations/accusource/*`, new triggers for assignment + optional catalog sync |
| Worker dashboard | `src/pages/c1/workers/dashboard.tsx`, new component under `src/components/worker/home/` or `dashboard/` |
| Worker employment | `src/pages/c1/workers/myEmployment.tsx`, `myEmploymentDetail.tsx`; optional `UserProfile` credentials / `EmploymentTab` |
| Notifications | Existing notification/FCM pipelines; see `docs/MESSAGING_NOTIFICATIONS_INVENTORY.md` |
| Docs | `docs/SOURCEDIRECT_API_REFERENCE.md`, `docs/ACCUSOURCE_FIRESTORE_VERIFICATION_CHECKLIST.md` — keep in sync |

---

## 8. Success criteria for “API key day”

- [ ] Sandbox **credentials** can be set per tenant (or global) without code change.
- [ ] **Package catalog** sync runs (manual button acceptable).
- [ ] **createBackgroundCheck** invoked from UI and from automation with same **accounting** + **package** fields.
- [ ] **Webhooks** update `backgroundChecks` and **downstream** user/application/assignment surfaces.
- [ ] **Onboarding → Background Checks** shows the same orders end-to-end as profile/credentials.
- [ ] **Workers** receive notifications for new orders and action-required steps; **dashboard** shows instructions + progress at the top when applicable.
- [ ] **Completed** screenings appear under **Employment** (worker + admin visibility) with consistent status/result fields.

---

*Last updated: 2026-03-24 (§3.4.1 per-assignment satisfaction + overrides)*
