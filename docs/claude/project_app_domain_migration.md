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
| DNS record | **LEFT FOR GREG** — Squarespace Domains demanded a fresh Google sign-in ("Verify to continue as g.fielding@") before editing records; Claude cannot log in. | account.squarespace.com → Domains → c1staffing.com → DNS → Custom records → Add record: **CNAME, host `app`, data `hrx1-d3beb.web.app`** (TTL default). c1staffing.com's nameservers are ns-cloud-d*.googledomains.com but the zone is edited in Squarespace's DNS panel. |
| SSL cert | automatic once the CNAME resolves (minutes to ~1 h); check `certState` via the GET above or `curl -sI https://app.c1staffing.com` | — |
| Firebase Auth authorized domain `app.c1staffing.com` | **LEFT FOR GREG** — the `identitytoolkit … PATCH …/config?updateMask=authorizedDomains` call was blocked by the Claude Code permission classifier and neither Chrome Google account has console access to the project (owner = gregpfielding@gmail.com). | Firebase console (as gregpfielding@gmail.com) → Authentication → Settings → Authorized domains → Add `app.c1staffing.com`. Required for phone/OTP sign-in AND for setup-password links once PUBLIC_APP_ORIGIN flips. Current list: localhost, hrx1-d3beb.firebaseapp.com, hrx1-d3beb.web.app, app.hrxone.com, 127.0.0.1, hrxone.com. |
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
