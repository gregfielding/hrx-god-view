# functions memory floor

> New Cloud Functions in functions/src/ need memory: '512MiB'; the default 256MiB OOMs on cold start because the module bundle eats ~200+ MiB

Any new Firebase Cloud Function in `functions/src/` should set `memory: '512MiB'` in its runtime options. The 256MiB default OOM-loops on cold start because this codebase's bundled module graph itself is ~200+ MiB before any user code runs.

**Why:** Real outage pattern — recent commits like `87a0eb86 fix(readiness-trigger): bump onJobOrderWriteDetectScreeningPackageDrift to 512MiB` and `141f63d3 fix(readiness-trigger): stop OOM-looping syncWorkerReadinessV1FromEntityEmployment` show this biting in production. Phase A readiness triggers were all written at 512MiB from the start to avoid this.

**How to apply:**
- New `onDocumentWritten` / `onDocumentCreated` / `onSchedule` triggers: include `memory: '512MiB'` in the options object.
- For `onCall` callables: same — and also include `cors: true` explicitly, otherwise a function crash strips the CORS header and the browser surfaces it as a misleading CORS error instead of the real 500.
- If a function legitimately needs more (heavy aggregation, large fan-out), go straight to 1GiB rather than tuning down — the cost delta is negligible vs. an OOM loop.
- The full default spec (per Greg's conventions): `region: 'us-central1'`, `memory: '512MiB'`, `maxInstances: 2`, `timeoutSeconds: 240`. Don't tune memory below the floor; raise other knobs only with explicit justification.
