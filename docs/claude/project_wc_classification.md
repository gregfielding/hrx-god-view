# wc classification

> "WC classification project — carrier import, catalog, AI classifier (slice 2 shipped 2026-07-29), and the C1 Events contractor-WC decision"

Workers' comp classification build-out. Two collections: `tenants/{t}/workers_comp_rates` (rate matrix: {state, code, rate, jobTitles[], modifierAccountId?, hiringEntityId?}, keyed state+code, per-state rate) vs `tenants/{t}/workers_comp_class_codes` (catalog: {code, title, description, bureau, descriptionSource, descriptionVerified, statesInUse, active} — one description per code, powers JO dropdown + classifier). Two-hop model: title → nature of work → (state → code + rate). **Matrix scoping extensions (2026-08-05):** optional `hiringEntityId` on a row = entity-scoped rate (doc id `STATE_CODE__e__ENTITY`) that WINS over the generic row for that entity's WC report — C1 Events reports/pays WC on contractors on its own schedule though codes never go to Everee; a jobTitles entry of `'*'` = the entity's PER-STATE DEFAULT code (fallback when an entry has no resolvable title — import rows without assignments); real title matches beat the default. Written via `upsertWorkersCompRate` callable (books-gated) from the /payroll-costs WC report's inline assign controls. **Assign LEARNS THROUGH (2026-08-05):** the callable also stamps code+rate onto matching uncoded assignments in that state (same title; '*' assigns stamp title-less ones) + the report month's uncoded entries (`propagateMonth`), and future assignments classify at creation via the matrix — unmatched payroll shrinks monthly. The assign UI is a state-scoped dropdown (entity's rated codes labeled with catalog titles, rate autofill, 'Other code…' free entry) fed by the report's `stateCodeOptions`. /payroll-costs is TWO TABS (Payroll Report | Workers' Comp Report) under one shared entity picker; both auto-reload on filter change.

**Shipped 2026-07-31 (timesheet WC tooling — matrix everywhere + Everee sync):**
- **Grid resolver matrix fallback** (`timesheetGridResolver.ts`): regular rows resolve WC from the matrix (state+title→code, state+code→rate) when the assignment/shift/JO chain has none — same gap the CSV importer had. Import resolver (`importTimesheetMatchWorkers.ts`) also gained the matrix fallback + `workersCompSource:'matrix'`, and the CSV-import client (`CsvTimesheetImport.tsx`) type-code→autofill-rate + learn-once (`learnWorkersCompAlias`).
- **WC dialog** (`EditWorkersCompDialog.tsx`): asks for the CODE ONLY — `setEntryWorkersComp` resolves the (internal) rate from the matrix by the entry's worksite state+code. Code field is a **state-scoped dropdown** of matrix codes (title+rate), free-typing still allowed. Import rows derive state from the import sidecar (no `assignment.worksiteState`). Save uses `reloadAll` (full re-resolve) — `refreshEntry` does NOT re-run the resolver so the cell went stale. BOTH dialog mount sites in `TimesheetGrid.tsx` must use `reloadAll`: the regular-row site was fixed first (f86a96ee), but the **import-row site kept `refreshEntry`** → picking a new code updated the RATE cell (falls through to the refetched sidecar) but the CODE cell kept the stale `resolvedWorkersCompCode` ("new rate shows but old code persists"); fixed 2026-07-31 to `reloadAll` too.
- **Re-resolve button** (🔗, import grid rows only, `reresolveImportEntry`): reconnects a saved "Needs rate/WC" import row to the worker's assignment (created after import) — `loadWorkerAssignments`+`pairAssignment` date-window, fills payRate+WC+worksite. Regular rows don't need it (they resolve live).
- **Everee WC sync**: `syncWorkersCompToEveree` callable (was UI-less) now has a **"Sync to Everee" button** on the WC Class Codes settings tab (`SyncWcToEvereeDialog.tsx`) — pick entity → Preview (dry-run: creates/updates/inSync/conflicts/evereeOnly) → Apply (POST new, PUT changed, never deletes). SL7-gated. Everee validates (code,state) on every worked-shift against ITS `/api/v2/workers-comp` table, so the matrix must be synced there; the WC RATE reaches Everee via this sync (as rateER), NOT on the worked-shift (which carries only the code).
- **Placeholder code `8040 @ $2.35` "Placeholder"** (Greg): fallback for when the carrier's real code is pending but payroll must go out (Everee requires a code). 26 matrix rows (one per state in use: AL AZ CA CO CT DC FL GA IA IL IN KS KY LA MD MI MN MO NC NJ NV PA SC TX VA WI) + catalog entry, `isPlaceholder:true`. Shows in the WC dropdown for every state; must run the Everee sync to register it there. Script: `functions/.scratch/add-placeholder-wc-code.cjs`.

**Import-entry empty `workState` footgun (fixed 2026-07-31):** on `timesheet_entries` import docs the worksite state can live ONLY in `import.worksiteAddress.state` — top-level `workState` is `''` and there's no top-level `worksiteAddress` at all. `reresolveImportEntry` writes the assignment's `worksiteAddress` but never wrote `workState`, so re-resolving a row whose assignment lacked a worksite address left the state blank → the WC-matrix rate lookup couldn't find a state → the WC dialog showed the no-state fallback (plain text box, no dropdown) and picking a code never resolved a rate ("can't choose a rate"; Christian Brown MO, Kyle Fenwick DC). Fix: all three read paths (`setEntryWorkersComp` `resolveMatrixRate`, `timesheetGridResolver` `buildImportSnapshot` line ~414, dialog derivation) fall back to `import.worksiteAddress.state`; `reresolveImportEntry` now stamps `workState`; one-off backfill `functions/.scratch/backfill-import-workstate.cjs` set it on the 4 affected rows. NOTE the entry field is `workerId` (not `userId`) and the collection is `timesheet_entries` (not `_v2`).

**Shipped 2026-07-29:**
- Carrier import (from carrier "Sub Client History" xlsx): scoped to C1 Select + C1 Events — 52 adds, 2 updates, CA6405→6504 typo fix; dirty state-prefixed codes (e.g. TX9014) cleaned → all 6504. Title harvest attached jobTitles to 15 matrix rows; 41 rows still bare (states with no HRX JOs).
- Catalog seeded: 19 codes with descriptions, all `descriptionVerified:false` (the audit gate). Descriptions web-enriched even when unofficial-but-usable.
- Slice 1: catalog CRUD UI (Settings→Onboarding Library→WC Class Codes, "Needs review" chips, bureau/states captions) + wcCodeHelper shows code meaning on JO positions (commit cfeedca4).
- Slice 2: AI semantic classifier — `suggestWorkersCompCode` + `learnWorkersCompAlias` callables (functions/src/workersComp/suggestWorkersCompCode.ts) + `WcSuggestButton` on both JO WC-code fields (commit 05155407, deployed). Novel title → gpt-5 picks best code FROM state-rated candidates (anti-hallucination filter drops non-candidates); Apply fills code+rate AND writes title back to matrix row jobTitles[] (learn-once). Suggest-only, staff-gated (securityLevel 4+).

**Decisions:** (1) suggest-only, never blind auto-apply (WC misclass = audit risk); (2) KEEP existing jobTitles so current connections don't break; new codes auto-draft description on creation = later step; (3) "Needs WC review" owner = any internal team member securityLevel 5+.

**C1 Events (1099 contractors) WC — Greg 2026-07-29:** C1 DOES pay the WC premium on its C1 Events contractors, so HRX must SHOW wc code + rate on the timesheet tables for C1 Events too — but NEVER send WC to Everee (contractors send none; consistent with [[feature_csv_import_resolution_chain]] "WC is W-2-only"). Not mandatory yet (don't gate submit on it). This is a display/cost-tracking need, distinct from the Everee wire.

**Slice 3 (pending):** needs-review queue + coverage dashboard; fold carrier-import + title-harvest into a monthly self-serve upload; surface WC code+rate on timesheet tables including C1 Events (non-mandatory). Also (later): the off-cycle/worker-profile payment form should resolve WC from JO position (see [[project_payroll_cost_attribution]]).

**2026-08-05 matrix audit vs carrier (InSource) July report — read-only, deliverable = carrier-request doc in session scratchpad:** HRX matrix 101 docs (93 generic + 8 CORT-scoped `modifierAccountId iNJQeuidEg6nJodNeWjc`); ALL overlapping rates match carrier net-effective exactly; 7 carrier rows exist only CORT-scoped (CA 8015, DC/GA/IN/NC/VA 8044, PA 2922 — mirror-to-generic decision pending). July reconciliation Everee $37,385.28 vs carrier $30,425.16 closed to the penny: (1) ⚠️ carrier's "DC 8044 $4,716.20" is actually COLORADO (CO 8044 $3,974.07 + CO 6504 $742.13) misfiled by InSource; (2) $6,960.12 July Select payroll never reached the carrier report (FL 8040/9014, KY/MO/OH 8044, DC 8040, TX 9014, $2.5k no-WC-state); (3) InSource force-fits off-policy codes (NC 9014→billed 8044, TX 8040→billed 9079, entry-level garbled CA6405→6504 — matrix was fixed 7/29 but ENTRIES still carry garbled codes); (4) OH 8044 $396/2 workers = monopolistic state, needs Ohio BWC not the private policy; (5) Everee accrues ER liability at placeholder 2.35 on unrated codes. Coverage asks: CO/KY/MO/TX/MN/FL 8044-class, NC/TX/FL/VA 9014, replace 8040 in 26 states. Events 1099 July $352.8k (Everee custom report has HOME state only — no codes/work location). Everee report builder does NOT expose the worked-shift `note` (JO attribution tag).

**WC-A/B/C SHIPPED 2026-08-05 (same day):** (A) 7 CORT-scoped rows mirrored to generic (doc id STATE_CODE, source cort_scoped_mirror, everee map copied). (B) garbled-code retag (31 docs: CA6405/CA6504→6504 @14.68, VA 0913→9014) + assignment denorm sweep via runBackfillAssignmentDenormFieldsPage (1,037 assignments gained WC; 1,679 still unresolvable = Events/legacy titles) + 31 uncoded Select entries stamped (matrix rate wins over stale assignment copy — CA 9082 assignments carried 3.17 vs matrix 5.26); 1 CA straggler manual. (C) `getWorkersCompMonthlyReport` callable (books-gated, payrollCostReport.ts) + WorkersCompMonthlyCard on /payroll-costs: per-entity calendar-month gross by workState+code, contractor entities flat (no auto-OT), uncoded rows loud, off-cycle payments separate section, CSV export = the monthly InSource upload. July validation: Select 100% coded, $38,586 (Everee $37,385 — estimate delta from rounding/status timing). **MYSTERY SOLVED (2026-08-05 PM):** the audit's "extra generic rows not on the Select policy" (AZ/FL/IL/MD/MN/MO/WI 9014, CA 9008/9016, MI 9015) ARE the C1 EVENTS carrier schedule — Greg produced the InSource "C1 Events LLC" report confirming codes+rates match exactly; the 7/29 import covered both entities. Events matrix seeded entity-scoped from it (.scratch/seed-events-wc-matrix.ts, 12 rows w/ per-state '*' defaults matching how the carrier bills; CA→9016, TX→9014 dominant). July Events unresolved: $144.7k → $24k (only NY $22.6k / DC $1.1k / CT $402 — states ABSENT from the Events schedule = coverage asks, same pattern as Select). ⚠️ InSource bills Events WC by worker HOME state (Everee 1099 report has no work location): carrier TX $121k home-state vs HRX TX $77k work-state; WC properly follows work state — Greg has grounds to correct with InSource using the HRX report. Report UI: class code is CLICKABLE (popup of state's codes w/ rates + 8040 + custom; picking loads matrix rate; saving a different code = RECLASSIFY — moves entries+assignments off the old code + relearns titles, `reclassifyFromCode` param). Remaining: WC-D now ≈ only 8040 replacement + TX 8810 disposition after carrier reply; WC-E (Greg: InSource letter/restatement/Ohio BWC + Events NY/DC/CT coverage ask + home-vs-work-state billing correction).

**Travel-crew WC + readiness rule SHIPPED 2026-08-05 PM (commits e33b7d1b, 02329f56):** (1) `EditWorkersCompDialog` gains a **Work state picker** when a row has no resolvable state (traveling crews — [[feature-venuesmart-travel-crew]]); pre-selected by an uppercase 2-letter token sniffed from worksiteName+csvSite ("Mubadala Citi DC Open" → DC — the token usually lives in `csvSite`, NOT the worksite name, which is just "Venuesmart"); `setEntryWorkersComp` accepts `workState`, uses it in the matrix lookup, and stamps `entry.workState` when empty so the WC monthly report classifies it. 8040 is ALWAYS offered (dialog appends a synthetic option; server `resolveMatrixRate` falls back to $2.35 for 8040 with no matrix row — mirrors the report's synthetic convention). (2) **Readiness rule (Greg):** a W-2 import row needs BOTH WC code AND a resolved rate to be `ready` — enforced in ALL matchStatus derivation sites (setEntryWorkersComp, setImportEntryPayRate, reresolveImportEntry, recheckImportTimesheetBlocks, reassignImportEntryWorker) + client `rowNeedsWc`; 1099 exempt. ⚠️ Trap found: rows imported under the Events (1099) context that the assignment override moves to Select were computed 'ready' under 1099 rules — sweep `.scratch/sweep-ready-wc-rate.ts` demoted 10 (executed). (3) Grid QoL: WC/rate/hours/tips edits refresh IN PLACE (refreshEntry overlays resolved WC; mergeShiftWc mirrors the shift back-fill locally — no more full reload of 400+ rows); **apply-to-all** on the grid: worker reassign offers same-CSV-name rows, WC save offers same-site rows missing a code (window.confirm, mirrors Import tab). (4) PeriodPicker: weekly entities get "Custom range…" → manual date pickers (Mon–Sun weeks) + "Back to weeks".

**Insured LOCATION schedule LOADED (2026-08-14):** Greg re-produced "C1 Client Report - Sub Client History.xlsx" — it IS the insured-worksite schedule (the July import only extracted state/code/rate and discarded the location columns): 126 rows = Client(entity) | Sub-Client name | street/city/state/zip | class-code-state | code | rate, across FIVE entities (Select 89, Events 20, Workforce 12, Resources 4, Medstaff 1). Loaded into `workers_comp_policy_locations` (doc id entity__STATE__nameKey__zip__code__street — code+street suffixes REQUIRED: the schedule lists the same site once per class code and per insured street address, 27 rows collapsed on coarser ids; source insource_sub_client_history_2026-08-14, `.scratch/load-wc-policy-locations.ts` with --wipe flag; file kept in functions/.scratch, NOT committed). **WC Worksites tab SHIPPED 2026-08-14 (commit 2769d222):** Settings→Onboarding Library, between WC Class Codes and 8040 Placeholders — client-side Firestore read (new staff-read rule on the collection), entity-count chips as filters + state dropdown + search; verified live: 126 locations / 27 states. Delta vs live worksites (18): only 3 uncovered — VenueSmart HQ Independence MO (stateless travelers artifact), **Joliet Memorial Stadium IL (Proof of the Pudding, Events)**, **Flushing Meadows NY (Venue Smart, Events — matches the audit's NY gap)** → add to the InSource letter. **8040 Placeholders tab SHIPPED same day** (Settings→Onboarding Library, `getWcPlaceholderUsage` books-gated callable — needed `cors:true`, and its CREATE hit the Cloud Run 1,000-services/region cap: Greg deleted scheduledEverifyPoller to free a slot; ⚠️ project is AT the cap — every new function needs a dead one deleted first; ~35 reclaimable = 17 E-Verify stubs + 19 legacy orphans). Live numbers at ship: 11 workers, $14,843 recent gross at $2.35, 8 coverage asks, 0 replace-now (VenueSmart travelers DC/MI/WI dominate; ORS Nasco TX, Carrier MD forklift, CORT Baird WI + Harriet Island MN).

**WC-E letter WATCH (2026-08-14):** Greg is drafting/sending the consolidated InSource letter himself. WATCH the inbox (chief-of-staff brief will surface it) for InSource's response and process it against the ask list: (1) July restatement + CO-misfiled-as-DC correction, (2) Ohio BWC (monopolistic state), (3) Select coverage asks CO/KY/MO/TX/MN/FL 8044-class + NC/TX/FL/VA 9014 + replace 8040 placeholder in 26 states, (4) Events coverage NY/DC/CT, (5) Events home-vs-work-state billing correction (HRX work-state report is the evidence), (6) **current location/worksite schedule if one exists** → load into `workers_comp_policy_locations` (collection exists, EMPTY; setWorkersCompPolicyLocation callable) so HRX can flag off-policy sites; if state-rated-only, record that in the memory. Response also unblocks WC-D (keep-or-retire off-policy matrix rows). The original "C1 Client Report - Sub Client History.xlsx" (2026-07-28) is gone from disk; the policy schedule is reconstructable from the matrix (source ^carrier_report|^cort_scoped_mirror, 73 rows — rebuilt CSV sent to Greg 2026-08-14).

**Canonical WC picker (Greg directive 2026-08-05 evening, commit eabe08be):** `src/components/workersComp/WcCodeSelect.tsx` is THE reusable WC class-code field — matrix by worksite state + hiring entity (entity-scoped rows win over generic, 8040 always offered @ synthetic $2.35, rate follows the pick via `onChange(code, rate)`, free-typing allowed). Adopted: EditWorkersCompDialog, FixAssignmentDialog, JobOrderForm (career + gig-position WC fields — picking a code auto-fills the rate field). STILL TO MIGRATE: CsvTimesheetImport inline WC cells, WorkersCompMonthlyCard assign dropdowns. ⚠️ DC bug fixed same day (7cd9bc06): normalizeUsStateCode (server functions/src/recruiter/usStateNormalize.ts + client mirror) had 50 states but NO DC → every DC matrix rate lookup silently failed (code changes kept stale rates); DC added to both maps + resolveMatrixRate prices 8040 even with no state; 14 mispriced rows swept (.scratch/sweep-reprice-wc-mismatch.ts), 21 needs_wc rows chain-completed (.scratch/sweep-needswc-chain-complete.ts).

## 2026-08-25 — coverage dashboard live + two data migrations (Greg approved)

- Coverage dashboard /reports/wc-coverage + Mass PN export shipped (see
  commit e0848b8d). First run showed $1.02M "no policy record" exposure —
  which was a RECORDS gap: `workers_comp` (policy headers) was completely
  empty.
- **Policy-record seed**: 44 (entity,state) records created from the
  carrier's own insured-worksite schedule (workers_comp_policy_locations),
  carrier InSource, active, `source: 'derived_from_policy_locations_
  2026-08-25'` — ☠️ effective/expiration dates + policy numbers are EMPTY
  (unknown; get from broker and fill in Settings → Workers' Comp; empty
  dates count as always-covering in the coverage engine until then).
- **True residual exposure: $132,650/90d in states NOT on the carrier
  schedule** — C1 Events: TN $62.1k, NY $55.5k, CT $4.9k, DC $2.4k, VA
  $0.6k; C1 Select: WI $7.1k (WI is on EVENTS' schedule, not Select's —
  the per-entity distinction matters). These are exactly the Mass PN rows
  the dashboard now exports.
- **Bill-rate backfill** (FIN-1 follow-through): 3,761 timesheet entries
  since June stamped with billRate via assignment (3,029) → JO position
  (700) → account flat markup (29); marker `billRateBackfill`. 44 entries
  /$7.2k unresolvable; 4 skipped (bill < pay suspicious). Accrual
  coverage 45% → **99%**; window truth: pay $1.019M, bill $1.315M,
  ~22.5% gross margin.

## 2026-09-05 — Select matrix audited vs the LIVE portal schedule (Greg's screenshots)

Greg produced screenshots of the InSource portal's C1 Select August filing
form — the authoritative 59-line active schedule (AL 9014 … VA 8046, incl.
CA(3) block + IL 8810 clerical). Audit result: **all 59 lines present in
HRX, all rates match to the penny, zero missing.** But 15 rows were VISIBLE
to Select off its policy: 11 were the C1 Events schedule still living as
GENERIC docs (AZ/FL/IL/MD/MN/MO/TX/WI 9014, CA 9008/9016, MI 9015) — titles
merged into the existing Events-scoped twins, generics DELETED (Select no
longer sees them; Events unaffected, scoped rows win). 4 were on NEITHER
schedule (NJ 9014, NV 9014, NV 9083, TX 8810) — titles merged into the
generic STATE_8040 placeholders, orphans deleted, per Greg ("changed to
8040 placeholders until we fix"). 41 Aug Select entries riding WI/MO 9014
($6,928.56 WI + $1,787.45 MO) restamped 8040 @2.35 — they surface on the
8040 Placeholders tab + the InSource letter's MO/WI coverage asks; the
portal has no 8040 line so they are NOT filed. ⚠️ Lesson: generic matrix
rows leak across entities — when a carrier line belongs to ONE entity,
scope it (`STATE_CODE__e__ENTITY`); the audit script pattern lives in this
session's history (compare Select-visible rows vs the portal table).

**InSource portal filing view SHIPPED same day:** getWorkersCompMonthlyReport
rows carry regGross/otGross/dtGross (reg absorbs premiums/tips/bonus +
rounding; contractor entities flat in reg) + `includeWorkerDetail` returns
per-(state,code,worker) rows. /reports/workers-comp table shows the three
columns in the portal's entry order; Export Excel = 'Filing lines' sheet
(portal column order) + 'Worker detail' sheet (the post-submit "actual
data" upload). Entities filed from HRX: Select + Events; Resources files
from Gusto.

**Coverage-ask "order form" SHIPPED 2026-09-05 PM:** /reports/wc-coverage
now answers "what do we ASK the carrier for": each carrier-ask cohort gets
a suggested REAL class code — the dominant code the same job titles carry
in the entity's OTHER rated states (matrixFor gained titleCodes/codeRates;
8040 never suggested) — plus that code's rate range on the existing
policy. New "What to ask the carrier for" table (entity + state + code +
titles + gross + annual est. + comparable rate; novel titles show a
"needs classification" chip), and the Mass PN export's Class Code column
now carries the suggested code with basis + comparable range in Notes.
First live run (90d): Events TN/NY/CA/CT -> 9014 @1.34-3.25; Select
KY/MN/TX/MO/WI -> 8044 @1.38-3.45, MD -> 8018 (Forklift) @4.34. Headline:
8040-needs-carrier $171k/90d, coverage exposure $135.8k (Events no-policy
states).

**Mass PN client resolution (2026-09-05 PM):** chain = assignment account →
entry.accountId (only linkage on most import rows) → job order →
parentAccountId walk to the TOP-LEVEL account (never a child venue), plus a
conservative site-name match against top-level account names (≥5-char base
token). Site→account facts from Greg: "Minneapolis St. Paul Office" =
Purolator (ZQIA66WQkAhPwRDzekdj), "Houston Distribution Center" = ORS Nasco
(TVzTtGoeuvd69MskPZF7) — 21 Indeed Flex import entries had no accountId and
were stamped; future imports for these sites should carry the account or
they'll blank again ("fill in client" is the honest fallback, never guess).

## ⚡ STANDING WATCH + PLAYBOOK — InSource/Eddie replies (Greg 2026-09-05)

Eddie Mas… = **eddiem@insourcees.com**, InSource account manager for bulk
coverage requests (OOO until 2026-09-08). Greg manually sent the first
auto-built Mass PN 2026-09-05 ("Coverate Request C1 Select" thread) asking
"does this spreadsheet work?".

**WATCH every InSource email (the inbox brief surfaces them). On reply:**
1. **Format feedback on the Mass PN** → adjust BOTH builders to his spec:
   client `src/pages/reports/WcCoveragePage.tsx` (buildMassPnWorkbooks) and
   server `functions/src/workersComp/massPnAutoSubmit.ts`
   (buildMassPnXlsxBase64) — they must stay in lockstep.
2. **New coverage granted (codes/rates)** → close the loop the same session:
   (a) upsert `tenants/{t}/workers_comp_rates` rows — net effective rates,
   generic vs entity-scoped per WHICH policy granted them; move the affected
   jobTitles off the STATE_8040 row onto the new row; (b) run the **Everee WC
   sync** (Settings → Onboarding Library → WC Class Codes → Sync to Everee,
   per entity, Preview then Apply — Everee validates (code,state) on every
   worked shift, so unsynced new codes BLOCK payroll); (c) **reclassify the
   8040 payroll** onto the new codes via the WC monthly report's clickable
   code → reclassifyFromCode (moves entries+assignments, relearns titles);
   (d) verify on the 8040 Placeholders tab + /reports/wc-coverage that the
   cleared states dropped out. This is the regular 8040-clearing motion.
3. **Policy/schedule changes** → update `workers_comp` policy records and
   `workers_comp_policy_locations`.

**Automated 14-day Mass PN send LIVE:** `runMassPnAutoSubmitForTenant`
(functions/src/workersComp/massPnAutoSubmit.ts) rides
scheduledScoringDistribution nightly; config
`tenants/{t}/settings/wcMassPnAutoSubmit` {enabled, entityIds
[c1_select_llc, c1_events_llc], cadenceDays 14, windowDays 21, lastSentAt}.
Window 21d on 14d cadence ON PURPOSE (timesheet keying lag — strict 14/14
would permanently miss late-keyed hours). Seeded lastSentAt 2026-09-05 →
first auto-send ~09-19. Emails go from Greg's connected mailbox
(gmailClientFor), one per entity with ask rows, subject "New bulk coverage
request for <Entity>". Manual sends: "Submit to Eddie" button on
/reports/wc-coverage (books-gated callable emailMassPn mode; file
byte-identical to Export).
