# HRX Invoicing Module — Cursor Build Spec

## Objective
Create the first shell of a new **Invoicing** area in HRX.

This is an internal product scaffolding step. We are **not** building the full QuickBooks sync yet. We are building:

1. A new **main menu item** for Invoicing
2. Access restricted to users with **securityLevel 5, 6, or 7**
3. A new **Invoicing layout/page** using existing HRX header and table design conventions
4. The ability to **create an invoice inside HRX**
5. A table to **view created invoices**
6. Placeholder fields for future QuickBooks sync-back status

The long-term architecture is:

- HRX generates and validates invoice data
- HRX pushes invoices into QuickBooks
- QuickBooks remains the accounting / delivery system of record
- QuickBooks syncs invoice status back into HRX

We are **not** building the QuickBooks API portion yet. This phase is only the HRX-side shell and invoice lifecycle foundation.

---

## Product Direction

### Do not do either of these:
- Do **not** require staff to manually build invoices inside QuickBooks
- Do **not** make HRX the final accounting-only sender with no accounting sync

### Correct architecture
- HRX creates the invoice draft using staffing-specific business logic
- HRX stores and displays the invoice inside HRX
- Later, HRX will sync/publish the invoice to QuickBooks
- QuickBooks will handle official accounting records, delivery, and payment reconciliation
- QuickBooks statuses will sync back into HRX

This means HRX should become the **operational billing brain**, while QuickBooks remains the **official accounting system**.

---

## Scope for This Phase

### 1) Main menu item
Add a new **main navigation menu item**:

- Label: `Invoicing`
- Icon: `$`-style finance icon (choose a clean icon consistent with current nav icon language)
- Placement: add to the main left navigation in a logical place near account / operational tools
- Visibility: **only show for users whose `securityLevel` is 5, 6, or 7**

Use existing role/security utilities already used elsewhere in HRX.

If the app uses route guarding as well as hidden nav items, implement **both**:
- Hide menu item for unauthorized users
- Protect the route from direct access

---

### 2) Invoicing route / layout
Create a new top-level page / route for the Invoicing module.

Use the **existing HRX page shell, header, spacing, action bar, and table design standards** already used on other layouts.

Do **not** invent a new visual language.

This page should feel like an existing HRX admin module.

Use:
- existing page header pattern
- existing card/container system
- existing table styling
- existing filter bar patterns if applicable
- existing empty-state styling

---

### 3) Initial Invoicing page structure
The first version of the Invoicing page should contain:

#### Header area
- Page title: `Invoicing`
- Short subtitle/description, something like:
  - `Create, review, and track HRX invoices before accounting sync.`

#### Primary action
- Button: `Create Invoice`

#### Main content
- Invoice table showing HRX-created invoices
- Empty state if no invoices exist yet

---

## Create Invoice — initial implementation
We do not need the final full billing engine yet.

For now, implement a practical HRX invoice creation flow that stores invoice records in Firestore.

### Minimum create flow
Allow a user to create an invoice with at least:

- Invoice number
- Account / customer reference
- Invoice date
- Due date
- Total amount
- Notes (optional)

Keep this lightweight and future-friendly.

This can be:
- a modal
- a drawer
- or a full detail page

Choose the pattern that best matches existing HRX create flows.

### Creation requirements
When a new invoice is created, store enough data to support both:
- current HRX display
- future QuickBooks sync

---

## Invoice table requirements
Create a table of HRX-created invoices.

For now, the table should support the following visible columns:

- **Invoice Number**
- **Sent Status**
- **Due Date**
- **Balance**
- **Payment Status**

These are intentionally aligned with the future synced QuickBooks view.

### Suggested additional internal columns if useful
You may also include:
- Account / customer
- Invoice date
- Total amount
- Created by
- Created at

But the five required fields above must be present.

### Placeholder behavior
Because QuickBooks sync is not live yet:
- `Sent Status` can default to something like `Draft` or `Not Sent`
- `Balance` should initially equal total amount
- `Payment Status` can default to `Unpaid`

Later, these values will update when QuickBooks sync is implemented.

---

## Invoice lifecycle states to support now
Build these states into the data model now so we do not have to refactor later.

### HRX invoice lifecycle
Recommended `hrxStatus` values:
- `draft`
- `ready`
- `published`
- `void`

### Delivery / send status
Recommended `sendStatus` values:
- `not_sent`
- `queued`
- `sent`
- `delivery_failed`

### Payment status
Recommended `paymentStatus` values:
- `unpaid`
- `partially_paid`
- `paid`
- `overdue`
- `void`

### Sync status
Recommended `quickbooksSyncStatus` values:
- `not_connected`
- `not_synced`
- `sync_pending`
- `synced`
- `sync_error`

Even if some of these are not yet used in UI, define them now.

---

## Firestore recommendation
Create a first-pass collection structure that is simple and future-safe.

### Suggested collection
```text
invoices/{invoiceId}
```

If the app already prefers tenant-scoped or company-scoped storage, match existing architecture. If appropriate, a nested path like this is also acceptable:

```text
tenants/{tenantId}/invoices/{invoiceId}
```

Use the project’s existing data model conventions.

### Required fields
Each invoice document should include at minimum:

```ts
{
  id: string;
  invoiceNumber: string;
  accountId: string | null;
  accountName: string | null;
  invoiceDate: Timestamp | null;
  dueDate: Timestamp | null;
  totalAmount: number;
  balanceAmount: number;
  hrxStatus: 'draft' | 'ready' | 'published' | 'void';
  sendStatus: 'not_sent' | 'queued' | 'sent' | 'delivery_failed';
  paymentStatus: 'unpaid' | 'partially_paid' | 'paid' | 'overdue' | 'void';
  quickbooksSyncStatus: 'not_connected' | 'not_synced' | 'sync_pending' | 'synced' | 'sync_error';
  quickbooksInvoiceId?: string | null;
  quickbooksRealmId?: string | null;
  sentAt?: Timestamp | null;
  lastSyncedAt?: Timestamp | null;
  syncError?: string | null;
  notes?: string | null;
  createdBy?: string | null;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
}
```

### Important identifier note
For HRX internal references, use the **HRX / Firestore document ID** as the canonical invoice ID.

Do **not** use a QuickBooks invoice ID as the primary key.

For account linkage:
- use the **HRX Account Firestore document ID** as the canonical internal account identifier
- later store QuickBooks mapping values separately

---

## Invoice number guidance
For now, support manual or generated invoice numbers.

If easy, implement a generated format such as:

```text
INV-1001
```

or a project-standard numbering format.

Keep the invoice number editable only if that matches your existing patterns.

---

## UI behavior
### Empty state
If no invoices exist:
- show a clean empty state
- message example: `No invoices created yet.`
- include CTA: `Create Invoice`

### Table behavior
Use the existing HRX table spec and interaction style used elsewhere in the app.

Include if already standard:
- sorting
- pagination
- row click to view details (optional for now)

### Status styling
Use chips / pills / badges consistent with the rest of HRX.

Examples:
- Draft
- Not Sent
- Unpaid
- Synced
- Sync Error

---

## Permissions
The new Invoicing module should only be visible and accessible to users with:
- `securityLevel` 5
- `securityLevel` 6
- `securityLevel` 7

Apply this to:
- menu visibility
- route protection
- create invoice action

If read-only roles are added later, we can expand the matrix later.

---

## Non-goals for this phase
Do **not** build these yet:
- QuickBooks OAuth
- QuickBooks customer mapping
- QuickBooks invoice creation API calls
- invoice resend through QuickBooks
- AR aging dashboard
- payment sync
- consolidated billing logic
- time-to-invoice automation
- PDF invoice rendering

We only want the shell, creation flow, table, statuses, and Firestore model.

---

## Future QuickBooks integration direction
When we do connect QuickBooks later, the intended workflow is:

```text
HRX creates invoice
→ user validates invoice in HRX
→ HRX pushes invoice to QuickBooks
→ QuickBooks sends invoice to customer
→ QuickBooks syncs sent status / balance / payment state back into HRX
```

That is why the table should already include:
- invoice number
- sent status
- due date
- balance
- payment status

Those are the eventual user-facing operational billing fields.

---

## Suggested implementation approach
### Suggested first files / areas to update
Use project conventions, but likely something along these lines:

- main navigation config / sidebar component
- route registry
- permissions / guard utilities
- new invoicing page component
- invoice create modal or drawer
- Firestore types / schema definitions
- invoice service / data hooks

### If there is already a pattern for modules
Mirror the structure used by existing major modules.

---

## Acceptance criteria
This phase is complete when:

1. A new **Invoicing** main menu item exists
2. It is visible only for users with `securityLevel` 5, 6, or 7
3. Clicking it opens a new Invoicing page using standard HRX layout/header/table styles
4. Users can create an invoice in HRX
5. Created invoices appear in a table
6. The table displays at minimum:
   - invoice number
   - sent status
   - due date
   - balance
   - payment status
7. Invoice documents are stored in Firestore with future QuickBooks sync fields included
8. Unauthorized users cannot access the route directly

---

## Final architecture note for Cursor
Please keep the implementation intentionally clean and expandable.

This feature is the beginning of a larger billing architecture where:
- HRX owns invoice generation and operational validation
- QuickBooks owns accounting and customer delivery
- status sync flows back into HRX

Do not overbuild QuickBooks integration now. Build the HRX billing shell correctly so the integration can land cleanly in the next phase.
