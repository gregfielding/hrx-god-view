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

## PO-grid reclass (2026-08-31, evening — the pipeline closed)

The QBO invoices GRID (Sales → Invoices, gear → PO column) displays the
Advanced custom field the API and classic reports cannot see. Read via
Greg's logged-in Chrome (claude-in-chrome, read-only + pagination), 594
invoices/6 pages → complete Num→PO map. NOTE: the classic "Invoice List"
report's Purchase Order column exports EMPTY — only the grid shows it.

Executed off that map: **20 invoices / $80,206** reclassed to event
subclasses (zero unresolved); renames `20226 LIV Golf INDY`→`2026 LIV Golf
Indy` and `Obama Presedential`→`Presidential`; `26 USGA Women's Open`
re-parented under Venue Smart; 5 new event classes created (Rolling Loud
Orlando, IPW/VIP Beach Party, Motionless in White, Coral Reefer Band,
LIV Golf VA). Invoice PO strings mix VenueSmart email PO numbers (#12xx —
resolvable via venuesmart_po_classes) and another #21xx-#22xx series; the
event NAME is the reliable key either way.

**Terminal state of the VS parent pool**: 17 non-factored (stay) + 21
parent-classed + 14 unclassed pre-May invoices (~$163K) whose PO fields
are genuinely EMPTY — PO discipline began May 2026; only Rosa/Angie can
assign those from memory. Bonus: **AEG Oakland invoices carry per-event
POs too** ("Summer Walker 6.28.26") — same treatment available when the
Legends/AEG tree is settled.

## Legends/AEG tree settled (2026-08-31, Greg ruling)

**Legends = top level, Oakland = its subclass, AEG merged into Oakland.**
Executed: `AEG:Legends` (the empty $0 class) PROMOTED to top-level `Legends`
(drop ParentRef + SubClass:false); `Oakland` re-parented under it — kept its
class Id (784543) so the HRX mapping survived, fqn refreshed to
`Legends:Oakland`; **100 transactions / $219,407** swept AEG→Oakland
(invoices, the $33K JE leg, ~90 small purchases, deposits — snapshot-first,
totals verified); `AEG` deactivated after emptying; its (absent) mapping
cleaned. ☠️ QBO renames deactivated entities to "Name (deleted)" — exact-name
lookups miss them afterward. Verified: 0 AEG-classed lines remain in 2026.
Future option on file: AEG Oakland invoices carry per-event POs
("Summer Walker 6.28.26") if per-event subclasses under Oakland are ever
wanted.

## The 4200 JE fixed (2026-08-31, Greg approved after investigation)

Greg's GL-reorg explanation checked out and the line-level investigation
settled the rest: 4200 ("Staffing Revenue — Recurring") received $1.31M of
invoice revenue Jan–Jun; when Tabitha wrote `Rev 063026` those invoices were
largely UNCLASSED, so her classed credit legs WERE the classification. But
today's invoice-level classing (PO reclass, RS3 merge, AEG merge)
reintroduced the same classes on the invoices — making her JE a pure
double-count (+$535K VS, +$48K PoP, +$33K Oakland).

Fix executed: the three unclassed DEBIT legs classed to mirror their credits
(Venue Smart / Proof of Pudding / Legends:Oakland — the AEG credit had been
merged to Oakland hours earlier). Verified: every class nets to 0.00 within
the JE; the ±$273,898.65 self-canceling pair left as-is.

**P&L result: Not-Specified INCOME went from −$509,048 to +$77,220** — which
is exactly the remaining known unclassed pool (14 pre-May no-PO VS invoices
$69,595 + 13 held Indeed Flex $7,700). The income side of the books now
reconciles precisely to the open-items list. Remaining Not-Specified is COGS
$1.2M + Expenses $513K = the wire-split push (Phase 4).

## Indeed Flex channel decomposed (2026-08-31, Greg's portal CSV)

**SBUS-numbered "Indeed Flex Inc" invoices are agency-channel billing for
OTHER clients** — the Flex portal export (agency-invoices CSV) maps each
SBUS invoice to its true end client. Reclassed the 2026 book accordingly:
**CORT $124,653** (WBI/Woodridge warehouses etc.), **Domino's $13,249** —
which SOLVES the "Domino's has 37 JOs but $0 classed revenue" mystery (it
was riding the Flex channel) — plus ORS Nasco, Carrier, Continental
Battery, Hyatt, and a new `Purolator International` class (created+mapped).
Residual: 26 C1-issued 606xxxxx April weeklies ($7,700) have no venue text
anywhere — they stay on the `Indeed Flex` class as the honest channel-level
residual (class kept active for exactly this purpose). Curiosity for the
Austin question: $7,894 of Flex lines were already classed `Austin`.

**Tree correction (Greg, same evening): Indeed Flex is a PARENT class** —
same shape as Venue Smart. All seven client classes re-parented under it
(`Indeed Flex:Cort`, `:Domino's`, `:ORS Nasco`, `:Carrier Enterprise`,
`:Continental Battery Systems, Inc.`, `:Purolator International`,
`:Hyatt Hotels Corporation`) — class Ids unchanged so the day's
reclassifications and HRX mappings survived; fqns refreshed.
`Indeed Flex:Mattress Firm` created (named by Greg; in the portal's
11-client list). `Indeed Flex:OnTrac` created and mapped to the HRX OnTrac account (Greg —
the ramping account bills through Flex too). The portal lists 11 clients
total — remaining ones get
subclasses as their invoices appear. The $7,700 channel residual sits at
parent level, mirroring the VS convention.

## The 14 pre-May VS invoices — email forensics verdict (2026-08-31)

Greg's Gmail was scanned end to end for the era: PO emails (ledgered),
Angie's remittances, and the weekly billing threads. Findings:
- Mark's PDF-per-event batch process **began 5/13** ("Invoices Moving
  Forward" thread — where Angie also first asked for PO numbers). The 4/26
  and 5/3 batches predate it (Lone Oak/TempWorks payment era).
- Angie's "Invoices Paid" (5/1) and "C1 Paid Invoices 5/6" carry AP
  SCREENSHOTS (read via Gmail attachment fetch + vision): they confirm all
  14 invoice numbers/amounts and the "dba Lone Oak Payroll" routing — but
  **contain no event names**. (Side detail: VenueSmart's AP amounts run
  $1–9 under QBO's — their Connecteam per-user fee deductions.)
- **Conclusion: the invoice→event link for these 14 exists only in Mark's
  Connecteam exports / memory.** He billed them weekly from Connecteam
  reports. Punch list (2 batches: 4/26 ×5 incl. the $42,154 one; 5/3 ×9)
  goes to Mark; candidate events that fortnight: Texas MotoGP, Austin Blues
  Fest, SRO GT, Pop Up Picnic, Lamb of God, Urban Music Fest, plus the
  Moody concert run (Don Toliver/Subtronics/Mau P/Junior H/Miguel).
  Do NOT guess amounts into the books.

## Austin decoded + retired; Flex invoice mirror shipped (2026-08-31, late)

**Austin was a GEOGRAPHY class** (the Austin, TX branch — early-year scheme),
not a client; the mapping page's "Harmony Charter" suggestion was name-match
noise. Zero mixed-class docs, but its revenue was client work classed under
the location: reclassed **91 txns / $232,558** → Proof of Pudding $125,015
(the RS3-family Austin venues: Dell Diamond, Kizer & Crystal, H-E-B Center),
Contigo $91,389, Indeed Flex $7,894, G6 $4,317, Black Caviar $3,944 — zero
revenue left. Class deactivated per Greg. Residue: ~$25.6K of Austin-branch
EXPENSES (airfare/Uber/fuel/Craigslist/vendors) remain on the inactive class
("Austin (deleted)" in reports) — optional later sweep to `National`
(overhead) if wanted.

**Flex invoice mirror** (the Fieldglass/Sodexo pattern, Greg's ask): new
`mirrorFlexInvoices` action on savePayrollVenueMapping + a "Mirror Flex CSV"
upload on /reports/qbo-classes (dry-run confirm → execute). Finalized portal
rows missing in QBO are created (customer Indeed Flex Inc, item "Staffing",
venue as description, class `Indeed Flex:{client}`, new-client subclasses
auto-created); existing ones amount-verified + class-fixed; UPCOMING/pre-2026
skipped; idempotent by DocNumber. Weekly ritual: download agency-invoices CSV
→ drop on the button. Replaces Mark's manual keying (12-day lag observed).
Flex emails carry NO billing notifications (checked) — CSV is the only feed.
`Indeed Flex:OnTrac` + `:Mattress Firm` pre-created for the ramp.

## Phase 4 SHIPPED — wire allocations push to QBO (2026-08-31, late)

The census that unlocked it: Everee wires land as UNCLASSED bank-feed
Purchases to "Everee Inc." on 5010 Direct Labor ($1.52M of 2026 postings —
singles up to $157K). **Tabitha had already validated the fix pattern by
hand**: her July "EV Pay Alloc 0701/0708/0716" JEs credit 5010 unclassed and
debit classed lines — built from the /payroll-costs worksheets. That was the
"month of manual validation" the original P4 plan required.

Built: `pushWireAllocations` action on savePayrollVenueMapping + a **"Push
to QBO"** button on `/reports/payroll-journal` (dry-run confirm → execute).
Per wire: one reallocation JE (DocNumber `EV Alloc {MMDD} {ENT}`, ≤21 chars)
crediting 5010 unclassed for the wire amount and debiting 5010 per class
from buildWireJournal's penny-exact splits; unattributed remainder stays
honestly unclassed. Idempotent: skips wires with an existing allocation JE —
matched by DocNumber OR any existing 5010-unclassed JE credit within $1 of
the wire (catches Tabitha's July entries).

**Next step is Greg's click**: /reports/payroll-journal → pick range (May–
Aug) → Push to QBO → review the dry-run list → confirm. Expected effect:
the $1.2M Not-Specified COGS drains into classes; Oakland/VS/Sodexo Direct
Labor becomes real; gross margin by client is finally answerable end to end.
Go-forward: run after each week's wires (or automate onto a cron later).

## Wire-push preview verified + Expensify closed the loop (2026-08-31, final)

**Preview (Greg's ask)**: buildWireJournal May–Aug = 105 wires / $1.52M,
4.5% unattributed. `Legends:Oakland` receives **$143,288** — the missing
Oakland payroll, answered. First preview exposed ~$536K of label→class
misses after the restructure (apostrophes, "FIFA Fan Festival Kansas City"
vs "FIFA KC", RS3-family names, role-only Flex labels); fixed with
WIRE_LABEL_ALIASES + punctuation-insensitive matching in resolveClassFqn —
now only 2 labels / $774 unresolved ("Sips and Sounds Dishwasher",
"Housekeeper - Chantilly"). No QBO sync needed — classes live there already;
only the resolver needed to learn the new names. Also finished the duplicate
top-level Minnesota pair (3 of Tabitha's July JE lines corrected to
`Venue Smart:MN Yacht Club`; pair deactivated).

**Expensify**: the EXP-6 write-back (workers' tags → QBO Purchase classes,
daily 06:30) was already live, but the workspace TAG LIST was hand-kept and
stale. New `pushQboClassesAsExpensifyTags` replaces it with the live active
class FQNs — runs before each daily write-back + on demand. First push: 105
tags to the production workspace; write-back re-run: 302 expenses, 113
already classed, 0 stale reversals (deactivated classes can't resolve, so
old tags can never undo the merges), 1 legacy "Minnesota Yacht Club" tag
outstanding.

**The P&L-by-class accuracy stack, end state**: revenue classed (done
today) · payroll COGS = Greg clicks Push to QBO on /reports/payroll-journal
(May–Aug, dry-run first) · card expenses = tag picker now mirrors the books
with a daily loop · residual = ~$69K honestly-unattributed wire remainder +
non-card unclassed expenses for Tabitha.

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

## Phase 4 execution (2026-08-31 evening)

**June–Aug pushed, May held (Greg's call).** Greg ran Push to QBO on
/reports/payroll-journal for 2026-06-01→2026-08-31: expect 77 JEs /
~$1.10M, 16 wires skipped (Tabitha's July "EV Pay Alloc" JEs), $2,496
unattributed remainder. Two deploy-blocking fixes shipped first, both in
`payrollCostReport.ts` (pair-deploy all 8):

- **`AcctNum` is NOT queryable in the QBO v3 API** — the 5010 lookup now
  fetches COGS accounts and filters locally (58311e1f). The account is
  "Direct Labor — Field Staff" (Id 73).
- **Wire-label aliases now apply to raw earning notes** as a last resort
  after `resolveVenueText` misses (65b7c11e). Notes like "LIV Golf VA -
  35 Hours", "Dallas Fifa W/E 5.31", "7 Hours G6", "COTA Cleaning" were
  falling to Unattributed because the token resolver only knows
  JO/account/venue-mapping names. WIRE_LABEL_ALIASES hoisted above the
  payment loop; new entries: bare `\bcota\b` (after NASCAR, = year-round
  COTA class), LIV Golf VA/Indy, bare `\bg6\b`, reversed "Dallas Fifa".
  `unattributedDetail` cap 200→500.

**May punch list for Mark** (section G on the artifact): $64,446
unattributed across 235 payments / 181 workers, top 25 workers = $26.4K.
Mark names each worker's May event → `payroll_class_overrides` docs
(`{kind:'worker', workerName:'Last, First', class:'<leaf or FQN>'}`) →
reload May → push. Overrides beat every heuristic. The ~156-worker tail
(~$240 avg) stays unattributed by agreement. Unknown label: "BTS - 23.5
Hours" (Vargas, Karol). June–Aug JEs carry their own $2.4K remainder
inside posted JEs — patching those means editing JEs, only worth it if
Mark's answers cover them.
