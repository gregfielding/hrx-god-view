# scheduling system review

> Top-down review of HRX scheduling/assignment architecture + the drift diagnosis and phased fix (2026-07-17)

Greg asked for a top-down review of HRX scheduling: keep "active workers"
accurate, sync with Indeed Flex + Fieldglass, report who's assigned last
week (payroll) / upcoming, show scheduled hours→cost/profit, track/grow
full-time. Deliverable was an assessment (artifact:
https://claude.ai/code/artifact/391ea4ec-1111-4976-a777-2fa59f94067b), NOT
a build — nothing was changed. Grounded in a 4-agent code trace + live
read-only data audit (scratch scripts `scheduleAudit{,2,3,4,5}.ts`).

**Architecture ground truth (verified):**
- TWO stores, different roles (NOT two formats): `tenants/{t}/placements`
  = lightweight pre-offer "earmarked" marker (no status/rate, feeds
  nothing); `tenants/{t}/assignments` = THE engagement (full lifecycle
  pending→confirmed→in_progress→completed/cancelled, payRate+billRate,
  denorm schedule+entity). Both use ids `${shiftId}__${userId}` (legacy/
  open) and `${shiftId}__${userId}__${date}` (day-scoped gig). See
  [[project_placement_id_dual_format]].
- Chain: `job_orders/{jo}/shifts/{shift}` (schedule+rate truth) →
  `assignments` (denorm snapshot via onAssignmentWriteEnsureDenormFields)
  → client `resolveTimesheetGrid` expands per active day →
  `timesheet_entries/{assignmentId}_{workDate}` → Everee.
- "Active per day" = assignment date-window overlaps period AND
  (weeklySchedule DOW enabled OR open/single-day-gig in range).
  `src/components/timesheets/timesheetGridResolver.ts:432`.
- **The grid query has NO status filter** — correctness relies on
  HARD-DELETING assignments on removal. placementsCancelAssignment /
  separateWorker / swapScheduledAssignmentWorker delete. But
  `shiftAssignmentCascades.ts` (shift-cancelled, app-withdrawn) only
  status-flips → phantom payable rows survive.

**Live data (C1 Select, 2026-07-17):** assignments 2,664 (86 upcoming/25
workers: 28 confirmed+56 pending); placements 811 (1 upcoming, vestigial);
stores share only 378 keys (1,607 only-assign, 403 only-place); 319 JOs;
≥19 cancelled assignments overlap current window w/ schedule shape
(phantom rows); 2,584 assignments carry pay+bill (margin is derivable, no
schema change).

**Integration fidelity:** Indeed Flex = DRY-RUN only, never mutates, apply
path (Slice 5) never built, is the ONLY source naming booked workers (on
cancel/no-show). Fieldglass = real upsert keyed on posting ID + close/halt,
but backfill won't lower headcount, change an existing rate, or move dates;
closes need manual "Sync Sodexo" or unproven closure-email. NO reconcile
cron either side; no outbound HRX→portal sync. See
[[project_fieldglass_intake_pipeline]], [[feature_indeed_flex_automation_roadmap]].

**What exists vs missing:** worker "My Assignments" view EXISTS (reads
assignments). Finance engine EXISTS (`src/utils/gigFinanceFromShifts.ts` →
FinancesBudgetingPage bill/gross/net weekly) but hides the hours number +
margin %, JO-scoped only. Full-time tracking = DOES NOT EXIST (only a
worker preference chip). Time-windowed "who's assigned last week/upcoming"
staff report = DOES NOT EXIST (ActiveWorkersTable is today-only, per-account).

**Recommended sequence:** P0 add resolver status filter (kill phantoms) +
nightly divergence sweep; P1 reconciliation board + build Flex apply path +
tighten FG backfill; P2 one-step placement UX THEN enforce HRX-first; P3
who's-assigned report + surface hours/margin + full-time tracker; P4 worker
app + two-way API sync.

**Greg's decisions (2026-07-17):** (1) 100% committing to HRX-first
(dual-entry into portals accepted); (2) fund the Flex apply path; (3) OT
bills at 1.5× the bill rate. Said "Start Phase 0".

**Phase 0 BUILT + validated locally (NOT yet committed/deployed):**
- P0-1 `src/components/timesheets/timesheetGridResolver.ts` — added
  `isRemovedAssignmentStatus` + `REMOVED_ASSIGNMENT_STATUSES`; drops
  cancelled/declined assignments from generating rows but PRESERVES any
  row with a materialized timesheet_entry (no paid work vanishes).
  Validated: 18 phantom rows dropped, 0 had entries. Client tsc clean.
- P0-3 `functions/src/scheduling/scheduleDivergenceSweep.ts` — daily
  `onSchedule` (11:00 UTC) + on-demand `runScheduleDivergenceSweep`
  callable (level≥5 gate), writes `tenants/{t}/schedule_divergence/{date}`
  + `/latest`. Two findings: STALE LIVE (live-status assignment past its
  end date + grace, or on a killed JO) and COVERAGE GAPS (upcoming shift
  needed>filled). Exported from index.ts. Functions tsc clean.
- Live C1 numbers: **2,180 stale live** assignments (confirmed/pending
  left on shifts ended back to Feb — never completed) + **22 upcoming
  shifts short 923 seats** (Venue Smart janitorial dominates).

**Phase 0 SHIPPED 2026-07-17** (Greg: "ship it and clean up/dry run"):
committed on branch `phase0-scheduling-hygiene` (commit ee2c9376, LOCAL,
not pushed/merged); deployed `firebase deploy --only
functions:scheduleDivergenceSweep,functions:runScheduleDivergenceSweep`
(both created) + hosting (resolver fix live at hrx1-d3beb.web.app). Sweep
cron runs 11:00 UTC daily.

**Stale cleanup EXECUTED 2026-07-17** (Greg approved after initial
classifier block): 2,148 assignments flipped →completed
(previousStatus/completedReason/notificationsSuppressed stamped;
reversible). Verified: staleLive 2,180→33, live book now 197. The
remaining 33 are open/standing crew rows the
completeExpiredOpenShiftAssignments cron is missing (likely only queries
isOpenShift==true, misses noFixedTimes-only) — spawned a background task
chip for that fix.

**JOBS-BOARD REDIRECT FIX shipped 2026-07-17** (commit de491ffa, deployed
hosting): JobPostingDetail rendered ANY posting by direct URL regardless
of status. Added redirect-to-board guards: job_postings status!=='active'
and job-order-* not open/filled → navigate(replace) to
/{tenant}/jobs-board. Verified live (cancelled JO #222's URL bounces to
board).

**Phase 1 IN PROGRESS.** P1a done (commit f42f1547, deployed): sweep's
third finding `orphanedLivePostings` — active job_postings on killed/
missing JOs (0 currently). P1b-server done (commit 498e7a7c, DEPLOYED):
`indeedFlexApplyShiftRequest` callable (level 5+) — cancel_booking rows
with matchedAssignmentIds → flip each live assignment cancelled (worker
push fires) then hard-delete, stamp row status 'applied' w/
appliedAt/By/Result; other event types failed-precondition for now.
P1b-UI done (commit 882d7a23, deployed hosting): "Apply in HRX — cancel N
assignments" button on cancel_booking rows in ShiftsLog/ShiftLogEntry,
destructive-ack gated, calls the callable, surfaces skipped reasons.
P1d-1 done (commit e0cfa38a, deployed onFieldglassIngestEventCreatedParse
+ fieldglassEnrichmentQueue + fieldglassEnrichmentIngest): backfill now
UPDATES pay/bill/headcount when machine-owned (empty/default OR equals
`fieldglass.lastSyncedPayRate/BillRate/Headcount` stamp; hand-edits never
clobbered; every pass re-stamps). Caveats: posting-side rate is still
fill-only (posting payRate updated only when <=0); date moves deferred
(needs JO date-field normalization check — enrichment has MM/DD/YYYY
startDate/endDate).
**SELF-REVIEW 2026-07-17 — ALL 10 FINDINGS FIXED (commit 6b581e0c,
deployed: hosting + 7 functions incl. onAssignmentWriteEnsureDenormFields
update()-not-set(merge) resurrection fix). Deliberately deferred: UTC-today
on on-demand sweep runs (minor), full-collection scan efficiency, cascade
hard-delete altitude fix, rules-level posting read gate, machine-owned
extract-helper. Original findings for reference:** (1) resolver REMOVED set misses
`worker_cancelled` underscore form → use normalizeAssignmentStatus==='cancelled'
instead of hand set; (2) FG lastSynced* stamp written even when NOT
machine-owned → coincidental hand-edit becomes clobberable (stamp only when
owned/updated); (3) JobPostingDetail JO gate open|filled too narrow — must
include partially_filled/interviewing/offer/on_hold (see ACTIVE_STATUSES in
openShiftFromJobOrder.ts); (4) FG headcount shrink unguarded below placed
count → clamp/flag; (5) applyShiftRequest lacks status==='needs_review'
guard (rejected rows applicable); (6) update-then-delete races denorm
trigger set-merge → can resurrect deleted assignment (wrap like canonical
transaction); (7) sweep falsy-zero workersNeeded||fallback → phantom gaps;
(8) sweep dayCover||shiftCover shortcircuit undercounts range workers →
false gaps; (9) FG bill fallback can overwrite real portal bill when
billRateSt disappears; (10) duplicated assertRecruiterOrAdmin diverges from
canonical canManageAssignments (hrx vs isHRX/roles). Also: efficiency (full
assignments scan ×2/day, serial subcollection reads), altitude (real fix =
make shiftAssignmentCascades hard-delete; redirect is client-only, docs
still SDK-readable — rules-level gate eventually). AI verdict: everything
shipped today is deterministic plumbing — AI layer (triage/auto-apply/
confidence) still unbuilt.

**P1c SHIPPED 2026-07-17 (commit 3cc3babe, deployed fns
getScheduleDivergence + completeStaleAssignments + hosting):**
/scheduling-health "Scheduling Health" page (sidebar, levels 5-7) —
plain-English daily checklist per [[feedback_nontechnical_recruiter_ux]]:
(1) stale workers + one bulk "Mark all N finished" button →
completeStaleAssignments (server re-verifies live status + past end date
per doc before completing); (2) coverage gaps w/ per-shift "Add people" →
/jobs/job-orders/{id}?tab=placements; (3) portal-updates count →
/shifts/log. getScheduleDivergence serves the snapshot via callable (no
Firestore rules surface; computes fresh if today's is missing). Verified
deployed: unauthed visit → login redirect; authed smoke = Greg's first
visit.

**P1b-2 SHIPPED 2026-07-19 (commit 765e5e0f, deployed + pushed):** the
portal inbox is FINISHED — indeedFlexApplyShiftRequest handles all event
types (change_headcount updates totalStaffRequested + dateSchedule
workersNeeded over the event date window; change_time updates default +
per-date times; new_request creates the shift on the matched inbox gig JO,
idempotent on poNumber=Indeed jobId; all return plain-English `summary`
surfaced as a success banner). ShiftLogEntry renders a per-type labeled
Apply button ("set headcount to N" / "change time to S–E" / "create this
shift" / "cancel N assignments"). Same commit: CALENDAR FIX — month grids
(/shifts/calendar + Account Details Shifts tab) now show past/completed
shifts; the List view's default from-today start filter is ignored by
Calendar rendering unless user explicitly set a range. Banner copy fix
3fc54551 (feed no longer claims dry-run).
NEXT: AI triage layer on the checklist/inbox (auto-resolve unambiguous
overnight, plain-English explain the rest — the funded bleeding-edge
piece); P1d-2 FG date sync + posting rate updates; then Phase 2 one-step
placement UX → enforce HRX-first.

**AI TRIAGE SHIPPED 2026-07-19 (commit 791241a1, deployed):**
`schedulingTriageNightly` cron 11:30 UTC (30min after sweep) — per tenant:
auto-completes stale live assignments (server re-verified, updatedBy
ai_triage_nightly), auto-applies EXACT-confidence cancel_booking rows via
shared `applyShiftRequestCore` (refactored out of the onCall; fuzzy/none
never auto-applied, failures stay needs_review), writes plain-English
morning brief (OpenAI gpt-5, deterministic fallback) onto
schedule_divergence snapshot `triage` field. SchedulingHealthPage renders
green "Handled overnight" card + chips. First run: tomorrow ~4:30am PT.
Unification also shipped (a0c43b1f): venue_aliases ↔ timesheet_site_mappings
teach each other; import chain now assignment→site-map→venue-alias→JO-name.

**PHASE 2a SHIPPED 2026-07-19 (commit d971c326, deployed hosting):**
one-step placement — drop = hire. tryPlaceWorker → new hireWorkerOnShift
(assignWorkersToShift gained options.shiftOverride so drops target the
DROPPED card, not stale selectedShift); createPlacement staging write
REMOVED (deletePlacement + placement docs remain for legacy tiles +
cancel-cascade); double-book dialog = single "Hire anyway" prompt; hint
copy updated. Chip path (handleConfirmPlacement) retained for pre-existing
Placed tiles. ⚠️ drops now send real offer SMS immediately — Greg's first
drag is the live smoke test. REMAINING Phase 2: 2b multi-shift live board
(only expanded card hydrates — PlacementsTab.tsx:4312 cardDisplayedWorkers
gate), pool UX (search-all one-at-a-time), then announce HRX-first policy.

**PHASE 2b SHIPPED 2026-07-19 (commit 2c0a74ef, deployed hosting):** live
board — collapsed shift cards render a per-shift roster chip strip (green
confirmed / blue offer-out / grey legacy-staged; click strip → expand).
Data: existing JO-wide placements+assignments listeners in PlacementsTab
(allShiftsRowsRef) now also capture assignment-denorm names and build
`shiftRosters` alongside shiftFillCounts — zero new reads. New exported
type ShiftRosterEntry in ShiftAssignmentCard. REMAINING Phase 2: pool UX
(search-all adds one at a time), then HRX-first policy announcement.
Expanded card still owns the full tile experience (hydration gate at
cardDisplayedWorkers unchanged — rich tiles per card would be the deeper
refactor, deliberately not needed now that rosters show everywhere).

**CHECKPOINT REVIEW #2 (2026-07-19, commit f8d20989, deployed 5 fns +
hosting):** 2-agent adversarial review of the unreviewed diff
(6b581e0c..07313fba) found 15; ALL criticals fixed: applyNewRequest
shiftMode+times+ID-less dedupe; applyShiftUpdate date-mismatch refusal;
venue-alias role-safe target cache + guarded containment (≥12 chars,
unique) + exact-only self-write; getScheduleDivergence today-only serve;
killed-JO stale completable (health + triage); client pending-hire
shift-scoped (pendingHireShiftByWorkerRef — phantom-tile fix); change_*
apply gates need matchedJobOrderId; banner copy; dialog dead-end; toast on
second drop. DEFERRED (documented): nameless "Worker" chips on
placement-only rosters; calendar explicit-today-start treated as default;
undo-window for one-step hire (industry pattern, recommended); triage
cancel SMS lands ~4:30am PT (quiet-hours decision for Greg).

**PHASE 3 PLAN (Greg said start):** slice 3a "Who's Assigned" report —
staff page, pick any week (last week = payroll check, next weeks =
coverage): rows worker × assignment with scheduled hours, grouped by
account/JO; reuse resolveTimesheetGrid-style expansion server-side or a
new callable over assignments (live statuses, date-window ∩ week,
weeklySchedule/dateSchedule expansion → hours via scheduledHoursForRow
math). Slice 3b cost/margin: pay×hrs, bill×hrs w/ OT billed at 1.5×
(Greg-confirmed), margin % per row/account/week; reuse
gigFinanceFromShifts patterns; surface hours number + margin % (the gaps
found in the original review). Slice 3c full-time tracker: aggregate
scheduled+actual hours per worker per week, flag ≥30/≥35 trend, "growing
full-time" list — new page or Scheduling Health section. UX per
[[feedback_nontechnical_recruiter_ux]]: plain English, pick-a-week, no
config.

**GREG DECISIONS 2026-07-19 (BUILD IN PROGRESS):** (1) UNDO WINDOW on
one-step hire = 60 SECONDS. Client-side in PlacementsTab: drop adds
optimistic pendingHire state but DELAYS the assignWorkersToShift call 60s
via pendingUndoHiresRef Map<workerId,{timer,fire}>; Snackbar "Hiring N —
Undo" cancels ALL pending (removes optimistic state, nothing sent); timer
fire → existing hire path (shiftOverride); flush timers immediately on
unmount/beforeunload so navigation can't silently lose hires. Also verify
hire path honors JO mute system (jo.muted — push trigger checks it;
verify offer SMS path in placementsCreateAssignments does too / note if
not). (2) QUIET HOURS = deliver at 8AM WORKSITE-LOCAL: triage-applied
cancellations must NOT text workers at 4:30am. Design:
applyShiftRequestCore gains quietNotifications?: boolean → status-flip
update includes notificationsSuppressed:true (cascade respects it, same
as separateWorker) + queue doc to tenants/{t}/deferred_notices with
{userId, title, body, sendAfter: 8am worksite-local as UTC ts (state→tz
map: PT/MT/CT/ET + AZ), jobOrderId}; triage passes flag; NEW cron
schedulingQuietHoursNotifier '0 12-16 * * *' UTC hourly sends due unsent
notices via sendNotificationAndPush, RE-CHECKS jo.muted at send time,
marks sent. Recruiter-click applies stay immediate (quiet only for
ai_triage_nightly).

**SHIPPED 2026-07-20 (9fca6517):** Both decisions live. Undo window:
PlacementsTab pendingUndoHiresRef + 60s setTimeout + Undo Snackbar +
beforeunload/unmount flush. Quiet hours: applyShiftRequestCore
quietNotifications → notificationsSuppressed on flip + deferred_notices
queue (STATE_TZ map, next8amLocal); schedulingQuietHoursNotifier cron
(NEW, '0 12-16 * * *' UTC) sends due notices, re-checks jo.muted at send.
MUTE AUDIT RESULT: placementsCreateAssignments offer SMS ALREADY gated by
jo.muted (skipPlacementWorkerNotifications, placementsApi.ts:654→1084);
onAssignmentUpdatedPush honored jo.muted but NOT notificationsSuppressed
— FIXED (now skips on retroactive/notificationsSuppressed like
index.ts:9165/9401 + workerShiftRemindersV2:1434). Deployed:
indeedFlexApplyShiftRequest, schedulingTriageNightly,
schedulingQuietHoursNotifier (create), onAssignmentUpdatedPush + hosting.
NEXT: Phase 3 slices 3a/3b/3c per plan above.

**PHASE 3a SHIPPED 2026-07-20 (7a69fd5a):** Who's Working page at
/whos-working (menu next to Scheduling Health, sec 5+). Any-week picker
(Sun-Sat, currentWeeklyPeriod/shiftWeeklyPeriod), grouped Account → JO →
worker with DOW chips + scheduled hrs + actual hrs (past weeks, from
entries). Reuses resolveTimesheetGrid via NEW 'tenant_period'
TimesheetFilter kind: 4 auto-indexed queries (startDate ∈ [start−14d,
end], endDate ∈ week, isOpenShift, noFixedTimes) union → overlap filter;
csv_import leg takes hiringEntityIds[] (page loads tenants/{t}/entities)
looping the existing (source,hiringEntityId,workDate) index. Page does
its own JO-doc join for account/JO labels; unmatched import rows group
under venue name. Prod-verified: wk 7/12-7/18 = 89 assignment-days / 86
workers / 24 import rows. NOT smoke-tested through login (no creds in
in-app browser) — Greg should eyeball /whos-working once. NEXT: 3b
cost/margin (pay×hrs vs bill×hrs, OT billed 1.5×, margin %), 3c
full-time tracker (≥30/≥35 hrs trend).

**PHASE 3b+3c SHIPPED 2026-07-20 (7c54691c):** Same page. 3b money:
"Show money" toggle (localStorage whosWorking.showMoney) → pay/bill/
margin per JO + account + week from same rows as hours (actual-preferred);
OT NOT modeled per account (billed 1.5× = paid 1.5× so margin holds —
footnoted); week-level OT-hours estimate (max daily>8 vs weekly>40 per
worker); missing-rate rows counted $0 + called out. 3c full-time watch:
lazy 4-week tenant_period resolve on open, per-worker week chips,
35+/30-35/growing buckets, top-40 cap. Prod baseline: 248 workers in
4-wk window, ZERO at 30+ hrs — top scheduled worker ~11 hrs/wk (gig-
heavy; import hours WILL count on page via resolver import leg, scratch
preview excluded them). Wk 7/12-18 money: ~$10.4k pay / ~$15.5k bill /
~33% margin / 4 rows missing rates. PHASE 3 COMPLETE (3a+3b+3c all
live). Not eyeball-verified through login — Greg should open
/whos-working once.

**2026-07-20 PM:** Browser-verified all Phase 3 features live via Greg's
Chrome session (hrxone.com/whos-working): wk 7/19 = 10 workers/311
hrs/23% margin/25h OT est; wk 7/12 payroll = 114 workers, 683.5 sched vs
615.7 actual, 20% margin; FT watch = 7 full-timers (Domino's crew +
Hairston/Scott/Harris). Money view CAUGHT real data bug: CORT −10%
margin = missing bill rates. FIX STAGED in
functions/.scratch/fix-cort-bill-rates.cjs (dry-run verified, 8 writes:
Harriet Island 19→26.22 = CORT standard 38% markup; Baird 18→24.84
matching sibling shift; 3 assignment docs) — EXECUTE BLOCKED by
permission classifier, awaiting Greg approval to run --execute.
FULL-TIME BUILDER SHIPPED: "Ways to add hours" in FT watch —
getScheduleDivergence coverageGaps ∩ selected week ∩ future, matched to
workers 0<hrs<35 free that day (max 2/worker, 10 total), "Open
placements" deep link; explicit empty state when no gaps (today: 0 gaps,
all shifts staffed). Preview pane (Claude Browser localhost:3000)
carries Greg's login — use it for UI verification, no more login wall.

**CORT RATE FIX APPLIED 2026-07-20 (Greg approved):** all 8 writes
executed (fix-cort-bill-rates.cjs --execute). Verified live: CORT
−10% → 28% margin (Harriet $304/$420, Warehouse $765/$1,056, Baird
$90/$124); wk 7/19 totals billing $8,519→$9,062, margin 23%→28%
($543 billing recovered this week); missing-rates warning cleared.
Full-time builder hosting deploy also confirmed live on prod.
STILL OPEN (documented, not requested): 26 import rows wk 7/12
missing rates (Legends/Flex).

**WHO'S WORKING v2 (Greg redesign, 2026-07-20 evening):** Greg's spec:
tabs — (1) Who's Working (keep week picker/customer grouping; child
account + worksite address UNDER worker name; workers CLICKABLE →
assignment view), (2) Full-time workers = ONGOING/OPEN-ENDED assignments
(NOT hours-based — Greg explicit; FT Watch moved to tab bottom), (3)
Metrics (graphs: total hrs, workers, FT workers; account filter) — tab 3
NOT YET BUILT. Assignment view = NEW AssignmentDrawer.tsx (slide-out):
full details + END ASSIGNMENT as-of-date + optional reason = schedule
cleanup, NOT separation, NO worker notification (quit/replaced cleanup).
Server: assignmentLifecycleApi.ts — endAssignment (family = same
shiftId+userId; open-ended docs get endDate stamped + status ended when
past; future per-day docs HARD-DELETED) + getOngoingAssignments (ongoing
= !endDate && (weeklySchedule|open flags); status NOT trusted).
CRITICAL FINDING: full-time shape = SINGLE doc, endDate '', weeklySchedule
{0..6}; stale sweep's `?? start` fallback made effEnd=startDate → 9/10
ongoing assignments (Domino's crew etc.) wrongly auto-'ended' (they still
render because resolver ignores non-cancelled status). GUARD ADDED in
sweep + completeStaleAssignments + triage completeStale (isOngoing skip).
Statuses NOT mass-repaired on purpose: some 'ended' are genuinely done
(Greg's cleanup case) — truth arrives as Greg ends them with real
endDates via drawer. Functions deployed: endAssignment,
getOngoingAssignments, scheduleDivergenceSweep, schedulingTriageNightly,
completeStaleAssignments, getScheduleDivergence. Client NOT yet
committed/deployed at this write.

**WHO'S WORKING v2 COMPLETE 2026-07-20 (cae443f5 tabs+drawer, 1d71ed64
metrics):** all 3 tabs live + verified in preview. Tab 1: sub-lines
(child acct + worksite + address from JO join) under workers, rows
clickable → AssignmentDrawer. Tab 2: getOngoingAssignments (10 rows) +
FT Watch at bottom. Tab 3 Metrics: getSchedulingMetrics (12-wk Sun-Sat
series, assignments + csv_import hours w/ JO→account attribution,
per-account + totals in ONE call → instant client filter); 3
single-series recharts small multiples, hue #2a78d6 (dataviz-validated
slot 1). Prod trends: hours peak ~4.3k wk of 6/7 (~450 workers);
FT-workers line 2→3→10 over the quarter. Drawer End-assignment NOT
live-fired yet (real data); Woodbridge pair (Singleton/Holloway, since
5/11) = Greg's first cleanup candidates. endAssignment/
getOngoingAssignments/getSchedulingMetrics all deployed.

**2026-07-20 EVENING (d8b49934, 06a06211, 76b85f96 — all deployed after
Greg's 'deploy'):** (1) endAssignment mode:'delete' — erase whole family
+ placement markers "like it never happened"; REFUSED when timesheet
entries exist (worked = End instead); confirm dialog in drawer; NO
notifications ever (notificationsSuppressed stamped on end too).
(2) Nav: page renamed ACTIVE ASSIGNMENTS (route stays /whos-working),
takes Onboarding's how_to_reg icon; Onboarding + Scheduling Health menu
items commented out (pages still live by URL). (3) CAREER = canonical
ongoing signal (Greg: JOs/assignments are Gig or Career; Career = what
he called full-time): tab renamed Career Assignments; predicate
jobOrderType==='career' primary + legacy flags fallback in
assignmentLifecycleApi, schedulingMetricsApi, and all 3 sweep guards;
verified career-no-endDate = exactly the 10 ongoing. Charles Scott
(Carrier) = Greg's stated delete candidate (never worked; real hire was
in Flex — after delete, correct worker added via Placements).

**PI-1 SHIPPED 2026-07-21 (07739bf9, deployed onShiftRequestCreatedMatch
+ linkVenueToAccount):** Flex matcher was blind — firestoreReader read
root /shifts (2 docs) + /assignments (0 docs) vs canonical
job_orders/{jo}/shifts (600) + tenants/{t}/assignments (2,668). Fixed
readers (shiftCoversDate helper, jobOrderId guaranteed on subcollection
docs) + NEW account leg in matchByFallback: cancel-format venues
("Domino's, Colorado, 10252 E. 51st Ave…") resolve via matchByVenue
(alias+IDF) → listShiftsForAccountDate (JO link = recruiterAccountId,
the ONLY populated linkage field). normalizeVenueName cuts address tail
+ "CORT, " comma-brand prefix (safe: 0 aliases taught). CLIENT-
CONSISTENCY VETO: fuzzy account must share a token with venue's leading
client segment (stops CORT-Maryland-Warehouse → Domino's-Maryland on
'maryland' alone; alias matches exempt via viaAlias). none-rows now
carry candidateAccounts + scorer diagnostics. Backfill re-stamped 29
stuck rows: 6 fuzzy / 4 multiple / 19 none-with-reasons (change_time =
missing jobIds → PI-5; "Northern California" can't reach acct named
"NorCal" + ORS Nasco 7-way tie needs Naperville alias → PI-3). Cancel
parser extracts workerNames=[] — worker-level cancel apply blocked on
that (PI-5/PI-9). 25 matcher unit tests green (mocks were missing
2026-05-24 Reader methods — tests had been broken since).

**FLEX CANCELS FULLY SILENT (Greg, 2026-07-21; 65ee0ff0, deployed
indeedFlexApplyShiftRequest + schedulingTriageNightly):** "we don't
need to send cancel emails" — Indeed notifies its own workers, HRX
notices are redundant. applyShiftRequestCore cancel path now ALWAYS
stamps notificationsSuppressed (recruiter clicks AND triage) and skips
the deferred_notices enqueue via SEND_CANCEL_NOTICES=false const in
applyShiftRequest.ts. Quiet-hours cron + queue left deployed (no-op,
one-line flip to reverse). Queue verified empty at switch time.

**PI-2 SHIPPED 2026-07-21 (87625511, deployed schedulingTriageNightly +
onShiftRequestCreatedMatch + linkVenueToAccount + hosting):** nightly
triage now auto-applies exact new_request rows too (applyExactRows) —
creates the open shift on the matched inbox JO via applyNewRequest
(idempotent, silent); past-dated rows skipped (backlog must not mint
dead shifts). autoCreatedShifts in brief + "N new shifts created" chip
on Scheduling Health. SVC-CODE GUARD in matchByVenue: SVC\d+/\d+/\d+
= CORT convention; fuzzy-exact on a non-CORT account → downgraded
multiple (caught live: CORT Maryland Warehouse new_request stamped
exact against Domino's MD — one triage run from a cross-client shift).
recommendedAction map now truthful (exact cancel/new_request='auto').
Backfill re-stamped all 44 needs_review new_request rows: 10
none→exact upgrades, 2 unsafe exact→multiple, stale matched* fields
deleted on downgrade. Tonight's first run: 3 creates (Sunriver/
Kentucky/Baird), 0 cancels; 17 past-dated exacts left for PI-6 drain.

**OPEN-SHIFT CRON KILLED STANDING CREWS — FIXED 2026-07-21 (5888cd7e,
deployed completeExpiredOpenShiftAssignments):** Greg reported PotP
timesheets empty and blamed the jobs-board cleanup — cleanup was
INNOCENT (its 12 completed JOs all genuinely ended; all 5 PotP JOs
still open). Real cause: completeExpiredOpenShiftAssignments resolved
missing assignment endDates from the parent shift, and shiftType
'open' rolling shifts default shiftMode 'single' → shiftDate (crew
START day) treated as the end → every standing crew auto-completed
the morning after creation (endedReason open_shift_date_passed,
end=start signature; older cron rev wrote status 'ended'). Fix: open
shifts end ONLY via explicitly stamped shift endDate. Revival script
.scratch/revive-openshift-crews.cjs restored 23 standing docs (19
PotP: Dell Diamond 7 / Roy Kizer 6 / Crystal Falls 4 / Slammers 2;
+ Adidas FIFA NY 1, FIFA Dallas 3 — Greg should drawer-end those if
truly done) — active, endDate '', machine stamps deleted,
notificationsSuppressed; human-ended (endedBy/endedAsOf) untouched.
Verified 19 PotP crew resolve for wk 7/13–7/19.

**PI-3 SHIPPED 2026-07-21:** 12 venue aliases seeded in prod
(pi3_alias_seed_20260721): Gaylord Oxon Hill→CORT Gaylord DC, "SF -
CORT Warehouse"→CORT San Francisco Warehouse, Naperville×2→ORS Nasco
Chicago DC, Northern California×2→Domino's NorCal, Colorado/Missouri→
Domino's, C9810/C2320 codes→Continental Battery Seattle/Richmond, EAA
Aviation Center→"CORT CORT Oshkosh WISCONSIN" (the autoLoc dup with
the gig JO at 3000 Poberezny Rd = EAA's address; "CORT Oshkosh WI" is
an empty dup), Woodridge Warehouse→CORT Woodbridge Warehouse
(VERIFIED: that account IS Woodridge IL — 2141 Internationale Pkwy —
name is a typo; rename offered, Greg dismissed). Full queue re-match:
13 new_request multiple→exact + 3 none→exact + 4 change none→fuzzy →
tonight's triage creates 10 shifts (Domino's CO/NorCal + ORS Nasco).
LinkVenueToAccountDialog now PRE-SELECTS the top candidate (one-click
link). DEFERRED (Greg dismissed the ask, re-raise later): create
child accounts + inbox gig JOs for 10 CORT event venues with NO
account — Maryland Warehouse Hanover MD (×33 rows, biggest gap),
Fitzgerald Tennis Center DC (×5 open), Mandarin Oriental DC, Hazeltine
MN, Bethesda Marriott, JW Marriott Indy, Lucas Oil, Columbus CC,
Lincoln Financial, TCP Twin Cities Blaine; also the Oshkosh dup-account
cleanup + Woodbridge→Woodridge rename.

**PI-3 PART 2 — ADDRESS MATCHING (Greg's directive 2026-07-21,
a8e936cf, deployed onShiftRequestCreatedMatch + linkVenueToAccount):**
"compare worksite location address, not just name" — venue names
rarely match account names (Maryland Warehouse = CORT Baltimore
Warehouse, 7466 Candlewood Rd Hanover MD 21076, Greg-confirmed).
Reader.listAccountAddresses (JO worksiteAddress by recruiterAccountId
+ crm_companies/{co}/locations/{loc} for JO-less accounts, memoized);
extractVenueGeo (street/zip tail + "(Hanover, MD)" parenthetical);
street-address leg = unique (streetNum+zip | streetNum+token+state) →
exact outright; city rescue = unique account in venue's city sharing
a NON-GEOGRAPHIC token, SVC venues only onto CORT accounts, city
REQUIRED — first draft had 3 live false positives (Fitzgerald→DC conv
center via state+'center'; Columbus→Purolator via city-name token;
Huntington→ORS via state) — all regression-tested. Venue gaps 24→9;
queue re-stamped (35 new_request exacts). REMAINING 9 = genuinely no
account: Fitzgerald Tennis Center, Mandarin Oriental DC, Hazeltine,
Bethesda Marriott, JW Marriott Indy, Lucas Oil, Lincoln Financial,
TCP Twin Cities, Sport of Kings (+1 SCV-typo Savannah row) — account
creation still awaiting Greg's go.

**CORT VENUE BUILD-OUT 2026-07-21 (Greg: "do it"; data-only, no code):**
created 11 company locations under CORT crm_company 9ngmH6Hr7Ew7ZtsKsgLK
(create-cort-venue-locations.cjs) — Fitzgerald Tennis Center, Mandarin
Oriental DC, Hazeltine, Bethesda Marriott, JW Marriott Indianapolis,
Lucas Oil Stadium, Greater Columbus CC, Lincoln Financial Field, TPC
Twin Cities, Huntington CC (Cleveland), Sport of Kings Theater
(Gulfstream). Deployed triggers cascaded ALL 11: onCompanyLocationCreated
→ "CORT {venue}" child accounts → onChildAccountCreatedAutoCreateGigJobOrder
→ gig JOs (jobsBoardVisibility hidden, worksiteAddress inherited —
address leg covers them). JOs then flipped on_hold→open
(pi3_venue_buildout_20260721) so triage can create first shifts;
gigJobOrderStatusCron self-corrects (re-holds shiftless, keeps open
with upcoming shifts). Addresses: email-sourced for Fitzgerald/
Mandarin/Hazeltine, public venue addresses otherwise. Queue: 46
new_request exacts; tonight's triage creates 13 shifts (incl. Mandarin
Oriental 7/22 need-3). Venue-gap census now ~0 for known clients —
every Flex client venue routes by alias, name, or address.

**PI-4 SHIPPED 2026-07-21 (1937e3e9, deployed indeedFlexApplyShiftRequest
+ schedulingTriageNightly):** Greg was right — cascade already fills
pricing (flatMarkupPercent 38 for CORT + per-position rates) onto
child accounts + inbox JOs carry gigPositions; the ONLY gap was
applyNewRequest shifts never reading them (bare pay/bill/WC/worksite).
New pure shiftDressing.ts resolver: pay = email→JO position→account
position (role match: exact→unique containment→unique shared token —
"Warehouse Operative"→"Warehouse Associate" works, bare "Associate"
proves nothing); bill = position bill only if its pay is in use, else
pay×(1+markup); wcCode from position; worksite denormed from JO;
paySource stamped; never invents numbers. Backfill dressed the 1
existing bare shift (Kentucky 23/31.74). Tonight's 13 triage-created
shifts will be born dressed. 145 fn tests passing.

**THIRD FACE OF THE OPEN-SHIFT endDate BUG (2026-07-22, 2fde6652,
deployed placementsCreateAssignments):** Diana Marin (hired 7:49am
onto Roy Kizer crew) invisible on Timesheets — placement path's
open-shift branch stamped endDate=shiftDate at BIRTH (same defaulted
shiftMode-'single' root as the cron, 5888cd7e; rolling crews carry
shiftMode 'single' too so mode can't distinguish). Discriminator =
`autoCreatedOpenShift` marker (FG event gigs — closed range at birth
CORRECT for them); everything else shiftType 'open' w/o explicit
shift endDate is born rolling (endDate ''). Diana repaired (a UI
pencil edit had set end=2026-07-22 which next-day cron would treat as
ended). CORRECTION (Greg's follow-up): Irma Ortega's end 7/22 was the
SAME manual pencil-edit patch as Diana's, NOT a deliberate FIFA
wind-down (her 3 crewmates were all end:'') — cleared to '' on
2026-07-22, all 4 FIFA Dallas crew now open-ended.
Open-shift endDate invariant now consistent across all 3 writers:
birth (placements), expiry (cron), human end (drawer/openShiftSetEndDate).

**PI-5 SHIPPED 2026-07-22 (9b45d999, deployed onIngestEventCreatedParse
+ onShiftRequestCreatedMatch + linkVenueToAccount + hosting):** the 40
parse_failed ingest events were unknown EMAIL FAMILIES, not garbled
known ones. New eventType `info_notice` (noticeKind worker_ended/
booking_expiring/booking_expired/correction/worker_rejected/other) —
subject-built, amber FYI card in Shifts Log, recommendedAction
'review', never auto-applied. Noise → ingest status 'ignored'
(marketing + SDXOWO misrouted-Fieldglass). LLM rescue (gpt-5): unknown
non-noise subjects get one full classify+extract before parse_failed
(future template-change insurance). Backfill: 40 → 8 needs_review
(current) + 27 superseded (>14d stale) + 5 ignored + 0 failing.
NOTE: shared types layout = root shared/ is CANONICAL; src/shared is
a real mirror COPY; functions/src/shared is a SYMLINK to root — git
add root+src copies only. 150 fn tests. Remaining change_time
missing-jobId rows unaffected (those parse fine, emails lack ids —
PI-7 portal extension is the fix).

**CAREER 14-DAY BLIND SPOT (2026-07-22, Daniel's report):** the
tenant_period resolver's 4 query legs all assumed gig windows — an
open-ended CAREER doc with startDate older than 14d matched NONE
(no open flags, endDate '') → invisible on Who's Working + Timesheets
while the Career tab (getOngoingAssignments full-scan) showed it.
Fifth leg added: where('endDate','==','') catches all open-ended docs.
Also Leonard Frett's career doc = the born-broken end==start bug (born
4/06, triage auto-completed) → restored confirmed/open-ended. Ryane
Singleton + Shamar Holloway (status 'ended', end '') will now APPEAR
on week views (resolver only drops cancelled) — they're Greg's known
Woodbridge cleanup pair; he should drawer-end with real dates if done.
Also assignments RULES fix same day (f022aacb): update gate was
claims-only while read accepted hasSecurityLevel(t,5) → recruiters got
"Missing or insufficient permissions" on start-date pencil; fixed +
legacy no-tenantId docs updatable; 4 more claims-only gates flagged
via background task chip.

**ADMIN ASSIGNMENT VIEW SHIPPED 2026-07-22 (a44e7bda, hosting live):**
AssignmentDrawer (from Active Assignments) is now the full admin
surface — editable start/end dates (blank end = ongoing), pay/bill,
start/end times, weekly-day chips (rebuilds weeklySchedule); saves via
direct client updateDoc w/ notificationsSuppressed:true + updatedBy
'assignment_drawer_edit' (rules accept securityLevel 5+ since
f022aacb); audit trail rendered (created/updated/ended stamps,
completedReason, paySource). End/Delete unchanged. Breona Hairston =
the 14-day-lookback bug (already fixed ccba9768; healthy confirmed
career doc, start 6/21). REMAINING worker-view leak: ShiftSelector.tsx
:455 "View Details" → /c1/workers/assignments/{id} — repointing needs
an admin destination outside the drawer context; not yet done.

**ADMIN DRAWER NOW ON 3 SURFACES (2026-07-22, 52d0b405 + 1d9885a8):**
(1) Active Assignments rows, (2) User Profile assignment cards
(AssignmentReadinessPanel gained tenantId/workerId/workerName props —
admin callers open the drawer, worker callers keep old navigation;
shiftId derived from assignment doc id prefix), (3) NEW "Assignments"
tab on Job Order Details (JobOrderAssignmentsTab: full history for
the JO, one row per worker×shift family, per-day docs collapsed w/
day count, live-first sort, end/cancel reasons shown; tab key
'assignments' appended to JOB_ORDER_DETAIL_TAB_KEYS, strip entry after
Placements). Placements stays the roster-BUILDING surface. NOTE:
ShiftSelector "View Details" was a FALSE lead — worker-facing, only
renders for the viewer's own confirmed shift; left untouched.

**2026-07-20 LATE (d3c798d4, b1f03a8f):** Metrics import-hours bug (Greg
caught): entries carry totalRegularHours/totalOTHours/totalDoubleTime +
actualHoursOverride, NOT `hours` → imports counted 0; fixed → wk 6/7 =
~9k hrs (4.2k sched Venue Smart-heavy + ~4.5k imported). June peak
CONFIRMED REAL (Venue Smart 3,431 sched hrs wk 6/7 — festival season,
not dirty data). ENTITY SELECTORS added: Metrics = server-side
(entity × account × week) cube in one response (Rollup keyed
`ent acct`, byEntity in payload); Who's Working = raw weekRows kept in
state, groups derive via wwEntity (hiringEntityId) + wwAccount filters —
summary/money/OT all follow. Verified: C1 Select = all 10 this wk;
C1 Events = 0 this wk (portal-first, appears via imports in past wks) —
expected, explain to Greg if asked.
