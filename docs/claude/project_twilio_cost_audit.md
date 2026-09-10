# twilio cost audit

> "2026-09-10 deep dive: Twilio is ~$500-620/mo now (peak $1,959 in May, incl. ~$830 of Engagement Suite charges May-Jul that have since stopped). ~51% of billed SMS segments are overflow. Job invites = 36% of SMS spend at exactly 2 segments, mostly because of the 42-char 'Reply STOP to unsubscribe, HELP for help.' footer. Swapping to the registered 'Reply STOP to opt out' ≈ -$52/30d; + Spanish accent transliteration ≈ -$78/30d total. 21211 retry loop already fixed 09-07/08 (small tail). No SMS-pumping evidence."

Greg 2026-09-10: "deep dive into our Twilio usage? our recent bills are excessive". Read-only analysis; no code changed.

## Monthly Twilio usage (Usage Records API, `totalprice`)

| Month | USD | Notes |
|---|---|---|
| 2026-03 | 27.61 | |
| 2026-04 | 311.60 | |
| 2026-05 | 1,959.10 | SMS $1,435 + Engagement Suite $525 |
| 2026-06 | 988.56 | Engagement Suite $285 |
| 2026-07 | 683.82 | Engagement Suite $21 (then stopped) |
| 2026-08 | 512.23 | toll-free SMS $300 + carrier fees $152 |
| 2026-09 (1-10) | 269.42 | includes $61.50 one-time A2P campaign fees |

Prepaid balance on 2026-09-10 was $52.46 — card charges Greg sees are auto-recharge top-ups, not monthly invoices (recharge settings are not exposed by the API; check Console → Billing).

## Where 30 days of SMS went (2026-08-11 → 09-10)

37,230 messages: 36,109 outbound, 1,121 inbound. Estimate uses $0.0125/segment (toll-free $0.0083 + ~$0.0042 carrier fee, both derived from August usage records). Keyword buckets over message bodies:

| Feature | Est. $ | Share | Billed sent | Avg segments |
|---|---|---|---|---|
| Job / shift invites | 182 | 36% | 7,289 | 2.00 |
| Applicant funnel (apply, prescreen, interview) | 75 | 15% | 2,063 | 2.24 |
| Other / long tail | 68 | 13% | 3,007 | 1.81 |
| Recruiter manual blasts | 60 | 12% | 2,082 | 2.32 |
| Onboarding & payroll reminders | 60 | 12% | 1,909 | 2.52 |
| Shift cadence (confirm / remind / check-in) | 57 | 11% | 2,258 | 2.01 |
| OTP codes (own SMS path) | 7 | 1% | 598 | 1.00 |
| Natalie | 1 | 0% | 21 | 2.10 |

Also: Twilio Verify $19-66/mo; phone numbers $8.25/mo; failed-message fees $18-20/mo in Jul-Aug (the 21211 loop below).

## Levers, ranked by measured savings

1. **Footer text.** 42% of billed messages carry "Reply STOP to unsubscribe, HELP for help." (`functions/src/messaging/templateEngine.ts` `stopText`, and `messaging/routingOrchestrator.ts` ~L676/L708). Job invites have median 178 chars; only 4% fit one segment today. With "Reply STOP to opt out" — the wording in the APPROVED A2P campaign samples ([[reference_twilio_messaging_state]]) — 54% fit; with no footer 84%. Across all traffic the swap saves 4,169 segments/30d ≈ **$52/30d**. ⚠️ C1 Messaging sends from the toll-free 888 (toll-free verification, not the 10DLC campaign) — confirm its verification sample messages before changing the wording.
2. **Spanish accents.** Smart Encoding is ON for every messaging service (it maps curly quotes/dashes), but á/í/ó/ú force UCS-2 (67 chars/segment); Spanish apply/onboarding templates run 3-4 segments. Transliterating (or shorter copy) adds ≈ **$26/30d** on top of #1. Trade-off: accentless Spanish.
3. **Manual blasts.** 2.32 segments average; e.g. a "Save the Date" blast with emoji = 7.8 segments × 127 recipients. A live segment/cost counter in the bulk composer is the fix.
4. Onboarding & payroll reminders average 2.52 segments — copy trim.

## Risks and incidents

- **21211 invalid-number retry loop:** 16,882 failed attempts in 30 days to 23 numbers (median gap 20-40 min; one number 1,472×). Fixed 2026-09-07/08 (permanent-failure handling + status callback stamping `phoneInvalid`, see [[reference_twilio_messaging_state]] incident section). Residual: 477 attempts from 20 numbers since 09-07, 5 on 09-10. Of the 23 numbers, 13 match user docs (3 with `interviewStatus: skipped` and no `phoneInvalid`); 10 match no `phone`/`phoneE164` on users — the sender must be reading them from elsewhere.
- **Public `sendOtpHttp` (functions/src/twilio.ts ~L66)** has no app-level throttle; the E.164 regex accepts international numbers and it relies on Twilio Verify's per-number 429s. Verify attempts went from ~20/day to 150-157/day on 09-09/10 (78% / 54% converted) — consistent with the phone sign-up launch; every attempt's carrier is a US MCC (310/311/313), so no pumping evidence. Worth App Check or per-IP limits.
- Unverified (code-map agent, not confirmed by data): `messaging/smsOutboundQueue.ts` can re-send if a Firestore write fails after a successful Twilio send; `applicationSmsTriggers.ts` dedupe key includes an updatedAt token (status flip-flop → repeat SMS).

## Re-running

Credentials are Secret Manager secrets `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` (not in `.env.hrx1-d3beb`): `gcloud secrets versions access latest --secret=…` inside the script, never printed. APIs: `/2010-04-01/Accounts/{sid}/Usage/Records/{Monthly,Daily}.json`, `Messages.json?DateSent>=`, `verify.twilio.com/v2/Attempts`, `messaging.twilio.com/v1/Services`. Raw 30-day message dump (contains phone numbers + bodies — PII, gitignored): `functions/.scratch/twilio_messages_30d.json`.
