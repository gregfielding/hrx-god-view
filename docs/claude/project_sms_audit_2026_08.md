---
name: project-sms-audit-2026-08
description: 2026-08-27 deep audit of every automated SMS path reaching scheduled workers — root causes for duplicate/bilingual/phantom-shift complaints + prioritized fix list
metadata:
  type: project
---

# Worker SMS audit (2026-08-27)

Evidence: 18,327 outbound messages in 14 days (messageLogs, Aug 13–27).
Report artifact: https://claude.ai/code/artifact/5e41151a-9d03-4068-a6d9-c0041aea27ba

## Root causes found (all reproduced in logs)

1. **P0 — shift_invite dual-path double-send**: `jobOrderAutoMessaging`
   sends the worded SMS directly AND fires the notification router for
   push — the router ALSO delivers SMS (logged body = literal
   `Message: shift_invite`, real Twilio provider id). 2,965 exact-2× pairs
   in 14d; 361 pairs split en/es (paths resolve language independently).
2. **P0 — assignment status-flip blast**: the assignment-update notifier
   (index.ts ~9720) gates on RAW `before.status !== after.status` and its
   dedupe key includes `updatedAt` → status flip-flop = unique key every
   write. Aug 18: 363 `assignment_confirmed` sends, ~180 EACH to two
   workers with ONE assignment apiece. Fix: normalized-transition gate +
   drop updatedAt from the dedupe key.
3. **P1 — rate-limit exemption**: `RATE_LIMIT_EXEMPT_MESSAGE_TYPES`
   (messaging/rateLimiter.ts) exempts assignment_confirmed,
   on_call_employment_started, payroll_onboarding_invite_needed,
   onboarding_reminder, reminder types — the per-user 6/hr–20/day caps
   never applied to ANY incident here. Exempt should mean higher cap
   (e.g. 3/day/type), never no cap.
4. **P1 — onboarding_reminder daily nag**: 3,028/14d; 123 workers got one
   EVERY day (no terminal stop despite the R1–R3/R5 ladder in
   processWorkerOnboardingReminders).
5. **P1 — hire barrage**: worker_hired + on_call_employment_started +
   payroll_onboarding_invite_needed fire together (day counts lockstep);
   239 workers got all 3. on_call_employment_started is bilingual-in-one-
   body by template (506/506).
6. **P2 — prescreen chase loop**: one worker got 335 chases in 5 days
   (multiple prescreen docs each chasing; the 5-day stop bounds days not
   sends/day).
7. **P2 — Messaging Sequences targeting UI is Phase 1 only** — saving
   targeting does NOT drive the dispatcher (still shiftReminderProfile
   tenant switch).

## Healthy

Shift-reminder V2 (workerShiftRemindersV2) is well-engineered: txn claim,
send-time re-check of assignment status/start, post-start + reply-state
suppression, retro/notificationsSuppressed honored (the 2026-08-26/27
assignment backfills produced ZERO texts). V1 retired 2026-06-07.

## Fix order

router-SMS suppression for invites → normalized transition gate → hard
per-type daily caps → onboarding ladder stop → one-message hire moment
(single language) → chase cap → wire sequences targeting (Phase 2).
P0+P1 ≈ −40% volume and kills every complaint pattern.

## ALL FIXES SHIPPED 2026-08-27 (commit 6edbeb11; 18 functions + hosting)

1. logAssignmentUpdated: NORMALIZED transition gate; dedupe key =
   (assignment, beforeN, afterN) — no updatedAt token.
2. rateLimiter: `claimTypeDailySlot` counter docs
   (messagingConfig/typeDailyCaps/counters/{uid}__{type}__{day}) — exempt
   types capped 3/day (onboarding_reminder 1/day, bulk_direct_sms 3/day);
   1:1 direct_message uncapped. Exported for direct-Twilio senders.
3. routingOrchestrator.logMessageAttempt skips sms/email rows (delivery
   paths self-log with the real body) — the placeholder double-rows are
   gone. CORRECTION from deeper analysis: the shift_invite "double send"
   was double-LOGGING (same Twilio provider id in every pair) — workers
   received ONE text; true 14d volume ≈ 7,962; biggest real dupe source
   was recruiter bulk re-blasts (+894/14d), now capped.
4. Hire moment: worker_hired + on_call_employment_started are DENIED the
   SMS channel in the router policy (push/in-app only);
   payroll_onboarding_invite_needed keeps SMS (the actionable link).
5. processWorkerOnboardingReminders claims the 1/day slot directly (it
   bypasses the router via sendWorkerMessageInternal).
6. Prescreen/interview: `claimDailyPrescreenSmsSlot` — ONE prescreen SMS
   per worker per day across all application docs and kinds (all 4
   direct-Twilio sites in processWorkerAiPrescreenReminders).
7. shiftReminderProfile Phase 2: `messagingSequences/cort_gig.targeting`
   GOVERNS (active/accountIds/workerTypes/occurrence; first_shift = CORT
   until a completed assignment exists at the account); legacy
   messagingConfig/shiftReminderProfile switch applies only when the card
   was never saved. Settings page note updated to "targeting is live".

Watch after ship: typeDailyCaps counters growing (each doc is tiny;
consider a TTL cleanup later); recruiters may notice bulk re-blasts
capped at 3/day per worker — that is intended.
