# HRX × QuickBooks Online Invoicing & A/R Integration Spec

## Purpose

This document defines the recommended architecture for adding an **Invoicing** tab to each **Account** record in HRX so users can:

- view invoices for that customer account
- view aging / accounts receivable balances
- open invoice detail
- resend invoices from HRX via QuickBooks Online (QBO)
- reconcile HRX accounts to QBO customers
- keep HRX as the operating system while QBO remains the accounting system of record

This spec is written for Cursor implementation.

---

## Product Goal

At the **HRX Account** level, add an **Invoicing** tab with a view switcher or segmented control such as:

- **Invoices**
- **A/R Aging**
- **Payments**
- **Settings / Mapping**

### Desired user experience

When a user opens an HRX Account, the Invoicing tab should show data only for the linked QuickBooks customer tied to that HRX account.

### Minimum MVP

1. Connect HRX tenant / hiring entity to a QuickBooks Online company.
2. Link each HRX **Account** to a QBO **Customer**.
3. Pull and display:
   - invoices
   - outstanding balances
   - due dates
   - invoice status / email status when available
   - payments applied
4. Show A/R aging for the linked customer.
5. Allow users to open the invoice in QBO and trigger resend / send email from HRX.
6. Store sync metadata and last refresh timestamps.

---

## Recommendation on Account Identifier

### Short answer

**Use the Firestore Account document ID as the canonical HRX identifier.**

Do **not** use the QBO customer ID as HRX's primary key.

### Recommended model

Every HRX Account should have:

- `accountId` = Firestore document ID (canonical internal ID)
- `qboCustomerId` = mapped QuickBooks customer ID (external system ID)
- `qboRealmId` = QuickBooks company / realm ID
- optional `externalRefs.hrxAccountId` stored into QBO customer metadata where practical

### Why this is the right model

The Firestore document ID is:

- already unique
- immutable inside HRX
- environment-safe
- available before QuickBooks mapping exists
- reusable across all future finance integrations, not just QuickBooks

The QBO customer ID should be treated as an **external foreign key**, not the source of truth.

### Best practice

Use this mapping pattern:

```ts
accounts/{accountId}
  integrations.quickbooks = {
    realmId: string,
    customerId: string,
    customerDisplayName: string,
    syncStatus: 'linked' | 'unlinked' | 'error',
    lastSyncedAt: Timestamp,
    lastInvoiceSyncAt: Timestamp,
    lastArSyncAt: Timestamp,
  }
```

### Helpful additional field

Also create a stable human-friendly field on the HRX account for long-term external matching:

- `accountCode`

Example:

- `acct_legends_oakland_arena`
- `acct_sodexo_disney_on_ice_oakland`

This is useful for:

- search
- reporting
- fallback matching
- future ERP integrations

But the **Firestore document ID** should remain the core system identifier.

---

## QuickBooks Online API: What We Need

QuickBooks Online provides a REST-based Accounting API and supports:

- Customer entity
- Invoice entity
- Payment entity
- query operations
- report endpoints
- OAuth 2.0 authorization
- webhooks

### Relevant capabilities for this project

#### 1. Customer lookup and mapping
We need to either:

- find an existing QBO Customer for the HRX Account, or
- create one, then store the returned `Customer.Id`

#### 2. Invoice retrieval
We need to retrieve invoices for a single mapped customer.

#### 3. Payment retrieval
We need to retrieve customer payments and optionally invoice-linked payments.

#### 4. Reports / A/R aging
We need the reports API for A/R aging visibility, especially customer-specific aging where possible.

#### 5. Email / resend invoice
We need invoice send functionality from the API so HRX users can resend invoices without leaving HRX.

#### 6. Webhooks or scheduled sync
We should support:

- webhook-driven refresh where possible
- scheduled nightly sync as the dependable fallback

---

## Official QuickBooks Online API Notes

These points matter for implementation:

1. The QBO Accounting API is REST-based.
2. OAuth 2.0 is required; each connected QBO company provides a `realmId` and tokens.
3. Query syntax is SQL-like but limited.
4. The Reports API supports pulling financial reports.
5. The Invoice workflow is built around the `Customer`, `Item`, and `Invoice` entities.
6. The Customer entity should be queried before creating duplicates.
7. Intuit deprecated older minor versions 1–74 beginning August 1, 2025, so new work should target a current supported minor version.

---

## HRX Domain Model

### Existing entity
- `Account` = active customer / worksite / child account in HRX

### Finance integration model
Each HRX Account should be able to map to exactly one QBO Customer within one QuickBooks company / realm.

### Important distinction
There may be multiple HRX accounts under one parent company, and you must decide whether each child account should map to:

- one unique QBO customer per HRX account, or
- one shared QBO customer at the parent company level

### Recommendation
For staffing invoicing, default to:

- **one QBO customer per bill-to account**

That keeps invoice visibility clean and avoids mixed A/R.

If multiple HRX child accounts bill through a single parent QBO customer, support that intentionally through an override setting.

---

## Recommended Firestore Schema

### 1. Account document

```ts
accounts/{accountId}
{
  name: string,
  companyId: string,
  parentAccountId?: string,
  hiringEntityId?: string,
  status: 'active' | 'inactive',
  accountCode?: string,
  integrations?: {
    quickbooks?: {
      enabled: boolean,
      realmId?: string,
      customerId?: string,
      customerDisplayName?: string,
      customerEmail?: string,
      syncStatus?: 'unlinked' | 'linked' | 'pending' | 'error',
      syncError?: string | null,
      mappedAt?: Timestamp,
      mappedBy?: string,
      lastInvoiceSyncAt?: Timestamp,
      lastPaymentSyncAt?: Timestamp,
      lastArSyncAt?: Timestamp,
      lastWebhookAt?: Timestamp,
    }
  }
}
```

### 2. Connected QuickBooks company

```ts
integrations/quickbooks/realms/{realmId}
{
  realmId: string,
  companyName: string,
  connected: boolean,
  accessTokenEncrypted: string,
  refreshTokenEncrypted: string,
  tokenExpiresAt: Timestamp,
  refreshTokenExpiresAt?: Timestamp,
  scopes: string[],
  connectedBy: string,
  connectedAt: Timestamp,
  lastSyncedAt?: Timestamp,
  lastWebhookAt?: Timestamp,
  status: 'active' | 'expired' | 'error'
}
```

### 3. Customer mapping cache

```ts
accounts/{accountId}/quickbooks/customer
{
  realmId: string,
  customerId: string,
  displayName: string,
  fullyQualifiedName?: string,
  primaryEmailAddr?: string,
  primaryPhone?: string,
  active?: boolean,
  raw?: object,
  syncedAt: Timestamp,
}
```

### 4. Invoice cache

```ts
accounts/{accountId}/quickbooks/invoices/{invoiceId}
{
  realmId: string,
  invoiceId: string,
  docNumber?: string,
  txnDate?: string,
  dueDate?: string,
  totalAmt?: number,
  balance?: number,
  currencyRef?: string,
  customerId: string,
  customerName?: string,
  emailStatus?: string,
  printStatus?: string,
  privateNote?: string,
  linkedTxn?: any[],
  metaLastUpdatedTime?: string,
  raw?: object,
  syncedAt: Timestamp,
}
```

### 5. Payment cache

```ts
accounts/{accountId}/quickbooks/payments/{paymentId}
{
  realmId: string,
  paymentId: string,
  txnDate?: string,
  totalAmt?: number,
  unappliedAmt?: number,
  customerId: string,
  customerName?: string,
  linkedTxn?: any[],
  paymentRefNum?: string,
  raw?: object,
  syncedAt: Timestamp,
}
```

### 6. A/R summary cache

```ts
accounts/{accountId}/quickbooks/arSummary/current
{
  realmId: string,
  customerId: string,
  totalOpenBalance: number,
  current: number,
  days1to30: number,
  days31to60: number,
  days61to90: number,
  over90: number,
  asOfDate: string,
  source: 'report' | 'derived',
  syncedAt: Timestamp,
  raw?: object,
}
```

### 7. Sync logs

```ts
accounts/{accountId}/quickbooks/syncLogs/{logId}
{
  type: 'customer' | 'invoice' | 'payment' | 'ar' | 'sendInvoice',
  status: 'success' | 'error',
  message?: string,
  requestSummary?: object,
  responseSummary?: object,
  createdAt: Timestamp,
  createdBy?: string,
}
```

---

## UI Specification: Invoicing Tab

### New tab on Account page
Add a tab:

- `Invoicing`

### Top bar controls
At the top of the Invoicing tab, add:

- View dropdown or segmented control:
  - Invoices
  - A/R Aging
  - Payments
  - Mapping / Settings
- Last synced timestamp
- Refresh button
- Open in QuickBooks button

---

## Invoices View

### Columns
- Invoice #
- Invoice date
- Due date
- Total
- Balance
- Status
- Email status
- Last updated
- Actions

### Actions
- View details
- Open in QuickBooks
- Resend / Send invoice email
- Refresh this invoice

### Filters
- Open only
- Paid
- Overdue
- Date range

---

## A/R Aging View

### Summary cards
- Total Open A/R
- Current
- 1–30
- 31–60
- 61–90
- 90+

### Table
- Invoice #
- Due date
- Days overdue
- Balance
- Bucket

### Recommendation
Use the Reports API if it returns usable customer-level aging. If the report output is too awkward, derive aging buckets locally from invoice due dates and balances cached from the invoice sync.

---

## Payments View

### Columns
- Payment date
- Amount
- Payment reference #
- Applied invoices
- Unapplied amount
- Synced at

---

## Mapping / Settings View

### Controls
- QuickBooks connection status
- QBO realm / company name
- Linked customer display name
- Linked customer ID
- Search QBO customers
- Link existing customer
- Create new QBO customer from HRX account
- Disconnect mapping (with confirmation)

---

## Recommended Identifier Strategy in QBO

### Use these fields
Inside HRX:
- `accountId` = Firestore doc ID
- `accountCode` = stable readable external code

Inside QBO:
- `Customer.Id` = authoritative QBO foreign key
- optionally put `accountCode` or HRX account ID into notes / display name conventions / supported custom fields where available

### Recommendation for implementation
When creating or mapping a customer, persist this locally in HRX:

```ts
{
  accountId: 'FirestoreDocId',
  realmId: 'QBORealmId',
  customerId: 'QBOCustomerId'
}
```

That is the only required durable mapping.

### Why not rely on customer name matching
Do not rely on name matching after initial setup because:

- names can change
- parent / child account naming can be inconsistent
- duplicate customer names are common in accounting systems

---

## QuickBooks OAuth / Connection Architecture

### One-time connect flow
1. HRX admin clicks **Connect QuickBooks**.
2. HRX redirects to Intuit OAuth consent.
3. User authorizes access.
4. Intuit returns:
   - `access_token`
   - `refresh_token`
   - `realmId`
5. HRX stores encrypted tokens server-side only.

### Important
Never call QuickBooks directly from the browser with live tokens.
All QBO API access should go through backend functions.

---

## Backend Modules to Build

Recommended structure:

```ts
/functions/src/integrations/quickbooks/
  quickbooksClient.ts
  quickbooksConfig.ts
  quickbooksAuth.ts
  quickbooksCustomers.ts
  quickbooksInvoices.ts
  quickbooksPayments.ts
  quickbooksReports.ts
  quickbooksWebhooks.ts
  quickbooksSync.ts
```

### Core responsibilities

#### `quickbooksClient.ts`
- builds authorized axios/fetch client
- injects bearer token
- refreshes tokens when needed
- appends supported `minorversion`

#### `quickbooksCustomers.ts`
- search customer by display name / metadata
- create customer
- map customer to HRX account
- retrieve customer by ID

#### `quickbooksInvoices.ts`
- query invoices by customer
- get invoice by ID
- send / resend invoice email
- sync invoice cache into Firestore

#### `quickbooksPayments.ts`
- query payments by customer
- sync payment cache

#### `quickbooksReports.ts`
- run aging reports
- normalize report response
- derive customer-specific A/R summary

#### `quickbooksWebhooks.ts`
- receive QBO webhook events
- queue selective refreshes

#### `quickbooksSync.ts`
- manual refresh for one account
- nightly bulk refresh job

---

## Suggested API Calls / Sync Flow

### 1. Connect realm
After OAuth:

- save `realmId`
- save tokens
- mark realm active

### 2. Map HRX Account to QBO Customer
Preferred order:

1. search existing customer candidates
2. user selects one
3. if none exists, create customer
4. save mapping to account document

### 3. Pull invoices for one customer
Use a QBO query against `Invoice` filtered by the mapped customer.

Pseudo example:

```sql
select * from Invoice where CustomerRef = '123' order by MetaData.LastUpdatedTime desc
```

### 4. Pull payments for one customer
Use query against `Payment` filtered by customer.

Pseudo example:

```sql
select * from Payment where CustomerRef = '123' order by MetaData.LastUpdatedTime desc
```

### 5. Pull A/R aging
Option A:
- use Reports API and filter / normalize if possible

Option B:
- derive from open invoices:
  - `balance > 0`
  - compare `dueDate` to today
  - assign bucket

### 6. Send / resend invoice
Use the QBO invoice send operation from backend.
Store action log in Firestore.

---

## Recommended MVP Sync Strategy

### Phase 1: Pull-only with manual refresh
- connect QuickBooks
- map account to QBO customer
- manual refresh button on Invoicing tab
- show invoices / A/R / payments
- send / resend invoice email

### Phase 2: Scheduled sync
- nightly sync all linked accounts
- selective re-sync for accounts viewed during the day

### Phase 3: Webhooks
- subscribe to QBO webhooks
- update invoice / payment / customer changes automatically

---

## Sending / Resending Invoices

### Recommended UX
In invoice table row actions:
- `Open in QuickBooks`
- `Send / Resend Invoice`

### Behavior
- backend calls QBO invoice send action
- if customer email missing, show error state
- log result to `syncLogs`
- refresh invoice row afterward

### Safety rules
- allow users with **securityLevel 5, 6, or 7** for account-level Invoicing tab actions (send/resend on that account). For a future global “create invoice” action (sidebar Invoicing), restrict to **securityLevel 7** only.
- require mapping + valid realm connection
- surface clear success/failure toast

---

## Cursor Implementation Plan

### Phase A — Data model and UI shell
1. Add `Invoicing` tab to Account page.
2. Add segmented view switcher.
3. Add empty states.
4. Add Firestore types for QBO integration.

### Phase B — QuickBooks connection
1. Build OAuth connection flow.
2. Store realm connection in Firestore.
3. Add token refresh support.

### Phase C — Customer mapping
1. Build search existing customer function.
2. Build create customer function.
3. Save `realmId + customerId` onto account.

### Phase D — Invoice sync
1. Build `syncAccountInvoices(accountId)` backend function.
2. Cache invoices in subcollection.
3. Render invoice table.

### Phase E — Payments + aging
1. Build `syncAccountPayments(accountId)`.
2. Build `syncAccountArSummary(accountId)`.
3. Render aging cards and payments table.

### Phase F — Send / resend invoice
1. Build backend `sendInvoice(accountId, invoiceId)`.
2. Add row action.
3. Refresh invoice after send.

### Phase G — Operational hardening
1. Add sync logs.
2. Add retry handling.
3. Add webhook support.
4. Enforce permissions: use two-tier access — account tab 5/6/7, global Invoicing 7 only (see Suggested Permissions below).

---

## Important Design Decisions

### 1. QBO is system of record for accounting
HRX should not become the accounting source of truth.

HRX should:
- read
- cache
- summarize
- trigger allowed actions

QBO should remain authoritative for:
- invoice balances
- payment applications
- report calculations

### 2. Avoid duplicate customer creation
Always query first before creating a QBO customer.

### 3. Use backend-only sync
Never expose access or refresh tokens to the client.

### 4. Keep a local cache
Even if QBO is authoritative, cache invoice and A/R data for:
- fast UI load
- historical snapshots
- debugging
- webhook refreshes

---

## Suggested UI Empty States

### No QuickBooks connection
> Connect QuickBooks to view invoices, balances, and payment activity for this account.

### Connected but unmapped
> This account is not yet linked to a QuickBooks customer. Link an existing customer or create one.

### Mapped but no invoices
> No invoices found for this QuickBooks customer.

---

## Suggested Permissions

**Two-tier access:**

1. **Account Invoicing tab** (Account Details → Invoicing tab): **security levels 5, 6, and 7**. These users can see the tab, view invoices/aging/payments for that account, connect QuickBooks, map/remap customers, refresh sync, resend invoices, open in QBO, etc. Users below level 5 do not see the tab and are redirected to Overview if they hit the tab via URL.

2. **Global Invoicing** (sidebar “Invoicing” with $ icon, route `/invoicing`): **security level 7 only**. This layout is for admins and will show all invoices across all accounts, reporting, and creating invoices. Level 5/6 users do not see the sidebar menu item and are redirected to `/accounts` if they open `/invoicing` directly.

Implementation: `utils/invoicingAccessControl` exports `canAccessAccountInvoicingTab(level)` (5/6/7) and `canAccessGlobalInvoicing(level)` (7 only).

---

## Server / data protection

UI and route protection are not enough. Backend must enforce the same tiers.

- **Firestore rules:** Restrict read/write on `accounts/{accountId}/quickbooks/*` to users with security level **5 or higher** for that tenant (so 5, 6, 7 can access account-scoped QBO data). For any tenant-wide or cross-account invoicing data, restrict to **level 7**.
- **Cloud Functions:** For account-scoped operations (sync, map, send invoice for one account), require security level **≥ 5**. For global/cross-account operations, require **level 7**. Return 403 when the caller’s level is insufficient.
- **Reuse the same rule:** Use the same helpers as in the app (`canAccessAccountInvoicingTab` / `canAccessGlobalInvoicing`) or mirror their logic in backend checks.

---

## Example Service Interfaces

```ts
export async function mapAccountToQboCustomer(params: {
  accountId: string;
  realmId: string;
  customerId: string;
  actorUid: string;
}): Promise<void>
```

```ts
export async function syncAccountInvoices(params: {
  accountId: string;
  force?: boolean;
}): Promise<{ count: number }>
```

```ts
export async function syncAccountArSummary(params: {
  accountId: string;
}): Promise<void>
```

```ts
export async function sendAccountInvoice(params: {
  accountId: string;
  invoiceId: string;
  actorUid: string;
}): Promise<void>
```

---

## Recommended First Release Scope

Ship this first:

1. Invoicing tab
2. QuickBooks connection at realm level
3. Account ↔ Customer mapping
4. Invoice table
5. Aging summary derived from cached invoices
6. Resend invoice button

That gets the business value quickly without waiting for a perfect reports integration.

---

## Why This Matters

For HRX, this turns an Account page into a real operating console.

Users will be able to see:
- what has been billed
- what is still unpaid
- which customers are aging out
- whether invoices were sent
- whether payment has been applied

That is a major upgrade for C1 operations and a meaningful product feature if HRX is later commercialized.

---

## Official References for Cursor

Use official Intuit docs as the source of truth:

- QuickBooks Online API overview: https://developer.intuit.com/app/developer/qbo/docs/learn/explore-the-quickbooks-online-api
- QBO develop overview: https://developer.intuit.com/app/developer/qbo/docs/develop
- Query operations and syntax: https://developer.intuit.com/app/developer/qbo/docs/learn/explore-the-quickbooks-online-api/data-queries
- Invoicing overview: https://developer.intuit.com/app/developer/qbo/docs/learn/learn-basic-bookkeeping/invoicing
- Create basic invoices: https://developer.intuit.com/app/developer/qbo/docs/workflows/create-an-invoice
- Customers in QBO: https://developer.intuit.com/app/developer/qbo/docs/learn/learn-basic-bookkeeping/customers
- Run reports: https://developer.intuit.com/app/developer/qbo/docs/workflows/run-reports
- Basic invoicing implementation: https://developer.intuit.com/app/developer/qbo/docs/develop/basic-implementations/basic-invoicing-implementation
- API Explorer getting started: https://developer.intuit.com/app/developer/qbo/docs/get-started/get-started-with-the-api-explorer
- Minor versions: https://developer.intuit.com/app/developer/qbo/docs/learn/explore-the-quickbooks-online-api/minor-versions
- Customer custom fields: https://developer.intuit.com/app/developer/qbo/docs/workflows/create-custom-fields/develop-custom-fields

---

## Final Recommendation

### Canonical identifier decision
Use:

- **HRX Account Firestore document ID** as the canonical account identifier

Store alongside it:

- `qboRealmId`
- `qboCustomerId`
- optional `accountCode`

That gives HRX a clean, stable finance integration model that will also work later for:

- NetSuite
- Xero
- Sage
- ERP integrations

Do not make QuickBooks IDs the primary identifiers inside HRX.
