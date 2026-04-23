# QuickBooks Online (QBO) API — integration reference (HRX / TempWorks replacement)

This document is a **planning and architecture reference** for moving HRX invoicing from TempWorks to **QuickBooks Online**, using the [Intuit QuickBooks Online developer documentation](https://developer.intuit.com/app/developer/qbo/docs/develop). It focuses on **mapping every QBO Customer to an active HRX Account**, surfacing **invoice history** and **accounts receivable (A/R)** per account in HRX.

**Related HRX codebase (already scaffolded):** `src/types/recruiter/account.ts` defines `integrations.quickbooks`, cached customer/invoice/payment/A-R docs, and sync log shapes—implementation can align with this model.

---

## 1. Official documentation entry points

| Topic | URL |
|--------|-----|
| **Develop hub (overview, links to all topics)** | [developer.intuit.com — QBO develop](https://developer.intuit.com/app/developer/qbo/docs/develop) |
| **OAuth 2.0 setup** | [OAuth 2.0](https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization/oauth-2.0) |
| **OAuth FAQ** (tokens, rotation, common failures) | [OAuth 2.0 FAQ](https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization/faq) |
| **OpenID / OAuth discovery documents** (sandbox vs production endpoints) | [Discovery docs](https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization/oauth-openid-discovery-doc) |
| **Minor versions** (API evolution; **always pass `minorversion`**) | [Minor versions](https://developer.intuit.com/app/developer/qbo/docs/learn/explore-the-quickbooks-online-api/minor-versions) |
| **IDs and fields (`realmId`, `SyncToken`, etc.)** | [Basic ID and field definitions](https://developer.intuit.com/app/developer/qbo/docs/learn/learn-basic-field-definitions) |
| **Query language (SQL-like queries against QBO)** | [Query operations and syntax](https://developer.intuit.com/app/developer/qbo/docs/learn/explore-the-quickbooks-online-api/data-queries) |
| **Webhooks** | [Webhooks](https://developer.intuit.com/app/developer/qbo/docs/develop/webhooks) |
| **Accounting API entity reference** | Browse from [Accounting API — all entities](https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/account) (portal navigation; entity pages list operations and fields). |

Always treat Intuit’s live docs as the source of truth for **field names, deprecations, and rate limits**.

---

## 2. Mental model: company, customer, invoice, payments

### 2.1 Company file = `realmId`

- Each **QuickBooks Online subscription / company file** has a **`realmId`** (often called **company ID** in docs).
- OAuth returns **`realmId`** when the user completes authorization; **every Accounting API request** is scoped under that company, e.g. REST path pattern:  
  `https://quickbooks.api.intuit.com/v3/company/{realmId}/…`  
  (Sandbox uses a parallel host—see Intuit docs for current sandbox base URLs.)
- **HRX implication:** Tenant-level OAuth connection stores **realmId + tokens** per Intuit-connected company. One tenant might connect one QBO company or (rarely) multiple—product decision.

### 2.2 Customer (maps to HRX Account)

- In QBO, **`Customer`** is the AR counterparty for invoicing.
- **`Customer.Id`** is the stable key you store on `integrations.quickbooks.customerId` (already reflected in HRX types).
- Customers can be **inactive**; HRX should align with **`active`** flags and decide whether inactive QBO customers may still map to archived HRX accounts.

### 2.3 Invoice

- **`Invoice`** carries **`CustomerRef`**, amounts, **`Balance`**, **`TxnDate`**, **`DueDate`**, **`DocNumber`**, line items, **`EmailStatus`** / **`PrintStatus`**, etc.
- **`SyncToken`** is required on **updates**—optimistic concurrency (see Intuit field definitions).

### 2.4 Payments and applied amounts

- **`Payment`** ties to **`CustomerRef`** and usually contains **`Line`** entries with **`LinkedTxn`** pointing at **`Invoice`** IDs for applied amounts (how payments settle open invoices).
- For **invoice history + open balance**, you typically combine **invoice list/detail**, **payment activity**, and optionally **reports** (below).

---

## 3. OAuth 2.0 — what you must implement

High-level flow (standard OAuth 2.0 authorization code pattern; details in Intuit’s guides):

1. Register an app in the **Intuit Developer** portal; obtain **Client ID**, **Client Secret**, configure **Redirect URI(s)** (HTTPS).
2. Send users through Intuit’s **authorization URL** with appropriate **scopes** for Accounting API access.
3. Exchange the authorization **code** for **access_token** and **refresh_token**.
4. Store tokens **securely** (server-side only). Use **refresh_token** to obtain new **access_token** before expiry.

**Operational facts** (confirm current numbers in [OAuth FAQ](https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization/faq)):

- **Access tokens** are short-lived (commonly on the order of **one hour**).
- **Refresh tokens** are long-lived but **not permanent**; Intuit documents **rolling expiry** (e.g. ~100-day horizon if unused—**verify in FAQ**). Always persist the **latest** refresh token returned.
- **TLS:** Use **TLS 1.2+**; follow Intuit security guidance.
- Use **`state`** on authorize requests for **CSRF** protection.

**Sandbox vs production:** separate app keys and OAuth endpoints; discovery documents list environment-specific URLs ([discovery docs](https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization/oauth-openid-discovery-doc)).

---

## 4. API usage patterns for HRX features

### 4.1 Customer ↔ Account linking

**Goal:** Each **active HRX Account** that bills through QBO has exactly one **QBO Customer** (per connected `realmId`).

**Implementation approaches:**

| Approach | Pros | Cons |
|----------|------|------|
| **HRX is source of truth** — create/update **QBO Customer** from HRX when account is created/updated | Tight control of naming, billing address, account number | Must handle QBO validation errors, duplicates, merge scenarios |
| **QBO is source of truth** — pick existing Customer and **link** | Matches accountant’s existing QBO | Need robust search + merge handling |
| **Bidirectional** — HRX creates, QBO edits sync back | Flexible | Conflict resolution and `SyncToken` discipline |

**Stable linkage:** Persist on the account document (already modeled):

- `integrations.quickbooks.realmId`
- `integrations.quickbooks.customerId`
- `integrations.quickbooks.status` (`not_connected` | `connected_unmapped` | `mapped` | `sync_error`)

**Optional:** Store **QBO `DisplayName`** / **fully qualified name** for UI and reconciliation (`AccountQuickBooksCustomerDoc` in types).

**Custom identifiers:** QBO supports **custom fields / metadata patterns** depending on edition and API surface—evaluate Intuit docs for storing **HRX `accountId`** in QBO for support/debug (without duplicating TempWorks coupling).

### 4.2 Invoice history (per account)

Typical strategies:

1. **Query API:** e.g. query **`Invoice`** entities filtered by **`CustomerRef`** = mapped customer ID (Intuit query syntax—see [data queries](https://developer.intuit.com/app/developer/qbo/docs/learn/explore-the-quickbooks-online-api/data-queries)).
2. **Pagination / limits:** Follow Intuit’s rules for **`STARTPOSITION`**, **`MAXRESULTS`**, and **minorversion**.
3. **Incremental sync:** Use **Change Data Capture (CDC)** where appropriate (Intuit documents CDC for catching up since a timestamp)—pair with webhooks for near-real-time.

**HRX cache:** Mirror summarized invoices under paths suggested in types, e.g. `accounts/{accountId}/quickbooks/invoices/{invoiceId}` (`AccountQuickBooksInvoiceDoc`).

### 4.3 Accounts receivable (open balances, aging)

Strategy layers:

1. **Per-invoice:** Sum **`Invoice.Balance`** for open invoices (respect **void** / **credit memo** links if you model credits).
2. **Reports API:** Intuit exposes **report** endpoints (e.g. A/R aging, customer balance)—use for **validated** totals and aging buckets. Entity names and parameters are in the Accounting API reference (search for **AgedReceivables**, **CustomerBalance**, etc., in the portal).
3. **Payments:** Fetch **`Payment`** applied to invoices to show **cash application** and remaining balance.

**HRX cache:** `AccountQuickBooksArSummaryDoc` matches an **aggregated** A/R snapshot for fast UI.

### 4.4 Minor version

Pass **`minorversion`** on requests (query parameter). Intuit adds fields and behaviors over time; pinning avoids surprise breakage. Follow [minor versions](https://developer.intuit.com/app/developer/qbo/docs/learn/explore-the-quickbooks-online-api/minor-versions) for **deprecation schedules**.

---

## 5. Webhooks + reliability

Intuit documents **webhooks** for near-real-time notifications when entities change ([Webhooks](https://developer.intuit.com/app/developer/qbo/docs/develop/webhooks)).

**Design expectations:**

- **HTTPS endpoint** registered in the developer portal; validate **payload signatures** per Intuit (documented verifier token / HMAC pattern on the webhook page).
- **Fast ACK:** Return **200** quickly; do heavy work **asynchronously** (queue).
- **At-least-once delivery:** Expect duplicates—use **idempotent** handlers (entity id + `lastUpdated` / `SyncToken`).
- **Best-effort:** Complement with **scheduled CDC/query** backfill so HRX never depends solely on webhooks.

Entities most relevant to HRX: **`Customer`**, **`Invoice`**, **`Payment`** (confirm exact subscription list in current webhook docs).

---

## 6. Rate limits, batching, and operations

- Intuit publishes **per-app / per-realm** throttling (numbers change—read current docs). Plan for **exponential backoff** and **request coalescing**.
- **Batch** endpoints may have **different** limits than single-entity calls—check Intuit’s “batch” documentation if you bulk-sync.

---

## 7. Product and data rules (HRX-specific)

- **Active Account:** Only **active** HRX accounts should appear as selectable billing identities for **new** invoice workflows; mapping for inactive accounts may remain read-only for history.
- **National / child / standalone accounts:** Decide whether QBO **Customer** maps to **standalone/child only** or also to **national** parents—avoid double-billing two customers for one bill-to.
- **Security / RBAC:** Align with existing HRX invoicing gates (e.g. account invoicing tab for levels 5–7, global invoicing for level 7)—see `src/utils/invoicingAccessControl.ts` and `GlobalInvoicingPage`.
- **Multi-currency:** If used in QBO, store **`CurrencyRef`** on cached invoices and handle FX display in HRX.

---

## 8. Migration from TempWorks (non-code checklist)

1. **Extract** TempWorks customer keys and invoice identifiers that HRX currently relies on.
2. **Match** each billing entity to a **QBO Customer** (manual import, CSV, or accountant-led cleanup).
3. **Write** `integrations.quickbooks.customerId` (+ `realmId`) for each HRX Account.
4. **Backfill** invoice history via QBO queries (or report exports for cutover window).
5. **Cutover:** Stop TempWorks invoice creation; switch HRX flows to QBO APIs.
6. **Reconcile:** Compare HRX cached A/R to QBO reports for a parallel run period.

---

## 9. Suggested reading order for implementers

1. [QBO develop hub](https://developer.intuit.com/app/developer/qbo/docs/develop)  
2. [OAuth 2.0](https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization/oauth-2.0) + [FAQ](https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization/faq)  
3. [Basic field definitions](https://developer.intuit.com/app/developer/qbo/docs/learn/learn-basic-field-definitions) (`realmId`, `SyncToken`)  
4. [Minor versions](https://developer.intuit.com/app/developer/qbo/docs/learn/explore-the-quickbooks-online-api/minor-versions)  
5. [Query syntax](https://developer.intuit.com/app/developer/qbo/docs/learn/explore-the-quickbooks-online-api/data-queries)  
6. Entity reference: **Customer**, **Invoice**, **Payment**, **CreditMemo** (if credits matter)  
7. [Webhooks](https://developer.intuit.com/app/developer/qbo/docs/develop/webhooks)  
8. Reports relevant to **A/R** and **customer balance**

---

## 10. Document maintenance

- **Review quarterly:** Intuit deprecates **minor versions** and fields on published timelines ([minor versions](https://developer.intuit.com/app/developer/qbo/docs/learn/explore-the-quickbooks-online-api/minor-versions)).  
- **Update this file** when HRX locks in: OAuth storage, webhook URL, sync cadence, and exact report names used for A/R.

---

*Last updated: 2026-04-23. No runtime code changes were made as part of authoring this reference.*
