# lone oak ar reconciliation

> 2026-09-08 research pass (no QBO changes): Lone Oak/TempWorks invoiced+collected for C1 through bill week ending 5/10/2026 (QBO-native invoicing from 5/12). QBO 6/25 aging still carried $322,189.67 / 69 Lone Oak-era invoices; 8 ($23,475.31) are provably paid to Lone Oak and closable now, 56 ($279,690.26) wait on John Gerhan's 9/4 funding report, 4 ($10,753.95) are pre-2026 AEG/812. Report artifact + CSV worklists delivered to Greg; script `scripts/lone-oak-ar-crossmatch.py`.

## Why this exists

Lone Oak Payroll (ARA, Inc., the TempWorks funding arm) was C1's back office
until mid-May 2026. Every invoice numbered 60500594–60500779 (C1 Events
entity, HierId 7008) and 60600004–60600069 (C1 Select, HierId 7005) was
issued by Lone Oak and paid to the ARA lockbox (Wells Fargo, PO Box 855917,
Minneapolis). QBO never saw that cash, so those invoices sit open in QBO
unless someone closes them by hand. Tabitha (Bandwidth Bookkeeping) owns the
cleanup; Donna obtained the closeout report from John Gerhan on 9/4.

## Mechanics that matter (from the TempWorks "Invoice Funding" report columns)

- **Financed** invoices: 90% advanced at funding, 10% reserve held
  (`ReserveReleased` col), `FactorFee` grows with DSO, `ChargebackDays`=90.
  Unpaid past 90 days → charged back (advance clawed from reserve; the
  receivable is C1's again and stays open in QBO).
- **Non-financed** invoices: Lone Oak only collects; proceeds pass through
  (`DueClient` col). Most VenueSmart LLC paper from mid-Feb, and Indeed Flex
  non-financed early on; Indeed Flex 60600024–60600068 were FINANCED
  ($26,838.07 due to ARA per Mike Neis 7/9).
- Recommended QBO treatment: one Other Current Asset "Due from Lone Oak –
  factor clearing". Lone Oak-collected invoices → Receive Payment dated on
  Lone Oak's PayDate, deposit-to = clearing. All Lone Oak wires (advances,
  reserve releases, pass-throughs, the ~$28K returned in Aug 2026) → credit
  clearing. Factor fees → monthly expense from the FactorFee column.
  Clearing should net to ~0; the remainder is the number to argue with John.

## Data inventory (Drive, all readable via the Drive connector)

| What | Drive title / id | As of |
|---|---|---|
| Lone Oak invoice register, C1 Events (186 inv, $929,408.25 billed / $220,409.87 paid / $708,998.38 bal) | `2026 Invoice Register.pdf` (1EXRKcQm3k1583y6Rlw4kfhnoheuOEkhW) + `Invoice Register.csv` (1WoU0RmyVejXEGxsgNChacVy8gXDcLW2J, 1/31–5/10 only) | 5/10 |
| Lone Oak invoice register, C1 Select (67 inv, $46,725.97 all unpaid) | `C1 Select Invoice Register.csv` (19HSUi-WrvZHN94zXhIQu0Y0N6Y3xd-RR) | 5/10 |
| Lone Oak factored aging, C1 Select ($34,633.17 financed unpaid) | `C1 Select Factored Invoice Aging.csv` (1G4NGByk746ZXuE-bCkTdP67RT6h2swGZ) | 5/11 |
| Lone Oak Invoice Funding report Jan 1–Mar 31 (114 inv) | `Standard_Beyond_Invoice Funding.CSV` (1Keg38QskimEx032KOFQ1Yr9W13e6taII) | 4/14 |
| Lone Oak Invoice Funding report Apr 1–14 (37 inv) | `Standard_Beyond_Invoice Funding (1).CSV` (1MPaB86ZNt0R3l1YQjgY0l5AM_Y5lw9zq) | 4/14 |
| QBO A/R Aging Detail ($366,948.51) | `C1 Staffing LLC_A_R Aging Detail Report.csv` (1ar3K2qqntJdP7pCef1h1Meun-SbrLuTb) | 4/30 |
| QBO A/R Aging Detail ($772,317.20) | `C1 Staffing LLC_A_R Aging Detail Report (1).csv` (1UpLkwQ9br9egbW25S_HKPHH4sZx35oHf) | 6/25 |
| Tabitha's Sodexo/Monument cross-compare | Sheet 1DpYoEpJaprSd18oSgXCp7CacEWJ-0eh2ncn7TirMlHs | 8/21 |
| Mark's cutoff export folders | Drive folders 1QB_O9Z20CgzGbNJS_DyQMdMYSAV2zJ5b (Select) and 1ntUjQxLTXwn-uCaOPVkP8DFSvlxG4xXe (Events) | 5/11 |

**Still only in Gmail (connector can't download attachments — ask Greg to
drop them in Drive):** John Gerhan's `C1_Invoice Funding (8).xlsx` (9/4,
thread 1a06d60b4b4ccd7d, Jan 1→9/4 with pay dates — THE closeout source);
Jaron's `Standard_Beyond_Factored Invoice Aging (31).XLSX` (6/3, thread
19e8eadd61d5618f); Mike's `C1 Invoice Payments.pdf` (7/9, 19f489ce7ead3352);
AEG's `C1 Events Check Payment Report.xlsx` (6/3); Proof's `ARA Invoice
update.xlsx` + 16 ACH remit PDFs (6/26, 19f04651850510ed).

## Cross-match results (QBO 6/25 vs Lone Oak 5/10)

- QBO open Lone Oak-era (inv date ≤ 5/13, excluding 7 QBO-native 5/12
  invoices 60600076–82): 69 inv / $322,189.67.
  - Paid to Lone Oak by 5/10, still open in QBO — close now: 8 / $23,475.31
    (RS3 60500676/678/696/697/706/722/747 = $22,990.81; AEG 60500604 $484.50).
  - Partial: RS3 60500761 $8,270.15 ($969.28 applied; Proof remit $7,300.87 in June).
  - Open at Lone Oak 5/10: 56 / $279,690.26 (AEG $94,842.72, Contigo
    $88,208.69, RS3 $46,734.97, VenueSmart 60500640/641/642 $41,102.24,
    Sodexo $4,906.64, G6 $2,519.23, Indeed Flex $1,375.77) → 9/4 report decides.
  - Pre-2026 / not in any 2026 Lone Oak report: 812 Mgmt 60500178 $1,642.20;
    AEG 60500529/543/564 $9,111.75 (AEG refuses to pay without event names;
    also 60500704, 60500740).
- Lone Oak balance at 5/10 NOT open in QBO 6/25: 115 inv / $464,400.14
  (VenueSmart $412K, Indeed Flex $25.5K financed, Sodexo $16K paid direct to
  C1 via Monument, RS3 5/3 batch $13.2K) — verify each closure traces to a
  Lone Oak wire or a direct deposit.
- QBO doc-number typos vs Lone Oak: 60600740/60600756/60600772/60600773 in
  QBO = 60500740/756/772/773 at Lone Oak; "60600041 (Mark Draft)" $40 is a
  stray duplicate of 60600041 $25.45.
- AEG "69K" applied 4/28 = 60500600+610+611+632+633 = $69,013.97 (already
  closed in QBO except 604). Jaron's 6/3 aging showed AEG owing Lone Oak only
  ~$595 (60500740+60500772) → the April invoices 688/689/704/705 were either
  paid to lockbox in May or charged back; unresolved on the thread.
- Contigo: Tabitha already credited from the 9/4 report (balance $27,253.51
  → $6,599.38 after 9/8). Two $10K Contigo payments went to Lone Oak in Aug
  and were forwarded — likely most of the "~$28K sent back" Tabitha saw.

## Re-running

Drop the CSVs above (plus the 9/4 xlsx exported to CSV with the same
columns as the funding reports) into `functions/.scratch/lone_oak/` using
the filenames the script expects, then
`python3 scripts/lone-oak-ar-crossmatch.py functions/.scratch/lone_oak`.
It writes `qbo_pre-cutoff_open_worklist.csv` and
`lone_oak_open_5-10_not_in_qbo_aging.csv`. Swap in a fresh QBO A/R Aging
Detail export (or the QBO connector's `qbo_accounting_get_ar_aging_detail`
once reauthorized) for the 6/25 file.

Related: [[project_qbo_invoicing]], [[project_qbo_class_cleanup]] (TempWorks-straddle JE pattern, the 14 pre-May VS invoices).
