# QBO Deep Integration — Build Plan (invoices, payments, A/R)

*Drafted 2026-07-24 from a full codebase inventory. Companion to
`QUICKBOOKS_ONLINE_INTEGRATION_REFERENCE.md` (the API patterns doc); this
is the concrete build sequence for showing invoices, payment history, and
accounts receivable at the company level (Global Invoicing, L7) and per
account (Invoicing tab, L5-7).*

---

## 0. What already exists (≈30% of the plumbing)

| Piece | State | Where |
|---|---|---|
| OAuth connect + callback + CSRF nonces | **Production-proven** | `functions/src/integrations/quickbooks/qboAuth.ts` |
| Token refresh w/ rotation + invalid_grant → Reconnect UI | **Production-proven** | `getQboAccessToken`, qboAuth.ts:262-291 |
| Scope | `com.intuit.quickbooks.accounting` — **already sufficient** for Customer/Invoice/Payment/Reports. No re-consent needed. | qboAuth.ts:36 |
| Generic query helper (`qboQuery`, minorversion 75, discovery-doc aware) | Proven live against `Purchase` (Expensify pipeline) | qboAuth.ts:294-307 |
| Firestore types for the whole cache model | Scaffolded, never written | `src/types/recruiter/account.ts:82-162` |
| Cache path builders | Scaffolded | `src/data/firestorePaths.ts:72-86` |
| Per-account Invoicing tab (subviews: invoices / ar / payments / mapping) | UI shell, all tables empty, buttons disabled | `RecruiterAccountDetails.tsx:10374-10571` |
| Global Invoicing page | Connect card real; data area placeholder | `GlobalInvoicingPage.tsx` |
| RBAC (tab L5-7, global L7) | Done | `invoicingAccessControl.ts` |
| Token keep-warm | The Expensify cron exercises the refresh token, so it never hits the ~100-day idle expiry | expensifyPush cron |

The connection is **one QBO realm per tenant** (`tenants/{t}/integrations/quickbooks`).

---

## 1. Decisions needed from Greg (before/during Phase 1)

- **D1 — Mapping direction.** Recommend **"QBO is source of truth"** to start:
  link HRX accounts to the customers the accountant already bills from, via a
  search-and-pick dialog with AI-suggested matches (normalized-name token
  matching, same approach as the import matcher). HRX→QBO customer *creation*
  is a later write-path feature.
- **D2 — National vs child mapping.** Map at the level the bill actually goes
  to. The mapping UI should warn when both a national parent and its child are
  mapped to customers (double-billing risk, reference doc §7).
- **D3 — One QBO file or two?** Today one realm serves the tenant. Confirm C1
  invoices both C1 Select and C1 Events clients from that single QuickBooks
  company. If the entities ever get separate QBO files, the integrations doc
  becomes per-entity (`integrations/quickbooks__{entityId}`) — small refactor,
  flagged now so nothing hard-codes the single-realm assumption deeper.

---

## 2. Phase 1 — Read spine (server) *(~1 day)*

New module `functions/src/integrations/quickbooks/qboInvoicing.ts`, all built
on the existing `qboQuery`/`getQboAccessToken`.

**1a. Customer directory cache.** Paged `SELECT * FROM Customer WHERE Active IN (true,false)`
→ `tenants/{t}/qbo_customers/{realmId}__{customerId}` (displayName, fully
qualified name, balance, active, email, lastSyncAt). Powers the mapping dialog
and the global "unmapped customers" list. Callable `syncQboCustomers` (L6+),
also invoked by the nightly sweep.

**1b. Mapping callables.** `mapAccountToQboCustomer` / `unmapAccountQboCustomer`
(L5+): writes `account.integrations.quickbooks` exactly as typed
(`realmId, customerId, customerDisplayName, status:'mapped'`). Server-side
suggestion helper ranks customers by normalized-name match against the
account (+ its CRM company names) so the dialog opens with a best guess.

**1c. Per-account sync.** `syncQboAccountData(accountId)`:
- `Invoice` by `CustomerRef` (paged STARTPOSITION/MAXRESULTS) →
  `accounts/{id}/quickbooks/invoices/{invoiceId}` (docNumber, txnDate,
  dueDate, totalAmt, balance, status derived: paid/open/overdue/voided,
  currency, linked payment ids, emailStatus).
- `Payment` by `CustomerRef` → `accounts/{id}/quickbooks/payments/{paymentId}`
  (txnDate, totalAmt, unapplied, linked invoice ids via `LinkedTxn`).
- A/R summary computed from open invoices (sum `Balance`, aging buckets by
  DueDate: current / 1-30 / 31-60 / 61-90 / 90+) →
  `accounts/{id}/quickbooks/arSummary/current`.
- Every run appends `syncLogs/{logId}` + stamps `lastSyncAt` on the account
  integration block. Idempotent by QBO `Id` + `SyncToken`.

**1d. Company-wide rollup.** For the Global page:
- Reports API `GET /v3/company/{realm}/reports/AgedReceivables` (validated
  totals + buckets, the accountant-grade number) cached to
  `tenants/{t}/qbo_reports/agedReceivables`.
- Recent invoices + payments across all customers (last 90 days, paged) cached
  to `tenants/{t}/qbo_recent/{...}` for the activity feed.
- Reports API is the **truth for aging totals**; entity queries are the truth
  for line-level lists. They reconcile on the page (mismatch = a badge, not a
  silent average).

## 3. Phase 2 — Freshness *(~half day)*

- **Nightly + every-30-min CDC sweep**: `GET /cdc?entities=Invoice,Payment,Customer&changedSince=lastSweepAt`
  → upsert only what changed, re-derive touched accounts' arSummary, refresh
  the company rollup. Cheap at C1 scale; well inside the 500 req/min/realm
  throttle.
- **Per-account Refresh button** → `syncQboAccountData` on demand.
- Webhooks (HMAC-verified endpoint + Intuit portal registration) are Phase 4
  polish — CDC gives near-real-time without the operational surface.

## 4. Phase 3 — UI wiring *(~1 day)*

**Per-account Invoicing tab** (the stubbed shell comes alive):
- `mapping` subview → search dialog over `qbo_customers` with the AI-suggested
  match pre-selected; shows mapped chip + Unmap; warns on parent/child double-map.
- `invoices` → cached invoice docs, newest first: doc #, date, due date, total,
  balance, status pill (Paid / Open / Overdue / Voided), **Open in QuickBooks**
  deep link (`https://app.qbo.intuit.com/app/invoice?txnId={Id}`).
- `payments` → payment history with which invoices each payment covered.
- `ar` → stat tiles from `arSummary/current` (total open, overdue, buckets)
  + last-synced stamp + Refresh.

**Global Invoicing page (L7)**:
- Company A/R headline tiles (total AR, overdue, aging buckets) from the
  AgedReceivables cache.
- Top open balances by customer, joined to mapped HRX accounts (click through
  to the account's Invoicing tab).
- Recent activity feed (invoices issued / payments received).
- **Mapping health card**: X of Y active accounts mapped; unmapped QBO
  customers with balances (the onboarding to-do list).

## 5. Phase 4 — Later / bigger

- **Webhooks** for push freshness.
- **Invoice creation from HRX** — the real endgame: generate draft QBO
  invoices from approved timesheets (assignment `billRate` × hours, now that
  the assignment backbone carries bill everywhere). Needs Item/Service +
  tax-code mapping decisions; its own plan.
- Credit memos in AR math, multi-currency display, statement emails.
- **AI collections assistant** (fits the automation ethos): a daily
  "who to chase" list — overdue invoices ranked by amount × age × payment
  history, with a drafted reminder email per account. High ROI, low risk,
  reads only cached data.

---

## 6. Risks / notes

- **Voids + credit memos** skew naive AR sums — that's why the Reports API is
  the aging truth and entity sums are cross-checked, not trusted alone.
- **Throttling**: 500 req/min/realm published; C1 scale (~dozens of customers)
  never approaches it, but the sync engine still backs off on 429.
- **Token health**: already kept warm by the Expensify cron; `getQboStatus`
  surfaces `tokenError` for the Reconnect flow.
- **RBAC**: no new surface area — existing gates (5-7 tab, 7 global) cover
  everything; cached financial docs inherit tenant rules (verify the
  `accounts/{id}/quickbooks/**` subcollection rules before Phase 3 ships).
