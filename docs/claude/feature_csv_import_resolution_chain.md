# csv import resolution chain

> "How the CSV timesheet importer resolves each Everee-bound field per row (worker, pay rate, WC, worksite) + the learn-once mappings"

The CSV timesheet importer ([[project_csv_timesheet_import]]) resolves each row to a complete Everee payload through a layered chain. Server: `functions/src/timesheets/importTimesheetMatchWorkers.ts` (the `importTimesheetMatchWorkers` callable). Client grid: `src/components/timesheets/CsvTimesheetImport.tsx`.

**Everee payload fields per row** (what actually gets submitted): `externalWorkerId` (Everee worker UUID), `effectiveHourlyPayRate`, `workersCompClassCode` (CODE only — WC *rate* is internal, NOT sent), and a numeric `workLocationId` resolved at submit from the worksite address (flat POST: street→line1, city, state, zip→postalCode; externalId=HRX worksiteId makes it idempotent). See [[feedback_everee_wire_gotchas]]. **WC is W-2 only**: for 1099 entities (`HiringEntity.workerType === '1099'`, e.g. C1 Events LLC) Everee takes NO workers-comp code/rate — the importer shows WC as "n/a · 1099" and never gates Ready on it; the future submit composer must omit WC for 1099.

**Two customer sources** (the importer is multi-customer): **Indeed Flex** (CSV, email match key) and **Connect Team** (xlsx via SheetJS — VenueSmart crews, always paying entity C1 Events LLC; the "All Employees" sheet has NO email so workers match by name — see name-match path in [[feature_csv_import_resolution_chain]]'s worker-identity section; "Type" column = the event/site, "Daily total hours" = net payable).

**Worker identity** (raise hit rate, slice #1):
1. Remembered email→worker alias wins outright — `tenants/{t}/timesheet_worker_aliases/{normalizedEmail}` via `saveTimesheetWorkerAlias` callable (`timesheetWorkerAliases.ts`).
2. Email lookup with expanded variants (raw/lower/trim + `normalizeEmail`: +tag stripped, gmail dots removed). Duplicate-email tiebreak prefers the Everee-linked record.
3. No match → bounded `lastName` query (indexed, capped — NEVER a tenant-wide scan, per [[feedback_conditional_worker_layout]]'s sibling footgun) → name-fallback suggestions; ambiguous email → the colliding records. Suggestions surface in a "Resolve worker" dialog; confirming saves an alias.

**Pay context (rate / WC code+rate / worksite)** — resolution order:
1. Paired assignment (date window contains workDate) → assignment.payRate, then shift→JO chain for WC/worksite.
2. Site→JO mapping — `tenants/{t}/timesheet_site_mappings/{customer}__{normalizedSite}` via `saveTimesheetSiteMapping` (`timesheetSiteMappings.ts`); resolveJobOrderFields picks JO position by role.
3. **Account backfill** — when the JO is silent on WC code/rate or worksite address, fill from the child account: `accounts/{accountId}.workersCompCode` / `.workersCompRate` (top-level) + worksite via `loadWorksiteFromChildLocation(db, tenantId, accountDoc)` (exported from `functions/src/jobOrders/gigJobOrderFromChildAccount.ts`; reads `crm_companies/{companyId}/locations/{locationId}` using account's `companyId`+`companyLocationId` or `associations.locations[0]`).
4. Inline manual override — pay rate / WC code / WC rate are click-to-edit in the grid (session-local, win over resolved, survive re-match; will flow into P4 submit).

WC chain (codes): entry/shift → JO.workersCompCode → JO.workersCompClassCode → JO.gigPositions[0].workersCompClassCode → account. JO doc paths walked: `job_orders`/`jobOrders`/`recruiter_jobOrders`.

**Everee submit REQUIRES a worksite STREET (2026-07-31):** `submitImportTimesheetBatch.ts` (~L902-919) reads `row.worksiteAddress`, and when `.street` is empty **falls back to `entry.import.worksiteAddress`**; if still no street → hard error "worksite \"X\" could not be attached — its address has no street on file" (Everee can't create the work-location, so WC would bill the worker's DEFAULT state). Import rows often carry state/city/zip but no street. The authoritative street lives on the **linked EVENT JO** — NOT a csvSite→JO *name* match (event JO names differ from csvSite, e.g. csvSite "FIFA WC Dallas" → JO "FIFA Fan Festival Dallas" @ 3809 Grand Ave; "NYC ADIDAS World Cup" → "Adidas FIFA NY"). Resolve via the most-common non-generic `jobOrderId` among that csvSite's rows, EXCLUDING the generic catch-all JO `X4Zav0bM6fMB18B6yDiA` "Venue Smart Supervisors Travel Team" (worksite Independence MO, blank state — wrong for traveling event crews). Backfill script `functions/.scratch/fix-import-street.cjs` filled 2317 rows from event JOs; ~14 event sites (Governors Ball, Travelers Championship, Womens Open USGA, several concerts) have NO street even on the JO → Greg updating those JO addresses, then re-run the fill for those sites. Separate per-worker Everee errors NOT fixable via data: 500 "No hourly position present" (worker has no hourly W-2 position in Everee) and 404 "resource does not exist" (worker not onboarded in Everee).

Deploy gotcha: `firebase deploy --only functions:...` hit a transient `Build failed with status: EXPIRED` (Cloud Build infra, not a code error) once — just retry the same deploy.

**W-2 submit composer upgrade (2026-07-06, commits 41483b97 + a7caed4f)**: worked shifts now use the CSV's real clock-in + break duration (state→IANA TZ conversion; window end DERIVED = start + net + unpaid break so Everee's minute-floor can't reject; noon-UTC synthetic remains the no-clock fallback) and an FLSA weekly-40 OT cascade (`importWorkedShiftComposer.ts`: Sun–Sat weeks, prior-batch same-week hours consume the threshold first, REGULAR+OVERTIME segments at 1.5×, minute-aligned). Entry docs mirror the reg/OT split. **POLICY (Greg): auto-OT applies ONLY to C1 Select LLC** — hard `AUTO_OT_ENTITY_IDS = {'c1_select_llc'}` allowlist in submitImportTimesheetBatch.ts; other W-2 entities get real windows/breaks but stay straight-time; 1099 (C1 Events) untouched (payables, no OT concept). CA daily-8/DT rules NOT implemented — must be added before any CA-site CSV is imported. Discovery that motivated it: Everee's worked-shift endpoint REQUIRES fullyClassifiedHours and never auto-classifies (the original "Everee adds OT" assumption was wrong) — Zirick Brooks week 6/22–6/26 paid 44.6h flat, ~$41.40 OT premium owed; retro adjustment for that paid week deliberately deferred pending Greg's go-ahead.

**Unification 2026-07-19 (commit a0c43b1f, deployed):** the two learn-once
stores now teach each other. importTimesheetMatchWorkers falls back to
`venue_aliases` (Shifts Log "Link to account") when no site mapping hits —
alias→account→inbox gig JO→fields, then self-writes the site mapping.
saveTimesheetSiteMapping cross-writes the venue alias. Resolution chain is
now: assignment → site-map → venue-alias → JO-name match → account-backfill
→ inline edit.

**billRate JOINED THE CHAIN 2026-07-20 (0c44f86d):** matcher resolved
payRate only — billRate now rides every path (assignment→shift→JO pos→
JO; site-mapping/venue-alias/JO-name) + client threading (MatchRowResult,
RowOverride, JobOrderOption picker overrides, effective(), save payload —
CSV bill column still authoritative when present). Backfill applied: 24
Connect Team wk-7/12 rows (FIFA Fan Fest KC $20, MN Country Club $20
Greg-confirmed, FIFA Fan Fest Dallas $20 [pay 15-16 → Venue Smart, NOT
Black Caviar 20/29], Adidas FIFA NY $23); 2 rows repointed off wrong JOs;
MN JO stamped 16/20; 4 connect_team timesheet_site_mappings taught.
Wk 7/12 money view: bill $24,008→$27,147 (+$3,139), margin 20%→29%,
missing-rate rows 26→2. Script: .scratch/backfill-import-bill-rates.cjs.

**MN CORRECTION (Greg, 2026-07-20):** "Minnesota Country Club Fest" CSV
site is actually the MINNESOTA YACHT CLUB → JO #315 tbv9Wfk0jtLFv1ZAIt18
(Venue Smart, 16/21.44) — NOT "Minnesota Country Club" #209 and NOT
Black Caviar's Yacht Club #311 (20/29; pay disambiguates). 12 rows
repointed + bill 20→21.44, site mapping retargeted, #209 rates reverted
to 0/0 (was never priced; my 16/20 stamp was based on the wrong match).
Lesson: CSV venue names are loose — confirm against JO # / pay rate
before mapping.

**ENTITY OVERRIDE (2026-07-22, 9501972f, deployed
saveImportTimesheetRows):** the paired ASSIGNMENT's hiringEntityId is
AUTHORITATIVE over the import screen's entity picker — when they
differ, the entry is stamped with the assignment's entity +
`import.entityOverrideFrom` audit field. Built for the Venuesmart
Supervisors Travel Team exception (JO X4Zav0bM = W-2 under
c1_select_llc while Venuesmart account default is c1_events_llc/1099;
workers still arrive in the ConnectTeam CSV imported under Events).
Downstream (grid, Everee submit, metrics) all key on entry
hiringEntityId → hours auto-land on C1 Select. JO + 5 assignments
flipped to c1_select_llc same day (also revived from born-broken
end==start). Caveat: resume-load/clear-stale in the Events import
session won't see overridden entries (they're Select's) — harmless,
doc ids deterministic so re-saves are idempotent.
