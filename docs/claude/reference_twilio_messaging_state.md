# Twilio messaging state (senders, A2P 10DLC, routing)

> "Audited 2026-09-07 in the Twilio console: HRX sends through the C1 Messaging service whose ONLY sender is the verified toll-free 888 line; NO approved 10DLC campaign exists (both Oct-2025 campaigns FAILED) — every local number on the account is unregistered for A2P, so Natalie's 312 line cannot send until a campaign is approved or she gets a toll-free number"

Account "My first Twilio account" (Greg), verified via Claude-in-Chrome 2026-09-07.

## Numbers

| Number | Type | Where it points | Notes |
|---|---|---|---|
| +1 888 805 8650 | Toll-free | C1 Messaging service (MGe3edf114c7b9c270ee66928816d65b25) | THE outbound sender for all HRX SMS (toll-free verified, separate from 10DLC) |
| +1 312 500 4352 | Local | direct webhook → `handleInboundSms` | main inbound line; NOT on any messaging service, NOT A2P registered |
| +1 415 429 3750 | Local | Low Volume Mixed service MG98999c80df5bb34ceeb0af83d9b206b3 (campaign FAILED) | Greg: may become a general company line |
| +1 312 663 8247 | Local | direct webhook → `handleInboundSms` | Natalie Brooks (automation persona), bought 2026-09-06; inbound works, outbound unregistered |

## Messaging services

- **C1 Messaging** `MGe3edf114c7b9c270ee66928816d65b25` — inbound request URL
  `https://us-central1-hrx1-d3beb.cloudfunctions.net/twilioInboundSmsWebhook`;
  sender pool = the toll-free 888 only; **No Connected Campaign** (fine for
  toll-free, useless for 10DLC numbers). Secret `TWILIO_A2P_CAMPAIGN` =
  this SID; `TWILIO_MESSAGING_PHONE_NUMBER` = +18888058650. `functions/src/twilio.ts`
  sends with `messagingServiceSid` and falls back to `from` on 21705/30034.
- **Low Volume Mixed A2P Messaging Service** ×3: MG2dd6557d05d9be9044c996fa568a8a39
  (no campaign, empty), MG98999c80df5bb34ceeb0af83d9b206b3 (campaign
  CM868794457d59e651eef0d73aebad9ade **Failed**, holds the 415),
  MGd6a691a8cdbdb62919304222539b2e03 (campaign CM8a78d616a250a19bdd7b685c2beb48b6
  **Failed**, empty). Brand `BNe4c984a6fd350db262a73955636907f0` exists.
  Both campaigns were submitted 10/9/2025 with the same description (OTP +
  application status + assignment/shift comms + onboarding) and sample
  messages that mix OTP ("Your one-time passcode is 1234"), links and
  marketing-ish copy with NO opt-out language — a classic rejection profile.

## New campaign SUBMITTED 2026-09-07 (Greg chose "do it right")

Registered via Claude-in-Chrome on the empty service
**MG2dd6557d05d9be9044c996fa568a8a39** ("Low Volume Mixed A2P Messaging
Service"), brand C1 Staffing LLC, use case Low Volume Mixed ($15 vetting +
$1.50/mo), status **In progress** (review = days to weeks; Twilio emails
Greg if anything is wrong). Content: staffing-agency description, 5 samples
all "C1 Staffing: … Reply STOP to opt out" (shift confirm YES/NO, plus-15
clock-in check HERE/NO, shift offer, onboarding reminder w/ hrxone.com
link, recruiter reply), consent flow = signup checkbox + verified phone +
https://hrxone.com/consent, privacy https://hrxone.com/sms-privacy, opt-in
keywords START/UNSTOP/OPTIN, links yes / phone numbers no / lending no /
age-gated no. Deliberate differences from the live cadence: samples say
NO (not CANCEL — CANCEL is a Twilio default opt-out keyword) and no OTP
sample (Verify is separate). **When approved**: add +1 312 663 8247 to
this service's Sender Pool, set its inbound request URL to
`twilioInboundSmsWebhook` (same as C1 Messaging), then point Natalie's
sends at this MG SID. Until then Natalie texts through the 888 (C1
Messaging) with her signature.

## Opt-out keywords (C1 Messaging) — changed 2026-09-07

Standard Opt-Out Keywords now: end, optout, quit, revoke, stop, stopall,
unsubscribe (`cancel` removed — see [[feedback_twilio_cancel_keyword_optout]]).
Opt-in: start, unstop, yes. Help: help, info. Twilio's auto-replies to these
do NOT show in the Messages log. Carrier blocks now surface in Slack via
`ops_alerts` (channel configurable at `app_config/ops_alerts.slackChannelId`).

## Natalie's line CANNOT receive verification codes (found 2026-09-07)

Slack's "sign in with mobile number" sent two codes (short codes 78156 and
22395) to +1 312 663 8247. Twilio marked both inbound messages **Failed,
error 30038 "OTP message body filtered"**, redacted the body to
`**verification code is:**`, and never called the webhook — Twilio blocks
one-time passcodes delivered TO its own numbers (account-verification abuse
prevention). This is not fixable by campaign registration; an exception
needs a Twilio support ticket ("inbound OTP allow-list"), and even then
per-sender. So for ANY portal / SaaS phone verification for Natalie
(Slack, Indeed Flex, Fieldglass, Google) use her mailbox
(n.brooks@c1staffing.com — Claude reads it) or Google SSO instead. Normal
worker replies to her line are unaffected (`sms_inbound_raw` audit copy
+ routing).

## What this means

- Sending from ANY local (10DLC) number on this account is unregistered
  A2P: carriers filter it (Twilio error 30034 / low deliverability). The
  platform only works because the toll-free line is verified.
- **Natalie's own line** (Greg's decision 2026-09-07: her texts should come
  from her number) needs one of: (a) a NEW, properly written 10DLC campaign
  on the existing brand (sample messages with "Reply STOP to opt out",
  documented opt-in at signup, one consistent use case, OTP moved to Twilio
  Verify) — days to weeks, $15 vetting; (b) a toll-free number for Natalie
  + toll-free verification (form: business info, use case, opt-in
  description, sample messages) — typically 1–5 business days; or (c)
  interim: send her messages through C1 Messaging (the 888) with her
  signature, replies still route to `handleInboundSms`.
- Do NOT add the 312 663 8247 number to C1 Messaging expecting compliance:
  a 10DLC number in a service without a campaign is still unregistered.
