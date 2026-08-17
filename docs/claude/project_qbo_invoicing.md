# qbo invoicing

> "QBO deep integration — D1-D3 locked; Phases 1-3 SHIPPED 2026-07-24 (read spine + 30-min cron + full UI, Venue Smart mapped+verified $549,409.96); Phase 4 (webhooks, invoice creation, AI collections) unbuilt"

Full plan: docs/QBO_INVOICING_BUILD_PLAN.md. qboAuth.ts carries the OAuth
spine (scope com.intuit.quickbooks.accounting, realm 9341452806974527) +
qboQuery + qboEntityUpdate (full-entity POST update, added for the
Expensify class write-back).

**Decisions locked with Greg 2026-07-24:** D1 QBO customers are source of
truth (link, don't create); D2 mapping generally at the NATIONAL PARENT
(child map allowed w/ double-billing advisory); D3 ONE QBO realm serves
both hiring entities.

**Phases 1-3 SHIPPED (6f1fbf07, e96c9e2a; functions + hosting deployed
2026-07-24):** qboInvoicing.ts callables syncQboCustomers (L6),
listQboCustomers (L5), map/unmapAccountToQboCustomer (L5),
syncQboAccountData (L5), syncQboCompanyRollup (L7, AgedReceivables =
aging truth), getQboAccountInvoicing (L5), getQboDashboard (L7),
qboRefreshCron (every 30 min: rollup + customers + all mapped accounts —
full resync, no CDC needed at C1 scale). UI: account Invoicing tab
(invoices/A-R aging/payments/mapping subviews, suggested-customer dialog
w/ llc-stopword token scoring, auto-sync after map, deep links to
app.qbo.intuit.com) + QboArDashboardCard on /invoicing (aging tiles,
per-customer table, mapping health, recent activity).

**⚠️ Path-depth footgun (cost a 500 on first live use):** `quickbooks` is
a SUBCOLLECTION of the account doc, so list data must nest one level
deeper — layout is `accounts/{id}/quickbooks/{invoices,payments,syncLogs}/items/{docId}`
and `quickbooks/{customer,arSummary}` as plain docs. Even/odd segment
counts on db.doc()/db.collection() throw at runtime, and callables
surface it as an opaque "INTERNAL" toast.

Live verification: Venuesmart LLC National (m1JEJs8YPohuXTQVjVQp) mapped
to QBO customer "Venue Smart" — per-account A/R $549,409.96 reconciles
exactly with the company AgedReceivables row; invoices show
overdue/paid status; payments resolve applied-invoice doc numbers.
Total company A/R at ship: $963,975.12 across 22 customers.

**Remaining:** map the other ~21 customers to HRX accounts (Greg, via
each account's Invoicing tab — dashboard mapping-health chips show
unmapped balances); Phase 4 webhooks, invoice creation from timesheets
(assignment billRate feeds it), AI collections assistant.
Related: [[project_expensify_card_pipeline]], [[project_assignment_backbone_review]].
