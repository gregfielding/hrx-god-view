# Worker messaging tracks — Gigs vs Open Shifts vs Careers (deep-dive map)

**Why this doc (Greg, 2026-09-03):** "we are treating messaging for GIGS,
Open shifts, and Careers all differently... we will need to do a deep dive
into this." This is the current-state map + the decision questions, so the
deep dive starts from facts, not archaeology. Everything below is
file-referenced; update it when the cadence changes.

## The three tracks — how an assignment is routed

Routing happens in `functions/src/cadence/shiftReminderProfile.ts`
(`resolveShiftReminderProfile`), in this order, as **hard product fences**
(Greg 2026-08-29) that no targeting doc, tenant switch, or per-assignment
override can cross:

1. `assignment.isOpenShift === true` → **default** profile (plain 24h+2h).
2. `assignment.jobOrderType === 'career'` → **career_placement** profile.
3. Per-assignment `shiftReminderProfile` override (rare, QA).
4. `messagingSequences/{id}.targeting` docs (accountIds + optional
   locationIds + workerTypes + occurrence first_shift|every_shift) →
   **cort_gig** or **gig_standard**. When ANY targeting doc exists, the
   docs govern; non-matching gig assignments fall to **default**.
5. Legacy tenant switch `messagingConfig/shiftReminderProfile`.
6. Fallback: **default**.

## What each track receives (per confirmed assignment)

All reminders are materialized as `scheduled_notifications` docs under the
assignment (`onAssignmentConfirmedScheduleReminders`), dispatched by the
`dispatchScheduledWorkerReminders` cron with claim-locks + per-channel
dedupe. Every step goes to **inbox + push + SMS** (channels set at
scheduling, `workerShiftRemindersV2.ts` ~732), each gated by the worker's
notification settings; bodies localize EN/ES off `users/{uid}.preferredLanguage`.

### GIG (gig_standard; cort_gig = same + T-15m clock-in)

| Step | When | Voice | Reply asked |
|---|---|---|---|
| assignment_reminder_24h | T-24h | "You're scheduled... Reply YES to confirm or CANCEL" | YES/CANCEL |
| assignment_reminder_23h_escalate | T-23h | "We still need a response..." (only if silent) | YES/CANCEL |
| assignment_reminder_22h_final | T-22h | "Last call... otherwise we may reassign" (only if silent) | YES/CANCEL |
| assignment_reconfirm_4h | T-4h | Qwick-style second opt-in ("Still good?") | YES/CANCEL |
| assignment_reminder_2h_instructions | T-2h | **Day-of logistics**: address + check-in + parking + on-site contact (see below) | HELP |
| assignment_reminder_15m_clockin | T-15m | CORT only: clock-in URL | — |
| assignment_checkin_0h | T-0 | "Are you on site? Reply HERE" | HERE |
| assignment_noshow_check | T+30m | SILENT — no worker message; flips no_show + recruiter alert if never confirmed arrival | — |
| assignment_confirm_now | now | Late-fill synth when assigned inside 24h: ask + address in one | YES/CANCEL |

- The T-2h logistics (2026-09-03): on-site contact resolves assignment →
  shift → JO (`onsiteContact{Name,Phone,Role}`, set on the JO **Day-of
  logistics** card); parking/check-in resolve through `staffInstructions`
  assignment → shift → JO → location. Resolved at DISPATCH time so late
  recruiter edits still land. Structured snippets suppress the free-text
  `shiftDescription` blob; no structured data → copy unchanged.
- Reply semantics: `cadenceReplyHandler` + keyword `replyClassifier`
  (YES variants / CANCEL / HERE / walk-off phrases) claim replies BEFORE
  the carrier STOP/HELP matcher when a cadence is active. In-app twins:
  ShiftConfirmationCard (confirm/cancel) and the day-of hero's Running
  late (`respondToAssignment` decisions — never touch status).
- `CONFIRMATION_ASK_REMINDER_TYPES` stamp `cortConfirmation.lastAskedAt`
  so a reply binds to the right shift when a worker holds two pending.

### OPEN SHIFT (standing crew, date-range assignments)

- **default** profile only: plain T-24h reminder ("You're confirmed for X
  tomorrow" + assignment URL — no YES/CANCEL ask) and plain T-2h ("Your
  shift starts soon" + URL). No escalations, no re-confirm, no check-in,
  no no-show probe, **no day-of logistics step**.
- No offer message either: open shifts never carried an accept/decline
  offer (`placementsApi.ts` ~2457) — workers are attached, not offered.

### CAREER (placements)

- **career_placement** profile: `career_first_day` at T-15h (evening
  before — welcome + address + assignment URL, no reply demanded) and the
  T-2h slot in placement voice ("Today's the day! ... Have a great first
  day!"). No confirmation demands, no escalations, no no-show probes —
  "a salaried hire nagged like a gig shift learns to ignore us."

## Adjacent surfaces (same deep dive, different pipes)

- **Offer time**: gig/career assignment creation sends an ACCEPT/DECLINE
  offer over SMS + push + email (`placementsCreateAssignments`,
  `resendAssignmentOffer` resends the identical message). In-app accept
  runs the same `respondToAssignment` rails.
- **Copy overrides**: a `messagingSequences` doc can carry recruiter-edited
  SMS templates per step (`sequenceCopyOverrides`) — an override REPLACES
  the built-in body, so overridden sequences don't get new built-in
  content (e.g. day-of logistics) until their templates are updated.
- **Recruiter-facing**: worker cancels / no-shows / running-late alert the
  assigned recruiters via `notifyRecruitersOnWorkerEvent` → dashboardFeed.
- **Not in the cadence**: interview invites, apply-wizard nudges, profile
  reminders, phone-change — separate senders, out of scope here.

## Gaps & decision questions for the deep dive

1. **Claim Shift (tier system) has no track yet.** A claimed gig shift is
   an instant commitment — does it skip the 24h YES/CANCEL ask (claim IS
   the confirmation) and keep only reconfirm_4h + logistics + check-in?
   Recommended: yes; the ask cadence exists to convert *assigned* workers
   into *committed* ones, which claiming already did.
2. **Open shifts get the least and arguably need a different shape, not
   less**: a standing crew's risk is schedule drift, not commitment. A
   weekly schedule digest ("your week at Pembroke Hill") may fit better
   than per-day 24h+2h pairs; today a 5-day open-shift week = 10 near-
   identical texts. Also: should open shifts get the day-of logistics
   content (they skip the 2h_instructions step entirely)?
3. **Careers after day one**: career_first_day anchors to the assignment
   startDate only — no messaging exists for week-1 check-ins (how's it
   going / timesheet reminders). Deliberate or gap?
4. **The worker app duplicates some SMS jobs** (confirmation card, day-of
   hero, running late). As app adoption grows, decide per step whether SMS
   remains the primary or the fallback channel — today every step fires
   all three channels with per-channel dedupe but no cross-channel
   suppression (a worker who confirmed in-app still gets no more asks —
   state-gated — but reminders themselves triple-fire by design).
5. **Copy override drift** (#Adjacent): overridden sequences silently
   diverge from built-in improvements. Consider template variables for
   logistics ({onsiteContact}, {parking}) or an "append logistics" flag.

## File map

- `cadence/shiftReminderProfile.ts` — tracks, fences, targeting (START HERE)
- `workerShiftRemindersV2.ts` — scheduler + dispatcher + non-cadence bodies
- `cadence/cadenceMessages.ts` — 2h_instructions / 15m / 0h bodies
- `cadence/enrichShiftPayload.ts` — shift extras + `fetchDayOfLogistics`
- `cadence/reminderSchedulePlanner.ts` — ladder re-spacing, late-fill synth
- `cadence/replyClassifier.ts` + `cadenceReplyHandler.ts` — inbound SMS
- `cadence/appConfirmationWrites.ts` — in-app confirm/cancel/running-late
- `placementsApi.ts` — offers, respondToAssignment decisions
