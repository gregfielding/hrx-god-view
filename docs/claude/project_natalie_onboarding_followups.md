# Natalie — onboarding + screening follow-ups (24h / 72h / 7d)

> Greg 2026-09-09: "Now that Natalie has a working number, I want her to do more outreach to
> workers, specifically for onboarding and background/drug follow-up. … if Deborah starts
> onboarding a worker on Monday, Natalie should look on Tuesday (24 hours later) to see if they
> have completed their key onboarding steps with us — tax forms, payroll, direct deposit, and
> e-verify (C1 Select only). … if a background check and/or drug screening was ordered and she
> can see it has not been started yet, she can text the worker … users get the background link
> and complete it without realizing there is a second part — drug screening instructions. She can
> do a 24 hour and 72 hour follow up, engage them in text convos, help them where she can, and
> report back any issues in Slack. If the worker is now declining to do them, she can remove them
> from the job and start someone else."

Code: `functions/src/natalie/natalieOnboarding.ts`. Runs inside the `natalieSlackInbox` minute tick
(`drainNatalieOutbox` → `enrollOnboardingFollowups` → `runOnboardingCheckpoints` →
`drainSmsConversations`). Texts go out from Natalie's 312 via her approved A2P service (every
`natalie_*` message type — see reference_twilio_messaging_state.md).

## What triggers a follow-up
| Trigger | Where it is read | Clock starts |
|---|---|---|
| Recruiter starts onboarding | `tenants/{T}/onboarding_instances/{assignmentId}` (createdBy.userId = recruiter, status ≠ complete) | instance `createdAt` |
| A human orders a screening | top-level `backgroundChecks` (candidateId, tenantId, hrxStatus in awaiting_applicant / submitted / in_progress / report_ready) | check `createdAt` |

Natalie's OWN screening orders already carry `natalie_sms_watches/{uid}.bgFollowup` (daily
nudges); when both exist, a checkpoint text stamps `bgFollowup.lastNudgeAt` so the worker never
gets two texts the same day. One follow-up per worker: `natalie_onboarding_followups/{uid}`.
Enrollment scans the last 48h but only takes starts/orders after the cutoff
(`DEFAULT_SINCE_MS` = 2026-09-09 21:30Z, override `app_config/natalie.onboardingFollowupsSince`);
at deploy time the prior 48h held 55 instances + 27 screenings (mostly one bulk placement) and
texting all of them at once was not the ask. Late enrollments start at the first checkpoint still
ahead (`firstCheckpointFor`) so nobody gets the 24h and 72h texts back to back.

## What she checks (sources of truth — nothing re-derived)
- **Worker steps**: `assignments/{id}.readinessSnapshotV1.requirements[]` — `work_authorization`,
  `i9`, `payroll_setup` (`in_progress` = Everee invite sent, not finished; `complete` = direct
  deposit/payroll done), `tax_form`, `handbook`, `policies`.
- **E-Verify (C1 Select only, `hiringEntityId === 'c1_select_llc'`)**: employer step, so it is a
  *recruiter* item posted in Slack, never texted. Read from `entity_employments` (`everifyStatus`
  `manual_outside_hrx`/authorized… = done; `i9Section2CompletedAt` missing → "I-9 Section 2
  (employer)" also flagged). HRX's own E-Verify processing is disabled (project_everify_disabled.md).
- **Background form**: latest `backgroundChecks` doc — `profileCompleted` or hrxStatus past
  `awaiting_applicant` = form done; `applicantPortalLink` is what she resends.
- **Drug screen**: `providerServiceOrderStatus` lines whose serviceName looks like a panel/lab
  (Quest Drug Screen, 4 Panel Quick Test @ Abbott, 4 Panel Urine…; TB/PPD excluded).
  `Collection is pending` / `In Progress` → **pending** (not collected); `Collection is complete`
  → collected; `Completed` / `drugReportReady` → completed; `Canceled`. The lab registration
  arrives by email from AccuSource/the lab — HRX has no link for it, so she tells the worker to
  look for that email and flags the recruiter if it must be resent from AccuSource.
- A FAILED background parks the follow-up and tells Slack; she never texts about onboarding then.

## Cadence
- **24h**: text listing open items (Everee/tax/direct deposit, I-9, handbook; AccuSource link if the
  form isn't started; the "drug screen is a separate second step" note once the form is done).
- **72h**: same, firmer, and she re-sends the Everee onboarding invite
  (`runPayrollOnboardingInviteResend`, initiatedByUid `natalie`) if payroll is still open.
- **7d**: parks it and asks the thread whether to remove the worker or keep going.
- All done on the worker's side → closes with :white_check_mark: in Slack (recruiter items still
  listed) and a short "you're all set" text. Texts only 9am–7pm in the worksite's time zone
  (state → tz), never two follow-up texts within 20h, max 15 checkpoint texts per tick.

## Conversations
`handleInboundSms` writes `natalie_sms_convos` for any sender whose SMS watch has
`onboardingFollowup.active` (STOP/HELP excluded). `drainSmsConversations` asks Claude
(`NATALIE_MODEL`, SMS-specific system prompt, JSON out) for a ≤300-char reply + intent
(`will_do` / `needs_link` / `says_done` / `question` / `declined` / `unclear` / `off_topic`) + actions
(`resend_background_link`, `resend_everee_invite`, `escalate`). She sends the reply, performs the
actions, appends to the follow-up `transcript`, and posts `Me → Name: "…" _read as: …_` in the
worker's Slack thread (the raw inbound is already relayed there by the existing watch relay).
- **declined** → follow-up status `declined`; Slack: ":x: … tell me 'remove NAME from JOB'". With
  `app_config/natalie.autoRemoveOnDecline === true` she removes immediately instead.
- Removal = `removeWorkerFromJob`: live assignments on that job order → `status: 'cancelled'`,
  `canceledBy: 'natalie'`, `cancelReason`, `cancelSource: 'natalie_onboarding_followup'` (docs are
  kept, like the recruiter claim-release path; the existing assignment trigger sends the worker
  the standard cancellation text), worker note, follow-up `removed`, and it returns the next
  candidates (`candidatesForJobOrder`) so she can `offer_shift` to someone else when asked.

## Slack
Thread per worker in `app_config/natalie.onboardingChannelId` (falls back to `recruitingChannelId`,
then #recruiting C0BF02MEKUP). Opener when enrolled; 24h/72h summary (done / worker owes /
:warning: recruiter side / background + drug status); every text she sends or receives; close-out.

## Tools / prompt
`onboarding_followups {includeClosed?}` (who is stuck, what they owe, last reply + intent),
`remove_worker_from_job {userId, jobOrderId, reason}`. Prompt rule: never remove without a human
saying so in the thread unless auto-removal is on.

## Kill switches / config (`tenants/{T}/app_config/natalie`)
`onboardingFollowups: false` stops enrollment (existing follow-ups still run their checkpoints);
`onboardingFollowupsSince` (ISO; pull the backlog in by setting it earlier); `onboardingChannelId`;
`autoRemoveOnDecline` (default off).

## Message types
`natalie_onboarding_24h`, `natalie_onboarding_72h`, `natalie_onboarding_done`,
`natalie_onboarding_reply`, plus `natalie_bg_portal_link` for resends. All route through
Natalie's messaging service.

## Tests
`functions/src/__tests__/natalie/natalieOnboarding.test.ts` — drug-line parsing and checkpoint text.
Dry-run script pattern: `functions/.scratch/onb-dryrun.ts` (snapshot + text for recent workers, no
sends).
