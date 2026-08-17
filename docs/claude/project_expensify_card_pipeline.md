# expensify card pipeline

> Relay card → QBO → HRX → Expensify feed LIVE (CSV import steady state); EXP-6 class + EXP-7 note/receipt write-back Expensify→QBO WORKING e2e (2026-08-14 first full sync: 32 classes, 9 memos, 190 receipt PDFs attached); scheduled submit via CLASSIC only; receipt URLs are login-gated — per-report includeFullPageReceiptsPdf is the only server path

# Expensify card-expense pipeline — state of play (2026-07-14)

**Problem:** Expensify's Relay bank connection only surfaces parent accounts,
not the ~14 nested debit/credit cards; Relay hasn't answered on VCF. Greg
rejected sub-account restructuring + manual CSV; demanded a live feed.
**Key insight:** a customer-hosted "VCF feed URL" cannot exist — Expensify's
commercial-feed intake is provisioned bank-side via Visa Subscription
Management. "Live" in this domain = automated daily batch.

**Architecture (all verified live):** Relay→QBO sync preserves full card
attribution in bank descriptors ("… **9423 Paid by Greg Fielding …") —
probe confirmed 25/25 on API-visible Purchase entities. Pipeline:
`expensifyCardPushCron` (daily 06:00 LA) → qboQuery Purchases (lookback
window) → parse **NNNN + 'Paid by' → route via card→worker map → create
expenses in worker's Expensify via Integration Server API (amounts in
CENTS) → exactly-once ledger. First test run 2026-07-14: 31/31 pushed,
0 errors (test mode).

**Code:** functions/src/integrations/quickbooks/qboAuth.ts (OAuth: discovery
doc endpoints, single-use CSRF nonces in qbo_oauth_nonces, rotating refresh
tokens, intuit_tid in error logs, getQboAccessToken/qboQuery exported) +
functions/src/integrations/expensify/expensifyPush.ts (parsePurchase +
runExpensifyCardPush exported for scratch runs). UI: ConnectQuickBooksCard
on /invoicing (L7). Commits 7af91fa6, e6e10a5f, dbbeb8ad, 8a9294ca.

**Config/data (tenant BCiP2bQ9CgVOCTfV6MhD):**
- tenants/{tid}/integrations/quickbooks — CONNECTED realmId 9341452806974527.
- tenants/{tid}/integrations/expensify — mode:'test' (all pushes →
  g.fielding@c1staffing.com), policyID=CF8E5E6613BEC167 (Test Workspace;
  LIVE workspace = 7F61B0DE15BBAE8D 'C1 Staffing LLC'), lookbackDays set
  to 3 for test (restore 14 at go-live), adminUids [Greg].
- tenants/{tid}/expensify_card_map/{last4} — 14 cards seeded from 12-month
  QBO scan (3830 purchases): 9423+6551+3038(shared virtual)→Greg,
  0877+9325+0538→Rosa Govea, 3820+7245+8885→Mark Kevin Garcia,
  0009→Danny Rodriguez, 6910→Donna Persson, 8778→m.rabadan@c1staffing.com
  (Greg chose company addr over her gmail HRX login), 2557→Jasmyne
  Robinson (gmail), 2180 Irene Castaneda UNMAPPED (no HRX user; dormant).
  Cron auto-creates stubs + notifies admins on unknown cards; unmapped
  txns stay queued (not ledgered) until email filled.
- Ledger: …/integrations/expensify/pushedTransactions/{qboPurchaseId};
  test pushes carry testMode:true — PURGE THEM before flipping live so
  workers receive their recent history.

**Credentials (functions/.env.hrx1-d3beb, never print):** QBO_CLIENT_ID/
SECRET (Intuit PRODUCTION keys, secret ROTATED after screenshot exposure),
QBO_REDIRECT_URI (…cloudfunctions.net/qboOAuthCallback), EXPENSIFY_
PARTNER_USER_ID/SECRET (validated via policyList). All in PARAM_KEYS.

**Intuit app:** 'Online Accounting scope' under Greg's dev account, IN
PRODUCTION (assessment passed 2026-07-14; first submit failed on Security
Q3 left blank — resubmit fixed). ATTESTATIONS TO HONOR: QBO calls ~daily;
no generative AI touches QBO data (noted in expensifyPush.ts header);
no webhooks/CDC (update Intuit if added); tokens server-side only.

**Deployed:** getQboAuthUrl, qboOAuthCallback, getQboStatus (rev 00002,
rotated secret) + hosting. NOT yet deployed: expensifyCardPushCron —
needs Greg's named deploy.

**WENT LIVE 2026-07-14:** cron deployed (daily 06:00 LA, scheduler
verified); test ledger purged; mode:'live', policyID 7F61B0DE15BBAE8D,
lookback 14d. First live run: 175 scanned / 126 pushed (all Greg's) /
20 no_card skips. Roster reconciled vs Relay Cards page → map covers 17
cards (added 3714+8551→Greg, 0611→Rosa). 8778 (Maria Rabadan)
DEACTIVATED (temp worker, Greg reconciles manually — active:false keeps
her txns queued silently). Greg verified c1staffing.com domain in
Expensify + invited members; workspace members: Greg(admin),
tabitha@bandwidthbookkeeping.com, vicki@crowncfo.com(admin), dm@(admin),
mk@, dr@, r.govea@.

## THE REAL BLOCKER, FOUND + FIXED 2026-07-15: QBO's Pending queue

Symptom: cards looked "idle" (I wrongly reported "5 of 17 cards" — an
artifact of a Jul-1-only 25-row probe; the true figure was 10 of 17 since
Jun 1, and Danny/Mark DID have spend). Real cause: **every downloaded bank
transaction lands in QBO's Pending / "For Review" tab, and the QBO API can
ONLY see the posted register.** Intuit will NEVER expose the review queue
(no `banktransactions` endpoint, no Banking API) because they pay
Plaid/Yodlee per access — confirmed in Intuit's own dev forums. So a
transaction sitting in Pending is invisible to every downstream system.
Proved it: Relay showed Danny's Jul 5/8/14/15 charges; QBO's register
stopped at Jun 29; the Pending tab held `Dollar Tree … **0009 Paid by
Danny Rodriguez` the whole time. **Diagnostic when a card looks idle:
QBO → Transactions → Bank transactions → Pending tab. Do NOT reason from
the register's absence.**

Fix (all in QBO, no code): bank RULE **17 "Auto Push to Expensify"** —
`Money out`, ALL accounts (NOT "All bank accounts" — that excludes the
2100 Credit Card type = 261 txns), `Bank text contains "Paid by"`,
category `Uncategorized Expense`, **priority 17 = LAST** (priority 1 would
override all 16 vendor rules), **Auto-post ON**. Plus Tabitha
(bookkeeper) enabled Auto-post on the other 16 rules 2026-07-15 — that was
required: QBO is first-match-wins, so broad class-only rules (rule 14
`"Rosa"`→Class Austin, rule 1 `"Business Credit Card"`→Class National)
were CLAIMING transactions at high priority and then not posting them,
stranding all of Rosa's spend. Result: July register 130 → 184 (rule 17)
→ **237** (Tabitha's pass); Rosa 1 → 33.
Rules dialog says "Rules only apply to unreviewed transactions" = they DO
sweep the existing Pending backlog retroactively. "Test rule" counts
condition matches only (ignores priority); "Preview" just shows priority
position.

**Expensify categories do NOT flow back to QBO** — workers categorizing in
Expensify leaves the register at Uncategorized Expense; bookkeepers still
reclassify there. Closing that loop = Expensify's own QBO integration, but
naively wired it double-counts (bank-feed txn + Expensify export).

## Expensify API hard limits (verified 2026-07-15, don't re-litigate)

- Job types are ONLY: file, reconciliation, download, create, get, update.
  **`update` does NOT touch expenses.** There is NO way to modify, delete,
  recategorize, or REASSIGN an existing expense — reassigning a company-card
  expense to another member is UI-only. So "let the native Relay feed create
  the expenses and have HRX enrich/reassign them" is IMPOSSIBLE. (It also
  wouldn't help: the native feed makes ONE card = the Relay *account*,
  assigned to Greg, so every expense is his by construction — that was the
  original bug.)
- **☠️ THE API CANNOT CREATE EXPENSES FOR ANYONE BUT THE CREDENTIAL OWNER.**
  Expensify Concierge, 2026-07-15, verbatim: "only the user can create their
  own expenses (aside from when a company card is assigned and the bank feed
  imports a company card expense). This is why you can create an expense for
  yourself, but you can't create an expense for any other user." NOT a
  permission — a product limit. Greg is a Domain Admin, targets are Domain
  Members + workspace members; irrelevant. The 401 is terminal.
  **=> `expensifyPush.ts` / `employeeEmail` can ONLY ever serve Greg.** The
  126 "successful" pushes proved nothing — all were his own. I claimed
  "cards are not the only way to attribute" — WRONG. For anyone but
  yourself, **an assigned company card + a bank feed is the ONLY mechanism.**
  Path forward = get real cards into Expensify (CSV company-card import with
  a card-number column, or the commercial/VCF feed URL Expensify offered),
  assign each to a member once; then feed imports land as company-card
  expenses in the right account (reconcilable + non-reimbursable by
  construction). Today's QBO Pending fix is the PREREQUISITE for either —
  it's what makes the source complete + card-attributed.
- CSV company-card import DOES create cards from a card-number column and
  assign them to members once — but it IS the feed (no API for the upload;
  its cards only ever receive transactions from later CSVs; a CSV-created
  card can't be fed by a bank connection).
- Relay: NO public API (backend is Unit + Thread Bank; access via Plaid,
  which is account-level = same blindness). NO per-transaction card alerts
  (notification prefs cover only transfers/deposits/ACH/wire/returns).
  Relay's "Other" integration emails PDF/CSV/OFX **statements** — periodic,
  and it does NOT list the credit account. Relay's QBO sync is the ONLY
  channel that carries card-level detail, which is why QBO is unavoidable.

## CLOSED 2026-07-15: the 401 is terminal (see API hard limits above)

Concierge confirmed the API can never create expenses for another user.
39 expenses (Rosa 33, Danny 4, Donna 2) will 401 + retry forever on the
daily cron, notifying Greg each run. **Next session: either point the cron
at a real card feed, or disable/neuter it so it stops alert-spamming.**
Do NOT chase this as a permission problem — Greg is a Domain Admin, the
targets are Domain Members + workspace members, and Donna is even a
workspace admin. All verified, all irrelevant.

Also fixed 2026-07-15: pushes now send **`reimbursable: false`** (commit
5053ad0d, NOT deployed) — we were omitting it, so Expensify's default
applied and company-paid card spend read as owed back to the employee.
Not retroactive (API can't update expenses); the 126 already in Greg's
account + Maria's 2 test Ubers would need UI fixes.

## EXP-5 — the CSV export, PROVEN ON LIVE DATA 2026-07-15 (commit 595b8cfc)

Tested end to end in the LIVE workspace (7F61B0DE15BBAE8D) with 6 real QBO
rows across 3 cards. All four assumptions held:
  1. CSV card-number column CREATES cards ✓
  2. cards assign to OTHER members (dr@, r.govea@) ✓  ← what the API can't do
  3. assignments SURVIVE a re-upload ✓  ← assign once, upload forever
  4. resulting expenses are OWNED by the cardholder ("From dr@c1staffing.com") ✓

Wire facts (all learned the hard way):
- New Expensify: Workspace → Company cards → Add cards → country → **Import
  transactions from file** → name the layout → map columns. Auto-maps
  `Card Number, Posted Date, Merchant, Amount, Currency` with "File contains
  column headers" on. It IS workspace-scoped (not domain, despite Classic).
- **Transaction start date defaults to the ASSIGNMENT DATE and silently
  rejects everything older.** This ate two full imports ("6 transactions
  added" then nothing anywhere). Set it back BEFORE importing history.
- **ISO dates land a day early** (2026-07-14 → Jul 13): read as UTC. We emit
  MM/DD/YYYY, string-sliced, never Date().
- **Expensify does NOT dedupe.** Importing the same file twice = duplicate
  expenses. Hence the export ledger, stamped on CONFIRM not download.
- Deleting a card feed deletes its transactions too.
- Search: unquoted keywords are IGNORED and silently return EVERYTHING
  (362 rows = Greg's whole list). **Quote them** — `"imported by HRX"` →
  exact match, found all 183 of our pushes (31 test + 126 first live + 26
  today; the test-mode LEDGER was purged 07-14 but the expenses never were).

Code: functions/src/integrations/expensify/expensifyCardExport.ts
(previewExpensifyCardExport + confirmExpensifyCardExport, ledger at
…/integrations/expensify/exportedTransactions/{qboPurchaseId}) + client
src/components/settings/ExpensifyCardExportCard.tsx on /invoicing.
DEPLOYED 2026-07-15 (both callables + hosting).

**FIRST EXPORT DONE 2026-07-15**: 714 txns / $61,427.17 / 10 cards
uploaded, assigned, and CONFIRMED — ledger holds all 714, card reads
"Up to date", 80 correctly held on Maria's paused •8778. Verified in
Expensify: Danny's Dollar Tree $38 + Staples $43.49 owned by
dr@c1staffing.com; Rosa's Cargreen $500/$201.88 + Uber Eats by
r.govea@. Dates landed correctly (Jul 14, MM/DD/YYYY fix held).
Expensify was emptied first (183 API pushes + native-feed residue
deleted) — **nothing may sit in Expensify before an import or it
duplicates; there is no API to clean up after.**
Card assignment gotcha: dr@ (Danny) vs dm@ (Donna) are one letter
apart — •6910 is DONNA's, got mis-assigned to Danny on the first pass.
STEADY STATE: /invoicing → download → upload → confirm. Weekly. No
re-assignment, no date fiddling, no re-upload (the double-upload was a
first-run artifact of cards not existing until the first import).

**expensifyPush.ts is DEAD**: config mode flipped live→'off' 2026-07-15
(kill switch at expensifyPush.ts:165 returns before any QBO call). Do NOT
re-enable — it would duplicate everything the card feed imports. Cleanup
done same day: 183 API-pushed expenses deleted, Relay Cards test feed
deleted. STILL OPEN: the NATIVE Relay feed's two account-level cards
(`0000 • Credit Account`, `5043 • Business Checking`, both assigned to
Greg) — that feed is the original bug's source and must die before the
first real upload or every transaction doubles.

Later ideas: QBO webhooks for near-real-time (revisit Intuit attestations
first), auto-categories from Relay's category tail in the descriptor,
mapping-management UI. Irene (2180) is a former employee — 0 activity,
ignore. Maria (8778) active:false ON PURPOSE (Greg reconciles manually) —
her txns show as `queuedUnmapped`, which lumps "no email" with "paused".

⚠️ UNRESOLVED, ASK TABITHA BEFORE THE FIRST EXPORT: Expensify IS connected
to QBO (171 categories mirror the chart of accounts; each card has a
"QuickBooks Online credit card export" target). The normal design is
Expensify exports → the QBO bank-feed line MATCHES it. But rule 12 now
auto-posts those lines to Uncategorized Expense, so nothing is left in
Pending to match → likely DOUBLE ENTRIES once a report is approved. Rule 12
may need to come off when the card feed goes live. Nobody has approved a
report yet, so no damage so far.

[[project-conventions]] [[reference-tenant-entity-ids]]

**Cycle 2 (2026-07-19) — append path PROVEN:** upload new batches via
Company cards → Relay Cards feed → **Settings → Import spreadsheet** (NOT
"Add cards", which creates a duplicate feed needing re-mapping — happened,
deleted). Imports process with a LAG (transactions appeared minutes later;
don't re-upload early — no dedupe). Never open the CSV in Numbers/Excel
before uploading (strips leading zeros 0538→538, may rewrite dates);
upload the raw downloaded file.

## EXP-6 (2026-07-24, commit 891f6615) — class write-back Expensify→QBO

Supersedes "categories do NOT flow back": CLASSES now do (categories
still don't). expensifyClassWriteback.ts: reads reported expenses via
the Integration Server file exporter (freemarker TSV template, file job
→ download), resolves tags against QBO Classes (FQN case-insensitive,
then unambiguous leaf; tags export as "Parent:Child" and an empty
parent yields ":Child"), matches purchases by pushed-comment "QBO #id"
or exact (date, cents, merchant) triple — merchant equality holds
because the CSV merchant came from our own parsePurchase. Sets ClassRef
on expense lines via qboEntityUpdate (new full-entity POST helper in
qboAuth.ts). Idempotent vs live QBO state; ledger
…/integrations/expensify/classSync/{purchaseId}; cfg
classLookbackDays (default 60) + lastClassSyncAt/Stats. Daily 06:30 LA
cron + runExpensifyClassWritebackNow callable + "Sync classes to
QuickBooks" button on ExpensifyCardExportCard.

**UNBLOCKED 2026-07-24 (same day):** the exporter sees ONLY expenses on
reports (no API for unreported ones — probed since Jan across all
reportStates). Fixes applied via Greg's Chrome session:
- **Scheduled submit enabled** on workspace 7F61B0DE15BBAE8D, frequency
  "Manually" (expenses auto-group onto open reports, never auto-submit).
  ☠️ The NEW-dot Workflows feature toggle SILENTLY ROLLS BACK (server
  rejects, no error shown; their Search backend was also 500ing) — use
  **CLASSIC** (expensify.com/policy?param={policyID} → Workflows →
  Submissions). Approvals remain "Submit and Close".
- Backlog: card expenses live as tracked expenses in the owner's
  self-DM; per-expense "More → Move to report" moves them. Harvest
  then swept 42 onto reports within the hour.
- Tag export escapes literal colons ("Venue Smart\:FIFA KC") — resolver
  unescapes (fix 37f13c03).
**First live write verified:** Uber $47.40 → QBO purchase 7583 ClassRef
{1000000015, FIFA KC} via the UI Sync button; triple-match path
(comment empty on CSV-imported expenses). Steady state: Greg classes in
Expensify → 06:30 cron (or Sync button) stamps QBO.
Expensify's own QBO accounting connection has a DEAD refresh token
("renew credentials" ×13) — report auto-export cannot fire, so no
duplicate risk while it stays broken; check export settings before
anyone reauthorizes it.

## EXP-7 (2026-08-14, commit 0f395c56) — notes + receipts write-back

Same module/cron/callable extended (Cloud Run cap → NO new functions;
timeouts 300→540s): one pass per matched expense stamps class (as
before) + appends the Expensify comment to Purchase.PrivateNote (memo;
append-only, skips if already contained, 3900-char cap, "QBO #id"
marker stripped) + attaches the receipt via new `qboUploadAttachment`
in qboAuth.ts (multipart /upload, Attachable→Purchase; a 200 can carry
a per-file Fault). Loop now iterates ALL expenses with any payload
(tag/note/receipt), not just tagged. UI button relabeled "Sync all to
QuickBooks" with class/note/receipt result line.

**Receipt access facts (probed hard, don't re-litigate):**
- `expense.receiptObject.url` = verifyReceipt.php (404 unauth');
  `receiptObject.thumbnail`/`receiptFilename` w_*.jpg forms 403 both on
  expensify.com/receipts/ and the S3 bucket; `download` job cannot
  fetch receipt files by name (404 any fileSystem). Receipt images are
  NEVER directly fetchable server-side.
- THE path: file job `outputSettings {fileExtension:'pdf',
  includeFullPageReceiptsPdf:true}` renders report PDFs WITH receipt
  images. Bulk runs name files `export{uuid}-{NUMERIC id}.pdf` but the
  TSV reportID is the R-form string — UNMAPPABLE; instead filter
  `filters:{reportIDList:'R00…'}` (R-form accepted) → exactly one
  filename. `fetchReportReceiptsPdf(reportID)` does job+download+%PDF
  check; one-slot cache (TSV groups expenses by report).
- Attachment = the report's WHOLE receipts PDF (per-expense receipt
  extraction impossible), fileName `expensify-receipts-report-{id}.pdf`,
  attached to EVERY matched purchase of that report; ledger
  `receiptAttachedAt` is the ONLY dedupe (QBO attachments are additive
  — never re-attach), `receiptAttempts` caps retries at 5, RECEIPT_CAP
  60 uploads/run (excess counted receiptsDeferred, cron drains daily).

First full sync 2026-08-14 (3 scratch passes of run-exp7-live.ts):
229 expenses on reports, 202 matched, 32 classes, 9 memos, 190 receipt
PDFs attached, 0 failures; QBO Attachable query confirms. 1 chronic
unmatchedPurchase remains (uninvestigated). Steady state: workers
class/note/photo in Expensify → 06:30 cron (or "Sync all" button on
/invoicing) lands everything on the QBO purchase.
