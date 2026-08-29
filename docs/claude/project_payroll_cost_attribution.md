# payroll cost attribution

> "HRX→Everee payroll cost attribution — Payroll Costs report + Everee note/label tagging; entry-status vocab, attribution fallbacks, submit-day wire splits; P3/P4 next"

> Leonard Frett calc-race CLOSED 2026-08-29: orphan Everee shifts
> 4193388/4193397 deleted (verified gone), import entries marked
> paid/off_cycle → off-cycle o3MG3Voj3zwTUk2pozqO ($289.08, pays Monday,
> untouched). Two 0-hour draft entries same dates left as-is (harmless).
> No double-pay possible from Wednesday's run.

Greg's accounting problem (2026-07-27): money wired to Everee has no per-job-order attribution in QBO; bookkeeper (Tabitha) can't split a $10K wire across classes (classes = job order names). Built P1+P2 2026-07-28.

**P1 — Payroll Costs report** (`getPayrollCostReport` onCall in functions/src/payroll/payrollCostReport.ts + src/pages/PayrollCostsPage.tsx at `/payroll-costs`, security level 6+, menu under Invoicing):
- Queries `tenants/{t}/timesheet_entries` by workDate range (≤92 days), filters status in-memory.
- ⚠️ Live status vocab is `sent_to_everee` (NOT "submitted") — census 2026-07-27: 1560 sent_to_everee / 416 draft / 14 error / 8 approved / 3 paid. Filter = sent_to_everee|submitted|paid.
- Attribution fallback chains (all were needed): accountId = entry.accountId (top-level, exists!) → assignment.accountId → jo.recruiterAccountId; worksite = assignment.worksiteName → jo.worksiteName → `e.import.worksiteName` → `e.import.csvSite` → e.worksiteName. JO lookup falls back across job_orders/jobOrders/recruiter_jobOrders.
- Entries have NO batchId — "batch" = submit-day group `${hiringEntityId} · sent ${YYYY-MM-DD}` from sentToEvereeAt. These per-day splits ARE the wire worksheets (taxes/fees allocate pro-rata per Greg's decision).
- Money math mirrors submit: scheduled = reg+ot*1.5+dt*2+(meal+rest)*rate+tips+bonus; import = reg+ot*1.5+tips+bonus.
- July 1-27 validation: $228,235.32 / 1,563 entries / 395 workers. FIFA Dallas = JO#157 $11,303.81 + #212 $5,438.46 + unattributed-with-venue-label $11,646.45. Unattributed ~$101K = mostly CSV-import rows with venue labels but no matched JO (June-era mapping debt).

**P2 — Everee tagging** (submitTimesheetBatch.ts → submitTimesheetEntryWorker.ts → composeTimesheetBatchPayloads.ts): attributionTag **v2 (2026-07-28, per Greg): NAME-first** = `<account name> · <JO name> — <worksite> · PO <customer po>` — internal JO# deliberately DROPPED because ids mean different things per client (VenueSmart = customer PO on jo.poNumber; Flex = job id per shift); the stable key AND the QBO class is the NAME. Account name resolved+cached at submit; jo.poNumber included when present (field exists, gig JOs, JobOrderForm). W-2 worked shifts: prepended to `note` (` | ` before recruiter notes). Payables: `withLabelPrefix()` prepends to `label` (` · `, 120-char cap). Report byJobOrder groups by account-scoped NAME (same-name JOs merge = one QBO class; #ids/POs shown as refs); wire-split labels are class-path shaped `Account:Name` mirroring QBO class hierarchy. QBO class mapping/auto-creation from names = P4.

**2026-07-28 API probe (definitive, sandbox round-trip + prod reads — .scratch/probe-everee-attribution-fields.cjs):**
- Worked shifts persist + echo BOTH `note` and `dimensions` (free-form key/value object) on GET.
- Payables ACCEPT + echo `dimensions` too — the CreatePayableDTO doc omits it but the wire takes it (expenses guide is right, schema doc stale). `label` echoes on real prod payables.
- `GET /integration/v1/expenses/by-date-range?min-earning-date=&max-earning-date=` works on both prod tenants: returns per-dimension buckets with totalWageAmount + totalEmployerTaxAmount + totalEmployerContributionAmount = FULLY BURDENED cost per dimension, taxes allocated by Everee itself. Currently one unallocated {} bucket each (we never sent dimensions). July: 3133 = $25,501.24 wages / $2,890.46 employer tax / $834.23 contrib; 3138 = $316,624.97 wages (1099, no burden). PTO/leave wages can't be dimensioned (land in unallocated).
- ⇒ Next enhancement (P2.5): stamp `dimensions: {jobOrderId, jobOrderNumber, accountId}` on worked-shift + payable submissions; then P4 QBO journal can read Everee-burdened per-JO costs from the expenses endpoint instead of our pro-rata approximation.
- Reconciliation datapoint: Everee July wages ≈ $342K total vs $228K HRX-attributed → quantifies direct-payment + June-boundary gap.
- Money wire shape gotcha reconfirmed: `{amount, currency}` (NOT currencyCode); payable POST needs ISO timestamp + verified:true; worked-shift POST requires fullyClassifiedHours (FCS enabled on all C1 instances).
- Everee in-app reports (verified 2026-07-28 via Greg's Chrome session, app.everee.com/reports): "Advanced payment reports" BETA builder has selectable columns **"Earning notes"** (payable label) + **"Time notes"** (worked-shift note) plus Worker external ID / Legal work location / Total employer taxes; Group-by + Summarize-by supported. Saved report **"HRX attribution check"** (C1 Events tenant) has those columns — results download as file only (no in-app view). Standard reports = fixed columns, filterable by legal work location; "Journal entries" GL export tool exists under Standard reports. No dimensions column in the builder (dimensions are API-only via expenses endpoint).

**Venue mappings (2026-07-28, P3 mechanism shipped early):** `tenants/{t}/payroll_venue_mappings/{normalizedLabel}` — admin maps a venue label → JO once via "Map to job order" button on unattributed /payroll-costs rows (JO autocomplete dialog; mappings card w/ delete); `savePayrollVenueMapping` callable denormalizes JO name/number/PO/account onto the doc; applied at READ time in getPayrollCostReport (no entry mutation) so past+future entries with that label report under the JO. June backfill = Greg mapping labels through the UI. **Extended 2026-07-28 (3fd53cfb):** same memory also matches mapped venue names as SUBSTRINGS in free-text (findMappingInText: normalized, keys <5 chars skipped, longest match wins) — entries fall back worksite-label→entry.notes; off-cycle rows consult the mapping too (worksite→notes+label) instead of bypassing it.

**Payments tab on User Details (2026-07-28):** new 'Payments' tab (label key 'Payments', level 6+ gate in UserProfile/index.tsx tabs array) — WorkerPaymentsTab.tsx: send-payment form (entity defaults to where worker has evereeWorkerIds linkage, shown with ✓; JO picker groups "Recent assignments" first + pre-selects most recent; warns when no Everee account) over off-cycle history via `listOffCyclePayments` callable (books-gated server read — offcycle_payments has NO client Firestore rules by design; rules file is per-subcollection explicit, new subcollections are deny-by-default).

**Off-cycle payments (2026-07-28, Mark Garcia's request — closes the direct-payment gap going forward):** `createOffCyclePayment` + `searchOffCycleWorkers` callables (books-gated) + "New off-cycle payment" dialog on /payroll-costs. Reasons (missed hours/late timesheet/forgot bank account/bonus/expense reimbursement/payroll correction/other) → payCodes by tax treatment: W-2 wage-like = **REGULAR_HOURLY** (⚠️ RETRO_WAGES custom code was NEVER provisioned on any tenant — sandbox probe "Unknown payCode"; only MEAL_PREMIUM/REST_PREMIUM exist, apiKey field, base earningType REGULAR_HOURLY), 1099 = CONTRACTOR, bonus=BONUS, reimb=REIMBURSEMENT, per diem = second PER_DIEM payable. Docs at `tenants/{t}/offcycle_payments` (audit-first, deterministic externalId `offcycle_<docId>`); report includes them as source "off_cycle (<reason>)". Caps $10k/$1k. **Duplicate-pay guard (2026-07-31, 7133ec9d — after Greg double-paid Eustralia Martinez $485.44 "Missed hours" that duplicated her sent csv_import entries for 06-24/25; recalled via Everee API):** callable queries timesheet_entries workerId+workDate (equality-only, status sent_to_everee|paid filtered in-memory, any source) BEFORE creating the payable; on hit returns `{status:'duplicate_warning', requiresOverride, duplicateWarning:{totalHours,totalAmount,entries,message}}` (nothing sent) unless resent with `overrideDuplicateWarning:true`; override stamps `duplicateOverride` audit block on the offcycle doc; both callers (WorkerPaymentsTab + /payroll-costs dialog) show "already has a submitted timesheet for {date} ({h}h, ${total}). Send anyway?" two-phase confirm, warning cleared on date/worker change. Mark also asked re Everee "Paid Externally" opt-in (recommended yes, email support@everee.com) — Everee OTP 2.0 rolling out, no API impact.

**Carrier WC import (2026-07-28):** carrier's "C1 Client Report - Sub Client History.xlsx" (manual email, 126 sites, 5 entities, 85 unique state+code pairs) imported into `tenants/{t}/workers_comp_rates` SCOPED TO C1 Select + C1 Events per Greg: 52 adds + AZ 9014 1.46→1.47 + IL 8044 2.35→3.45 + CA_CA6405 doc re-keyed to code 6504 (typo), all stamped source carrier_report_2026-07-28 (script .scratch/import-carrier-wc-rates.cjs, idempotent). NOT imported: Workforce/Resources/Medstaff pairs (13). Open questions: NJ 9014 + NV 9014 in HRX but not in carrier report (stale?); MA absent from carrier book entirely; carrier shows IL/TX 6504 with two coexisting rates (took max). ⚠️ KEY GAP for the "mapping revisit": matrix rows match by state + jobTitles[] (+modifierAccountId) — the 52 imported rows have NO jobTitles so the programmatic matrix step can't fire (backfill dry-run: would_stamp=1, unresolvable=2507); resolver chain = matrix(state+title+account) → legacy shift→JO→gigPositions→account copy, in backfillAssignmentDenormFieldsCallable.ts resolveWorkersComp. Greg chose HYBRID 2026-07-29: position picker stays truth (JobOrderForm ALREADY auto-fills code+rate on title pick via pricingByJobTitle/workersCompRateMaps — was only missing data); jobTitles harvested+attached to matrix rows via .scratch/attach-wc-jobtitles.cjs (evidence: stamped assignments → JO/gigPosition codes → carrier site-name match → global vote; cross-code dedup: title claimed by 2 codes in one state dropped from all since the auto-default map is keyed state+title→ONE code). EXECUTED: 15 rows got titles, 41 still bare (mostly 6504/7380 states with no HRX JOs yet — fill organically or hand-curate); 35 cross-code dups dropped (CA 9080/9082 + TX 9040/9079 overlap heavily at same sites); Dirty state-prefixed WC codes ("TX9014"→9014, "CA6504"-style) CLEANED 2026-07-29 (.scratch/clean-dirty-wc-codes.cjs — scans assignments/JOs/gigPositions/shifts, matches /^[A-Z]{2}\d+$/ where numeric part is a real matrix code): only 4 spots tenant-wide (Moody Amphitheater JO + Yard Driver JO top+2 shifts, all →6504); matrix itself had 0 dirty code docs. Post-cleanup re-harvest: TX ambiguity gone (0, was 1), +1 attach (CA 6504 ← Yard Driver CDL). Denorm backfill --execute was classifier-blocked (only 1 assignment stampable anyway).

**WC CLASSIFICATION project (Greg 2026-07-29, HYBRID confirmed): three-layer model** — (1) code CATALOG w/ descriptions, (2) title→nature→(state→code+rate) TWO-HOP semantic mapping (NOT title→code: same work = diff code+rate per state; 81 distinct JO titles, only 42/52% exact-match-covered), (3) Everee sync unchanged. Decisions: curate-19 descriptions now + KEEP jobTitles; new codes auto-DRAFT description on creation LATER (draft-then-verify); suggest-only no blind auto-apply (audit risk); "Needs WC review" owner = internal securityLevel 5+. **SLICE 1 SHIPPED (64b7d22c + cfeedca4):** catalog collection `tenants/{t}/workers_comp_class_codes` (was EMPTY — SEPARATE from workers_comp_rates matrix; keyed by code; the WCClassCodesTab.tsx CRUD under Settings>Onboarding Library>WC Class Codes powers JO code dropdown) seeded w/ 19 codes via .scratch/seed-wc-class-codes.cjs (idempotent): +fields description (web-sourced NCCI/CA_WCIRB + enriched, only 2922 unsourced), bureau (NCCI/CA_WCIRB/PA_PCRB), descriptionSource, descriptionVerified:FALSE for all (human confirms before classifier trusts), statesInUse. WCClassCodesTab: Review chip (Verified/Needs review) + bureau/states caption + "Description verified" toggle. JobOrderForm: WC code field helperText now shows catalog title+description ("(unverified)" suffix) via wcCodeHelper() loading wcCatalog once. NOTE descriptions are ONE-per-code (not per-state) — code means one thing per bureau, rate varies by state; C1 has no cross-bureau code collision. **SLICE 2 NEXT (not built): AI classifier** on JO position w/ novel title → appAi.ts(OpenAI gpt-5) w/ title + in-scope codes' descriptions for that state → suggest code+rate+confidence+reason chip; confirm → title becomes new matrix alias (learn-once). **SLICE 3: needs-review queue + coverage dashboard + fold carrier-import+title-harvest into monthly self-serve.**

**Known gaps (Greg acknowledged):** direct payments made inside Everee (outside HRX) appear in no log (⇒ mitigated go-forward by off-cycle feature above); June is a mess pre-tagging.

**Next phases:** P3 = June backfill / venue→JO mapping for the unattributed bucket + reconcile Everee-direct payments (via /api/v2/payments — but see [[reference-everee-environments-and-submit]] wire gotchas: external-worker-id filter silently ignored). P4 = QBO auto-journal: match tag JO name → QBO class, post split journal entries against the wire — AFTER Tabitha validates a month of the manual split worksheets. Related: [[project-qbo-invoicing]], [[feature-ts1-phase4-state]].

## Expediting stuck W-2 wages (2026-08-20, VenueSmart travelers)

Timesheet submits create **worked shifts** for W-2 hourly (payables only
for extras) — shifts pay on the weekly cycle, whose run FINALIZES the
Wednesday morning it pays (~9AM PT). Shifts submitted minutes after
finalize wait a full week. To pay them same-day:
1. ☠️ **A payable alone never surfaces as a payment** — you MUST call
   `requestPayablePayout(cfg, {externalIds, includeWorkersOnRegularPayCycle:
   true})` after creating payables; it groups them into a Needs-Approval
   payment (import path does this — submitImportTimesheetBatch).
2. payCode: **BONUS** (Everee rejects custom codes on /api/v2/payables
   even after provisionCustomPayCodes reports CREATED — the codes exist
   for the dashboard, not the API; 2026-08-05 + re-confirmed 2026-08-20);
   label "Wages — Shift ending YYYY-MM-DD (missed pay-run cutoff)" keeps
   stubs honest + wire-class attribution working; timestamp = work date.
3. **Delete the worked shifts** so no future run double-pays; shifts in
   an approved period 400 ("can no longer be modified") — retry with
   `deleteWorkedShift(cfg, id, {correctionAuthorized: true})` which
   succeeds.
4. Coverage check before converting: parse recent payments'
   earningList notes for "Shift ending YYYY-MM-DD" per
   employee.externalWorkerId — timestamps lie (the run absorbs
   submissions up to the minute it processes).
5. Payments land status=CALCULATED → someone must APPROVE on the Everee
   Payments page (10AM PT cutoff for same-day arrival).
Scripts: functions/.scratch/expedite-stuck-shifts.ts (+ retry/stamp
companions, 2026-08-20). Also ☠️ Everee's PER_DIEM earning code is
FICA-TAXED ($50→$46.17); FIXED 2026-08-20 — import extras + off-cycle
per-diems now ship payCode REIMBURSEMENT (non-taxable). Historical
PER_DIEM-coded earnings were shorted 7.65% (workers) + employer FICA
match overpaid; remediation via Everee support or top-up payables.

## Daily-reimbursement rule (2026-08-27, Prairie View A&M \$5/day parking)

Assignment-level automatic per-day reimbursement: set `dailyReimbursement`
(number) + `reimbursementLabel` on an ASSIGNMENT (and its JO so future
assignments at that location inherit — inherit is manual today: stamp new
assignments when created from those JOs, or re-run the stamp). At submit,
`submitTimesheetEntryWorker` gives every entry with worked hours a
REIMBURSEMENT payable at that amount (untaxed, excluded from OT + WC
premium wages), and stamps `reimbursementAmount`/`reimbursementLabel` on
the entry (the WC audit's reimbursements breakout reads
`entry.reimbursementAmount`). Hours-gated: a day with no hours gets
nothing. An amount already on the entry (import lane) wins over the rule.
To add the rule for another location: set `dailyReimbursement` +
`reimbursementLabel` on the ACCOUNT doc — the resolution chain is
assignment → job order → account (more-specific wins, so one JO can
override its account's rule), meaning new JOs and new assignments under
that account inherit with zero stamping.
Live: Sodexo PVAMU account autoLoc_8ea92d49ea1833ab292a7a091626ec77 —
5 JOs (#219/220/221/222/404) + 12 assignments at \$5 "Parking".

## ☠️ Everee pay-run calc can RACE a batch submit (2026-08-28, Leonard Frett)

Everee auto-calculates a worker's open scheduled payment when worked
shifts arrive — and the calc reads a SNAPSHOT. Leonard's 5 Indeed Flex
shifts (Aug 17–21) were POSTed in one batch at 15:19:03Z; his payment's
`calculationRequestedAt` was 15:19:01Z and `calculatedAt` 15:19:03.56Z,
so the snapshot caught only the first 3 shifts. The last 2 landed
seconds later and did NOT re-trigger calculation; Greg approved the
$432.30 payment at 16:13 and Leonard was paid 24.02 of 40.05 hours.
Nobody else in the 39-entry / 9-worker batch was affected (their calcs
ran after their shifts landed).

Diagnosis path (all read-only, from `functions/`):
- `/api/v2/payments?page=N&size=500&include-workers-on-regular-pay-cycle=true`
  — worker fields live in `employee`/`payeeDisplayFullName`; hours in
  `regularHours`/`totalHours`; shift linkage in `earningList[].note`
  ("Shift ending YYYY-MM-DD").
- `listWorkedShifts` (`external-worker-id` filter works) —
  `payableDetails.paid` / `.paymentId` / `.editable` tell you exactly
  which shifts a payment consumed. There is NO GET-by-id route for
  worked shifts (`/integration/v1/worked-shifts/{id}` 404s).

Unpaid-but-submitted shifts stay `paid:false, editable:true` and should
ride the worker's NEXT scheduled payment; make-whole-today = revert the
entries in the grid (deletes the shifts) + off-cycle payment via UI
(same path as the Zirick 2026-08-28 case). Watch item: after any batch
submit, verify every shift in the batch reaches `paid:true` once the
period's payment finalizes — a post-approval sweep would have caught
this same-day.
