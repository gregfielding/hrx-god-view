# Web app domain migration: hrxone.com → app.c1staffing.com

> Greg, 2026-09-05: "get ready for our web app to exist at app.c1staffing.com
> as we move from hrxone.com (don't remove hrxone.com yet but get ready)".
> This file is the runbook. Status table at the bottom.

## Shape of the move

Both hostnames point at the SAME Firebase Hosting site (`hrx1-d3beb`, project
`hrx1-d3beb`), so there is no second deploy target: app.c1staffing.com is an
alias of hrxone.com until we flip the canonical origin, and hrxone.com keeps
working after the flip until it is retired (redirect step, last).

Existing custom domains on that site: `hrxone.com`, `app.hrxone.com` (both
ACTIVE, cert ACTIVE). The second site `app-hrxone-com` has no domains and is
unused.

## Where the origin is decided (single switch each side)

- **Functions**: `functions/src/config/appOrigin.ts`
  - `PUBLIC_APP_ORIGIN` — canonical origin used to BUILD every SMS / email /
    push link (login, setup-password, jobs board, earnings, payroll tickets,
    unsubscribe, short links `…/l/{slug}`, Google Jobs indexing URLs, …).
    Reads `process.env.PUBLIC_APP_ORIGIN`, default `https://hrxone.com`.
    All ~40 former literal `https://hrxone.com…` link sites were rewritten to
    `${PUBLIC_APP_ORIGIN}…` (commit of 2026-09-05). `utils/workerUrls.ts`
    delegates to it (`WORKER_WEB_BASE_URL` still overrides for that helper).
  - `BROWSER_ORIGINS` / `isAllowedBrowserOrigin()` / `corsOriginFor()` — the
    browser origins allowed to call hand-rolled `onRequest` handlers
    (aiChat, gptGateway, codeAware, apollo, findDecisionMakers, gmail import,
    messagingApi, enhancedMainChat, resumeParser). `app.c1staffing.com` and
    `*.c1staffing.com` are already in. `integrations/callableBrowserCors.ts`
    (Gen2 `onCall` allowlist used by ~35 callables) and the four inline
    `cors: [...]` arrays in index.ts / placementsApi.ts also list it.
    Callables with `cors: true` never needed anything.
- **Client**: `src/config/appOrigin.ts`
  - `PUBLIC_APP_ORIGIN` (env `REACT_APP_PUBLIC_APP_ORIGIN`, default
    hrxone.com) — fallback for the handful of absolute-URL builders.
  - `getAppOrigin()` — current origin when it is one of ours, else canonical.
    Invite links (InviteUsersPage, BulkInviteFromCsvDialog), job-post share
    URLs and the decline redirect use it; everything else already used
    `window.location.origin`, which is correct on either host.
  - `public/index.html` og:url / twitter image still say hrxone.com on
    purpose (canonical until the flip).

## Infrastructure steps

| Step | Status (2026-09-05) | How |
|---|---|---|
| Firebase Hosting custom domain `app.c1staffing.com` on site `hrx1-d3beb` | **CREATED** (state `HOST_UNHOSTED` / `OWNERSHIP_MISSING` until DNS lands) | `POST https://firebasehosting.googleapis.com/v1beta1/projects/hrx1-d3beb/sites/hrx1-d3beb/customDomains?customDomainId=app.c1staffing.com` with a gcloud token (gregpfielding@gmail.com is the project owner) + header `x-goog-user-project: hrx1-d3beb`. Poll `GET …/customDomains/app.c1staffing.com` → `requiredDnsUpdates`. |
| DNS record | **DONE 2026-09-06** (Greg re-verified the Google sign-in, Claude added the record) | account.squarespace.com → Domains → c1staffing.com → DNS → Custom records: **CNAME, host `app`, data `hrx1-d3beb.web.app`**, TTL 4 h. c1staffing.com's nameservers are ns-cloud-d*.googledomains.com but the zone is edited in Squarespace's DNS panel. Footgun: after picking the record Type the form jumps up the page — re-locate the Name/Data fields before typing. |
| SSL cert | automatic once the CNAME resolves (minutes to ~1 h); check `certState` via the GET above or `curl -sI https://app.c1staffing.com` | — |
| Firebase Auth authorized domain `app.c1staffing.com` | **DONE 2026-09-06** (Greg, in the console as gregpfielding@gmail.com; verified via the identitytoolkit config GET) | Firebase console → Authentication → Settings → Authorized domains. The `PATCH …/config?updateMask=authorizedDomains` route is blocked by the Claude Code permission classifier and neither Chrome Google account has console access — this one stays a Greg step. Required for phone/OTP sign-in AND for setup-password links once PUBLIC_APP_ORIGIN flips. |
| Functions redeploy for the CORS allowlists | pending (do after DNS so it can be verified end-to-end) | named list — see "Deploy list" below |
| Web bundle rebuild + hosting deploy | pending (client changes are behavior-neutral on hrxone.com; ship with the next hosting deploy) | standard preflight in CLAUDE.md |

### Deploy list for the CORS change (named, never bare `--only functions`)

onRequest with hand-rolled headers: `chatWithAI`, `chatWithGPT`,
`enhancedChatWithGPT`, `upsertCodeChunksHttp`, `apolloPingHttp`,
`findDecisionMakersHttp`, `cleanupContactCompanyAssociationsHttp`,
`sendMessageApi`, `testRenderApi`, `getGmailImportProgressHttp`,
`queueGmailBulkImportHttp`, `parseResume*` (resumeParser).
onCall with inline `cors:` arrays: `updateUserLoginInfo`, `updateUserActivity`,
`addUsersToGroups`, `validateUserGroupSignup`, and the three in
placementsApi.ts. Everything importing `CALLABLE_BROWSER_CORS` (everify*,
everee*, i9*, prescreen*, userGroup*, sendWorkerOrderInterviewSms,
getUserParsedResumes, sendProfileUpdateReminder, reviewAndRescoreUser,
restartEvereeOnboarding, resendPayrollOnboardingInvite,
resendOnboardingPayrollLink, onCallI9SupportingReminder,
updateExternalOnboardingStepVerification, getI9SupportingDocumentSignedUrl).
`grep -rl "CALLABLE_BROWSER_CORS\|corsOriginFor\|isAllowedBrowserOrigin\|app.c1staffing.com" functions/src` regenerates the file list.

## The flip (later, Greg's call)

1. DNS + cert + auth domain above are green; open https://app.c1staffing.com,
   sign in by phone, load the jobs board and a callable-backed page.
2. `functions/.env.hrx1-d3beb`: add `PUBLIC_APP_ORIGIN=https://app.c1staffing.com`;
   redeploy the link-building functions (`grep -rl PUBLIC_APP_ORIGIN functions/src`).
   The `/l/{slug}` short links already delivered keep working because
   `linkRedirect` is served on both hosts via the hosting rewrite.
3. Client: set `REACT_APP_PUBLIC_APP_ORIGIN=https://app.c1staffing.com` (or
   change the default), update `public/index.html` og:url, rebuild, deploy.
4. Website (Squarespace): nav "Jobs Board" + the two homepage "Learn more"
   buttons currently point at `https://hrxone.com/c1/jobs-board` → change to
   app.c1staffing.com. (Header link is in Pages → Jobs Board (link item).)
5. Flutter 1.0.1: associated domains are `hrxone.com` +
   `worker.c1staffing.com` (an older guess — see Runner.entitlements,
   AndroidManifest.xml, `app_deep_link_parser.dart`,
   `payroll_embed_screen.dart`). Replace `worker.c1staffing.com` with
   `app.c1staffing.com` in all four; the AASA / assetlinks.json under
   `public/.well-known/` are served on every host automatically, and the
   Apple team id / package fingerprints stay the same.
6. Store listings: privacy/support URLs are on hrxone.com/legal/*.html and
   c1staffing.com/support — unaffected by the app move.
7. Last: retire hrxone.com by turning it into a redirect. Firebase Hosting
   redirects cannot match on hostname, so either (a) move hrxone.com to the
   spare site `app-hrxone-com` with a `redirects` entry to
   app.c1staffing.com, or (b) add a tiny host check in `src/index.tsx`
   (`if (location.hostname === 'hrxone.com') location.replace(...)`). Keep
   `/l/**`, `/legal/*.html` and `/.well-known/*` reachable on hrxone.com for
   as long as old SMS links and the store listings reference them.

## Footguns hit while setting this up

- Firebase Hosting REST: the customDomains resource lives under
  `/v1beta1/projects/{p}/sites/{s}/customDomains` — the unscoped
  `/v1beta1/sites/{s}/customDomains` path 404s. Every call needs
  `x-goog-user-project` or you get "requires a quota project".
- For a subdomain the new API asks for a single CNAME to
  `hrx1-d3beb.web.app` (no TXT); ownership is proven by that CNAME.
- Squarespace Domains re-prompts for Google sign-in before any DNS edit even
  when the site editor session is valid — plan on Greg clicking through.
- The Locations page on c1staffing.com is one image (`C1_COVERAGE.png`, a US
  map with markers CA / NV / AZ / TX / IL / NY-NJ) and no text — it renders
  blank in headless/automation viewports because the image lazy-loads; it
  is fine for humans.

## Full audit 2026-09-11 (gaps the 09-05 pass missed)
Report artifact: https://claude.ai/code/artifact/e298a23e-ee17-4404-8df0-ffba9fb0afe7
Status: app.c1staffing.com serves the site (200, cert live). Recommended:
flip the canonical and keep hrxone.com serving; retire behind a redirect
only much later, with an expanded keep-list (below).
- ☠️ New hardcoded `https://hrxone.com` since the switch (≈25 lines):
  `functions/src/natalie/{natalieTools,natalieOutbox,natalieOnboarding,natalieFill,natalieCraigslist,natalieDescriptions,natalieBrief}.ts`,
  `messaging/smsDeliveryAlerts.ts:259,266`. `natalieCraigslist.ts:52` is the
  PUBLIC ad body. Convert to `PUBLIC_APP_ORIGIN`.
- ☠️ CORS bugs not using `corsOriginFor`: `triggerAINoteReview.ts` (Add Note
  AI review FAILS from app.c1staffing.com today), `updateLocationAssociation.ts`.
- ☠️ `functions/src/twilio.ts:211` OTP SMS ends `@hrxone.com #code` (WebOTP is
  host-bound) — flip with PUBLIC_APP_HOST or pass the page host + allowlist.
- ☠️ `cors.json` (Storage bucket) lists only localhost + hrxone.com.
- `platform_config/seo.canonicalOrigin` is unset → both hosts self-canonical
  (duplicate content). Set it to hrxone.com now, app.c1staffing.com at flip.
- Client: `REACT_APP_PUBLIC_APP_ORIGIN` isn't in `.env` or the build check —
  a clean build silently keeps hrxone.com. `robots.txt` Sitemap line,
  `index.html` og tags, `JobPostingDetail.tsx:2909` sameAs,
  `DeleteAccount.tsx:21,56` + `SMSPrivacy.tsx:163` copy.
- Firestore data with typed hrxone.com: 4 C1 messageTemplates (Application
  Waitlisted EN/ES, Application Rejected ES, +1), 5 job_postings (3 active;
  jobDescription + craigslist.draft.body), job order "Lollapalooza 2026"
  staffInstructions.checkIn.text. `short_links`: 73,082 docs, all targets
  hrxone.com, still being created — keep `/l/**` on hrxone.com (or have
  linkRedirect rewrite the host).
- c1_app 1.0.1: `worker.c1staffing.com` has NO DNS — remove it from
  Runner.entitlements, AndroidManifest (3 filters; on Android ≤11 one failing
  autoVerify host breaks verification for all hosts), deep-link parser, and
  `payroll_embed_screen.dart:221` returnUrl; add app.c1staffing.com.
- Keep-list for hrxone.com retirement (serve directly, no redirect):
  `/.well-known/*`, `/privacy` `/terms` `/consent` `/sms-privacy`
  `/sms-optin.html(+png)` `/signup` (approved Twilio 10DLC evidence — don't edit
  the campaign), `/legal/*.html`, `/l/**`, `/unsubscribe`, `/delete-account`
  (Play data safety URL), `/c1/jobs-board/**` (live Craigslist ads),
  `/img/**` `/brand/**` (signatures), `/slack/events` and
  `/api/integrations/accusource/webhooks` if registered on hrxone.com.
  DNS to keep: `go.hrxone.com` (old Twilio links), `ingest.hrxone.com` MX
  (Indeed Flex + Fieldglass intake), hrxone.com MX/DKIM (senders).
- Consoles to verify: Twilio toll-free verification URLs, Slack events
  Request URL + Natalie app redirect, AccuSource 13 webhook slots, Everee
  embed domains, SendGrid link branding/event webhook/invite template
  d-36383cd7…, Firebase browser key restrictions, Google OAuth consent screen,
  Intuit app URLs, Search Console property + Indexing API owner, Squarespace
  links, Fieldglass extension matches.
- User impact at flip: re-sign-in (per-origin auth), web push re-grant and
  duplicate notifications (tokens per origin), browser-stored settings reset.

## Option 1 chosen + "fix now" done (2026-09-11)
Greg chose option 1: flip the canonical to app.c1staffing.com later and keep
hrxone.com serving (no redirect). Done today, behavior-neutral on hrxone.com:
- Natalie / Slack alert / Craigslist-ad links (27 literals in
  `natalie/{Tools,Outbox,Onboarding,Fill,Craigslist,Descriptions,Brief}.ts`,
  `messaging/smsDeliveryAlerts.ts`) now use `PUBLIC_APP_ORIGIN`. Not deployed
  (still resolve to hrxone.com) — they go out with the flip redeploy
  (`grep -rl PUBLIC_APP_ORIGIN functions/src` now lists them).
- CORS: `triggerAINoteReviewHttp` and `updateLocationAssociationHttp` now echo
  `corsOriginFor(req.headers.origin)` + `Vary: Origin`; deployed today.
- VERIFIED the runbook's CORS redeploy already went out: preflight from
  app.c1staffing.com returns the origin on chatWithAI, chatWithGPT,
  enhancedChatWithGPT, apolloPingHttp, findDecisionMakersHttp, sendMessageApi,
  parseResumeHttp, updateUserLoginInfo, updateUserActivity,
  resendAssignmentOffer, submitWorkerAiPrescreenInterview.
  (`getUserParsedResumes` 403s OPTIONS from hrxone.com too — not domain.)
- Storage: the LIVE bucket `hrx1-d3beb.firebasestorage.app` CORS is
  `origin ["*"], GET` — already fine. The repo `cors.json` was stale and
  NARROWER (would have broken web.app/app hosts if applied); it now mirrors
  live. Don't apply the old list.
- `platform_config/seo.canonicalOrigin = https://hrxone.com` (was unset →
  both hosts self-canonical). Change to app.c1staffing.com at the flip.
- Web copy: DeleteAccount (EN/ES) no longer says hrxone.com; SMSPrivacy link
  text uses `getAppOrigin()`; JobPostingDetail JSON-LD sameAs →
  www.c1staffing.com and "HRX" fallbacks → "C1 Staffing"; agency slug helper
  text uses the current host. Deployed with hosting.
- c1_app (for 1.0.1, NOT built): entitlements + AndroidManifest claim
  app.c1staffing.com (8 filters mirroring hrxone.com), worker.c1staffing.com
  removed everywhere (parser, manifest, entitlements, Everee returnUrl →
  app.c1staffing.com). 160 tests pass.
- Known pre-existing: `__tests__/natalie/natalieSlackInbox` and
  `natalieRoadmap` suites fail to load ("Right-hand side of 'instanceof'")
  via jobOrderAutoMessaging's onCall under the jest mock — fails without
  these edits too.
Still for flip day: OTP `@host` line, env vars both sides, og tags +
robots.txt, canonicalOrigin → app, Firestore template/posting text, Search
Console, Squarespace, Slack redirect, announcement. Console checks remain
Greg's (see the report artifact).

### Console checks run 2026-09-11 (read-only)
- Google Cloud API keys (all 6 incl. both Firebase browser keys): **no
  website/referrer restrictions** → nothing to add for app.c1staffing.com.
- SendGrid: DEFAULT link branding is `url6316.hrxone.com` (valid) — every
  tracked link in email rides that hrxone.com subdomain, so keep its DNS
  forever (or switch the default to the already-valid `url6167.c1staffing.com`).
  No event webhook configured. Inbound Parse `ingest.hrxone.com` →
  cloudfunctions.net (unaffected; keep the MX). Sender auth valid for
  c1staffing.com and one hrxone.com record (6 stale invalid hrxone.com entries).
- Twilio: credentials aren't in `functions/.env*` (Secret Manager); checked in
  the console instead — see below.

### Deploy results 2026-09-11
- Hosting (web copy fixes) deployed from a clean worktree (main.9886f869.js);
  deep link check 200.
- ☠️ First functions deploy of the CORS fix FAILED the Cloud Run startup
  probe: `triggerAINoteReviewHttp` / `updateLocationAssociationHttp` were
  `256MiB` and OOM'd on cold start (logs: "Memory limit of 256 MiB exceeded",
  and triggerAINoteReviewHttp was already OOMing before the change). Bumped
  both files to 512MiB (+ the `triggerAINoteReview` callable) and redeployed:
  success. Verified a POST from `Origin: https://app.c1staffing.com` now
  returns `access-control-allow-origin: https://app.c1staffing.com` + `Vary: Origin`.

### Slack + Twilio consoles checked 2026-09-11 (read-only, Greg's Chrome)
- Slack app "HRX Messaging Bridge" (A0A64K3EWAX): Event Subscriptions Request
  URL is `https://hrx1-d3beb.web.app/slack/events` — NOT hrxone.com, so the
  domain move never affects it. No Interactivity URL. The "Natalie Brooks
  (HRX)" app isn't in this Slack user's app list (owned by another account) —
  its `hrxone.com/slack/oauth/callback` redirect only matters on re-auth, and
  option 1 keeps hrxone.com serving.
- Twilio numbers: +1 888 805 8650 and +1 312 500 4352 both route messages via
  the "C1 Messaging" service; number SMS webhook
  `https://us-central1-hrx1-d3beb.cloudfunctions.net/handleInboundSms`;
  service inbound `…/twilioInboundSmsWebhook` — unaffected.
- Toll-free verification (888), APPROVED 2026-01-08: business website
  `https://www.c1staffing.com/`, opt-in workflow URL
  `https://hrxone.com/c1/apply`, plus `hrxone.com/privacy` and
  `hrxone.com/consent`. ☠️ Add `/c1/apply` to the hrxone.com keep-list.
- A2P 10DLC: campaign CM6ad9ea96b377abe2e29d8b65e06b4167 (MG2dd6…) VERIFIED
  2026-09-09 cites `https://hrxone.com`, `/privacy`, `/terms`, `/signup`,
  `/sms-optin.html`, `/consent`. Two older campaigns (MG98999…, MGd6a69…)
  are Failed/Rejected (2025-10-09) and irrelevant.
- Conclusion under option 1: no Slack or Twilio change needed. Only a future
  hrxone.com retirement would touch them (keep-list: `/c1/apply`, `/signup`,
  `/privacy`, `/terms`, `/consent`, `/sms-optin.html`, `/sms-privacy`).

### Everee + SendGrid checked 2026-09-11 (read-only)
- Everee dashboard (app.everee.com → Settings → Integrations hub → Everee API):
  C1 Select LLC (tenant 3133) and C1 Events LLC (3138) each have ONE webhook,
  target `https://us-central1-hrx1-d3beb.cloudfunctions.net/evereeWebhook`,
  enabled — unaffected by the domain move. No embed allowed-domain /
  frame-ancestors setting exists in the dashboard, and account settings have
  no hrxone.com. The embed returnUrl follows the page origin; an end-to-end
  embed test on app.c1staffing.com still needs a worker with an active Everee
  onboarding session (the reviewer demo account isn't enrolled).
- SendGrid: the ONLY template is "Worker Invitation Template"
  `d-36383cd72987421fa5335e9ea7db10d9` (active). Its footer hardcodes
  `https://app.hrxone.com/support` and `https://app.hrxone.com/privacy`
  (HTML + plain text, 4 hits). Both return 200 today (`/support` is only the
  SPA shell — there's no top-level /support route; `/c1/workers/support`
  redirects to payroll-help). At the flip: edit the template footer to
  `https://www.c1staffing.com/support` and `https://app.c1staffing.com/privacy`.
  ☠️ Add the `app.hrxone.com` custom domain to the retirement keep-list — sent
  invites link to it.

### Google Cloud OAuth + AccuSource checked 2026-09-11 (read-only)
- Google Auth Platform (project hrx1-d3beb — open it as gregpfielding@gmail.com;
  g.fielding@c1staffing.com lacks `clientauthconfig.clients.list`): app "HRX One",
  publishing status Testing (no verification required). Branding home page,
  privacy policy AND terms links are all `https://app.hrxone.com`; authorized
  domains include `hrxone.com`.
- OAuth web clients — "HRX Web Integration v2", "HRX Gmail Integration",
  "HRX ONE WEB APP": JavaScript origins = localhost:3000, app.hrxone.com,
  hrxone.com (+ hrx1-d3beb.web.app on the first two); NONE list
  app.c1staffing.com. Redirect URIs are all cloudfunctions.net
  (`gmailOAuthCallback`, `handleCalendarCallback`) → unaffected. The web app
  has no client-side Google sign-in (OAuth runs server-side via those
  callbacks), so the missing origin shouldn't break anything; add
  `https://app.c1staffing.com` to each client's JS origins at the flip anyway
  (cheap insurance). Consent-screen links can stay on app.hrxone.com while it
  serves; if it's ever retired, add `c1staffing.com` as an authorized domain and
  repoint the three links.
- AccuSource SourceDirect (`www.accusourcedirect.com` → API v1.0 → WebHooks):
  NOT checked — the portal was at its login screen in Claude's Chrome. Greg
  to confirm whether the 13 webhook slots use `hrxone.com/api/integrations/accusource/webhooks`
  (keep-list) or the cloudfunctions URL.
