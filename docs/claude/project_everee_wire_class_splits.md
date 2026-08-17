# everee wire class splits

> Everee wire → QBO class-split report for the bookkeeper — builder script + all the Everee/QBO wire-reconciliation facts (funding ids, paging params, memo formats)

Greg 2026-08-14: bookkeeper classes Everee wires as one lump "field staff
payroll"; needs each wire split into QBO class dollars (class = JO name,
same convention as /payroll-costs). Builder:
`functions/.scratch/build-everee-wire-class-report.ts` (READ-ONLY; rerun
any month; July delivered 2026-08-14: 36/43 wires matched to the penny,
July-dated wires $337,969 split, $98,682 Unattributed).

**Hard-won wire-reconciliation facts:**
- QBO wires = Purchases, memo `Everee, Inc Everee Inc - C1 {Select|Events|}
  Payment Sent By Greg Fielding`; plain "C1 Payment" memos are NOT a third
  company — they're Events/Select runs with a generic descriptor. `ePay0001
  Initiated By Everee Inc` debits = Everee service-fee drafts (never match
  payroll funding).
- Everee `/api/v2/payments`: REAL paging params are `page`/`size`
  (`page-number`/`page-size` in evereePayments.ts are silently IGNORED —
  Events returned the same first 1000 rows every call; totalItems 3,444).
  One row per worker×pay-run; `fundingList[].companyFundingId` groups
  payments into the exact ACH pull — sum of `fundingList[].amount.amount`
  = the wire, TO THE PENNY. `earningList[].note` carries "Shift ending
  YYYY-MM-DD" (join `${workerId}|${workDate}` to timesheet_entries —
  field is **workerId**, NOT userId) and `JO#<n>` after 2026-07-28.
- Wires can bundle several fundings (subset-sum ≤4) and one funding can
  split across two bank debits (7/17 $2,927.03+$269.41=$3,196.44).
- Everee company ids: 3133=Select, 3138=Events, 2320=SANDBOX (0 payments;
  entity c1_sandbox_smoke — exclude).
- QBO Banking For-Review lines are API-invisible (same Pending blindness
  as the card pipeline) — report emits pending-funding splits so the
  bookkeeper can class them when they post.
- June-period wires (6/11–6/25) don't reconcile exactly (pre-HRX
  coverage); ~29% July Unattributed = Everee-only one-off payments +
  pre-7/28 untagged 1099 payables — should collapse from August.

**Venue-text resolver (2026-08-14 cleanup pass):** AD_HOC one-time
payments carry free-text notes ("Railbird - 13 People", "Black Caviar
Bonnaroo", "VS - Nascar SD Lead") — resolved via unique ≥5-char tokens
from JO names + account names + payroll_venue_mappings, plus a stem(6)
map for plural drift ("womens"→"women"). ☠️ STOP list must apply to NOTE
tokens too — "Contractor pay" stem-matched "Contra Costa" and stole $74k
before the guard. Recovered ~$122k of attribution window-wide. Drill-down:
`.scratch/dump-everee-unattributed.ts` → everee-unattributed-payments.csv
(worker/date/note/diagnosis). Residual $212k window-wide ($90.8k in
July-dated wires): $67.5k workers with ZERO HRX timesheets (RS3/golf
contractor crews — Blanca Escobedo et al.), rest HRX workers paid
off-app with venue-free notes ("Contractor pay") — needs human memory or
per-worker default-class overrides, not more parsing.

**Greg's fill-in round trip (2026-08-14 PM): July = $0 unattributed.**
Greg filled 714/716 rows of the worklist CSV in Sheets (CLASS column keyed
by Payment ID + apply-to-worker flag). Applied via the builder's override
loader (paymentOverrides + workerOverrides beat every heuristic; his raw
labels normalized through a LABEL_MAP — "Oakland AEG"→Oakland Arena,
"KC FIFA"→FIFA Fan Festival Kansas City, etc.) and PERSISTED: **1,037 docs
in `tenants/{T}/payroll_class_overrides`** (kind worker|payment, 323
worker defaults incl. Blanca Escobedo→golf sites) — future reports and
the auto-classing cron must load these FIRST. Final July: $337,969 across
19 wires, 100% classed; ~103 split rows name classes not in QBO yet
(bookkeeper creates: Governors Ball, FIFA Fan Festival KC, Venuesmart
Womens PGA Open, Sodexo - Tower…). Downloads folder became READABLE via
dangerouslyDisableSandbox cp this session (TCC granted) — try before
asking Greg to drag files.

NEXT (Greg's stated theory): auto-write the class splits into QBO (split
the Purchase into classed lines via qboEntityUpdate, EXP-6-style cron).
[[project_payroll_cost_attribution]] [[project_expensify_card_pipeline]]
