# ☠️ Twilio treats "CANCEL" as an opt-out — our shift cadence asked workers to reply it

> "Found 2026-09-07: the C1 Messaging service's Standard Opt-Out keywords are cancel, quit, stop, optout, unsubscribe, stopall, revoke, end. The gig cadence's 24h ask said 'Reply YES to confirm or CANCEL'. Every CANCEL reply was processed by Twilio BEFORE HRX saw it → the worker was unsubscribed at the carrier layer; 3 of 10 CANCEL repliers since the 8/29 pilot are confirmed blocked (every later send failed with error 21610), the rest are unverified but the mechanism is the same."

## Facts (verified via the Twilio API, read-only scripts in functions/.scratch/twilio-cancel-*.cjs)

- Messaging Service C1 Messaging (MGe3edf114c7b9c270ee66928816d65b25) → Opt-Out
  Management → Standard Opt-Out Keywords include **cancel**. Opt-in keywords
  are start, yes, unstop (so "YES" from a previously opted-out worker
  re-subscribes them — harmless). Help: help, info.
- 10 workers replied a bare "CANCEL" to the 888 between 2026-08-30 and
  2026-09-05. For 3 of them HRX later tried to text and Twilio rejected with
  21610 "Attempt to send to unsubscribed recipient": Maria Galvez (…9670, 3
  failed), Anaia Gage (…3357, 10 failed), Beatriz Morales (…7631). The other
  7 (Leialoha Goolsby, Christopher Gonzalez, Keila Barrios, Patricia
  Valencia, Jose Mejia, Tiffane Samson, Dominique Mark) had no sends after
  their CANCEL except Jose Mejia (3 delivered — so not blocked). Twilio's
  auto-reply ("You have successfully been unsubscribed…") does NOT appear
  in the Messages log, so absence of it proves nothing.
- HRX's own classifier already accepts a bare **NO** as a cancellation token
  (`replyClassifier.ts` CANCELLATION_TOKENS), so the fix is copy + Twilio
  config, not new parsing.

## Fix (3 parts)

1. **Twilio**: on C1 Messaging → Opt-Out Management → Enable Advanced
   Opt-Out → remove `cancel` from the opt-out keyword list (keep stop,
   stopall, unsubscribe, quit, end, optout, revoke). Do the same on the new
   Natalie service MG2dd6557d05d9be9044c996fa568a8a39 once its campaign is
   approved. (Account setting — Greg's call.)
2. **HRX copy**: every worker-facing "Reply … CANCEL" becomes "Reply … NO"
   (cadenceMessages.ts / sequenceCopyOverrides.ts, EN + ES; the A2P campaign
   samples submitted 2026-09-07 already say NO). Deploy
   dispatchScheduledWorkerReminders.
3. **Unblock the workers**: Twilio offers NO API to clear an opt-out — only
   the worker texting START/UNSTOP/YES to the 888 clears it. Recruiters
   (Daniel/Deborah) call or push-notify the list above and ask them to text
   START; until then every SMS to them silently fails (HRX logs 21610).

## Why it hid

Twilio's keyword handling runs before the webhook; HRX's cadence saw the
CANCEL, cancelled the shift correctly, and never learned the number was
now dead. Outbound failures surfaced only as 21610 in the Twilio log, which
nobody was watching. Add a 21610 alert (Slack) to the SMS sender.
