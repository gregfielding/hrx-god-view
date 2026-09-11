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
| 2026-09-11 12:10 | Greg (Claude) | functions | `submitWorkerAiPrescreenInterview`, `reviewAndRescoreUser`, `natalieSlackInbox` | e560c81e | ✅ | Interview scores reach the tier scorecard (riskProfile.topRisks serverTimestamp-in-array fix); Natalie follows job-order hiring-plan hires + never DMs herself on escalations; Craigslist ready+URL → posted (4 OnTrac posts flipped at 19:01Z). Built from a clean worktree (main had another session's uncommitted Sodexo intro work) |
| 2026-09-11 12:04 | Greg (Claude) | functions | `dispatchScheduledWorkerReminders`, `handleInboundSms`, `twilioInboundSmsWebhook` | 6aeefa58 | ✅ | T+15 late check-in gate (Flex punch lookup + feed-freshness guard, canonical-type fix); a NO after start now binds to the started shift (reply handler, so the inbound pair together). All three source zips diffed first: only older committed blobs differed. Built from a worktree with main's env files (shasum-identical), `--non-interactive`. T+30 probe still muted |
| 2026-09-11 11:45 | Greg (Claude) | hosting | Per-host OTP autofill (web passes webOtpHost) + web push dedupe across origins | 55bcb9ea | ✅ | Retry with 8GB heap; main.c30b0508.js; deep links 200 on both hosts |
| 2026-09-11 11:43 | Greg (Claude) | hosting | Per-host OTP autofill (web passes webOtpHost) + web push dedupe across origins | 55bcb9ea | ❌ | Build OOM (fork-ts-checker) — nothing uploaded; retry succeeded 11:45 |
| 2026-09-11 11:36 | Greg (Claude) | functions | `sendOtp` | ba6e24ee | ✅ | SMS WebOTP line echoes the page host when it's ours (utils/webOtpHost.ts); callers that don't send it get PUBLIC_APP_HOST (unchanged behavior) |
| 2026-09-11 10:46 | Greg (Claude) | functions | `triggerAINoteReview`, `triggerAINoteReviewHttp`, `updateLocationAssociationHttp` | 025a811e | ✅ | CORS now echoes app.c1staffing.com; memory 256MiB → 512MiB |
| 2026-09-11 10:41 | Greg (Claude) | functions | `triggerAINoteReviewHttp`, `updateLocationAssociationHttp` | 16f8e975 | ❌ | Cloud Run startup probe failed: 256MiB OOM on cold start. Old revisions kept serving |
| 2026-09-11 10:41 | Greg (Claude) | hosting | Web copy fixes for the app.c1staffing.com move (DeleteAccount, SMSPrivacy, job JSON-LD, agency slug text) | 6e91b73c | ✅ | Built from a clean worktree with `NODE_OPTIONS=--max-old-space-size=8192`; main.9886f869.js; deep link 200 |
| 2026-09-11 10:39 | Greg (Claude) | hosting | Same as above | 16f8e975 | ❌ | Build OOM (fork-ts-checker) while a functions build ran in parallel; nothing uploaded |
| 2026-09-11 09:30 | Greg (Claude) | hosting | Worker "Get the app" banner, shipped OFF | db596f38 | ✅ | main.5b863fa9.js; first attempt minutes earlier OOM'd in the build (nothing uploaded) |
| 2026-09-10 | Greg (Claude) | functions | `checkOtp`, `workerSupportAssistant`, `parseResumeHttp`, `submitWorkerAiPrescreenInterview`, `processApplicantScoreQueue`, `enqueueApplicantScore`, `recalculateApplicantScore` | — | ✅ | AI-processing consent gates (backfilled; time and commit not recorded) |
