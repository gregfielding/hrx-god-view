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
| +1 737 264 6753 | Local (Austin overlay; Twilio had zero 512 inventory 2026-09-08) | direct webhook → `handleInboundSms`, voice → demo.twilio.com welcome (same as 312) | "Natalie Brooks (automation) #2 — 737", bought 2026-09-08 (PN54f9b011…) as a spare configured identically to the 312; unregistered for A2P until the campaign is approved, then add to MG2dd6…'s sender pool with the 312 |

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

## Incident 2026-09-07: 817 outbound failures in 36h = invalid numbers re-sent every 30 min

Greg saw the Twilio log solid red. Deep dive (Claude, scratch
`twilio-outbound-failures.cjs` / `twilio-21211-shape.cjs`, read-only):
- 818 of 871 outbound messages failed; **817 were error 21211 "Invalid 'To'
  number"** to only **19 numbers** — impossible NANP area codes (555, 459,
  893, 932, 797, 444…) typed by applicants on the apply landing page months
  ago, plus a few test accounts. The 888 toll-free sender itself is fine
  (TWILIO_APPROVED); delivered messages kept flowing.
- Root cause: three crons treat EVERY send failure as transient and
  re-defer 30 min forever — `processScheduledInterviewInvites`
  (`interviewInviteScheduledAt` + `autoInterviewInvitePhoneDeferrals`; its
  48-deferral cap only covered the *no phone* branch), `processApplyWizardReminders`
  (`applyWizardReminderDueAt`, no cap at all — one user reached 5,001
  deferrals, i.e. since April), and `processWorkerAiPrescreenReminders`
  (`*DueAt` + `DEFERRAL_MS`). `sendWorkerMessageInternal` swallowed the
  Twilio code, so callers could not tell "bad number" from "rate limit".
- Fix (commit on 2026-09-07): `messaging/smsDeliveryAlerts.ts` gained
  `PERMANENT_SMS_ERROR_CODES` + `isPermanentSmsFailure(result)` (21211,
  21614, 21610, 21617, 30006, and HRX `status:'skipped'` refusals) and
  `recordSmsInvalidNumber` (stamps `users.phoneInvalid` +
  `phoneInvalidReason: 'twilio_21211'`, raises an `ops_alerts` doc kind
  `sms_invalid_number` → Slack #dev via the existing drain).
  `sendWorkerMessageInternal` now returns `errorCode` on every failure,
  calls the recorder on 21211/21614, and short-circuits `phoneInvalid`
  users with `status:'skipped', errorCode:'PHONE_INVALID'` (no Twilio call).
  All three crons stop on permanent failures (clear the pending flag /
  delete `interviewInviteScheduledAt`, outcome `sms_unreachable`) and the
  invite + wizard crons also give up after 48 deferrals of any kind.
- Deploy list: `functions:processScheduledInterviewInvites,functions:processApplyWizardReminders,functions:processWorkerAiPrescreenReminders`
  plus everything that bundles `twilio.ts` picks the change up on its next
  deploy. Backfill script `functions/.scratch/backfill-unreachable-invites.ts`
  (`--dry` first) stops the 16 looping users immediately; the deployed code
  does the same on their next tick.
- Recruiter follow-up: users with `phoneInvalid: true` need a corrected
  phone; clearing the flag re-enables sending (nothing clears it
  automatically yet — worth a "fix phone" affordance on the profile).
- Also learned the same day: Twilio blocks inbound OTP codes TO Twilio
  numbers (30038) — see the Natalie section above.

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

## ☠️ Local scratch runs send MOCK SMS (found 2026-09-08)
`smsProviderFactory` picks the provider from `SMS_PROVIDER` (Firebase param
or env); unset → `MockSmsProvider`, which logs "[MOCK SMS] Would send…",
writes a messageLog with `provider: 'mock'` / `providerMessageId: mock-…`
and reports `success: true`. Scratch scripts run with `ts-node` from
`functions/` do NOT load `.env.hrx1-d3beb`, so the 2026-09-07 23:30Z
"97 texts" OnTrac re-run and the 2026-09-08 15:2xZ "190 texts" re-run were
mocks — nobody was texted, but `tryClaimDailySmsSlot` still burned each
worker's 24h shift-invite slot. Rules: (1) run blasts through the deployed
code (Natalie's `schedule_blast` / `natalie_scheduled_actions` with
`runAt = now`) — never locally; (2) if a local send is unavoidable, set
`SMS_PROVIDER=twilio` plus the four TWILIO_* secrets in-process and verify a
messageLog `providerMessageId` starts with `SM`; (3) after a mock run,
release `tenants/{t}/shiftInviteSmsCooldown/{uid}` for the affected pool
before re-running.

## 10DLC campaign #2 REJECTED — 30908 privacy policy (found 2026-09-08)
The 2026-09-07 submission on MG2dd6557d05d9be9044c996fa568a8a39 (brand
BNe4c984a6 is APPROVED/VERIFIED) came back `FAILED`, error 30908 "a compliant
privacy policy can not be verified", field MESSAGE_FLOW. Two causes: (1)
hrxone.com/sms-privacy and /consent are a JS-only SPA shell — curl returns a
3.9 KB page with no policy text, so the reviewer saw nothing; (2) the notice
said "do not sell or rent" but not the statement Twilio checks for. Fixed
2026-09-08: `legal.smsPrivacy.s2P4` (en/es) adds "We do not share, sell, or
provide your mobile phone number or your text messaging opt-in and consent
data to third parties or affiliates for marketing or promotional purposes…",
and static crawlable copies ship at https://hrxone.com/sms-privacy.html and
https://hrxone.com/consent.html (generated from en.json into `public/`;
regenerate when the locale copy changes). Resubmission script:
`functions/.scratch/a2p-resubmit.cjs` (deletes the FAILED campaign on the
service, POSTs the corrected one whose MessageFlow cites the .html URLs and
quotes the non-sharing sentence). Twilio charges the $15 vetting fee again —
Greg's call to run it. Natalie's 312 line stays receive-only (and cannot get
OTPs, 30038) until a campaign is approved; her sends go via the 888.

## Campaign #3 submitted 2026-09-08 20:05Z — in real review
Resubmitted with `PrivacyPolicyUrl=https://hrxone.com/privacy.html` and
`TermsAndConditionsUrl=https://hrxone.com/terms.html` (both static, en/es,
with the non-sharing statement; terms.html carries an SMS program section).
Campaign #2 (20:05Z-58s earlier) was auto-rejected in the same second with
30882 TERMS_AND_CONDITIONS_URL + 30908 PRIVACY_POLICY_URL because those two
API params were never sent — the vetting bot reads the params, not URLs
buried in MessageFlow. #3 has stayed IN_PROGRESS past the instant-reject
window; human review is days–weeks. Check with
`functions/.scratch/a2p-status.cjs`. When APPROVED: add +1 312 663 8247 to
MG2dd6557d05d9be9044c996fa568a8a39's sender pool, set its inbound URL to
`handleInboundSms`, point Natalie's sends at that MG.

Console "errors" seen the same day were unrelated to the campaign: 12200
("Content is not allowed in prolog" — our webhooks answered `OK` instead of
TwiML; fixed to `<Response></Response>` text/xml), one 11200 (an inbound
MMS with no text got a 400 from `handleInboundSms` — fixed: attachments
become `[sent N attachment(s)] <MediaUrl>`), and 30003/30005/30006/21610
delivery failures from the Denver blasts (bad/unreachable numbers).

## Campaign #3 REJECTED 22:38Z (30908 MESSAGE_FLOW) — cause was a deploy race, not the copy
The reviewer (human, 2.5h after submission) followed the sign-up flow to
hrxone.com/privacy — the in-app page, which then lacked the statement — and
privacy.html/terms.html had vanished: they were published from a checkout
that was on the wrong branch and a later main deploy replaced them (see
feedback_hosting_empty_config_incident.md addendum). Round 4 setup
(2026-09-08 ~17:15 PT, on main): `legal.privacy.s4P3` non-sharing statement
in the Privacy Policy itself (en/es); `/privacy`, `/terms`, `/sms-privacy`,
`/consent` rewritten to the static bilingual pages ahead of the SPA
catch-all; resubmit script cites the canonical URLs and quotes the sign-up
checkbox verbatim (`PrivacyPolicyUrl=https://hrxone.com/privacy`,
`TermsAndConditionsUrl=https://hrxone.com/terms`).

## Debugger triage 2026-09-08 (357 alerts in the UTC day) — what each code was
30003 ×127 / 30005 ×68 (unreachable / unknown handset — Denver blasts; transient,
not stamped), 21610 ×58 (unsubscribed: 30-ish were HRX's own STOP confirmation
— removed 2026-09-08, Twilio's messaging-service auto-reply covers it — the
rest were blasts re-trying STOP'd numbers because the async carrier rejection
never stamped the worker; `twilioStatusCallback` now stamps on 21610 /
21211 / 21614 / 30006), 12200 ×55 (webhooks answered `OK` not TwiML —
fixed in BOTH `handleInboundSms` and `twilioInboundSmsWebhook`; deploy both),
21211 ×32 (invalid numbers, incl. the AccuSource test's 555 number), 11200 ×4
(text-less MMS 400 — fixed), 30006 ×9, 20404 ×3, 60005 ×1. None of these
touch the 10DLC campaign.

## Round 4 REJECTED 02:36Z 9/9 (30908 MESSAGE_FLOW again) → round 5 setup
Root cause per Twilio's "A2P 10DLC Campaign Onboarding Guide" (linked from the
console banner): (1) the opt-in is behind a login/in-app flow, so the
message_flow MUST carry a public screenshot link — reviewers hit the login
redirect at hrxone.com and could verify nothing; (2) the public phone
sign-up (`PhoneSignupGate`) had NO consent language and `checkOtp` auto-stamped
`userAgreements.smsConsent.agreed=true` — bundled consent, an explicit
rejection reason; (3) the fee line must be verbatim "Message and data rates
may apply" (ours said "Message & data rates"). Fixed 2026-09-09: separate
unchecked optional checkbox + CTIA disclosure + policy links on the phone
sign-up, `checkOtp` records `smsConsent` → `users.smsOptIn` + `userConsents/{uid}`,
public https://hrxone.com/sms-optin.html (+ sms-optin.png, captured with
Playwright from portal-worker/.scratch/optin-shot.ts) reproduces the screen;
static legal pages regenerated by `scripts/generateStaticLegalPages.py` with
Twilio's exact sentence ("All the above categories exclude text messaging
originator opt-in data and consent…") and bold STOP/HELP + carrier-liability
terms. message_flow now quotes the checkbox verbatim and links the screenshot.

## Round 5 SUBMITTED 2026-09-09 15:52Z — in review
Corrected message_flow (verbatim checkbox text + https://hrxone.com/sms-optin.html
screenshot link), PrivacyPolicyUrl=https://hrxone.com/privacy,
TermsAndConditionsUrl=https://hrxone.com/terms; passed the instant automated
check. Human review took ~2.5h on rounds 3 and 4; Twilio says up to 5 business
days at current volumes. Check: `functions/.scratch/a2p-status.cjs`.
