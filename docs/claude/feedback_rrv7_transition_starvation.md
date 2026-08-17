# rrv7 transition starvation

> "Frozen navigation ROOT CAUSE FOUND: identity-unstable effect loops in RecruiterJobOrders restarted RRv7's navigation transition forever; fix = memoized filter + stable id-key deps + no-op state writes (a6684083); NavigationWatchdog stays as belt-and-braces"

# Frozen navigation (URL changes, view stays) — SOLVED 2026-07-09

**Root cause (confirmed live via console evidence — PlacementsTab's
render-time log fired 180+ times in 44s after one row click):**
`RecruiterJobOrders.tsx` had `filteredJobOrders` as an inline
`.filter()` — new array identity every render — feeding a `useMemo`
whose product (`paginatedJobOrders`) was a dep of three per-page
effects that each wrote state unconditionally:
1. zero-gig pages → `setNextShiftByJobOrderId({})` with a fresh `{}` →
   CPU-speed re-render loop (trigger: a search matching only Career
   orders, or the debounced refetch's empty window);
2. gig pages → shift fan-out refetch → new result object each round →
   network-paced loop;
3. all pages → applicant-count merge re-created EVERY row object →
   `jobOrders` identity change → loop (the always-on background churn).

RRv7 wraps every navigation in startTransition; each loop tick's urgent
update restarted the transition, so the detail route never mounted.
Greg's observation "click the search X and the order opens" was the
tell: clearing search brought gig rows back → loop broke → the parked
transition committed.

**Fix (a6684083):** memoize `filteredJobOrders`; per-page effects keyed
on a stable `id:jobType` join string (`paginatedIdsKey`) instead of
array identity; all three setStates return `prev` when nothing changed
(preserve row identities in the applicant-count merge).

**How to apply elsewhere:** any effect dep that is an inline
`.filter()/.map()` product + an unconditional `setState(freshObject)`
in that effect = this bug. Symptom set: URL updates, old page stays
interactive, popstate inert, no console errors, F5 fixes. Check other
heavy list pages (RecruiterAccountDetails has many
`paginated*`/`filtered*` effects — not yet audited).

**Belt-and-braces:** `NavigationWatchdog` (App.tsx, 057946d8) detects
any intent >5s without a router commit, stashes a report in
localStorage `hrx_nav_watchdog_report`, and force-loads the intended
URL. DeferredMount (fcbea4f2) was NOT the cure — remove or keep as
harmless.

**Probe gotcha:** when debugging via claude-in-chrome, check
`document.visibilityState` FIRST — background tabs throttle timers to
1/s (1/min after 5 min), which fakes "main thread saturated" readings
and silently breaks Google Places prediction fetches. Trust
PerformanceObserver('longtask') + console-log timestamps over
setInterval tick counts.
