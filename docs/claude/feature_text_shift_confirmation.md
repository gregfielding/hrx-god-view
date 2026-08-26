# text shift confirmation

> Team-decided (2026-08-21 Systems & Process meeting): confirm/decline shifts by replying to an SMS, no app login required. Not built yet — captured here so the protocol details aren't lost before someone picks it up.

**Why:** for events like ACL, workers largely don't self-confirm shifts in the app — they text Rosa Govea directly, creating a heavy manual load (per Rosa, this is the actual current-state workflow, not a hypothetical). Greg Fielding's framing: shift confirmation shouldn't require logging into anything.

**Agreed protocol (from the meeting, not yet implemented):**
- Reminder text sent **2 hours before shift start**.
- Worker has a **30-minute window to respond** before the team starts looking for a replacement.
- Team wants **real-time visibility** into who's confirmed vs. gone quiet — not a batch report — since manual follow-up (especially early-morning) is the specific pain point being eliminated.
- Explicitly do NOT want the deadline to feel punitive toward workers in transit (raised as a concern, no concrete mitigation decided).
- Longer-term idea floated (not decided): AI/bot-handled replies for common questions (payroll status, "can I cancel") via the same SMS channel, "choose your own adventure" style branching.

**Likely implementation surface:** this repo already has inbound SMS handling — `twilioInboundSmsWebhook` (see `functions/src/twilio.ts` family) is a deployed, live function. A reply-based confirmation flow would extend that inbound path rather than starting from scratch. Cross-check the existing shift-reminder cron machinery (`dispatchScheduledWorkerReminders`, `cleanupLegacyWorkerShiftReminders` per the deployed-functions list) before assuming this needs a new scheduler.

**Related:** decided in the same meeting as [[project_phone_number_login]] — both are "reduce login friction" fixes for different situations (real account access vs. one-off shift response).

**How to apply:** if picking this up, start from the existing Twilio inbound-SMS + reminder-cron code rather than a fresh design — the 2hr/30min timing and "real-time, not batch" visibility requirement are the two concrete constraints from the meeting; everything else (bot-style Q&A) is an idea, not a spec.
