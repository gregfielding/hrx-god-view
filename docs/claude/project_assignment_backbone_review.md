# assignment backbone review

> "2026-07-23 full review — assignment is truth for pay/bill/schedule/identity/entity but WC code+rate and worksite street NEVER exist on assignments (no writer stamps, no consumer reads, 0/135 live docs); fix plan proposed"

Greg's intent (2026-07-23): the assignment doc = single source of truth for
"who's working" — worker, JO + type, pay, bill, WC code/rate, schedule,
worksite address, entity — read by Timesheets, JO Assignments tab, Who's
Working. Full 3-way review run (writer sweep + consumer sweep + prod audit
of 135 live assignments).

**Solid:** payRate, billRate (93%), weeklySchedule/isOpenShift, worker
identity (`workerDisplayName`+first/last, userId/candidateId), jobOrderId,
`jobOrderType` (NOT jobType), jobTitle, worksiteName, `worksiteState`,
hiringEntityId, accountId/companyId, status — 100% coverage and read
faithfully by all surfaces. Entity override in saveImportTimesheetRows
reads assignment.hiringEntityId = correct truth usage.

**Two systematic model gaps (root cause of the 2026-07-23 payroll saga):**
1. **workersCompCode/Rate: NOT an assignment field.** No writer stamps it
   (placementsApi, addRetroactiveWorker, swap, denorm trigger — none);
   no consumer reads it (grid resolver, import matcher, both Everee
   submit paths all resolve shift→JO→gigPositions→account); 0/135 docs
   have any WC key. Import matcher DOCSTRING claims assignment-first — false.
2. **worksiteAddress street/city/zip: NOT an assignment field.** Only
   name+state+lat/lng exist. Every surface joins job_orders.worksiteAddress
   (Who's Working, AssignmentDrawer address line, getOngoingAssignments,
   import matcher, submit work-location).

**Secondary findings:**
- placementsCreateAssignments does NOT set hiringEntityId/weeklySchedule/
  accountId at birth — relies on async onAssignmentWriteEnsureDenormFields
  trigger; JO lacking recruiterAccountId leaves them unresolved.
- entry.payRate is a FROZEN creation-time copy (createDraftTimesheetEntry) —
  drawer rate edits don't propagate to existing entries.
- Data: 9 live missing billRate (Breona@Sodexo, Richard Lewis ×2 @Domino's…),
  5 missing worksiteState (Venuesmart C1 Select crew from the entity flip).
- Legacy client-side creator src/services/phase2/assignmentService.ts
  (CreateAssignment.tsx, 'current-user' TODO) mints incomplete docs — retire.
- useActiveShifts/Shifts page reads NO assignments (JO/shifts only) — not an
  assignment surface despite the name.

**FIX SHIPPED 2026-07-23 (c9c02de8 + f0c3872b), Greg approved with "WC
is programmatic" caveat:** WC resolves MATRIX-FIRST from
tenants/{t}/workers_comp_rates (state + jobTitle exact-match lowercase;
account-scoped rows via national-parent modifier beat generic — mirrors
src/utils/workersCompRateMaps.ts), legacy shift→JO→gigPositions→account
chain as fallback + matrix rate top-up by (state,code). Implemented in
the SHARED denorm resolver (backfillAssignmentDenormFieldsCallable.ts
resolveWorkersComp/resolveWorksiteAddress) so trigger + backfill both
stamp; trigger pre-filter gates on code+street only (rate/source
diff-ignored). Backfill run: 2,610 addresses + 872 WC over 2,692 docs,
0 errors; 135/135 live have streets. Consumers flipped assignment-first
(entry overrides still win): importTimesheetMatchWorkers,
submitTimesheetBatch pre-flight (new assignmentCache), grid resolver
Step 4a (AssignmentSnapshot now carries workersCompCode/Rate).

**Remaining (Greg's court):** 12 live C1 Select W-2 assignments have NO
WC because the MATRIX lacks rows for their state+title (KY/CO/MA/NC
warehouse + Venuesmart travel team) — never invent; he adds rows in
Settings → Workers Comp, then re-run .scratch/run-denorm-backfill.cjs
--execute. 9 live missing billRate have no bill on shift/JO either
(true data entry). Venuesmart travel team has no single worksiteState
by design. Greg's "NOTE: we…" message was truncated — follow up.
Related: [[project_scheduling_system_review]], [[feedback_everee_wire_gotchas]].
