# Natalie Brooks — roadmap to a full team member (Greg, 2026-09-07: "Make this all happen. GO!")

Natalie is C1's autonomous recruiting assistant: an HRX user (uid
`sSPyxJiaYsXlHJb5XUOJ3d14PcU2`, securityLevel 7), a Google Workspace mailbox
(n.brooks@c1staffing.com), a Slack member (U0BV79X65R9) with her own user
token, a Twilio line (+1 312 663 8247), and the always-on portal worker that
logs into Indeed Flex and SAP Fieldglass as her. Related docs:
[[project_portal_worker]], [[reference_slack_natalie_persona]],
[[reference_twilio_messaging_state]], [[project_shift_confirmation_cadence]].

Principles: she acts through the same systems the humans use (Slack, SMS,
HRX records, the portals), every action leaves an audit trail a recruiter
can read, she closes her own loops, and she says plainly what she cannot do.

## Status legend
✅ shipped · 🔧 in progress · ⏳ blocked on Greg (one-time) · 📋 next

## Phase 0 — what exists (all ✅ by 2026-09-07 night)
- Portal worker: hourly Fieldglass + Flex syncs, 10-min clock-in watch,
  timesheet-grid punch feed, `accept_job_request` (auto-accept policy in dry-run).
- Cadence: T+15 late check-in text from Natalie, T+30 no-show flip, worker
  CANCEL → Flex-team replacement ask (posted as her; #dev until pointed at the
  Flex channel).
- Slack: @mentions + DMs answered as her with HRX tools (worker status, portal
  sync status/request, Flex requests/accept, order fill status, worker SMS).
  Outsiders and bots ignored. Live-verified.
- SMS: invalid-number and opt-out failures are terminal; carrier blocks and
  invalid numbers alert #dev.

## Phase 1 — close her own loops + audit trail
1. ✅ `natalie_actions` log: every Slack-initiated action (sync, accept, text,
   note, task) → `tenants/{t}/natalie_actions/{id}` with who asked, Slack
   permalink, tool input, result; mirrored onto the worker's / job order's
   `activityLogs` so it shows in HRX ("Natalie did this because Rosa asked").
2. ✅ Follow-ups: portal actions she queues from Slack get a
   `natalie_followups/{actionId}` row; the inbox tick posts the outcome into
   the originating thread when the action reaches a terminal status.
3. ✅ Escalation: at the T+30 no-show flip she DMs the assigned recruiter(s)
   (HRX recruiter → Slack user via `slackUsers` mapping) with the situation,
   phone, and HRX link — not just a dashboard flag.

## Phase 2 — memory and judgment
4. ✅ `add_worker_note` / notes in `worker_status`: recruiters tell her things
   ("prefers mornings") → `users/{uid}/notes` authored by Natalie, surfaced in
   every later answer.
5. ✅ `rank_workers` reliability tool: per worker completed / no-show /
   cancel counts over 90 days, tier, notes → ranked with reasons for "who
   should I send Saturday?".
6. ✅ `create_task`: "remind Rosa Thursday to call Claudia" → HRX task on the
   recruiter's list (assignedTo resolved from the Slack user), confirmed in-thread.

## Phase 3 — proactive
7. ✅ Morning brief (7:00 CT weekdays, `natalieMorningBrief`): unaccepted Flex
   requests, Fieldglass changes overnight, today's unconfirmed shifts, late
   check-ins with no answer yesterday, unread email needing a human, portal
   health — posted as her to `app_config/natalie.briefChannelId` (default
   **#recruiting**). First one posted 2026-09-07 13:47 PT (manual run via
   `gcloud scheduler jobs run firebase-schedule-natalieMorningBrief-us-central1`).
   Known gap: "unaccepted" is judged from HRX's `external_shift_requests`
   only — a request a human accepted in the portal still shows until the
   Flex sync marks it (cross-check against the portal jobs list is next).
8. ✅ Weekly "what I did" (Mondays in the same function): counts from
   `natalie_actions` + asks + syncs + no-shows caught + things she couldn't do.
9. ✅ Worker replies relay: inbound SMS from a worker with an active
   late/no-show/cancel state is relayed by Natalie to the recruiter thread.

## Phase 4 — full channels (need one-time grants from Greg)
10. ✅ Email: connected 2026-09-07 14:35 PT (Greg added n.brooks@ as an OAuth
    test user from the gregpfielding@gmail.com console account — the project
    owner — then consented as Natalie; verified: profile + inbox read OK).
    NOTE the OAuth app is still in *Testing* publishing status, so Google
    expires the refresh token after 7 days; flip Audience → Publishing status
    to "In production" (unverified-app warning is fine) or re-consent weekly.
    Code: (`natalie/natalieMailbox.ts` — tenant grant at
    `tenants/{t}/integrations/natalieMailbox`, OAuth purpose `natalieMailbox`
    on the shared `gmailOAuthCallback`; tools `read_inbox` / `send_email`;
    the brief lists unread non-automated threads). One-time step: open the
    consent URL in `functions/.scratch/natalie-gmail-consent-url.txt` in a
    window signed into Google as n.brooks@ and click Allow; the callback
    refuses any other account.
11. ⏳ Texting from her own number: waits for the 10DLC campaign approval
    (submitted 2026-09-07); then move Natalie's sends to +1 312 663 8247.
12. ⏳ Mac mini (9/22): move the portal worker off Greg's laptop.

## Phase 5 — finish jobs end to end (portal adapters)
13. ✅ `book_worker` in Indeed Flex — live 2026-09-07 23:52 PT: Claudia
    Vargas and Ezequiel Felix booked on 545617/546477/546480 (2/7, 2/12,
    2/12 verified on the booked tab). Flow: job-details?workers=available →
    search box → "Book" on the matching row → confirm dialog ("You are about
    to book …") → Confirm → verify ?workers=booked → targeted sync. Flex
    states eligibility blocks inside that dialog — Michelle Decker: "Ontrac
    Attestation Form is required to book this shift. Please upload your
    certificate to continue." — the adapter now fails with that sentence
    (PORTAL_REJECTED) and Natalie relays it to Slack. Workers must be in the
    agency's Flex pool ("Add worker" → /o/workers/add is the next adapter).
    A YES to an offer, or `place_worker`, auto-queues the Flex booking when
    the shift's PO number is a Flex job id (`bookInFlexIfLinked`).
14. 📋 `submit_candidate` in Fieldglass (needs a Sodexo walkthrough with Greg).
15. ✅ (first half) SMS watches: when Natalie texts someone (offer or
    confirmation check) the inbound webhook relays their reply into the
    Slack thread she announced it in, and a YES to an offer places them on
    the shift + confirms by text (`natalie_sms_watches`, `natalieFill.ts`).
    📋 Full two-way threads in HRX conversations still to do.

## Fill-an-order play (shipped 2026-09-07 night, first run on OnTrac Denver)
`candidates_for_job_order` (applicants with interview score/reliability +
workers within 15/30/60 mi via the Worker Reach radius resolver) →
`offer_shift` (text from C1 signed Natalie, YES auto-places) →
`place_worker` → `worker_reach_blast` (Auto Messaging tab's radius blast)
→ `book_worker` in Flex. Lessons from the first run: (1) daily Flex
requests for the same site are one continuing order — reopen the JO and
let applyShiftRequest create one shift per request (poNumber = Flex job id);
(2) running the blast from a local script needs
`admin.firestore().settings({ ignoreUndefinedProperties: true })` or every
SMS fails after its daily slot is claimed (fixed by releasing
`shiftInviteSmsCooldown/{uid}` and re-running; 97 texts + 192 pushes went
out at 15 mi, the pushes twice); (3) the Flex venue clock-in link is
per-venue (venueId=9204), not per order, so the same QR works every day.

## Operating notes
- Everything she posts is under her user token; the MCP Slack connector in
  Claude sessions posts as Greg — never use it for her voice.
- Config docs: `app_config/natalie` (briefChannelId, escalation on/off),
  `tenants/{t}/app_config/indeed_flex` (auto-accept, ask channel).
- Cloud Run cap: check `gcloud functions list | wc -l` before adding a
  function; true orphans (deployed but not referenced in src) as of tonight:
  firestoreAutoAssignFlexWorker, firestoreLogSettingCreated,
  firestoreLogSettingDeleted, firestoreLogUserGroupDeleted, voidOffCyclePayment.

## Worker-reported problems → automatic fix loop (2026-09-07 night)
1. `inboundSmsWebhook` flags texts that read like a technical problem
   ("won't save", "error", "link not working", "can't log in"…) into
   `natalie_tech_issues` (open) with the last outbound message as context.
2. The inbox tick (`natalieOutbox.drainTechIssues`) gathers evidence (user,
   recent messages, applications, interviews), has Claude write a one-line
   diagnosis + next steps, posts it to #dev as Natalie, texts the worker
   "flagged to our tech team, I'll text you when it's fixed", and — when
   `GITHUB_NATALIE_TOKEN` is set — opens a GitHub issue labeled
   `natalie-tech` with the same evidence (status → `triaged`).
3. Cloud routine **"Natalie tech-issue fixer"** (claude.ai routine
   `trig_01VGWBaWnnzwRQ2zmFHpQWdA`, every 2h, claude-opus-5, repo checkout,
   Greg's claude.ai connectors incl. Slack) reads open `natalie-tech` issues,
   investigates, opens a fix PR on `natalie/fix-issue-<n>`, and comments
   `[fixer] verdict: fixed_in_pr #N | already_fixed | needs_human` with a
   "What Natalie should text the worker" paragraph. It never deploys.
4. `drainTechVerdicts` polls those comments: already_fixed → Natalie texts
   the worker the paragraph and marks resolved; fixed_in_pr → posts in the
   #dev thread ("reply 'deployed' and I'll text them"); needs_human → flags.
   Merging + deploying the PR stays a human (or Claude Code session) step.
One-time: create a fine-grained GitHub PAT (Issues: read/write on
hrx-god-view) as Secret Manager `GITHUB_NATALIE_TOKEN`, then bind it on
`natalieSlackInbox` (defineSecret) and redeploy.
First case: Keaney Hicks, 2026-09-06 "won't let me save the answers" — the
position-pack prescreen bug fixed the next day; Natalie texted him the fix
and his link on 2026-09-07 22:05 PT.
**Verified end-to-end 2026-09-07 22:14 PT** (token bound, deploy done):
seeded issue #42 for Keaney's report → routine run posted `[fixer] verdict:
already_fixed` in 148s (it uses GitHub MCP tools; there is no `gh` in the
sandbox and no node_modules, so it cannot run jest — verdicts are by
reading) → `drainTechVerdicts` marked the doc resolved and posted in #dev
within the minute. Greg closed #42. The routine flags "confirm the function
was redeployed" on every already_fixed verdict; check
`gcloud functions describe <fn> --format='value(updateTime)'` against the
fix commit time before trusting it. Follow-up: no regression test covers
the submit-side dyn_pos_* allowed-id set.

## Background checks — where the truth lives (2026-09-07)
`users.backgroundCheck` / `backgroundCheckStatus` DO NOT EXIST (Natalie read
them and told Greg every applicant was null). The recruiter UI reads the
latest top-level `backgroundChecks` doc with `candidateId == uid` (AccuSource),
and rolls up per-service-line verdicts (`providerServiceOrderStatus.{id}.
adjudication.verdict ?? autoVerdict`; completed SSN-locator/lab lines with no
verdict count as PASSED, other completed lines NEEDS_REVIEW; canceled lines
and `order:` webhook echoes duplicating a named line are dropped): any FAILED
→ Failed, any NEEDS_REVIEW → action needed, any PENDING → in progress, else
Cleared. `backgroundSummary()` in natalieFill.ts mirrors this and feeds
`worker_status.backgroundCheck` and `candidates_for_job_order` scoring
(FAILED = −100). `users.comfortablePassBackground` is only the applicant's
willingness attestation, not a result.

## Fill play, part 2 — background checks + scheduling (2026-09-07 late)
Greg: "if any of them want it, order the Sodexo Basic package right away and
follow up with them to make sure they do it… another blast tomorrow at 30 mi."
- `acceptOfferFromReply` (YES) → place → Flex book → `kickOffScreening`: runs
  `runScreeningAutomationForConfirmedAssignment` directly (Natalie's
  assignments are BORN confirmed, so the onDocumentUpdated trigger never
  fires for them); if the automation declines (no package on the JO, entity
  not allow-listed) it falls back to `orderBackgroundCheck` →
  `createBackgroundCheckInternal(…, NATALIE_HRX_UID, {type:'automation'})`.
  Automation orders in production are allowed because
  `ACCUSOURCE_PRODUCTION_VALIDATION_HRX_ONLY=false` in the env file.
- Package resolution: explicit packageId → JO `screeningPackageId` →
  `app_config/natalie.defaultBackgroundPackage` → Sodexo Basic 23923. The
  OnTrac Denver JO (Z4yQqi5VhOgULEeE30ha) is stamped 23923 + backgroundCheckRequired.
- Nobody in HRX texts the applicant portal link (partial_profile orders sit at
  `awaiting_applicant` until the worker finishes the AccuSource form), so
  Natalie does: `armBackgroundFollowup` texts it (`natalie_bg_portal_link`)
  and sets `natalie_sms_watches/{uid}.bgFollowup`; `drainBackgroundFollowups`
  (every minute in natalieSlackInbox) texts the link when it appears, nudges
  daily 9am–7pm MT (max 3, `natalie_bg_reminder`), and posts to the thread on
  completion / no-phone / canceled / gave-up (6 days).
- `natalie_scheduled_actions` (`{kind:'worker_reach_blast', runAt, params:{jobOrderId, radiusMiles}, slack, status}`)
  run by `drainScheduledActions` (transaction-claimed); tool `schedule_blast`.
  Seeded: 30-mile OnTrac blast 2026-09-08 09:00 MT (doc OiMijI9bhppH9s0NCKJN).
- Guards: FAILED background → offer_shift refuses, YES reply is NOT placed
  (`blocked_background`, action `offer_blocked_background`). Vida Rodriguez's
  watch had its offer removed by hand tonight for this reason.
- Missed-relay lesson: the watch code shipped 23:12Z but handleInboundSms was
  only redeployed 05:04Z, so three replies (Claudia, Ezequiel ×2, Michelle ×2)
  were silently unrelayed for ~6h. Deploy handleInboundSms in the same list
  as natalieSlackInbox whenever natalieFill/inboundSmsWebhook change.


## 2026-09-09 — onboarding + screening follow-ups (24h / 72h / 7d, SMS conversations)
Shipped `functions/src/natalie/natalieOnboarding.ts` — see project_natalie_onboarding_followups.md. Texts go from the 312 (A2P approved the same day). Tools: `onboarding_followups`, `remove_worker_from_job`. Config: `app_config/natalie.{onboardingFollowups,onboardingChannelId,autoRemoveOnDecline}`.
