# interview sms cadence

> "Worker AI pre-screen interview-SMS outreach — the 7 trigger entry points, the 5-day cadence hard stop, and where it's enforced"

The worker AI pre-screen **interview-invite SMS** subsystem (`functions/src/workerAiPrescreen/`) sends an invite + chase reminders (chase 1 = +4h, chase 2 = +24h). Workers were getting these texts **for days** because ~7 independent entry points each re-armed fresh invite/chase waves and the only global guard (the 10-day `userInInterviewReinviteCooldown`, cold-invite-only) ignored chases/follow-ups.

**The fix (2026-06-22, commit `07b85ec1`): a single 5-day cadence hard stop.** No interview outreach more than 5 days after a person's cadence started.
- **`interviewCadence.ts`** is now the single source of truth: the de-duped `scheduleInterviewChaseFields` (was copy-pasted in 6 files), `INTERVIEW_CADENCE_HARD_STOP_DAYS=5`, `interviewCadencePastHardStop({userData, chase1DueAt})`, `effectiveCadenceStartMs`, `shouldStampNewCadenceStart`, `newCadenceStartUserFields`.
- **Per-user anchor `interviewCadenceStartedAt`** (on the user doc) — stamped on a COLD/first invite, NOT advanced by chases (unlike `lastInterviewInvitedAt`, which advances on every SMS and is why the cooldown couldn't anchor a cadence). Legacy/fallback: derive cadence start from the chase-1 due date − 4h, so existing runaway waves stop with no backfill.
- **"New cadence after cooldown"**: the anchor resets when a fresh cold invite goes out (already gated by the 10-day cooldown), so legit re-engagement still works.

**Enforcement points** (all in `processWorkerAiPrescreenReminders.ts` cron unless noted — the cron is the only place that actually SENDS):
- Both chase senders (`processPrescreenChaseSms` = application chases; `processProfileFirstPrescreenChaseUserSms` = profile-first chases on the user doc) skip + clear pending when past the window → outcome `cadence_hard_stop`.
- Follow-up re-arm path checks the hard stop BEFORE re-arming.
- First real `eligible_invite` stamps the anchor.
- `scheduleWorkerAiPrescreenFollowUpOnUserWrite` (the noisiest trigger — fires on user-doc writes on eligibility false→true, no cooldown) now bails if past the hard stop. Note: do NOT add `userInInterviewReinviteCooldown` here — the nudge sets `lastInterviewInvitedAt`, so the cooldown would block the legit nudge→eligible conversion.

**The 7 trigger entry points** (classify before touching): COLD invite (stamp anchor) — `autoScheduledInterviewInvite` (onUserCreated + processScheduledInterviewInvites, profile-first chases on user doc), `triggerRecentUserInterviewBackfill`, `sendWorkerOrderInterviewSms` (recruiter one-tap, 24h cooldown), `recruiter/triggerUserGroupInterviewInvites`, `combinedApplicationInterviewFirstTouch` (bundled into `applicationSmsTriggers.ts` onApplicationCreated/StatusChanged), cron first-touch. RE-ARM (hard-stop gated) — `scheduleWorkerAiPrescreenFollowUpOnUserWrite`, `scheduleWorkerAiPrescreenReminder` (queues the cron reminder). Cold-invite senders stamp the anchor via `touchLastInterviewInvitedAt(db, uid, sentAt, {stampCadenceStart:true})`.

**Known residual (minor, accepted):** a single within-5-day follow-up on a sender-originated cadence that lacks a per-user anchor can extend chases a few days past the original window (chase-1-due-date fallback slides). Bounded + rare (follow-ups fire on a one-time eligibility transition). Related: [[feedback_i18n_source_vs_generated]], [[feedback_functions_memory_floor]].
