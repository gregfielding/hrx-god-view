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

## Phase 4 incident + remediation (2026-08-31 late night)

**The first live June–Aug push silently skipped 26 wires / $525K.** The
dialog said "Created: 54 · Skipped: 39" — 23 more skips than the dry-run
predicted. Two causes in the original idempotency: DocNumber `EV Alloc
{MMDD} {ENT}` is only unique per day+entity (multi-wire days collapsed —
7/31 had five C1 Select wires), and the "any unclassed 5010 credit within
$1" heuristic false-matched across unrelated wires. Worse, it also
DOUBLE-created 3 JEs that Tabitha's month-end "EV Pay Alloc" batches (all
dated 7/31, up to 30d after their wires, amounts a few $100 off current
Everee data) already covered.

**Also found: Everee pagination was nondeterministic** — the payment walk
broke on the first page with no fresh items, and with Everee actively
syncing (voids/corrections landing same evening), items shift across page
boundaries mid-walk: wire totals drifted ±$300 run-to-run. Fixed: walk
every page to totalPages.

**Remediation executed (scratch, snapshot-first):**
- Every allocation JE (54 mine + Tabitha's 17, minus deletions) now
  carries `[wire:{fundingId}@{ENT}]` in PrivateNote — exact idempotency
  keyed on Everee's stable companyFundingId. 70 tagged; her `EV Pay Alloc
  0715` covers BOTH 7/15 wires (22,046.12+206.72=22,252.84 exactly) and
  got two tags; her 0723 #2 covers the 7/24 SEL wire (dated a day early).
- Deleted my 3 duplicates of her JEs (0708 SEL / 0713 SEL / 0715 EVT,
  $26,762.41; backups in .scratch/backup_deleted_je_*.json).
- Created the 22 truly-missing JEs ($233,126.30), incl. the $128,751.89
  `[wire:none@EVT]` aggregate (payments with NO companyFundingId, lumped:
  P&L-correct, not bank-line-matchable).
- **Flex subclass fix**: Indeed Flex channel job orders have role-y names
  ("Warehouse Associate") — buildWireJournal now labels them by the JO's
  ACCOUNT (Cort, Domino's, ORS Nasco, Carrier, Continental, Purolator,
  Hyatt, Mattress, OnTrac) so labor lands on Indeed Flex:{client}. ~$45K
  of parent-classed Flex debits repatched across 15 of my JEs (recomputed
  full splits, credit untouched, balance verified).
- Final verify: 93/93 June–Aug wires tagged, 0 untagged, all JEs balanced.

**Left for Tabitha (bank rec)**: 3 JEs whose Everee wire total moved AFTER
posting (0806 EVT, 0820 EVT, 0730 EVT — deltas $105–$1,304, late voids/
corrections; the JE credit should match the actual bank wire, so hers to
adjudicate). ~$2.4K parent-Flex debits inside her own 3 July JEs left
untouched. The callable now reports `allocated_amount_drift` rows with the
delta instead of hiding drift; `[wire:none@…]` aggregates that grow later
surface the same way.

**Rule for future pushes**: never push a wire dated within the last ~3
days — Everee keeps attaching corrections to fresh fundings (the 8/31
wires changed twice during this session).

## Attribution audit + logic revision (2026-09-01)

Greg asked to audit HOW the CFO wire report applies classes. buildWireJournal
now returns `attributionAudit` — every dollar tagged with its resolution
method. June–Aug ($1.41M): 63.9% note_dates_x_index (structured notes with
ISO dates × timesheet/assignment index — the gold path), 15.0%
payment_override (Greg's 8/14 CSV, per-payment, precise), 10.5%
note_venue_text, 7.9% sole_assignment_class, 2.2% note_alias, 0.5%
worker_override, 0.1% unattributed. May: 58.5% unattributed (the Mark punch
list), 30.4% worker_override (the CSV describes exactly that era).

**Logic flaw found and fixed**: payroll_class_overrides holds 1,037 docs
(source `greg_filled_csv_2026-08-14`): 714 payment-kind + 323 worker-kind.
Worker-kind docs were TIMELESS TRUMPS — a worker marked "Oakland Arena" in
the CSV had every later payment forced to Oakland even after moving
events (~$255K of June–Aug steered this way). Demoted: worker-kind now
only answers what the pipeline can't otherwise resolve; payment-kind
stays absolute. 37 posted JEs repatched.

**Resolution chain (current)**: payment_override → JO# note tag → note
ISO-dates × index → sole-assignment-class for the period → note venue
text → note alias → worker_override → period day-split → unattributed.
Index = timesheets (any non-rejected status incl. draft) overlaid with
assignment date-ranges (userId/accountId/startDate..endDate); JO labels =
account-kind mapping (qbo_class_mappings targetKind=account, unique
accountId) → ACCOUNT_CLASS_RULES regex → JO name.

**Durable rule**: every dollar paid should carry account+JO at payment
creation (JO# tag or ISO dates in the Everee note is what feeds the gold
path). The pay flow should enforce that — the report can only recover
what was recorded.

## Steady state reached — June 1 forward (2026-09-01)

Greg's rulings: **May de-scoped** (~$62K stays unattributed, May never
pushed); pre-Everee (Jan–Apr, TempWorks/Lone Oak) ignored; focus June 1
forward. The last 6 unclassifiable June+ payments ($1,141.54) were
classified by Greg in chat → payment-kind overrides
(source `greg_chat_2026-09-01`): Gaymon→Cort, Sutton→Suenos,
Fajardo→Pokemon GO, Hill→Cort, Murray→FIFA KC, Duran→MN Yacht Club.
**June 1 forward is now 100% attributed.** Affected JEs patched.

The durable system:
1. **Anchors at source**: batch worked-shifts, off-cycle payables, and
   adjustment payables all stamp `JO#<n>` and/or the ISO work date into
   the Everee note. **Job order is REQUIRED on off-cycle payments**
   (backend rejects; both forms block; ticket corrections derive the JO
   from the worker's timesheet for that date).
2. **Nightly ledger freeze**: `maybeRunDailyLedgerFreeze` rides
   reconcileTimesheetBatchesCron (once-per-day function_runs claim,
   cron now 1GiB); freezes fully-resolved payments ≥3 days mature into
   `payroll_payment_attributions`. Frozen shares are the attribution of
   record; only a payment-kind override supersedes.
3. **QBO push**: wire-tag idempotent; drift surfaces as
   `allocated_amount_drift` rows (0730/0806/0820 EVT still flagged for
   Tabitha — Everee keeps adjusting those wire totals).

Remaining human loop: monthly Push to QBO click + any new unattributed
rows in the report (rare — payments made directly in Everee's UI).

## TempWorks-straddle pattern (2026-09-01, Continental Battery pilot)

Clients whose season crossed the TempWorks→Everee cutover show QBO revenue
with no 5010 labor — the wage cash left via TempWorks (Everee holds only
$0 IMPORTED stubs; e.g. Demetrius Lewis (FL), Continental 4/27–5/16).
Fix pattern: a "TW Alloc {client}" JE — debit 5010 classed to the client,
credit 5010 unclassed, wages derived from the client invoices at the
assignment's pay/bill ratio. Pilot: JE 8800 "TW Alloc Continental"
$1,521.11 (80.06 hrs × $19; SBUS 32800/33725/34093 ÷ $26.22 bill rate).
JE carries a [wire:...@MANUAL] tag so its unclassed credit can't
false-vouch in the push heuristic. NOTE: two DIFFERENT workers named
Demetrius Lewis exist (FL b.1990 / Chicago b.1980) — NOT duplicates.

## Revenue-account rule + screening allocation (2026-09-01 afternoon)

**4100/4200 rule (Greg)**: 4200 Recurring = ONLY Sodexo + Indeed Flex
family; everything else = 4100 Events & Venue. Nearly every QBO item maps
income to 4200, so ~$2.2M of events-family revenue misposted YTD. Fix =
monthly idempotent JE (Rev Reclass MMYY, [revrc:YYYY-MM] tag): debit
4200 / credit 4100 per class, months ended ≥3d only, unclassed lines
skipped. Jan–Jul backfilled ($1.56M / 7 JEs); Aug+ auto-post via the
weekly health run. Items untouched (shared by Sodexo/Flex mirrors) —
item hygiene = later cleanup with Mark; invoice drill-downs still show
the item's 4200 until then, but P&L is correct.

**Screening allocation**: AccuSource charges (vendor 191, billed to 5010
unclassed) → Scrn Alloc JEs: credit 5010, debit 5300 per class; each
screen classed by order JO/client, else worker's first assignment
(−7d grace), else National (~74% never assigned = pipeline overhead).
[screen:{purchaseId}] tags, 35-day maturity, auto-runs weekly. Six 2026
charges backfilled ($7,558).

**Verification page** now has batch "Apply to all N" (toast after any
save — applies the class to every flagged row sharing the guess,
resolveClassificationFlags action).

## Expense recon page + merchant rules (2026-09-02/03)

- /reports/expense-recon: Uncategorized + Categorized tabs, date range,
  auto-save account AND class pickers (class = its own editable column,
  per line — category and class are different things), JE rows included
  (`je_` ids). Saving a rule applies it live immediately and greys
  matching rows — no second click.
- Rules (`tenants/{t}/qbo_merchant_rules`): word-boundary match on parsed
  merchant; `matchDescriptor: true` also tests entity+note+line text —
  the only way to split same-merchant charges (Google = `google
  workspace` vs `google cloud`, the latter being HRX's Firebase/GCP
  spend). Rules engine sweeps JournalEntries too (JE merchant = `JE
  {DocNumber}`).
- AccuSource convention: categorize to 5010 Direct Labor — Field Staff,
  NO class; the weekly screening job reclasses to 5300 Field Staff
  Recruitment split per worker class. Job now matches AccuSource by
  descriptor as well as vendor 191 (bank-feed purchases have no vendor —
  they were invisible before 2026-09-03).
- Outbound draft sign-offs (inbox chief-of-staff + reply desks): single
  contact line after "—"; never a bare "Greg" line above "Greg Fielding
  ·…" (doubled name looked broken; API drafts never get the Gmail rich
  signature appended).

## Account retirements + recon hardening (2026-09-03, second wave)

- Retired accounts (flipped since 2026-01-01, then deactivated):
  "Meals" (45) -> "Travel:Travel meals" (102), 69 txns $3,473.71;
  "Vehicle:Fuel" (124) -> "Travel:Ground Transport" (115), 54 txns
  $1,986.28. Write-back CATEGORY_ALIASES map lingering Expensify picks
  (meals, fuel, vehicle:fuel). Expensify category toggles (Meals, Fuel,
  Vehicle:Leased) are MANUAL — our EXPENSIFY_PARTNER creds are not a
  policy admin (policyList empty; make the integration user a workspace
  admin to script it).
- Google: >$700 -> "Software & Subscriptions:C1 App" (acct 172,
  created) = Firebase/GCP; <=$700 -> "Google Workspace". Amount-banded
  rules (minAmount/maxAmount on |TotalAmt|); cardholder rules with
  overwriteClass (danny rodriguez -> Legends:Oakland, always).
- "je gusto" rule DELETED: Gusto payroll JEs only hit Uncategorized on
  reimbursement lines — the rule misfiled Donna P.'s $247.60 (now
  G&A:Office expenses, JE 7007 line 29). Reimbursements = human pick.
- Categorized tab includes human JE debit expense lines (automated
  wire/revrc/screen JEs excluded); cap 4000 + total; search field.
- ☠️ FOUND 2026-09-03: 212 QBO purchases ($18,580.62, Jul-Aug) created
  by Expensify report exports ("Imported from Expensify" in
  PrivateNote) — ALL duplicate bank-feed charges (feed is
  authoritative). Greg had exported the reports himself; confirmed +
  DELETED 210 of 212 same day ($18,547.62 removed; ids in session log).
  The 2 survivors were QBO bank-MATCHED (each backed by its own bank
  line — same-amount twins were different real charges): a matched
  import copy is authoritative, only unmatched ones are dupes. RULE:
  never export reports from Expensify into QBO — the feed brings every
  charge; Expensify is tagging-only (write-back copies tags over).
- Scratch runs needing a QBO token REFRESH must load env:
  DOTENV_CONFIG_PATH=.env.hrx1-d3beb npx ts-node -r dotenv/config …

## June revenue double-reclass (found + fixed 2026-09-03)

June 4200 went NEGATIVE (−$578K) / 4100 doubled ($1.27M): the month was
reclassed twice — a MANUAL close JE "Rev 063026" (−$615,617 from 4200,
pre-automation) plus our automated "Rev Reclass 2606" (−$652,021).
Manual JE deleted (Greg's call); the tagged [revrc:] JE is the single
source of reclass truth. RULE: no manual month-end revenue reclasses —
the weekly cron posts one per month; a manual one double-moves. Tell
Mark before the next close. Also new accounts 2026-09-03: 5210
ConnectTeam Fees (items 33 + 37 repointed, 81 invoices resaved — item
37 "VS Tech Fee (deleted)" is INACTIVE and invisible to default Item
queries; query Active IN (true,false)), 5400 Event Supplies and
Equipment (COGS, Id 174).

## Gov Ball vs QBO class audit (2026-09-03) — resolved + open items

- HRX Job Costing now applies payroll_jo_date_splits: rolled work
  (crew-roll windows) is excluded from the JO's pay/GP and shown as a
  "rolled to {class}" chip. Gov Ball JO #162: \$13,185.28 own-event pay
  (102 entries) vs \$76,245.67 rolled to FIFA NY (596 entries). QBO
  class P&L was already correct (GB class 5010 \$51,683.47 = event
  labor across ALL GB JOs). Exact ties: HRX billed == GB-classed
  invoices; P&L income = billed + ConnectTeam 5210 gross-up.
- OPEN: 15 unclassed Venue Smart invoices \$69,595.20 (batches 4/26 +
  5/03, incl. 60500752 \$42,154.40) — pre-Everee, blank descriptions,
  no PO/entry/sibling evidence. Needs Greg/Rosa to name the events.
- OPEN: FIFA NY under-billing hardened — labor classed FIFA NY
  \$104,691.96 vs invoiced \$68,682; expected billing at normal multiple
  ~\$155-175K → likely \$85-105K gap. Evidence: GB crew 6/15-7/05,
  Kelis Teran on FIFA NY invoice 7/18-19.

## ConnectTeam-driven VS billing attribution (Q1 done 2026-09-03)

Method that works: VS bills weekly, one invoice per event per Sunday
batch, most labeled only "C1 Events Non Factored Revenue" on the bare
"Venue Smart" parent class. ConnectTeam timesheet export ("All
Employees" sheet; per-shift rows; "Type" = event descriptor; NO bill
rates in the overview export) gives hours by event by week — rank-match
each batch's invoice amounts to that week's event hours; implied
blended rates land $16-26/h and confirm the match. Q1 result: 21
invoices $132,698.20 attributed (Okeechobee = 3 invoices \$90,200.40
per Greg incl. the 4/2 adjustment rebill); 6 oddballs -> new class
"Venue Smart:2026 Misc" (Greg: clear via misc PO). New classes: 2026
Misc, 2026 USFO Innings/Okeechobee/Extra Innings (separate per Greg).
Descriptor->class map: functions/.scratch/connecteam/descriptor_map.json
(gitignored; rebuild from this doc if lost). Remaining parent-class:
\$88,585.60 (4/05, 4/12, 4/19 batches) + 15 unclassed invoices
\$69,595.20 (4/26, 5/03) — resolve with Q2 ConnectTeam file, then FIFA
NY gap with Q3. Worker PII stays in functions/.scratch/ — never commit.

## ConnectTeam attribution COMPLETE Jan-Aug (2026-09-03)

All VS billing Jan 1 -> today attributed by event (final sweep: one $0
line left). April batches + the 15 unclassed invoices resolved via
weekly hours rank-matching; 5/03 batch: SRO GT (3 invoices $5,432.60),
Kid Cudi ($2,236.60), Seabreeze, LIV Golf VA; strays -> 2026 Misc.
Full-book implied rates all land $19.46-29.56/h (Lolla $21.99, WI State
Fair $20.75, Bonnaroo $24.49...) — VS billing tracks ConnectTeam hours.

FIFA NY VERDICT (inverts the under-billing theory): NY bills $21.77/h
on THEIR ConnectTeam hours (3,155.5h / $68,682) — richest FIFA site,
no gap vs their records. Real issue: HRX rolled GB-JO crew 6/15-7/05 =
68 workers / 4,713.9h / $76,245.67 paid, but ConnectTeam NY shows only
~19 workers / ~1,900h that window. ~50 workers / ~2,800h / ~$55-60K
billable have NO VS-side record. PENDING: Danny/ops to confirm where
those workers actually worked (Michelle Coleman 82.6h, Bibiana
Mondragon 80.1h, Kennedy Austin, Bryson Jeffery... top names). If FIFA
NY -> bill VS with HRX clock as backup (fifa_ny_detail.csv + rolled
worker list in functions/.scratch/connecteam/). If elsewhere -> re-split
the payroll_jo_date_splits classes.

## Travel-team payroll resolved via ConnectTeam (2026-09-03)

The \$36.6K parent-class 'Venue Smart' payroll = 7 traveling supervisors
(Vaughn, Spencer, Magana x2, True, K. Perez, De Julian) whose venue
label 'Venue Smart Supervisors Travel Team' maps to no QBO class ->
account-level fallback (some paid via C1 Events pre-hire, then C1
Select — Greg). Fixed: 56 payment_override ledger docs (source
connecteam_travel_team_20260903) assigning each payment its CT
dominant-hours event; true-up rewrote 18 wire JEs. Parent payroll now
\$1,065. DC Open \$1.4K -> \$16.4K (\$24.75/CTh). Ratio audit method:
QBO 5010-by-class / CT hours; healthy \$14-18; salaried staff (Mark
True) break the ratio — ignore. Partial-staffing events (FIFA Dallas
2,245 our-hours vs 6,516 CT) explain low ratios; Greg confirms whether
Dallas/DC Open used subcontract labor (cost then lives outside W-2
payroll and should be classed to events). OPEN: Silvia Orozco 8/13
attributed Black Caviar while CT shows Lolla — verify; FIFA NY Danny
question; August concert classes still to pre-create.

## FIFA rolled-crew resolution (2026-09-03) — the real story

The GB-JO date-split's "crew rolled to FIFA NY" was wrong for most of
the crew: ConnectTeam name-matching proved 47 of the 68 rolled workers
(Coleman, Austin, Jeffery, Vaughn...) worked FIFA WC DALLAS 6/13-7/24.
111 payment_override docs (source connecteam_dallas_reattribution_
20260903) moved ~\$54.7K of weight NY->Dallas (+Guzman->GB); Orozco
8/13 -> Lollapalooza (Greg). True-up rewrote 10 JEs. FIFA family now:
Dallas \$95.3K/\$14.63 CTh, NY \$63.8K/\$20.22, KC \$107.7K/\$16.52,
GB \$51.6K/\$16.19. NO under-billing claim against VS — Dallas's
\$134,262 invoice already covered those workers' hours; the "NY gap"
was payroll misattribution. Greg confirmed FIFA staffing was all-C1
(no subcontractors). NOTE: payment_override in the ledger BEATS the
payroll_jo_date_splits rule — worker-level CT evidence > JO-wide split.
FIFA margins ran thin (billed/labor ~1.1-1.4x pre-burden) — business
fact, not a data error.

## Screening pipeline final form (2026-09-03)

- Account: 5310 Background & Drug Screening (COGS, Id 175) — allocator
  targets it by /background.*screening/i with 5300 fallback.
- Classing chain per screen: JO -> client accountName -> PACKAGE
  (requestedPackageName regex -> leaf; CORT/Sodexo/Continental/
  Purolator/Carrier/Mattress/Domino's/ORS Nasco/Hyatt) -> assignment ->
  National. Splits COST-WEIGHTED per package (Greg's AccuSource rate
  sheet in code: Database \$7.36 ... Carrier \$67.39; Sodexo Basic+ PA
  variant shares a name with the \$37.04 one — common cost used).
- Maturity 7 days (was 35); screen lookback window per charge stays 35.
- All 2026 charges allocated: \$15,544.74 / 10 charges (Aug three
  forced 2026-09-03: Cort \$3,589, Sodexo \$2,418). 2025's \$630
  out-of-scope. Verizon: rule verizon -> Occupancy Costs:Utilities &
  Communications:Phone service (typo 'Communciations' fixed); Misc PO
  true-up list = 12 paid VS invoices \$20,101 on class 2026 Misc.

## Workers' comp allocation (2026-09-03)

7140 held ALL carrier payments (\$56,608 YTD to InSource). Fix:
(1) rate backfill — 2,369 entries stamped workersCompRate from the
matrix (state via entry.workState / assignment.worksiteState; title via
assignment; matrix = tenants/{t}/workers_comp_rates {STATE_CODE} docs
w/ jobTitles + '*' state defaults). Was 36% of gross unrated, now 0.1%
(\$631: VA supervisor title + stateless strays).
(2) pushWcAllocations (wcAllocations.ts): self-truing monthly JE
[wcalloc:YYYY-MM] debit 5100 WC — Field Staff per class (gross x rate;
JO -> payroll_jo_date_splits -> account rules -> JO name;
WC_LEAF_ALIASES for fuzzy misses), credit 7140. Posted Jun \$8,717.85 /
Jul \$10,187.90 / Aug \$10,955.72. Runs weekly after screening; action
'pushWcAllocations'. Residual on 7140 = internal WC + InSource
deposit variance — computed ~\$10K/mo vs ~\$7.5K/mo paid means a
carrier catch-up bill is building; watch 7140. Jan–May stays on 7140
(pre-Everee, Greg's scope ruling). Known limit: GB->FIFA WC follows
the JO-wide date split (~\$1.5K NY/Dallas blur).

## Division (QBO Department) tagging + Tabitha's revenue matrix (2026-09-06)

Tabitha (email 9/4, "Update & Claude JE Review Request"): the [revrc:]
JEs were landing in **Not Specified** on P&L by Division. QBO Departments
in this file: `Event-based` (1000000011), `Recurring` (1000000001),
`Corp / Unalloc.` (1000000021). Rule is keyed off the ACCOUNT: 4100 lines
→ Event-based, 4200 lines → Recurring. revenueAccountReclass.ts now
stamps per-line DepartmentRef and its self-truing rewrite also fires when
any 4100/4200 line is missing its division (one-time backfill of all 9
existing JEs rides the next real run).

Her full revenue tagging matrix (record of truth for future classing):
- 4100 Events & Venue — AEG, VenueSmart sub-classes, RS3-Events, 812 Mgmt
- 4200 Recurring — Sodexo, Indeed Flex, Proof of Pudding (RS3-Hosp), G6,
  Contigo, Black Caviar, Western Group Packaging, C1 MedStaff
- 4300 Other — anything not fitting 4100/4200, confirm with Vicki
- 4900 Refunds & Discounts — negative income, tagged to customer class

RESOLVED 2026-09-06 — Greg ratified Tabitha's matrix ("you have
instructions for which clients (and payroll) belong to 4100 and 4200"),
superseding the 9/1 Sodexo+Flex-only rule. Shipped same day:
- `RECURRING_DIVISION_RE` + `divisionKindForClassFqn` +
  `fetchQboDivisions` exported from payrollCostReport.ts — ONE family
  rule shared by all four JE writers (revenue reclass, wire allocations,
  allocationTrueUp, WC alloc, screening).
- Revenue reclass rerun with the expanded family: all 9 months
  rewritten; Proof of Pudding ($326,220), Contigo ($100,182), Black
  Caviar ($56,981), G6 ($11,275) — $494,658.13 — returned to 4200.
- Division stamped on every classed DEBIT line of every tagged JE:
  [revrc:] 136 lines, [wcalloc:] 58, [wire:] 437 (102 JEs via
  trueUpAllocationJes + 2 stragglers the matcher misses — TW Alloc doc
  prefix, legacy-tag EV Alloc 0519 — via scratch), [screen:] 52.
  Verified 0 missing. WC 7140 credit → Corp/Unalloc. Screening credit
  lines mirror the ORIGINAL purchase's class and stay division-untagged
  ON PURPOSE (they must net against the untagged purchase in the same
  P&L-by-Division column — 4 National credits are the expected residue).
- allocationTrueUp now rewrites a JE whose classed debits lack
  divisions, so future wire JEs stay tagged; wcAllocations/revenue
  reclass have the same missing-division rewrite trigger.
- AEG / RS3-Events / 812 Mgmt / Western Group Packaging are not active
  QBO classes yet — the regex already covers Western Group + MedStaff
  for when they appear.

## ☠️ 9/6 division rewrite broke the P&L by Division — rule made official, writers paused (2026-09-08)

Tabitha (9/8): "Revenue reclass — walk through the JEs posted by Claude,
this will take additional work to fix." Greg: "Our P&Ls were correct
BEFORE the 4100/4200 update." Greg's 9/2 P&L (Jun–Aug) = the correct
baseline: 4100 $1,641,271.24 / 4200 $126,622.68 (Sodexo Rebates −230.86).

What the 9/6 run actually did (three changes, one of which was asked for):
1. Stamped Divisions on the 9 [revrc:] JEs **keyed off the ACCOUNT**
   (debit 4200 → Recurring, credit 4100 → Event-based). A reclass between
   accounts must never move dollars between Division columns; this one
   pulled a negative out of Recurring and doubled Event-based. THE BUG.
2. Adopted Tabitha's wider 4200 family (Proof/Contigo/Black Caviar/G6…)
   → $494,658 moved back into 4200 across Jan–Sep. Wrong per Greg.
3. Extended Division stamping to every tagged JE via trueUpAllocationJes,
   which REWRITES debit lines to current attribution — that rewrite hit
   Tabitha's 17 July "EV Pay Alloc" JEs and replaced her hand splits.

**OFFICIAL RULE (Greg 2026-09-08): Recurring = Sodexo + Indeed Flex family
ONLY. Everything else is Events (4100 / Event-based).** Western Group
Packaging and C1 MedStaff never had revenue — no classes, not in the rule.
Tabitha's 9/4 matrix is superseded; tell her + Vicki.

Code (this commit):
- `RECURRING_DIVISION_RE = /^(sodexo|indeed flex)/i` (payrollCostReport.ts)
  — single source for 4100/4200 AND payroll-side Division.
- revenueAccountReclass.ts: buckets by month+class+**invoice header
  DepartmentRef**; both JE legs carry the invoice's own Division (none if
  the invoice has none); exact leg-set comparison drives the rewrite;
  `stale_prior_delete_manually` surfaces a month whose JE should go.
- allocationTrueUp.ts: `EV Pay Alloc*` (Tabitha's) are NEVER rewritten —
  reported as `skippedHuman`. Only `EV Alloc`/`TW Alloc` (ours) are touched.
- **Kill switch**: `qboJeWritersEnabled(tenantId)` reads
  `tenants/{t}/settings/qbo_automation.jeWritersEnabled`; absent/false =
  PAUSED. The weekly health run skips true-up / revenue reclass /
  screening / WC while paused. Explicit callable actions still work.
  Flip to `true` only after the rerun is verified with Tabitha.

**Rerun procedure (Greg, from the laptop — needs deploy first):**
1. `git pull`, then `firebase deploy --only functions:savePayrollVenueMapping,functions:reconcileTimesheetBatchesCron`
2. Dry run, from `functions/` (runner: `scripts/qboReclassRerun.ts`):
   `DOTENV_CONFIG_PATH=.env.hrx1-d3beb npx ts-node -r dotenv/config -P tsconfig.scripts.json scripts/qboReclassRerun.ts dry`
   Expect 9 months `would_true_up`; Jun–Aug 4200 debits should sum back
   to the 9/2 split (4100 $1,641,271.24 / 4200 $126,622.68 for Jun–Aug);
   true-up `skippedHuman` = Tabitha's `EV Pay Alloc` docs (19 as of 9/8), `patched` = ours whose
   Proof/Contigo/BC/G6 lines flip Recurring→Event-based.
3. Same command with `write`. A second `dry` must show every month
   `already_reclassed` and true-up `patched 0`.
4. Hand Tabitha a before/after P&L by account AND by Division. Her 17
   July JEs: our 9/6 rewrite is NOT reversible from code — pre-rewrite
   copies exist only if the 9/6 session snapshotted them under
   functions/.scratch/ (check backup_*.json); otherwise she re-keys them.
5. Only then set `jeWritersEnabled: true`.

Known open: the Division of the ORIGINAL Everee wire purchases / AccuSource
charges vs our untagged credit legs — if Tabitha tags those purchases with
a Division, the credits need the same tag (they currently net in Not
Specified by design). Ask her on Wednesday's call.

### Rerun executed 2026-09-08 (evening) — P&L restored to the 9/2 figures

Greg ran the runner from the laptop after deploying the fixed
`savePayrollVenueMapping` + `reconcileTimesheetBatchesCron` from this branch.

- Revenue reclass `write`: all 9 months (2026-01..09) `true_upd`. Jun–Aug
  4200→4100 totals = 652,021.47 + 375,548.29 + 613,701.48 = **$1,641,271.24**,
  exactly the 9/2 P&L 4100 line.
- P&L Jun 1–Aug 31 pulled via the QBO connector immediately after the write:
  **4100 = $1,641,271.24, 4200 (parent line) = $126,622.68** — both match the
  9/2 baseline to the penny. Total income unchanged ($1,767,603.18). Before
  the write (post-9/6 state) it was 4100 $1,433,262.60 / 4200 total
  $334,400.46 — i.e. ~$208K had been pushed into 4200 by the 9/6 matrix.
- True-up `write`: patched 1 (`EV Alloc 0813 EVT`), unchanged 84,
  skippedHuman 19 (all of Tabitha's `EV Pay Alloc *` docs — 19, not 17: the
  9/6 run rewrote 17, two more were never touched and are now guarded too).
- **Dry/write mismatch, noted:** the `dry` minutes earlier predicted patched
  3 (0730/0622/0813 EVT) + drift 1 (0624 EVT: credit 4,194.11 vs wire
  3,736.83); the `write` saw 0730/0622/0624 as unchanged. Nothing in QBO
  changed between the runs on our side; the wire totals come from
  `buildWireJournal`, whose Firestore reads are `.get().catch(() => null)` —
  a slow/failed read of a big collection (assignments, ledger) silently
  yields a different journal. Harmless here (only our own EV Alloc docs are
  ever touched, and the reclass JEs are verified by the P&L), but the
  true-up should fail loudly instead of swallowing read errors before the
  weekly job is re-enabled. TODO.
- Runner arg note: `qboReclassRerun.ts write dry` (two args) runs nothing —
  mode is arg 1, target (`reclass|trueup`) arg 2; use plain `dry`.

Still open after this: Tabitha's 17 July `EV Pay Alloc` docs were rewritten
on 9/6 (Division + split); restore from `functions/.scratch/backup_*.json`
on Greg's laptop if present, else QBO Audit History per JE.

**Greg 2026-09-08 (later): the rule is LAW, no sign-off gate.** Recurring =
Sodexo + Indeed Flex only; everything else non-recurring, now and going
forward. Writers re-enabled via `scripts/qboJeWriters.ts on` (status/off
also there). The true-up read-failure TODO above is still open — the
weekly run's blast radius is our own `EV Alloc`/`TW Alloc` docs only.

### Segment-dated JEs for the block calendar (2026-09-08, later)

Greg: monthly P&L AND block P&L must both be exact. Revenue reclass + WC
allocation JEs are now posted per segment (month ∩ block) — see
docs/claude/reference_fiscal_blocks_2026.md. Tags gained a `/B<n>` suffix;
legacy month tags are migrated in place on the next write. Deploy
`savePayrollVenueMapping,reconcileTimesheetBatchesCron`, then
`qboReclassRerun.ts dry` → `write` → `dry`.

**8040 excluded from the QBO WC allocation (Greg 2026-09-08):** entries whose
`workersCompCode` is 8040 (or `workersCompSource` says placeholder) carry the
synthetic 2.35 rate but no premium is paid on them yet, so `wcAllocations.ts`
skips them (reported as `excluded8040` in the result / runner). The carrier
monthly report already parks 8040 in its placeholder group. The HRX payroll
cost report still burdens gross at 2.35 for 8040 — a management estimate,
untouched.

**True-up stability guard (2026-09-08, after EV Alloc 0813/0730/0806 re-patched
on every run):** `buildWireJournal` reads Everee `/payments` live and pages
shift while Everee syncs, so a wire's total/split differs read-to-read; it
also swallows a failed QBO class query (journal comes back all-unclassed).
`trueUpAllocationJes` now (a) throws if no split in the journal resolved to
a QBO class, and (b) rewrites a JE only when the current read's fingerprint
(credit|wireTotal|split) equals the previous run's, recorded in
`tenants/{t}/qbo_trueup_observations/{doc}` (dry runs record too). A doc
whose exact split was already written but still compares as different is
reported instead of rewritten (comparison bug, not data). Runner prints
`deferred`.

**Post-9/2 cost reconciled (2026-09-08 evening, `qboReports.ts changes`/`detail`/`wirecheck`):**
the −$84K net-income swing vs the 9/2 print = Gusto 8/21 payroll JE entered
9/4 ($24.5K sal + $11.3K comm + burden) + SEVEN Everee purchases on 5010
($39,157.82) entered after 9/2 by the bank rec + small opex. Internal burden
Jun–Aug = 7.5–7.9% of wages (normal; the YTD "4%" was Feb's −$11,099 and the
Lone Oak months). 7120 401(k) stops after June — Human Interest charges are
landing in 8100 (ask Tabitha). `wirecheck` cannot match 1:1 (a bank debit
combines several Everee fundings, or is split 5010/5200 fees; 7/15 =
22,046.12 + 206.72 exactly), but totals foot: Everee funded $1,410,505
Jun–Aug vs QBO 5010 + 5200 = $1,402,475 (0.6% gap ≈ Aug 26–28 wires landing
in Sept) and zero same-amount duplicates → the seven purchases were MISSING
wires, not duplicates. Same session: two back-to-back buildWireJournal calls
returned 4,194.11 and 3,736.83 for the 6/24 EVT wire — the flakiness the
true-up guard now defends against.

## P&L by Division cleanup — Tabitha call 2026-09-08 (evening)

Greg + Tabitha reviewed the June "Profit and Loss by Division" (Corp /
Unalloc. · Event-based · Recurring · Not specified). Read-only audit that
reproduces the report to the penny from the QBO entities:
`functions/.scratch/division_audit.ts <start> <end>` → CSV + pivot (line-
level DepartmentRef for JEs, header DepartmentRef for everything else).
Three separate problems, three separate fixes:

**1. 5010 Direct Labor: Not Specified −$513,414.72 and Event-based doubled.**
- Everee wire Purchases already sit in `Corp / Unalloc.` (Tabitha tags them
  at bank rec) — June $478,521.64 (−$6,978.41 refund deposits).
- Tabitha's own `Rev Allocation 063026` JE (#7846, created 7/26) spread the
  whole Corp column out to Event-based/Recurring **by revenue ratio**, 5010
  included: Corp −471,209.04 → Event 438,742.43 / Recurring 32,466.61. That
  was her June method before our per-wire JEs existed (July she switched
  to per-wire `EV Pay Alloc`, credits tagged Corp).
- Our 31 June `EV Alloc` JEs (pushed 8/31) allocate the same wires again by
  actual attribution — credits UNTAGGED (→ Not Specified), debits
  Event/Recurring → 5010 Event-based = 864,951 against 355K revenue.
- **Convention (Greg, law): wire lands in Corp; the allocation JE's credit
  carries Corp too; classed debits carry Event/Recurring; unattributed
  remainder stays Corp.** Result: wire nets to zero in Corp, nothing in
  Not Specified. Tabitha's `EV Pay Alloc` credits already follow it.
- Code: pushWireAllocations (payrollCostReport.ts), allocationTrueUp.ts
  (also rewrites when a credit/unclassed debit lacks Corp),
  screeningAllocations.ts (credit mirrors the purchase's Division).
- Backfill: `.scratch/backfill_alloc_je_divisions.ts dry|write` — 91 JEs
  (85 EV/TW Alloc + Scrn Alloc), $1,208,892 of credits, snapshot per JE to
  `.scratch/backup_je_div_<Id>.json`, debit totals verified unchanged.
- **Still Tabitha's call**: drop the three 5010 lines from `Rev Allocation
  063026` (they are superseded by the per-wire JEs). Everything else in
  that JE is her overhead-by-revenue allocation and stays.
- Expected Corp 5010 after both: Jun −41,800.55 / Jul −10,657.38 /
  Aug +15,523.89 / Sep +85,822.08 (Sept wires not pushed yet) — JEs are
  dated by Everee funding date, purchases by bank post date, so month
  edges carry timing; Jun–Sep nets to the un-pushed wires. Not Specified
  5010 → 0.

**2. Revenue: invoice header Division was hand-keyed and ignores the rule.**
- June: $294,580 of Venue Smart/RS3/Black Caviar/G6 invoices carried
  `Recurring`; $5,943 of Sodexo carried `Event-based`; Jan–Apr and Aug–Sep
  mostly untagged. The `[revrc:]` JEs mirror the invoice Division (by
  design since 9/8), so 4100 showed $296,504 under Recurring.
- New `pushInvoiceDivisions` (`src/payroll/invoiceDivisions.ts`): header
  DepartmentRef on every 2026 Invoice/CreditMemo = client family via
  RECURRING_DIVISION_RE on the CUSTOMER name (Sodexo / Indeed Flex →
  Recurring, else Event-based; never Corp, never blank). Idempotent; full-
  entity update. Rides the weekly job BEFORE the revenue reclass, callable
  action `pushInvoiceDivisions`, runner phase `invdiv` (now part of `both`).
  Flex mirror invoices are created with Recurring stamped.
- Dry run 2026-09-08: 242 invoices to re-tag (117 none→Event, 49
  Recurring→Event, 18 Corp→Event, 42 none→Recurring, 16 Event→Recurring).
  Three April Sodexo invoices (60600025/26/40) are classed `National` —
  line class wrong, for Mark/Tabitha; header still goes Recurring.
- After `invdiv write` → `reclass write`: 4100 entirely Event-based, 4200
  entirely Recurring (= Sodexo + Flex only), every month.

**3. Corp / Unalloc. residuals (June) — the "one by one" list.** All are
side effects of the revenue-ratio allocation being a point-in-time JE:
- Not in her JE at all: 5200 Payroll Platform Fees 550.50 (Everee fee),
  5310 AccuSource 70.94, 6020 Gusto fee 289.00, 8840 Ground Transport
  1,832.12 (Enterprise 1,002.35 + Marathon/Uber/9 card lines), 9010 card
  rewards 335.71, 9020 interest 0.01; 5300 shortfall 501.93 (Indeed 6/29).
- Re-accounted to sub-accounts AFTER her JE (parent −X Corp / sub +X Corp,
  net zero, cosmetic): 8100→C1 App 986.74 (Twilio) + LLM 200 (Cursor);
  8210→Phone 852.20 (Verizon); 8300→Small tools 664.74 (Apple);
  8720→Wyoming LLC 209.94.
- 7120 +1,184.31 / 7131 −1,184.31: Gusto 401(k) lines; her JE netted the
  401(k) into the 7131 credit.
- 7140 −6,369.13 = InSource 5,000 − her 5,000 credit − our WC Alloc field-
  share credit 6,369.13 (Corp by design; 7140 goes negative when the
  month's carrier payment < computed field premium — expected until the
  carrier true-up).

**Execution state**: code done (tsc clean), dry runs verified; the QBO
WRITES were blocked by the Claude permission classifier this session —
Greg runs them (order matters): backfill `write` → `qboReclassRerun.ts
write invdiv` → `write reclass` → `dry` (all `already_*`). Then deploy
`savePayrollVenueMapping,reconcileTimesheetBatchesCron`. Until deployed,
the weekly job still posts untagged credits (the true-up will then re-tag
them on its second pass via the missing-division trigger).

**Verified 2026-09-08 (later, after Greg ran the four commands):** 5010 Not
Specified = 0.00 (Corp −513,080.53 until Tabitha drops her three 5010
lines from `Rev Allocation 063026`; then −41,871.49 timing). Invoices: all
2026 headers now follow the rule (`dry invdiv` = 0 to change). ☠️ **QBO's
query index lags entity updates (~1 min)**: `write reclass` run seconds
after the 242 re-tags read stale invoice headers and wrote June's legs half
on the old Division (4100 Recurring 153,158.68). Fix = run `write reclass`
again once `dry` shows the invoices settled. Guarded now: the weekly job
defers the reclass to the next run when invoices changed this run, and the
runner's `both` stops after a non-zero `invdiv` write.

## Workers' comp allocation now uses InSource ACTUALS (2026-09-08, late)

Greg: "5100/7140 are way off." Read all 61 InSource invoices from
client.insourcees.com (Greg's logged-in Chrome; Show 100 rows → one page).
**Entity → Division map (Greg): C1 Events = Event-based (5100), C1 Select =
Recurring (5100), C1 Resources = internal (7140). Medstaff/Workforce = $0.**
2026 YTD premium: Events 38,012.70 / Select 3,757.87 / Resources 2,905.59.

- InSource debits the bank ONE LINE PER ENTITY; every 7140 bank line
  matches a portal invoice to the penny (memo `INSOURCE - MAY 2026 PREMIUM`
  = the PAYROLL month; cash lands in M+1). Extras that stay on 7140:
  `UNLIMITED WOS` $500 fee (Jan, Aug), monthly `ASSESSMENTS` (~$280),
  and $5,000-minimum top-ups in the March (2,552.45) and May (1,400.03)
  payments. Jan–Feb premium cash sits on **5100 untagged with refund
  deposits** (Lone Oak era) — left for Tabitha; allocation starts 2026-03.
- The matrix estimate (gross × rate) ran 10–15% low on Events and high on
  Recurring every month (Jun est. 5,570.68/798.45 vs actual 6,337.29/487.19).
- `wcAllocations.ts` rewritten: reads `tenants/{t}/wc_carrier_invoices/
  {YYYY-MM}` ({events, select, resources}); allocates each entity's ACTUAL,
  using the matrix only to split it across classes and across the month's
  segments; months with no doc fall back to the estimate labelled
  `estimated_matrix` and self-true when the doc lands. Result carries a
  `reconciliation` (bank premium by memo month vs portal). Seed/update:
  `.scratch/seed_wc_carrier_invoices.ts` from
  `.scratch/insource_wc_premium_by_entity.csv`. **Monthly ritual (~5th):
  add the new month's three figures to the CSV and rerun the seed** (the
  portal has no API; the Chrome read is the extraction path).
- Tabitha's `Rev Allocation 063026` also spreads the June 7140 cash by
  revenue ratio (−5,000 Corp / +4,655.50 / +344.50) — those three lines
  should come out like the 5010 ones did (7140 is internal by design).

### WC accrual model (2026-09-08, latest) — 7140 shows the month's own premium

Greg: accrue C1 Resources too. `wcAllocations.ts` now books the FULL
InSource premium for payroll month M in M: debit 5100 per class (Events →
Event-based, Select → Recurring), debit 7140 Corp (Resources, pro-rata by
segment days), credit **2410 Accrued Workers' Comp** (sub of 2400 Accrued
Expenses; auto-created on the first write run). The carrier's debit in M+1
(one bank line per entity on 7140, memo `<MONTH> 2026 PREMIUM`) is offset
by a `WC Pay MMYY` JE dated the bank date: debit 2410 / credit 7140 Corp
for min(bank premium, portal total), tag `[wcpay:YYYY-MM]`. Real cost that
stays on 7140: $5,000-minimum top-ups (Mar 2,552.45, May 1,400.03),
`UNLIMITED WOS` $500 fees, monthly `ASSESSMENTS`. Legacy `WC Alloc` JEs
(credit 7140) are rewritten in place. Expected June 7140 Corp after the
write and after Tabitha drops her Rev Allocation 7140 lines: 5,000 cash −
3,599.97 clearing + 405.74 accrued = **1,805.77** (1,400.03 of it the May
top-up). Runner `dry wc` prints allocations, payment clearings, and the
bank-vs-portal reconciliation.

### Gusto fees → 7150 Payroll Platform Fees — Internal (2026-09-08, latest)

Greg: 6020 Payroll Financing Fees is wrong for Gusto fees (internal payroll
processing). Gusto "GUSTO - FEE" bank lines were scattered: 8100 Software
(Jan–Apr ×6), 5200 Payroll Platform Fees (May/Jul/Aug ×4 — that account is
Everee/FIELD fees), 6020 (Jun/Sep ×2), plus the 5/6 "OUTSTANDING BALANCE
per Gusto" $311 (= the May fee). New account **7150 Payroll Platform Fees —
Internal** (Expense; name differs from 5200 because QBO names are unique).
`.scratch/gusto_fees_to_7150.ts dry|write` creates the account and moves
all 13 lines ($3,824.00), snapshot-first. Merchant rule
`qbo_merchant_rules/gusto_fee_7150` (pattern `gusto - fee`, descriptor
match) routes future Uncategorized fee lines; Tabitha's bank-rec picks
should use 7150 too. Tempworks WEB PAY lines on 6020 ($5,413) untouched
(Lone Oak era).

### Overhead allocation automated — `Ovh Alloc` (2026-09-08, latest)

Greg: "most of our expenses are handled this way… you can automate?" Yes:
`src/payroll/overheadAllocations.ts` (`pushOverheadAllocations`) replaces
Tabitha's hand-keyed month-end `Rev Allocation` JE. Per segment (month ∩
block): every overhead line sitting in Corp / Unalloc. OR untagged is
credited where it sits and debited Event-based / Recurring at the
**calendar month's** revenue ratio (invoice header Division; Sodexo + Flex
= Recurring), same account both sides (sub-accounts included, so the
"parent −X / child +X" artifacts can't happen). Eligible = all Expense-
type accounts (7140 INCLUDED since Greg's later call — its NET Corp balance
after the WC accrual + clearing spreads by revenue) except Uncategorized/
Ask My Accountant, plus COGS overhead except 5010/5100/5310 (own writers).
Base excludes only `Ovh Alloc` and `Rev Allocation` docs; every other JE is
real balance (e.g. a Scrn Alloc credit on 5300 nets that account's base). 6xxx Other Expense and 9xxx
Other Income stay in Corp. Tag `[ovh:YYYY-MM/B<n>]`, DocNumber
`Ovh Alloc MMYY B<n>`, self-truing on the leg set, since 2026-05. Runs
LAST in the weekly job (after invoices/WC settle; skipped in a run that
re-tagged invoices), callable `pushOverheadAllocations`, runner `ovh`.
Result flags `manualAllocationsToDelete` — Tabitha's `Rev Allocation
063026` (#7846) must be DELETED (not patched): `.scratch/delete_je.ts 7846
"Rev Allocation 063026" write` (snapshot to backup_deleted_je_7846.json).
Dry run 2026-09-08: May–Sep, 10 segments, ~$500K of overhead; June 94.63%
Event. Greg's later calls the same evening: 7140 by revenue too (net Corp after WC
accrual/clearing); **Other Income 9010/9020 by revenue too** (credits flip
sides). Only 6xxx Other Expense stays in Corp (May Tempworks WEB PAY
$5,413, Lone Oak era). 5200/5300 by revenue like everything else.

**Screening Division = Recurring, always (Greg 2026-09-08, late):** every
5310 debit in a `Scrn Alloc` JE is tagged Recurring regardless of the client
class it splits to (National included — it used to go to Corp, event
clients to Event-based). `pushScreeningAllocations` now also re-tags the
debit lines of existing `[screen:]` JEs on every run (`divisionFixes` in
the result; runner `scrn` phase prints them). 7 JEs re-tagged 2026-09-08.
The credit still mirrors the source purchase's Division so the charge nets
where it sits. June 5310 after: Corp 0 / Recurring 70.94 (Greg's screenshot
showing 70.94 in both columns predated the recreated Scrn Alloc 0610).

## 5010 Corp residual — Everee funding statuses (2026-09-08, late)

Greg: "tackle the −41,800.55 of Corp field payroll" (and July/Aug). Root
causes, all in `buildWireJournal`'s funding handling:
- **Everee fundingList statuses**: every funding is type OPTIMISTIC_FUNDED
  (Everee fronts pay); status `SUBMITTED` = company pull happened (has
  companyFundingId, or none when funded from a manual wire — the 6/25
  batch, 216 lines $96,751.60); `CREATED_NEW_FUNDING` = superseded attempt
  that ALWAYS has a SUBMITTED sibling for the same money (July: 81 lines
  $32,000.29 → counted twice); `APPROVED_FOR_FUNDING` = paid to the worker
  but the company pull was NEVER submitted (May 19: 54 lines $18,963.67 —
  Greg 2026-09-08: that was the very first Everee test period — DISREGARD,
nothing owed). `prevFundingId` links the
  chain. No company-funding endpoint exists (/company-fundings, /fundings
  404).
- The builder grouped every no-id funding for an entity into ONE bucket
  keyed `none` regardless of date → the June aggregate JE `EV Alloc 0625
  EVT2` (148,174.05) = May pending 19,422.16 + June 96,751.60 + July
  superseded 32,000.29. Fixed: only SUBMITTED fundings count; no-id groups
  keyed `none-YYYY-MM`; journal result carries `unfundedOptimistic`.
- Executed: 0625 EVT2 credit rewritten to 96,751.60 (runner
  `write trueup "fixcredit=EV Alloc 0625 EVT2"` — the fixcredit list form
  exists because a drifted credit that still matches the BANK debit, e.g.
  0730 EVT, must not be pulled toward Everee's moving read); legacy May
  aggregate `EV Alloc 0519 EVT` (#8797, 19,422.16, never-pulled money)
  deleted (backup_deleted_je_8797.json).
- Reconciliation tooling: `.scratch/wire_bank_match.ts <start> <end>` —
  fundings ↔ bank debits with bundling (≤4 fundings per debit, one funding
  across 2 debits, −1..+8 days). 74/105 exact; the rest are near-pairs
  where Everee's wire total moved after the bank debit (voids/reissues).
  **Bank debit is the truth for the JE credit**, not Everee's current read.

**Refund sign + Other Expense (2026-09-08, late):** ☠️ a card REFUND is a
`Purchase` with `Credit: true` (memo "Return from …") — negative on the
P&L. The overhead allocator (and division_audit.ts) read it as a positive
expense and credited it again → −86.00 Not Specified on 8810 (the 7/13
Southwest return, 43.00 ×2). Both now negate `Credit:true` purchases.
Other Expense (6xxx) is now allocated by revenue too (Greg) — nothing
stays in Corp except what 5010/5100/5310 writers own.

**Bank tie-out for wire JE credits (2026-09-08, late):** `src/payroll/
wireBankMatch.ts` pairs buildWireJournal fundings with QBO Everee bank
debits on 5010 (exact ≤4-funding bundles, one funding across 2 debits,
near-pairs within max($50, 3%) for post-pull drift; −1..+8 day window;
`ePay0001` fee drafts and `Credit:true` refunds excluded). `allocationTrueUp`
now sets each JE's credit target to the BANK amount when every wire behind
it matched (`bankTied` in the result; runner prints "bank-tied"), so Everee's
moving reads no longer drive the credit. Unmatched wires keep Everee's total
and the old drift guard. Never-submitted fundings (APPROVED_FOR_FUNDING)
export: `.scratch/everee_unfunded_list.ts` → `everee_unfunded_approved_for_
funding.csv` (54 lines, $18,963.67, all 2026-05-15 pay date) — for Greg's
question to Everee.
Matcher passes (final): exact bundles → one-wire/two-debits → near pairs
(max $100/5%) → tolerant bundles (≤5, drift on the largest) → **month
close-out** (leftover debits of a month spread pro rata over the month's
leftover wires older than 3 days when the sides are within ±25%). Result
2026-09-08: 104/105 wires tied; projected 5010 Corp = 0.00 for May–Aug,
Sept = the un-posted 9/8 wire only. `.scratch/match_report.ts <start>
<end>` prints how each wire matched + the month view.
Late additions (2026-09-08): matcher nets Everee refund DEPOSITS on 5010 in
the month close-out; pro-rata shares must pass the two-read guard (exact/
near/split credit fixes apply immediately); true-up reports `humanDrift`
(Tabitha's `EV Pay Alloc` credit vs bank — never rewritten; 2 tiny in July).
Stale `EV Alloc 0731 SEL` (#8729, 11,784.98 — the old entity-wide SEL
'none' bucket, really August money) deleted; missing JEs created by
`.scratch/push_missing_wire_jes.ts dry|write <start> <end>` (mirrors the
callable, bank-tied credits, skips wires ≤3 days old): `EV Alloc 0820 SEL`
(none-2026-08@SEL 11,346.21) + Sept 9/1–9/4 wires. ePay0001 fee drafts
250 (6/8) + 45 (8/21) moved 5010→5200 (`.scratch/epay_fees_to_5200.ts`);
**8/6 ePay0001 5,209.50 left on 5010 — too big for a fee, Tabitha to
identify.** Not-a-wire on 5010: 6/11 Alberto Guerrero 1,800 (Railbird
contractor, classed) — fine.

## Classed expenses follow the CLIENT's Division (Greg 2026-09-08, latest)

Greg: travel etc. must NOT be spread by revenue — each is classed (usually
via Expensify) with the customer; Sodexo + Indeed Flex family (Cort…) →
Recurring, everything else → Event-based. **But all G&A is by revenue
ratio regardless of class** (Greg, minutes later). Boundary in
`src/payroll/expenseDivisions.ts` (`pushExpenseDivisions`): CLASS-DRIVEN =
Travel 8800 family, 8400 client meals, 5210/5300/5400 client-facing COGS
(header Division = larger class family; unclassed/`National` travel falls
to the ratio); RATIO = every other expense account — a purchase there
found in Event/Recurring is put BACK to Corp for the ratio pass (94 moved
on the second write). Runs in the weekly job
BEFORE the overhead ratio (which skips that run if anything was re-tagged
— QBO query lag); callable `pushExpenseDivisions`; runner `expdiv` (in
`both`, stops before `ovh` after a non-zero write). First write 2026-09-08:
207 purchases (149 untagged→Event, 31 Corp→Event, 22 untagged→Recurring,
4 Corp→Recurring, 1 Event→Recurring). `.scratch/retag_8840_event.ts` is
superseded.
**Refund deposits (2026-09-09):** Everee/worker refund deposits on 5010 get
the paying ENTITY's Division in `pushExpenseDivisions` (C1 Select →
Recurring, else Event-based) and are no longer netted by the matcher — so
a refund nets against the labor it reverses, not in Corp. July's −146.84
was: Tabitha's 0708/0713-2 credits 150.60 under their bank debits, minus
two 7/28 C1 Events ePay refunds (297.44). Corp 5010 now: Jun 0.00, Jul
+150.60 (hers), Aug +5,209.50 (the 8/6 ePay0001 draft — not a funding,
not a reissue; Everee exposes no billing endpoint), Sep 0.00.
**The 8/6 ePay0001 5,209.50 = Everee's JULY platform invoice (2026-09-09).**
Everee's monthly invoice (`C1 Events LLC_Monthly_Invoice_3138-MM.2026.pdf`,
downloaded from the Everee app — never emailed) is drafted via the
`ePay0001` ACH profile ~the 6th–15th of the next month and belongs on
**5200 Payroll Platform Fees**: Apr 250.00 (5/15 #6208), May 550.50 (6/8
#6480), Jun 1,950.00 (7/8 #7785), Jul 5,209.50 (8/6 #8634 — first month
with state sales tax, per Everee's 7/23 notice). Tabitha attaches the PDFs
to those purchases (Apr–Jun done 8/14); Greg to pull 3138-07 for #8634.
Small ePay drafts (250 6/8, 45 8/21) are ad-hoc fees, also 5200. The only
other ePay0001 activity is REFUNDS (deposits) of over-wired payroll (Nate
8/12: "over wired $283.95 in total"). `.scratch/epay_fees_to_5200.ts`
moves any ePay draft found on 5010 to 5200 (≤ $10K).

## 1260 Everee Funding Balance — the cash-vs-funded model (2026-09-09)

Greg: "held at Everee" needs its own ledger item. **1260 Everee Funding
Balance** (Other Current Asset; 1250 was taken by the Lone Oak factor
reserve). Every wire JE now books: debit 5010 per class = what Everee
FUNDED (labor); credit 5010 Corp = the BANK debit (Corp nets to zero);
difference → 1260 (over-wire = asset up, Everee netting a later wire =
asset down). Unmatched wire (no bank line yet) → credit 1260 for the funded
amount; unmatched Everee bank debit (≥5 days old, June+) → the purchase
line is moved 5010→1260 (and back when it later matches); Everee refund
deposits → 1260; Tabitha's `EV Pay Alloc` get a companion `EV Hold …` JE
(`[wirehold:je{Id}]`) for their bank difference instead of edits. The
account balance should track Nate's "over-wired" figure (8/12: $283.95).

☠️ **Everee `/api/v2/payments` MUST be walked with `sort=id,asc`**: the
unsorted walk silently drops 34–49 payments per pass (page shift) — June
funded read 433,077.76 vs 442,574.33 sorted; the drop looked like $9.9K
"held at Everee". Fixed in buildWireJournal + payrollPaymentIssueSweep.
June closes to 0.00 in 1260: three untied early-June debits (11,572.07) =
6/15 refund 6,853.74 + netting into bigger fundings 3,983 + the two tiny
unmatched wires 735.40. The 5/14 wire 19,161.07 = the May 15 batch
(18,963.67, still APPROVED_FOR_FUNDING in Everee) + 197.40 — Everee's
statuses are wrong for that test batch; May left out of the 1260 moves.
Refunds, refined: only "Everee Inc - ePay0001" deposits (an over-wire
coming back, e.g. 6/15 6,853.74) go to 1260; worker-named "C1 Payment" and
"C1 Events/Select LLC - ePay0001" deposits are RETURNED worker payments
(Everee still counts the funding) → 5010 in the entity's Division. May
wires stay on the pre-1260 behavior. Result 2026-09-09: 1260 June in
11,572.07 / out 11,572.07 (= 0), July +1,320.04 (over-wires incl. Tabitha's
150.60 via EV Hold), Aug −1,076.82 (Everee netting) → balance ≈ +243 vs
Nate's 8/12 "$283.95 over-wired" / 8/28 "92.62 to send back". Monthly
check: `.scratch/balance_1260.ts`; per-JE check: `.scratch/june_je_check.ts
<start> <end>`.

## May 2026 + September-to-date closed the same way (2026-09-09, afternoon)

Greg: "let's do May the same way - and sept to date". September was
already clean (only the fresh 9/8 wire, 899.00, waits for the >3-day rule;
the weekly job pushes it). May needed two things:

**Everee side.** The 5/15 batch (18,963.67) is the only wire whose Everee
funding never left `APPROVED_FOR_FUNDING` (first Everee test week) yet the
bank shows the pull (5/14 wire 19,161.07 = 18,963.67 + 197.40). Rule in
`buildWireJournal`: `APPROVED_FOR_FUNDING` counts as funded only when dated
before 2026-06-01. `push_missing_wire_jes.ts write 2026-05-01 2026-05-31`
created `EV Alloc 0515 EVT2`; trueup now uses the bank model for May too
(`preModel = false`, bank-line moves from 2026-05-01). Match report May:
bank 106,837.42 = credits 106,837.42, corp 0.00.

**Direct worker payments — new writer `directPaymentAllocations.ts`**
(`pushDirectPaymentAllocations`, runner phase `dpay`, callable action
`pushDirectPaymentAllocations`, rides the weekly job right after trueup).
During the Lone Oak→Everee cutover Greg paid workers straight from the
bank: Purchases on 5010, memo "<Worker> - C1 Payment Sent By …" (Everee
wires carry the same phrase, excluded by /everee/ on the memo). Same-day
duplicate refunds land as Deposits "<Worker> - Cancellation of: …" and are
netted per worker. One JE per segment, `DP Alloc MMYY B<n>`, tag
`[dpay:YYYY-MM/B<n>]`: credit 5010 Corp = the bank debits, debit 5010 per
class (Division by class family), unattributed remainder debited back to
Corp so the P&L stays honest. Attribution chain per worker name:
`payroll_class_overrides` kind 'worker' ("First Last" or "Last, First") →
HRX `timesheet_entries` (workDate from 14 days before the window) → JO →
`qbo_class_mappings` account mapping → `ACCOUNT_CLASS_RULES` on the account
name (CORT → Indeed Flex:Cort, Hyatt) → `WIRE_LABEL_ALIASES` on the JO name
("FIFA Fan Festival Kansas City" → FIFA KC) → JO name. Self-truing on the
leg set; result carries `punchList` (worker, amount, dates, hrx status).

May result: 138 items 35,872.17 → Cort 15,737.03, Sodexo 1,769.16,
Carrier 1,399.26, Lollapalooza 1,224.10, FIFA KC 827.07, Hyatt 120.52;
**14,795.03 across 40 workers unattributed** (35 are HRX users with no
timesheets/assignments in May, 5 have no HRX user at all). Punch list CSV
`.scratch/direct_payment_punchlist.csv` went to Mark; when he names the
event, add `{kind:'worker', workerName, class}` overrides and the weekly
job (or `write dpay`) pulls the money out of Corp.

May P&L by Division after all this: every account is 0.00 in Corp except
5010 = 13,274.04 = 14,795.03 unattributed − 1,520.99 `TW Alloc
Continental` (the TempWorks-straddle pilot leaves its credit in the Corp
pool by design — the TempWorks cash never hit 5010 in May).

Footguns met today:
- `qboQuery` returns the entity list UNWRAPPED (`{Class:[…]}`,
  `{Deposit:[…]}`), not `{QueryResponse:{…}}` — always read
  `r.QueryResponse?.X ?? r.X`. Two scratch probes silently printed nothing.
- `users.tenantIds` is a MAP (`{tenantId:{role…}}`) — `array-contains`
  returns 0. Use `where('tenantId','==',T)` (4,372 docs) and fall back to a
  `lastName ==` lookup for docs that only carry the map.
- `WIRE_LABEL_ALIASES` is now module-scope/exported from
  payrollCostReport.ts (was local to buildWireJournal; the duplicated
  "Womens Open" entry was removed).

## ☠️ 7140 is ONLY C1 Resources — InSource $5,000 minimum (2026-09-10)

Greg flagged June 7140 = 1,805.77 as high. It was 405.74 (June C1 Resources
premium, correct) + **1,400.03 = InSource's $5,000 monthly minimum top-up
for May** (portal May: Events 1,737.75 + Resources 671.03 + Select
1,191.19 = 3,599.97; the 6/9 bank pulls total exactly 5,000.00).

**How InSource bills the minimum.** When the entity premiums for a payroll
month total < $5,000, the shortfall is invoiced to **C1 Workforce LLC**
(an entity with no payroll; the portal shows its invoices as $0.00). Proof:
bank pulls sum to exactly 5,000.00 in Oct/Nov/Dec 2025, Jan/Feb/Mar/May
2026; the "ACH Returned — C1 Workforce LLC January/February 2026 Premium"
emails (Maggie Holcombe) carry 3,768.11 and 2,692.05 (+$35 fee), exactly
5,000 − portal. April and Jun+ premiums exceed 5,000 → no top-up. The
pre-renewal writer comment already said top-ups "stay on 7140 as real
cost" — that was wrong under Greg's rule.

**Rules (Greg 2026-09-10):** "Internal should ONLY be C1 Resources." "If
there are charges unrelated to a specific entity, then those should be
added to a new GL account number and allocated by revenue. Title Workers
Comp Minimum Shortage."

**Writer changes (`wcAllocations.ts`):**
- `INSOURCE_MONTHLY_MINIMUM = 5000`; top-up = max(0, 5000 − portal total)
  is accrued in its premium month (pro-rata by segment days) as a debit to
  **Workers Comp Minimum Shortage** (AcctNum 5110, same type/level as 5100,
  created by the writer if missing), Corp, credit 2410. `WC Pay` now clears
  min(bank premium, portal + top-up). The overhead writer then allocates the
  Corp balance by revenue (it's not one of the excluded 5010/5100/5310).
- Non-premium InSource bank lines on 7140 since 2026-03 (state ASSESSMENTS,
  UNLIMITED WOS) get one `WC Fee MMDD <purchaseId>` JE each
  `[wcfee:<purchaseId>]`: Events share → 5100 Event-based, Select share →
  5100 Recurring by the entity premium mix of the memo month (WOS: latest
  carrier month before the bank date); the Resources share stays on 7140.
  Assessments are computed per entity (Eddie 7/22: C1 Resources now gets its
  own assessment invoice), so premium mix is the right proxy. WOS is a
  per-policy-year $500 fee; the Jan 2026 one was invoiced to C1 Select —
  if the entity is known, override rather than rely on the mix.
- Jan–Feb 2026 and 2025 top-ups sit on 5100/7140 untagged (Tabitha era),
  not touched (writer gate ≥ 2026-03).

## Travel split: Travel for Events (COGS) vs Travel for Sales (2026-09-10)

Greg: create "Travel for Events: SUBCATEGORY" in COGS; rename the existing
Travel family "Travel for Sales"; then build rules for what goes where.

**Skeleton (done 2026-09-10, `.scratch/travel_skeleton.ts`):** 5500 Travel
for Events (Id 180, COGS / OtherCostsOfServiceCos) with 5510 Airfare (181),
5520 Hotels (182), 5530 Travel meals (183), 5540 Ground Transport (184).
8800 Travel (Id 51) renamed **Travel for Sales**; its subs (8810 Airfare,
8820 Hotels, 8830 Travel meals, 8840 Ground Transport, unnumbered Travel
Insurance) keep their names, so FQNs are now "Travel for Sales:Airfare" etc.

**Rename impacts handled in code:**
- `expensifyClassWriteback.ts` maps Expensify category → account by exact
  FQN/Name; Expensify still sends "Travel:…" until its QBO category sync
  refreshes → `legacyTravel()` rewrites `travel:` → `travel for sales:`, and
  the meals/fuel aliases point at Travel for Sales. (Unmapped lines just stay
  on Uncategorized and retry daily — no misposting.) ☠️ Expensify's own
  category list must be re-synced from QBO (Accounting → Sync) to show the new
  names; nothing in code does that.
- `expenseDivisions.ts`: 55xx added to the class-driven set (88xx matched by
  AcctNum, unaffected by the rename).

**Rules (Greg 2026-09-10: "class is enough, allocate sales travel by
revenue"):**
- `travelRouting.ts` (runner phase `travel`, callable `pushTravelRouting`,
  weekly job right after direct payments): line-level on Purchases + Bills
  since 2026-05-01. Client class → matching 55xx sub; no class / National /
  Corp / overhead / retired Austin → matching 88xx sub (Travel Insurance →
  5500 parent). Two-way, idempotent. First write 2026-09-10: 394 lines,
  $48,460.23 → Travel for Events (May 321.65, Jun 23,744.55, Jul 12,005.80,
  Aug 10,172.51, Sep 2,215.72).
- 5500 family is CLASS-DRIVEN in `expenseDivisions.ts` (Sodexo / Indeed Flex
  → Recurring, else Event-based). 8800 Travel for Sales is a RATIO account
  from 2026-05-01: a sales-travel purchase parked in a client Division goes
  back to Corp and `overheadAllocations.ts` spreads it by revenue.
- ☠️ Scope footgun hit on the first run: dropping 88xx from the class-driven
  set while the writer's `since` = 2026-01-01 flipped 48 Jan–Apr purchases
  ($4,561.66) Event-based → Corp. Restored the same day
  (`.scratch/restore_janapr_travel_divisions.ts`, matched by
  MetaData.LastUpdatedTime); the writer now keeps legacy class-driven travel
  before `TRAVEL_SPLIT_FROM = '2026-05-01'`.
- Weekly job: a run where the router moved any lines defers expense
  Divisions + overhead to the next run (QBO query lag).
- Only signal is the class: QBO books every card to one "Credit Cards
  Payable" account and the Expensify classSync ledger has no cardholder, so
  a sales trip tagged to a client lands in Travel for Events. Refine later by
  adding the owner email to the Expensify exporter template and joining
  `expensify_card_map/{last4}`.

## Event-staff recruitment ads → COGS 5300 (2026-09-10)

Greg: "move 8010 above the gross profit line and into COGS." The 8010
balance in the P&L was entirely its sub **Advertising & marketing:Recruitment
(Advertising to recruit Event Staff)** (Id 1150040042, no number: Indeed +
Craigslist job ads, Jul 1,017.59 / Aug 3,353.44 / Sep 541.44). That is the
same thing as the existing COGS account **5300 Field Staff Recruitment /
Advertising** (also Indeed + Craigslist), so no new GL number: the travel
router's account-merge map moves every line on that sub to 5300 (class-
independent, since 2026-05-01, weekly), the Expensify writeback aliases the
old category to 5300, and the overhead writer re-trues its Jul–Sep legs onto
5300. The sub is to be made inactive once nothing references it. The 8010
parent itself only held small Jan–Mar promo buys (lanyards, monogram, Zazzle,
Shutterstock ≈ $368) — real marketing, left below gross profit.

## Travel: CARDHOLDER rule supersedes class-only (Greg 2026-09-10, late)

Greg: "ALL expenses in the travel family by Danny, Rosa, or Mark always go in
the Event area. All travel family expenses by Greg or Donna ALWAYS go in the
Sales area, with the exception that if Venuesmart is added as the class …
those are moved to Event area."

- `travelRouting.ts` `wantFamily()`: cardholder Danny (dr@) / Rosa
  (r.govea@) / Mark (mk@) → Travel for Events; Greg (g.fielding@, includes
  the "Corporate Card" 3038 whose map email is Greg's) / Donna (dm@) →
  Travel for Sales unless the line's class is `Venue Smart` or
  `Venue Smart:*` → Events. EVERYONE ELSE → Travel for Events (Greg,
  later the same evening: "anything misc (not greg or donna), put as
  Events") — Maria Rabadan's inactive card 8778, unmapped cards, charges
  without a card descriptor (Expensify expense reports "Imported from
  Expensify"), Bills. The class only matters for Venue Smart on Greg/Donna
  lines.
- Cardholder source: Relay descriptor "**NNNN Paid by <Name>" via
  `parsePurchase` (expensifyPush.ts) → `expensify_card_map/{last4}.email`
  local-part; an unmapped last4 falls back to the cardholder first name only
  when that name belongs to exactly one mapped person.
- Coverage check May–Sep 2026 (597 travel lines): all but ~$3.8K resolved
  to a person (Maria 2,839.31, no card 504.23, unmapped 5474 339.01 /
  8214 97.19).
- Downstream unchanged: 55xx class-driven Division (unclassed event travel
  in Corp gets spread by revenue by the overhead writer), 88xx by revenue.

## Chart tidy: 8020 + 8110 nested under 8100 (2026-09-10)

Greg: "8020 Website & Digital and 8110 Google Workspace should both be
nested within 8100 Software & Subscriptions." Done via Account update
(SubAccount + ParentRef → Id 108); both were already Expense type, numbers
unchanged. FQNs are now "Software & Subscriptions:Website & Digital" (Id
1150040039) and "Software & Subscriptions:Google Workspace" (Id 1150040044),
alongside the existing subs Adobe Products, C1 App, LLM Software. No code
matches these names; the Expensify writeback still resolves the leaf Name.
Both stay revenue-ratio overhead.

## Travel for Events is ALWAYS Event-based when unclassed (2026-09-10, late)

Greg (P&L by Division Jun–Aug showed 5530/5540 125.57 in Corp and 5510
−35.00 Not specified): "all event travel will ALWAYS be Travel Events."
Cause: after the cardholder rule, Rosa/Mark/misc travel with no client class
landed on 55xx, but 55xx was class-driven only — unclassed lines left the
purchase header in Corp / none, and the overhead writer then spread them by
revenue (partly into Recurring), leaving segment residue in the multi-month
view.
- `expenseDivisions.ts`: a 55xx line with no class / National / Austin counts
  as the EVENT family → header Event-based. Sodexo / Indeed Flex classed
  event travel still → Recurring (the 2026-09-08 class rule).
- `overheadAllocations.ts`: 55xx excluded from the revenue-ratio base.
- First write: 111 May–Aug purchases ($18,380.06) → Event-based (99 from
  Corp, 12 from none); Jan–Apr untouched.
- Same day, Greg: "Technology & Software" (unnumbered top-level Expense) also
  nested under 8100 → "Software & Subscriptions:Technology & Software".

## Travel for Sales Division by class too (Greg 2026-09-10, final tweak)

"On travel for sales.. if the CLASS involves Indeed Flex (or family of
companies), or Sodexo, then each item would be in the Recurring division.
Otherwise, Event Based division." So ALL travel now follows one Division
rule (from 2026-05-01): class matches `RECURRING_DIVISION_RE` (Sodexo /
Indeed Flex family) → Recurring; anything else, including no class /
National / Austin → Event-based. Nothing in either travel family is spread
by revenue: `overheadAllocations.ts` excludes 55xx and 88xx;
`expenseDivisions.ts` treats 88xx as class-driven (unclassed → Event-based
from 2026-05-01; Jan–Apr legacy). Which ACCOUNT (Events vs Sales) is still
the cardholder rule in `travelRouting.ts`. First write: 148 May–Sep
purchases (109 Corp → Event-based, 28 Corp → Recurring, 11 none →
Event-based).
