# Marco Gomez — second recruiting persona (works for Rosa; C1 Events minus Oakland Arena)

> Greg 2026-09-11: "Marco Gomez — a 'Natalie' style recruiter that is built to work for Rosa —
> primarily supporting venuesmart, but also every other 'c1 events' account besides oakland arena."

Status: **LIVE** — switched on 2026-09-11 21:35:23Z (`tenants/{T}/app_config/marco.enabled = true`, Greg:
"flip it on now"). At that moment 70 onboarding follow-ups were active (18 stamped natalie + 52 created before
persona stamping) — they all finish with Natalie; no pending escalations or SMS watches were scoped to Marco.
New C1 Events (minus Oakland Arena) follow-ups, escalations, offers and relays route to Marco from here.
Kill switch: set `enabled: false` — `tokenFor` hands everything back to Natalie on the next tick, no data changes. Model: [[project_natalie_roadmap]] /
[[reference_slack_natalie_persona]] / [[project_natalie_onboarding_followups]].

## Decisions (Greg, 2026-09-11)
- **Scope = C1 Events accounts (`hiringEntityId == 'c1_events_llc'`) EXCEPT Legends Global / Oakland Arena.**
  Marco **owns them fully**: onboarding + screening follow-ups, confirmation escalations, fill play,
  morning brief for those accounts route to Marco; Natalie stops touching them. A worker must never get
  follow-up texts from both personas.
- **Boss**: Rosa Govea — HRX uid `OqZ0SlWsYqMhFgq9fIxgd9Pm0I62`, Slack `U07KRMRKT1R`.
- **Home channel**: a NEW `#events-recruiting` (Rosa, Mark, Maria + Marco). `#venuesmart` (C07KP7NHL7P)
  has been silent since 2025-07 — not used.
- **Phone**: +1 737 264 6753 (Austin overlay, PN54f9b011…, reserved for this persona since 2026-09-09 —
  see [[reference_twilio_messaging_state]]). Not yet in any messaging service; needs adding to an
  A2P-approved sender pool (MG2dd6557d05d9be9044c996fa568a8a39's Low Volume Mixed campaign matches the
  use case) with per-persona `from` routing so Natalie keeps the 312.
- **Mailbox**: m.gomez@c1staffing.com (Greg creating the Workspace account).
- **Language**: worker texts go out in the worker's `users.preferredLanguage` (ES/EN); replies mirror the
  language the worker writes in.
- **Headshot**: AI-generated square portrait (navy blazer, "Staffing & Recruitment · English | Español"
  office backdrop) supplied by Greg in chat 2026-09-11.

## Ownership (Greg, 2026-09-11 PM — confirmed)
"Marco will be the contact for users/applicants for C1 Events jobs (excluding Oakland) and Natalie will
stick to Indeed Flex (and family of companies) and Sodexo."
- Code (`scopePersona`): C1 Events minus Oakland Arena → Marco; **everything else → Natalie**, including
  Oakland Arena (Danny's — e.g. the every_shift confirmation escalations DM Danny as Natalie) and any
  C1 Select / Workforce account that is neither Flex nor Sodexo. **Greg confirmed 2026-09-11: "Oakland and
  other accounts stay with Natalie"** — no "no persona" bucket.

## Scope data (live probe 2026-09-11, `functions/.scratch/marco_scope_probe.ts`)
72 job orders on `c1_events_llc`:

| Account | accountId | JOs (open) | Recruiters on JOs | Marco? |
|---|---|---|---|---|
| Venue Smart, LLC (+ "Venuesmart LLC National" name variant, same id) | `NHc6r1yOVUK6aOqt0EQH` | 45 (26) | Rosa, Mark, Maria Rabadan, Greg | ✅ |
| Black Caviar Catering | `F4u0eLZVwguXfwffOuJa` | 7 (7) | Rosa, Danny | ✅ |
| Contigo Catering | `JAXhZ3wLVkosuoQJbtCH` | 6 (2) | Rosa | ✅ |
| Proof of the Pudding | `KFKxtXFRap3u3JpZrrTT` | 6 (5) | Rosa | ✅ |
| G6 Catering | `nrNHIZqcwRSMakrDsttV` | 1 (1) | Rosa | ✅ |
| Legends Global (Oakland Arena `QGNUkDRD4jMej6RArOO4`) | `pioetKgJXPu19zk2K7Y6` | 7 (1) | Danny | ❌ Danny's |

Note the cadence doc keys Oakland Arena under Legends **National** `uhb5hq4ddyLWtSeJP9Te` +
locationId `QGNUkDRD4jMej6RArOO4`; the JOs carry `pioetKgJXPu19zk2K7Y6`. The exclusion should match
the **locationId** (and both account ids), not one account id.
Black Caviar has Danny on some JOs — its event sites are not Oakland Arena, so it is Marco's.

## Natalie identity facts to mirror
Natalie's user doc: `isAutomationPersona: true`, securityLevel 7, role Admin, jobTitle "Recruiting
Assistant", `recruiter: true`, `integrations.slack` + `tenants/{T}/slackUsers/{slackId}` mapping.
`app_config/natalie` is currently EMPTY at both root and tenant paths — she runs on code defaults.

## Accounts (2026-09-11)
- **HRX user `WevlId9Sedb8Yb0nnGFLJB0DIbn1`** (created 2026-09-11 by `functions/.scratch/create_marco_account.ts`,
  mirrors Natalie): Auth user with no password/providers, custom claims `roles.{T} = Admin / "7"`;
  users doc with `isAutomationPersona`, Recruiting Assistant, recruiter + crm_sales, `tenantIds.{T}`
  (securityLevel "7", role Admin, status active), phone/phoneE164 = the 737, twilioNumberSid
  PN54f9b011…, `integrations.slack`, avatar `https://hrxone.com/brand/marco-gomez-512.jpg`, and
  `interviewStatus: 'skipped'` / `interviewSource: 'automation_persona'` — ☠️ creating Natalie's doc
  fired `onUserCreatedScheduleAutoInterviewInvite` at her own number (it only skips when interviewStatus
  is already completed/invited/skipped). `tenants/{T}/slackUsers/U0C14BDAX2P` → his uid.
  Local `admin.auth()` fails (ADC has no quota project); the script uses Identity Toolkit REST with
  `x-goog-user-project: hrx1-d3beb` instead.
- Slack user **`U0C14BDAX2P`** (Marco Gomez, title Recruiting Assistant, avatar = the square headshot).
- Slack app **"Marco Gomez (HRX)"** — App ID `A0C14PJQFGB`, Client ID `7582435419591.12038800831555` (public),
  created 2026-09-11 by Greg from `functions/.scratch/slack-marco-app-manifest.json`; client secret in Secret
  Manager `SLACK_MARCO_CLIENT_SECRET`. Only the creator's api.slack.com login is a collaborator — the Chrome
  profile Claude drives sees "Contact a member of your team who is a Collaborator", so Client ID / settings
  have to come from Greg. (A Slack client_id suffix is NOT the base-36 App ID — don't try to derive it.)
  Token exchange: `node functions/.scratch/slack-marco-token-exchange.cjs 7582435419591.12038800831555 <code-or-url>`
  (stores MARCO_SLACK_USER_TOKEN only if the token is U0C14BDAX2P's; revokes anyone else's). Authorize URL:
  `https://slack.com/oauth/v2/authorize?client_id=7582435419591.12038800831555&user_scope=chat:write,channels:read,groups:read,channels:history,groups:history,users:read,im:write,im:history,im:read,mpim:history,mpim:read&redirect_uri=https://hrxone.com/slack/oauth/callback`
  After a new token version: redeploy `natalieSlackInbox` (secret versions are pinned at deploy).
- ✅ **Token stored 2026-09-11 ~14:21 PT**: Greg authorized in Incognito as m.gomez@; the exchange verified
  `authed_user.id == U0C14BDAX2P` (team C1 Staffing, all 11 user scopes incl. im/mpim history) and added a new
  `MARCO_SLACK_USER_TOKEN` version over the `unset` placeholder. `natalieSlackInbox` redeployed to bind it;
  Marco's first tick only records cursors in `app_config/marco_slack_inbox` (no backlog answered), then he
  answers DMs + @mentions in channels he has joined.
- Google Workspace **m.gomez@c1staffing.com** created by Greg.
- `#events-recruiting` **C0C1EEYG820** created 2026-09-11 (by Greg via the Slack connector; Rosa, Mark,
  Marco invited — Maria Rabadan has no Slack account under that name) and set as
  `tenants/{T}/app_config/marco.homeChannelId` (`enabled` still unset = off).
- `PERSONAS.marco.hrxUid = 'WevlId9Sedb8Yb0nnGFLJB0DIbn1'` (authorship of notes/tasks/placements).

## Email signature
Natalie's live Gmail signature (read 2026-09-11 via her mailbox grant, `sendAs.get`) is an HTML table:
round 74px headshot from `https://hrxone.com/brand/natalie-brooks-512.jpg`, gold `rgb(242,183,5)` 3px
left border, name, "Recruiting Assistant · C1 Staffing", phone · mailto, c1staffing.com, tagline "On-demand
W-2 workforce, anywhere in the U.S." Her OAuth scopes (gmail.modify/send/userinfo.email) can't write
settings, so it was set in the Gmail UI. Marco's copy: `functions/.scratch/marco-signature.html` — same
template, `https://hrxone.com/brand/marco-gomez-512.jpg` (committed; resolves only after a hosting
deploy), 737-264-6753, tagline "Event staffing, anywhere in the U.S. · Hablamos español" (C1 Events is
1099, so the W-2 line would be wrong). Calls to the 737 (and Natalie's 312) play an EN/ES "no calls or voicemail, please text this number" message
(set 2026-09-11; was Twilio's demo greeting).

## Build state
**Slice 1–2 committed (not deployed)** — see the commit "feat(personas): Marco Gomez foundation":
- `functions/src/natalie/personas.ts` — registry + `scopePersona` + `effectivePersona` (Marco only when
  `tenants/{T}/app_config/marco.enabled === true` AND `MARCO_SLACK_USER_TOKEN` holds an `xoxp-` token).
- `twilio.ts` — `natalie_*` / `marco_*` messages pinned `From` their persona's number inside
  MG2dd6557d05d9be9044c996fa568a8a39 (the 737 must be added to that pool: adapt
  `.scratch/twilio-natalie-go-live.cjs`). Until then Marco's texts fall back to the 888 (21606/21712).
- ☠️ **Flex booking hazard fixed**: `bookInFlexIfLinked` / `placeWorkerOnShift` treated ANY all-digit
  shift PO as an Indeed Flex job id. 21 of 23 C1 Events shift POs are Venue Smart QBO PO numbers (1238,
  2159…), so placing someone on a Venue Smart shift would have stamped `flexJobId` and queued a Flex
  `book_worker`. Now `isFlexShift` needs shift `source: 'indeed_flex_apply'` or an `indeed_flex`
  `external_shift_requests` row whose `event.jobId` is the PO.
- Marco's Slack brain rides `natalieSlackInbox` (state `app_config/marco_slack_inbox`, transcripts
  `marco_slack_threads`), `MARCO_SYSTEM_PROMPT`, tools minus Flex/Fieldglass/Craigslist/mailbox.
- **Secret `MARCO_SLACK_USER_TOKEN` exists with placeholder `unset`** (created so deploys of
  natalieSlackInbox from main don't fail on a missing secret). The token exchange adds the real version.
- Pre-existing: `natalieSlackInbox.test.ts` / `natalieRoadmap.test.ts` haven't loaded since 2026-09-07
  (onCall from jobOrderAutoMessagingRadius under a fake firebase-admin) — separate fix task.

**Slice 3 — work routing (committed after slices 1–2, not deployed).** Ownership is stamped where the
work starts and resolved at drain time with `tokenFor(tokens, doc.persona)` (Marco's token only while he
is live, else Natalie's — so flipping `enabled` off hands everything back without data changes):
- `natalie_escalations.persona` = `scopePersona(assignment)` at enqueue; Marco's DMs go to the JO's
  assigned recruiters (Rosa), never to either persona's own Slack user; unmapped → Marco's home channel.
  The "I've asked the client about a replacement" line stays Natalie-only (it's the Flex ask).
  `assignments.natalieEscalation.persona` lets `natalie_relays` post into the right persona's thread.
- `natalie_onboarding_followups/{uid}.persona` + `.lang` (from `users.preferredLanguage`) at enrollment;
  scope comes from the assignment, else the job order (hiring-plan hires). Marco's threads use
  `natalie_onboarding_threads/marco__{jo}__{day}`. Checkpoint / done / reply texts per persona + language
  (`marco_onboarding_1h` …), Spanish copy in `composeCheckpointTextEs` / `composeDoneText`; Marco's SMS
  reply prompt `MARCO_SMS_SYSTEM` (replies in the worker's language; doesn't volunteer that he's automated,
  but doesn't deny it when sincerely asked — Natalie's prompt still says "never mention that you are an AI").
- `natalie_sms_watches.persona` (offers, background follow-ups, onboarding); `natalie_relays.persona`;
  `natalie_scheduled_actions.persona`; `natalie_followups.persona`; `natalie_actions.persona` and the
  worker activity feed's `action` = the persona's first name.
- Slack tools act as the persona that was asked: notes/tasks authored by Marco, `marco_slack_request`
  texts signed "— Marco, C1 Staffing", `worker_status.preferredLanguage`, `onboarding_followups` filtered
  to the asker's own follow-ups.
- Background checks Marco orders: `backgroundChecks.automationPersona: 'marco'` (`automationSource` stays
  `natalie` for existing consumers), `orderedByName: 'Marco Gomez'`.
- Inbound: a bare "Sí" now counts as YES (`\b` never matched after the accented í).
- Tests: `src/__tests__/natalie/marcoCopy.test.ts` pins Natalie's English copy unchanged and Marco's Spanish.
- Routing is by the worker's watch/follow-up doc (one per worker), not by which number they texted — the
  scope rule already guarantees one owner per worker.

## Staff ↔ persona conversations by SMS and email (Greg 2026-09-11: "Rosa will be texting Marco a lot")
Both personas, `functions/src/natalie/personaConversations.ts` (tests: `__tests__/natalie/personaConversations.test.ts`):
- **Who**: `app_config/persona_staff_directory` (rebuilt hourly by the tick, or on first use) = users with
  tenant securityLevel ≥ 5 AND a `@c1staffing.com` email, not `isAutomationPersona`, not inactive. Phones
  normalized from `phoneE164` or the raw `phone` (Rosa only has `phone`). Level-7 client contacts (Rocco /
  Marty Mazzella at venuesmartllc.com / tisales.com) and outside bookkeepers are excluded by the domain rule.
- **SMS**: `handleInboundSms` → `enqueueStaffSms` right after the raw audit copy: persona = the number texted
  (737 → Marco, 312 → Natalie), sender in the directory, not a STOP/HELP/START keyword (a plain "yes" IS
  routed) → `persona_sms_inbox/{MessageSid}` and the webhook returns (no worker pipeline). The tick answers
  BEFORE the outbox (`drainStaffSms`, ≤5/tick, transaction-claimed) with `answerAsNatalie(surface: 'sms')`;
  history = `persona_sms_threads/{persona}__{phone}`; reply `{prefix}staff_reply` from the persona's number,
  plain text ≤1200 chars. `twilio.ts` exempts `*_staff_reply` from the worker early-funnel + 60s duplicate
  guards (only inside `sendWorkerMessageInternal`). Works before Marco is switched on (identity = the number
  texted); until the 737 is in the A2P pool his replies fall back to the 888.
- **Email**: `drainStaffEmail` (after the outbox) reads each CONNECTED persona mailbox:
  `in:inbox is:unread newer_than:2d from:c1staffing.com`; sender must be in the directory; ledger
  `persona_email_handled/{persona}__{messageId}` (create() = claim); history = the whole Gmail thread
  (persona's own messages = assistant turns); reply in-thread via `sendEmail(…, persona)`, marked read.
  Everyone else's mail is left unread for a human. ☠️ Natalie's mailbox is connected, so staff email to
  n.brooks@ is answered automatically from this deploy on.
- Tools asked for by text/email have no Slack thread, so portal follow-ups aren't posted back.

## Gmail connect (Marco) — ✅ CONNECTED 2026-09-11 (grant has gmail.settings.basic)
`gmailOAuthCallback` handles `state.purpose === 'marcoMailbox'` (deployed 2026-09-11 from a clean worktree —
the first attempt died on another session's uncommitted WIP). m.gomez@ is an OAuth test user (Greg). Open
`functions/.scratch/marco-gmail-consent-url.txt` in an Incognito window signed into Google as m.gomez@ →
Allow → "Marco's mailbox is connected" → `tenants/{T}/integrations/marcoMailbox`. Scopes include
`gmail.settings.basic` so the signature (`.scratch/marco-signature.html`) can be set by API. The OAuth app is
in Testing mode → refresh tokens expire after 7 days (same as Natalie) until publishing status is In production.
**Signature ✅ SET 2026-09-11** via `functions/.scratch/marco_signature_set.ts` (checks the scope + that the
headshot URL serves image/jpeg, `sendAs.patch`es `.scratch/marco-signature.html`, reads it back). The headshot
went live with another session's 14:08 hosting deploy — before that the URL served the SPA index.html (200
text/html), which a plain status check doesn't catch; check the content-type. Gmail never adds signatures to API sends, so Marco's automated emails use the
plain-text signature in `sendEmail` either way.

## One-time steps to go live (in order)
1. **Slack app**: create "Marco Gomez (HRX)" from `functions/.scratch/slack-marco-app-manifest.json`
   (api.slack.com, as Greg); copy its client secret into Secret Manager `SLACK_MARCO_CLIENT_SECRET`.
2. **Authorize as Marco** in a real Incognito window signed into Slack as m.gomez@ (NOT Greg's Chrome —
   Natalie's first two tokens were Greg's): `https://slack.com/oauth/v2/authorize?client_id=<marco app client id>&user_scope=chat:write,channels:read,groups:read,channels:history,groups:history,users:read,im:write,im:history,im:read,mpim:history,mpim:read&redirect_uri=https://hrxone.com/slack/oauth/callback`
   → exchange the code with a copy of `.scratch/slack-natalie-token-exchange.cjs` writing
   `MARCO_SLACK_USER_TOKEN` (new version; the check must show user `U0C14BDAX2P`).
3. ✅ **Twilio** (2026-09-11): +1 737 264 6753 added to MG2dd6557d05d9be9044c996fa568a8a39's sender pool (pool =
   737 + 312, sends pinned per persona). ✅ Voice (2026-09-11, Greg: no voicemail, ask them to text): both persona numbers play an EN/ES "please text this number" message and hang up (`.scratch/persona_voice_message.cjs`).
4. **Slack channel**: create `#events-recruiting` (Rosa, Mark, Maria, Marco) and set
   `tenants/BCiP2bQ9CgVOCTfV6MhD/app_config/marco.homeChannelId`.
5. **Deploy** (log it): `functions:natalieSlackInbox,functions:handleInboundSms,functions:twilioInboundSmsWebhook,functions:dispatchScheduledWorkerReminders`
   plus anything else bundling `twilio.ts` sends picks up the From pin on its next deploy. Hosting deploy
   for `public/brand/marco-gomez-512.jpg` (signature image) with the hosting preflight.
6. **Switch on**: `tenants/BCiP2bQ9CgVOCTfV6MhD/app_config/marco { enabled: true }`. Existing active
   Natalie follow-ups for Events workers keep their stamp (natalie) and finish with her; new ones go to Marco.

**Later** — Marco's morning brief (events-only), his mailbox grant (`marcoMailbox` purpose on
gmailOAuthCallback, add `gmail.settings.basic` so the signature can be set by API), HRX user doc.
