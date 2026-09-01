# QBO class cleanup + VenueSmart PO automation (2026-08-31)

Working session with accounting (Greg screen-sharing the artifact:
https://claude.ai/code/artifact/27e6929c-7ec6-41e9-a079-cd27b8652904).
Headline from the live P&L-by-class pull: **~$2.22M of YTD P&L activity had
no class** (income −$509K / COGS $1.20M / expenses $513K — 60% of COGS
unclassed), plus $1.22M sitting directly on the "Venue Smart" parent class.

## Decisions made (Greg + accounting)

- **Venue Smart parent:child tree STAYS** — the P&L "Total Venue Smart"
  column already rolls per-event subclasses into a client total (Greg
  initially said "roll subclasses into the parent"; what he wanted was the
  rollup VIEW, which QBO's Collapse/Expand toggle already provides). Nothing
  was flattened.
- **COTA family**: NASCAR @ COTA = its own class (`Venue Smart:Nascar`);
  F1 @ COTA = its own class (`F1 COTA`, created on first PO); everything
  else at COTA (concerts, monthly cleaning) = `Venue Smart:COTA`. NASCAR
  city variants keep their classes; **NASCAR Phoenix is VenueSmart CORP**
  (separate entity, class `VenueSmart Corp:Nascar Phoenix`) — the two
  Venuesmart entities never roll together.
- JE `Rev 063026` ($534,732 "move Venue Smart rev from 4200") = GL
  renumbering artifact — stays at parent, nothing to split.
- Mazzella trust deposit $100K (Deposit #4674) = **investor money wearing a
  customer class** — Tabitha to strip it.
- KS Venue Credits (~$146K deposits) = customer prepayments — parent until
  applied to invoices.
- Non-factored-revenue invoices (17 / $129,906) stay at parent by design.

## Executed 2026-08-31 (all snapshot-first, totals verified unchanged)

- `Venue Smart:Florida State Fair` created + mapped; $101,342 invoice moved.
- #60600100 ($34,844) → Suenos (Greg via UI; verified via API).
- `VenueSmart Corp` + `VenueSmart Corp:Nascar Phoenix` created; both Phoenix
  invoices ($43,968) moved out of the LLC tree; the misplaced LLC subclass
  deactivated; HRX mapping transplanted.
- 9 memo-matched invoices executed ($50,445).
- 6 NASCAR invoices corrected COTA→Nascar ($34,120) after Greg's family
  ruling — my first-pass alias had sent them to COTA.
- **PO email backfill**: 56 emails → **37 event classes created**, 12
  matched existing, PO→class ledger seeded (~49 rows).
- `/reports/qbo-classes` gained a From/To date range (was hardcoded YTD).
- Unclassed-income drill-down: the −$509K = JE `Rev 063026` unclassed debit
  legs (−$615.6K) + 46 invoices with NO class (+$106.6K). JE fix waits on
  Tabitha: what fed the 4200 balance (classed 2026 / unclassed / prior-year)?
- **RS3 = Proof of the Pudding (Greg ruling)** — RS3 was the old name. Merged:
  55 transactions / $183,057 reclassed RS3→`Proof of Pudding`, plus the 5
  RS3-customer unclassed invoices ($15,272); `RS3` and `Dell Diamond Cooks`
  classes deactivated after emptying; mappings cleaned. This also explains JE
  line 4 ("RS3 rev" classed Proof of Pudding — class was right, label old).
- Sodexo (12/$13,404) and G6 (2/$672) unclassed invoices classed by customer.
  HOLDS: Indeed Flex 13/$7,700 (Greg), Venue Smart 14/$69,595 (PO export).
- Mazzella deposit (Id 4674): Venue Smart class stripped, $100K, verified —
  account side (capital vs revenue) left for Tabitha.

## The VenueSmart PO automation (live)

`functions/src/integrations/quickbooks/venuesmartPoClasses.ts`, riding
**inboxTriageCron** (no new function — Cloud Run cap). VenueSmart emails POs
from their QBO (`From: quickbooks@notification.intuit.com`, `Reply-To:
angie@venuesmartllc.com`, subject `Purchase Order from VenueSmart LLC -
{event} - {venue}`, body `Purchase Order # : NNNN`). Sweep parses, routes by
family rules, dedupes by normalized containment ("FIFA KC Fan Fest WWI" →
existing "FIFA KC", never a sibling), creates class + authoritative HRX
mapping, ledgers `tenants/{t}/venuesmart_po_classes/{poNumber}` and
`venuesmart_po_email_ledger/{messageId}` (idempotent). Sender spoof-guard;
Greg's own forwards correctly fail it. Scoped `after:2026/01/01`. Kill
switch: `integrations/inboxChiefOfStaff.venuesmartPoSweep === false`.
18 parser/matcher tests.

## ☠️ Footguns learned

- **QBO Advanced custom fields are INVISIBLE to the v3 REST API** —
  `CustomField: []` even when the UI shows a populated PO field. The PO/
  Worksite fields on C1's invoices are Advanced custom fields. No API route;
  a report export (Invoice List + PO column → CSV) is the extraction path.
- **Invoice PO strings end in HRX jobOrderNumbers** ("FIFA KC Fan Fest WWI
  #2150" — the #2150 is jo.jobOrderNumber, NOT VenueSmart's PO number,
  which runs ~1200). A PO-column CSV therefore joins invoice → HRX JO →
  mapped class deterministically.
- QBO query language: `ParentRef` is not selectable (`SELECT *` instead);
  `Name = 'x' AND Active IN (true,false)` → QueryProcessingError; entity
  queries return the QueryResponse directly from our `qboQuery` (read
  `res.QueryResponse?.X ?? res.X`).
- Reclass pattern: fetch full entity → rewrite line `ClassRef` only →
  `qboEntityUpdate` with the full Line array + `sparse:false` → verify
  TotalAmt unchanged. Class edits never touch payment linkage. Renames are
  free (ID-based); there is no delete, only deactivate, and only AFTER
  reclassing.
- A QBO P&L has Income / **COGS** / Expenses groups — auditing "Expenses"
  alone misses the payroll money (COGS was 60% unclassed).

## Open

- 58 invoices / $303,490 still on the bare VS parent: 17 stay (non-factored),
  16 + 25 wait on **Greg's PO-column CSV export** for deterministic matching.
- ~~VS Texas Home Office~~ resolved (Greg 2026-08-31): stays a normal
  Venue Smart subclass like any event — already created/mapped that way.
- Phase 3 (drain the $2.22M Not-Specified pool: −$509K unclassed income needs
  a transaction drill-down), Phase 4 (wire-split journal push), Phase 5
  (QBO "warn on unclassed transaction" setting + invoice auto-classing —
  the venuesmart_po_classes ledger is the lookup for auto-classing).
- Domino's ($0 classed, 37 JOs) and Sodexo ($28.9K classed, 204 JOs) revenue
  location unknown — likely in the unclassed pool.

Related: [[project_qbo_invoicing]], [[project_payroll_cost_attribution]].
