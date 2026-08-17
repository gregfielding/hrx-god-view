# swr dep effect refetch amplification

> SWR cache hooks (useTenantWorkerDirectory etc.) as effect deps re-fire fetch effects 3-5x per page view; cancel-flag pattern makes each re-fire cancel+restart expensive server scans — dedup by filter key + monotonic run id instead

# SWR-dep effect re-fire amplifies expensive server scans

On /users/all, the full-collection search effect had
`workerDirectory.workers` (from `useTenantWorkerDirectory`, an
IndexedDB stale-while-revalidate hook) in its deps. The hook emits a
new array identity 2-3× per page view (IndexedDB load, then server
revalidation), so the effect re-fired each time; the per-closure
`cancelled` cleanup flag cancelled the in-flight scan's WRITES but not
the server request — so each page view ran the identical
`searchRecruiterTableUsers` scan 3-5× concurrently. Enough load to
time out the callable ('internal' error) once the heavier
on_assignment scan shipped (2026-07-11).

**Why:** cancel-flag-per-effect-run treats "same effect re-fired" as
"inputs changed". With an SWR dep, they usually haven't.

**How to apply:** for effects that trigger expensive fetches and have
an SWR/cache hook in deps: (1) compute a filter KEY of the inputs that
actually change the result; (2) skip the run when the key matches the
last-started run (clear the marker on error so retries work); (3)
replace the per-closure `cancelled` flag with a monotonic run-id ref —
writes are stale only when a NEWER run started, so the surviving
original run still lands its results. Fixed in RecruiterUsers.tsx
commit e344aee5 (see `searchScanRunIdRef` / `lastSlowScanKeyRef`).
Related: [[feedback-rrv7-transition-starvation]] (same family:
identity-unstable deps re-running effects).

**2026-07-22 second instance:** `useActiveShifts` (account Shifts tab)
had NO stale-response guard — navigating national CORT (64-child slow
fetch) → empty child account (instant fetch) let the national response
land last and paint other accounts' shifts onto the child's tab.
Fixed with the same monotonic runIdRef latest-wins pattern. When
hunting cross-entity data bleed in tabs/pages, check for this race
BEFORE suspecting the query scoping — the scoped query was correct.
