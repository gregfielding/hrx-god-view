# scoped functions deploy

> "Never run a bare `firebase deploy --only functions` (all functions) in this repo — always deploy an explicit, named list of just the changed/new functions."

Never deploy with a bare `firebase deploy --only functions` (no explicit function list) in this repo. There are 140+ functions defined in `functions/src/index.ts` and hundreds more currently live in `hrx1-d3beb`. Two problems with the bare form:

1. **It's slow and wasteful** — redeploys every function in the codebase even when only a handful changed.
2. **It can hard-fail non-interactively.** Firebase reconciles the full local source against the full live deployed set; if any function exists in prod but not in current source (e.g. legacy/removed code — confirmed 19 such orphans in `hrx1-d3beb`: `cleanupTestData`, `getCircuitBreakerStatus`, `firestoreLogTenantCreated`, etc.), it aborts with "Aborting because deletion cannot proceed in non-interactive mode" rather than deploying anything.

**How to apply:** always build an explicit comma-separated list — `firebase deploy --only functions:fnA,functions:fnB,...` — scoped to exactly the functions whose source changed. To find that list reliably: `git diff --name-only <base>..HEAD -- functions/src` for the changed files, then `grep -oE "^export const [a-zA-Z0-9_]+" <file>` per file to get the real exported Cloud Function names (filter out plain constants/types, keep only `onCall`/`onSchedule`/`onDocument*`/`onRequest` handlers). Deploying a function whose code didn't change is harmless (idempotent) — when unsure whether a shared helper affected a sibling function in the same file, err toward including it explicitly rather than guessing it's unaffected.

The 19 orphaned legacy functions are a separate, out-of-scope cleanup decision — never delete them as a side effect of a deploy; if the user wants them removed, that needs an explicit, separate confirmation (see [[project_conventions]]).
