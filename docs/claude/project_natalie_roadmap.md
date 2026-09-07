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
10. ⏳ Email: code shipped (`natalie/natalieMailbox.ts` — tenant grant at
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
13. 📋 `book_worker` in Indeed Flex (needs one observed booking flow in a
    logged-in session) → "fill the Denver order with our best three".
14. 📋 `submit_candidate` in Fieldglass (needs a Sodexo walkthrough with Greg).
15. 📋 Two-way SMS threads: her line's inbound routed into HRX conversations,
    summarized for the recruiter on request.

## Operating notes
- Everything she posts is under her user token; the MCP Slack connector in
  Claude sessions posts as Greg — never use it for her voice.
- Config docs: `app_config/natalie` (briefChannelId, escalation on/off),
  `tenants/{t}/app_config/indeed_flex` (auto-accept, ask channel).
- Cloud Run cap: check `gcloud functions list | wc -l` before adding a
  function; true orphans (deployed but not referenced in src) as of tonight:
  firestoreAutoAssignFlexWorker, firestoreLogSettingCreated,
  firestoreLogSettingDeleted, firestoreLogUserGroupDeleted, voidOffCyclePayment.
