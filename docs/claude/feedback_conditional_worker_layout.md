# conditional worker layout

> src/layouts/ConditionalWorkerLayout.tsx renders <Outlet /> for unauthenticated visitors — routes under it that require auth must also be wrapped in WorkerRoute, or unauth users hit a dead-end

`src/layouts/ConditionalWorkerLayout.tsx` renders `<Outlet />` for unauthenticated visitors — it does **not** redirect to login. Routes mounted under this layout that need auth will let an unauth user sit on a broken page (no auth-aware content renders) without ever being prompted to sign in.

**Why:** Discovered during the BI.0 migration debrief — `/c1/workers/payroll/*` was wrapped only in `ConditionalWorkerLayout`, so workers who tapped a stale link landed on a "Sign in to view payroll" dead-end with no actual sign-in affordance. Fixed in PR #6 by wrapping the route in `WorkerRoute` in addition to the layout. Other routes under `ConditionalWorkerLayout` may have the same gap.

**How to apply:**
- When adding a worker-facing route that requires authentication, wrap it in both `ConditionalWorkerLayout` (for chrome) **and** `WorkerRoute` (for auth gating). Don't rely on the layout alone.
- When auditing worker routes for any reason (auth flow, deep-link fix, navigation polish), proactively check whether all auth-required routes under `ConditionalWorkerLayout` have a `WorkerRoute` wrapper. If you find one that doesn't, flag it — likely a latent dead-end.
- The pattern to copy is whatever PR #6 used for `/c1/workers/payroll/*`. Reading that diff is the fastest way to see the canonical wrap.
