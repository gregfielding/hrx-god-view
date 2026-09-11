# Deploy log (hrx1-d3beb)

Every Claude session (Greg's or Mark's) appends ONE row here after any
`firebase deploy` — functions, hosting, rules, indexes — then commits and
pushes right away. Before deploying, `git pull` and read the top rows: if the
other person deployed the same function or hosting in the last hour, check
with them first (simultaneous deploys of the same target race).

Newest first. Times are when the deploy finished, Pacific. Commit = the
pushed commit the deploy was built from. Result: ✅ released, ❌ nothing
released (say why).

| When (PT) | Who | Target | What | Commit | Result | Notes |
|---|---|---|---|---|---|---|
| 2026-09-11 10:46 | Greg (Claude) | functions | `triggerAINoteReview`, `triggerAINoteReviewHttp`, `updateLocationAssociationHttp` | 025a811e | ✅ | CORS now echoes app.c1staffing.com; memory 256MiB → 512MiB |
| 2026-09-11 10:41 | Greg (Claude) | functions | `triggerAINoteReviewHttp`, `updateLocationAssociationHttp` | 16f8e975 | ❌ | Cloud Run startup probe failed: 256MiB OOM on cold start. Old revisions kept serving |
| 2026-09-11 10:41 | Greg (Claude) | hosting | Web copy fixes for the app.c1staffing.com move (DeleteAccount, SMSPrivacy, job JSON-LD, agency slug text) | 6e91b73c | ✅ | Built from a clean worktree with `NODE_OPTIONS=--max-old-space-size=8192`; main.9886f869.js; deep link 200 |
| 2026-09-11 10:39 | Greg (Claude) | hosting | Same as above | 16f8e975 | ❌ | Build OOM (fork-ts-checker) while a functions build ran in parallel; nothing uploaded |
| 2026-09-11 09:30 | Greg (Claude) | hosting | Worker "Get the app" banner, shipped OFF | db596f38 | ✅ | main.5b863fa9.js; first attempt minutes earlier OOM'd in the build (nothing uploaded) |
| 2026-09-10 | Greg (Claude) | functions | `checkOtp`, `workerSupportAssistant`, `parseResumeHttp`, `submitWorkerAiPrescreenInterview`, `processApplicantScoreQueue`, `enqueueApplicantScore`, `recalculateApplicantScore` | — | ✅ | AI-processing consent gates (backfilled; time and commit not recorded) |
