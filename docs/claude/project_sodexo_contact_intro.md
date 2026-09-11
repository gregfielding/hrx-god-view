# sodexo contact intro

> "Intro email sent FROM and AS Deborah (d.waltermyer@c1staffing.com) to a contact newly attached to a new Sodexo job order. It goes out in the contact's daytime, never overnight, and a same-thread follow-up goes 48h later if nobody replied. Built 2026-09-11; OFF until the mailbox is connected, Greg's scripts are in code, and the kill switch is flipped"

## What it does

When a contact lands on a Sodexo JO's Deal Contacts card
(`deal.associations.contacts`), Deborah's own Gmail emails them. That field
is written two ways: by the Fieldglass hiring-manager attach in
`fieldglassJobOrder.ts ensureHiringManagerDealContact`, and by a recruiter
adding a contact in RecruiterJobOrderDetail. Because it's her Gmail,
replies land in her inbox.
- **Send window** (Greg: "send in the morning not overnight"): 8 AM–6 PM
  contact-local. The timezone comes from the JO `worksiteAddress.state` via
  `timezoneForState`, defaulting to Pacific. Anything outside the window
  queues for the next 8 AM local. Weekends are NOT excluded.
- **Candidate-in-mind orders are skipped** (Greg 2026-09-11), keyed on
  `fieldglass.candidateInMind`. The check runs at queue time AND again in
  the cron before the intro and the follow-up. Every intro waits ≥10 min
  (`INTRO_SETTLE_MS`) and is sent by the cron, never inline. Reason: an
  email-first FG order gets its hiring-manager contact attached by the
  backfill BEFORE the same backfill stamps candidateInMind, so an inline
  send would race it. Effective intro latency is 10–25 min during the day.
- **Follow-up** (Greg: "if there is no reply, 2nd email 48 hours later"):
  goes 48h after the intro (pushed into the window if needed), in the same
  Gmail thread (threadId + In-Reply-To/References, subject "Re: …").

## Pieces

- `functions/src/sales/deborahMailbox.ts` holds the grant.
  - Tenant-level, at `tenants/{t}/integrations/deborahMailbox`. Same shape
    as natalieMailbox / salesOutreachMailbox; NEVER `users/{uid}.gmailTokens`.
  - Scopes: `gmail.send` + `gmail.readonly`.
  - OAuth state purpose `deborahMailbox` → branch in the shared
    `gmailOAuthCallback`. The callback refuses any account other than
    d.waltermyer@.
- `functions/src/sales/sodexoContactIntro.ts` holds the runner, the cron,
  and `SODEXO_INTRO_TEMPLATE` / `SODEXO_FOLLOW_UP_TEMPLATE` (Greg's
  scripts). While null: no intro sends, and follow-ups wait. Merge fields:
  `{{firstName}} {{fullName}} {{jobTitle}} {{siteName}} {{city}} {{state}}
  {{startDate}} {{poNumber}} {{jobOrderNumber}} {{headcount}}`.
- `functions/src/sales/sodexoContactIntroRules.ts` holds the pure rules:
  window, reply classification, diff, and template. Tested in
  `sales/__tests__/sodexoContactIntroRules.test.ts`.
- **Intro hook**: inside `onJobOrderStatusTransitionSnapshot` (existing
  job_orders onDocumentWritten, 512MiB, retry off). Isolated try/catch.
  Every write that isn't Sodexo or adds no new contact exits before any read.
- **`sodexoContactIntroCron`** (NEW function, every 15 min, maxInstances 1):
  delivers `queued` intros and runs due follow-ups. It uses the query
  `nextActionAt <= now` (single-field, no composite index). It claimed one
  Cloud Run slot (993 → 994; see the conventions ledger).
- **Signature** (Greg: "use her real signature"): Gmail only auto-inserts
  signatures in its compose UI, never on API sends. So `sendAsDeborah`
  reads her live signature via `users.settings.sendAs.get` at send time and
  sends multipart/alternative. The HTML part mirrors Gmail's compose markup
  (`sales/gmailSignature.ts`); the text part holds the signature as text.
  Templates end at the sign-off with NO typed signature. If the signature is
  unreadable or empty, it uses `DEBORAH_FALLBACK_SIGNATURE_HTML` (text, no
  logo). The ledger records `signatureSource: gmail|fallback`. Parts are
  base64-encoded because Gmail signature HTML exceeds the 998-octet line limit.
- Connect / verify: `functions/.scratch/deborah-mailbox.ts url|verify`
  (run from `functions/`). `verify` also writes
  `functions/.scratch/deborah-email-preview.html` (body + her real signature).

## Gates

1. Sodexo JO: `companyId 5VV6w7lFLRxJv3TEeu7M`, `parentAccountId
   AKsctgcdwAZ8C7RUkgky`, or company/parent name "Sodexo".
2. Contact id newly present in `deal.associations.contacts`. Snapshot edits
   of an existing contact don't count.
3. Config doc `tenants/{t}/integrations/sodexoContactIntro` `{ enabled:
   true, enabledSince: <Timestamp>, dryRun?: bool }`.
   - A missing doc means OFF; the cron stops too.
   - The JO's `createdAt` must be ≥ `enabledSince`. That means no
     retroactive blast over the ~130 existing Sodexo JOs, and adding a
     contact to an OLD JO doesn't send.
4. The contact must pass these checks before EVERY send (intro and follow-up):
   - not internal (c1staffing.com / hrxone.com)
   - not `emailBounced`
   - not opted out (`optedOut`, `sodexoOutreach.optedOut`,
     `crmReengagement.optedOut`, `doNotContact`)
   - not in `outreach_suppressions`
5. **Once per email address, ever**: the ledger doc
   `tenants/{t}/sodexo_contact_intros/{email}` is claimed in a transaction.
   A hiring manager who posts 20 orders gets one intro + one follow-up.
   Delete the row to re-evaluate a contact. `dry_run` rows don't block a
   later live send.
6. Intro: skipped if Deborah's mailbox already has any mail from/to them
   (`prior_correspondence`).
7. Follow-up: skipped on any human reply in the thread or from them
   anywhere (`replied`), or a mailer-daemon bounce (`bounced`; this also
   stamps the contact `emailBounced` like the bounce sweep). It's also
   skipped if Deborah wrote them herself (`complete /
   deborah_followed_up`). Out-of-office auto-replies do NOT count.
8. Anything >24h overdue (outage, template shipped late) is dropped
   (`expired` / `no_template`), never sent stale.

## Ledger statuses

`queued` (intro waiting for 8 AM) → `sending` → `sent` (follow-up scheduled)
→ `followup_sending` → `followup_sent` | `replied` | `bounced` | `complete`
(+`followUpSkipReason`). Terminal elsewhere: `skipped` (+`skipReason`),
`failed`, `followup_failed`, `dry_run` (with `wouldSendAt`,
`wouldFollowUpAt`, `followUpPreview`). Failed rows are NOT retried, so there
is no double-send risk. A crash mid-send leaves `sending` / `followup_sending`
stuck, which is visible and never re-sent. `nextActionAt` is non-null only
while something is scheduled. The contact doc gets
`sodexoContactIntro { sentAt, from, jobOrderId, gmailMessageId,
gmailThreadId, followUpSentAt }`.

## Go-live checklist

1. Deploy `functions:gmailOAuthCallback,functions:onJobOrderStatusTransitionSnapshot,functions:sodexoContactIntroCron`.
2. `npx ts-node .scratch/deborah-mailbox.ts url`. Open the URL in a browser
   signed in as Deborah and confirm "Deborah's mailbox is connected", then
   run `verify`.
3. Scripts are in the template constants (drafted with Greg 2026-09-11:
   order-number subject; one either/or question — "submit straight into
   Fieldglass, or resumes first?"; follow-up "Is {{poNumber}} still open?";
   sign-off "Working hard for you!"; no typed signature). A JO missing any
   field the scripts use is skipped (`missing_fields:…`), never sent with
   blanks.
4. Set the config doc `{ enabled: true, dryRun: true, enabledSince: now }`
   and review a few `dry_run` ledger rows. The cron does nothing while
   dryRun is on. Then flip `dryRun: false`.
