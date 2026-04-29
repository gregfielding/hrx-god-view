# Everee provisioning — timing, endpoints, and entity mapping

Operational decisions locked **2026-04-29**. Cross-links: HRX Everee Master Plan (`HRX-Everee-Master-Plan.md`), entity seed (`scripts/seedOnboardingEntitiesAndPackages.js`).

---

## W2 vs 1099 — Everee API surface

| Classification | Everee route | Required payload highlights |
|----------------|--------------|-----------------------------|
| **W2 employee** | `POST /api/v2/embedded/workers/employee` | Identity + `payType`, `payRate`, `typicalWeeklyHours`, `hireDate`, `legalWorkAddress`, `homeAddress`, `externalWorkerId` (we send Firebase uid). Default compensation satisfies provisioning; **per-shift rates override** in normal operations (Timesheets API). |
| **1099 contractor** | `POST /api/v2/onboarding/contractor` | Minimal: identity + `hireDate` + `legalWorkAddress` + optional `externalWorkerId`. **`approvalGroupId`** optional in Everee’s OpenAPI but may be required per tenant configuration — store on entity as `evereeApprovalGroupId` when Everee ops assigns a group. **Not** `/api/v2/embedded/workers/contractor` (not in published API). |

**Host:** always `https://api.everee.com` (never `api.sandbox.everee.com` — NXDOMAIN). Sandbox vs production is keyed by **`EVEREE_API_TOKEN_<evereeTenantId>`** and `x-everee-tenant-id`, not by hostname.

---

## Per-entity classification map (C1)

| Entity | Worker classification | Everee route |
|--------|----------------------|--------------|
| **C1 Events** | Always **1099 contractor** | `/api/v2/onboarding/contractor` |
| **C1 Select** | **W2 employee** | `/api/v2/embedded/workers/employee` |
| **Sandbox / integration test** | W2 against tenant **2320** | Same as C1 Select employee path |

---

## Per-entity trigger map (when we create the Everee worker record)

| Entity | Trigger | Rationale |
|--------|---------|-----------|
| **C1 Events** | **Application submit** — Firestore `onCreate` on `tenants/{tid}/applications/{appId}`, gated to `hiringEntityId === '<C1 Events entity id>'`. | Gig timing: placement can be hours before shift; application-submit is the earliest reliable hook. **Cost:** some workers provision who never get assigned — acceptable. |
| **C1 Select** | **Stage 2 (secondary):** first assignment **or** manual “Sync to Everee” on Employment (`EvereeAdminSyncCard`). Manual sync remains ops fallback. Lower urgency than Events — traditional placement has more lead time. |

Stage 2 implementation waits on **C1 Events Everee production tenant + API token** (`EVEREE_API_TOKEN_<eventsTenantId>`). Sandbox **2320** is insufficient for production Events-only rollout.

---

## Default rate strategy (C1 Select W2)

- **Everee requires** a default `payRate` at employee provisioning.
- **Source of truth for the default:** position rate from the worker’s **most recent application** (among applications tied to C1 Select / relevant JOs).
- **Operational reality:** **per-shift overrides always win** once shifts flow through Everee Timesheets. The stored default is a compliance/accounting baseline; it does not need to change on every JO change unless product/legal asks for it.
- **Caveat:** we often **provision before the worker’s final JO is known** — acceptable; default tracks “last known intent”; overrides handle actual worked shifts.

---

## Idempotency & linkage

- Fast path: `users/{uid}.evereeWorkerIds[evereeTenantId]`.
- Fallback: `tenants/{tid}/everee_workers/{entityId}__{userId}`.
- Either hit → return existing Everee worker id, **no duplicate POST**.

---

## Ops prerequisites (not code)

1. **C1 Events:** Everee production tenant + API token → `EVEREE_API_TOKEN_<id>` + optional `evereeApprovalGroupId` on the Events entity doc.
2. **C1 Select:** Everee production tenant + token when leaving sandbox-only testing.

---

## One-shot: enable Everee on C1 Select (sandbox 2320)

```bash
node scripts/configureEvereeForC1SelectEntity.js --tenant=YOUR_TENANT_ID --write
```

Uses deterministic entity id `c1_select_llc` unless `--entity=` is passed. See script header for hostname/token notes.
