# conventions

> Cross-cutting code conventions that aren't obvious from grep — multi-tenant filtering, AccessRoles utility, schema codegen path, Cloud Function defaults, notifications channel, AI-logging map

Conventions called out explicitly by Greg as load-bearing — assume any PR I write will be reviewed against them.

- **Multi-tenant filtering is non-negotiable.** Every Firestore query on a tenant-scoped collection MUST filter by `tenantId`. There is no "default tenant" fallback — a query without the filter is a bug.
- **Security checks use `src/utils/AccessRoles.ts`.** Use `getAccessRole` / `canAccessModule` rather than hardcoded `securityLevel >= N` comparisons. Levels 0–7. Sidebar / route gates have already migrated to this pattern; new code follows.
- **Firestore schemas are codegen'd.** Source: `packages/contracts/firestore/schemas/`. Generated TS in `src/types/` (and probably mirrored). **Hand-editing the generated `.ts` is wrong** — edit the schema source, run codegen, commit both. Verify the toolchain before assuming.
- **Cloud Function defaults**: `region: 'us-central1'`, `memory: '512MiB'`, `maxInstances: 2`, `timeoutSeconds: 240`. Override per-function only with explicit justification (e.g., bulk-write needing 1GiB + higher concurrency, or scheduler needing more timeout). Don't tune below the floor.
- **All notifications go through `functions/src/utils/createNotification.ts`.** Direct Firestore writes to notification collections bypass plumbing (delivery, dedupe, locale). Use the helper.
- **AI-relevant new fields require a `loggingTriggerMap.ts` entry** — exists in both `src/utils/` and `functions/src/utils/`. If a new field feeds into AI prompts / scoring / readiness / prescreen, register it on both sides.
- **`.scratch/` is gitignored** — one-shot ops scripts, log dumps, sample fixtures. Never `git add` from there (matches the broader pattern in `functions/.scratch/` for migrations).
- **Service-account auth path**: `GOOGLE_APPLICATION_CREDENTIALS=~/.config/gcloud-claude/service-account.json` is exported in Greg's shell. That SA does not have Secret Manager access; sensitive creds (Twilio, SendGrid) must be exported manually each session via `gcloud secrets versions access`.
- **`jobOrderNumber` is a NUMBER on job_orders docs** (2026-07-08 migration: 88 string docs converted, all writers aligned — jobOrderService, gig auto-builder, FG orchestrator, deal-draft form). Firestore orders by type before value, so a string reintroduction breaks table sorting again. Display pads via formatJobOrderNumber-style helpers; equality queries must use numbers.
- **Inviting internal users** (2026-08-19 Vicki/Tabitha precedent): the app flow is `functions/src/auth/inviteUser.ts` (auth user + claims `roles[tenantId]={role,securityLevel}` + pending_invites + reset link). From a laptop, admin-SDK auth ops hit the ADC quota-project 403 — use Identity Toolkit REST with `gcloud auth print-access-token` + `x-goog-user-project: hrx1-d3beb` (script: `functions/.scratch/invite-vicki-tabitha.ts`). ☠️ ALSO write the `users/{uid}` doc (`tenantIds[tid].securityLevel` as STRING '7') — server-side gates read the users doc, not the claims roles map. All-reports access requires level 7. Invited 2026-08-19: vicki@crowncfo.com (Crown CFO), tabitha@bandwidthbookkeeping.com (Bandwidth Bookkeeping) — both Admin/7.

## securityLevel model (normalized 2026-08-25, Greg's policy)

- **Tenant map is the authoritative home** (`tenantIds.{tid}.securityLevel`);
  the top-level `securityLevel` is a REQUIRED mirror — half the gates read
  `tenantIds[tid].securityLevel ?? securityLevel` (isStaff, ensureBooksAccess,
  AuthContext). Both must exist and agree on every doc.
- **Policy: every @c1staffing.com email is '7'.** Enforced at invite time
  (inviteUserV2 forces '7' for the domain) and swept 2026-08-25 (5 staff
  promoted, incl. two who sat at worker-tier '2').
- **Workers are '2'.** All mint paths now stamp it: phone signup,
  inviteUserV2 (non-numeric labels like 'Worker' normalize to '2'),
  adminCreateWorker default, OnboardingProfileForm (was writing unparsable
  strings like 'Agency_Worker'), AddWorkers form (hidden hardcoded '5'
  fixed; CSV import disabled entirely).
- **Backfill 2026-08-25**: 7,492 legacy docs had the level ONLY in the
  tenant map (AuthContext staff-default footgun class) — top-level mirrored
  from the map (7,491×'2', 1×'7' = Greg's own staff doc). 108 docs with no
  level anywhere (worker-looking) stamped '2'. Every one of the 14,008 user
  docs now carries a top-level level. Markers: `securityLevelBackfill` /
  `securityLevelRetier` {from, at, reason} on every touched doc — query
  those to audit or revert.
- Census after: 13,965×'2', 15×'7' (all staff), 23×'4' (customer-side
  contacts — NOT company staff, left as-is), 1×'3', 1×'0', 3× numeric-0
  gregapp@gmail.com test artifacts.

## Heavy local jobs — don't crash the laptop (incident 2026-08-29)

Running the FULL functions jest suite (96 suites, ts-jest recompiles the
whole codebase per worker, defaults to one worker per core) CONCURRENTLY
with a CRA build or `firebase deploy` exhausted macOS application memory
and hard-crashed Greg's machine. Rules: run heavy jobs (full jest, CRA
build, firebase deploy) ONE AT A TIME; cap jest with `--maxWorkers=2`;
prefer targeted suites (`npx jest src/cadence`) over the full run. Also:
a starved machine makes `firebase deploy` fail with "Cannot determine
backend specification. Timeout after 10000" — retry serialized with
`FUNCTIONS_DISCOVERY_TIMEOUT=120`, and never trust a deploy piped through
`tail` (the pipe masks the exit code — capture to a file and check `$?`).
Known debt: 8 of 96 jest suites (47 tests) fail — pre-existing, they were
unrunnable before jest.config.js landed 2026-08-28; cadence/prescreen
suites are green.

## Cloud Run 1,000-service cap (us-central1) + freed-slot ledger

Every gen2 function is a Cloud Run service, and the project sits at the
per-region cap. A NEW function can only be created after a dead one is deleted.
- Check headroom: `gcloud run services list --project hrx1-d3beb --region us-central1 --format='value(metadata.name)' | wc -l`
- Before deleting, verify: zero callers (grep src/, functions/src, shared/,
  ../c1_app), and zero invocations in 30d
  (`gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="<lowercased name>"' --freshness=30d --limit 5`).
- Delete: `firebase functions:delete a b --region us-central1 --project hrx1-d3beb --force`,
  then confirm with `gcloud functions list`. Remove the export in the SAME
  commit so the function can't be redeployed.

Ledger (append new entries at the bottom):
- Pre-ledger: Phase 1C e-sign functions (2026-06-05, see the index.ts comment);
  `inviteUser` v1 ([[project_phone_auth]]); getResumeParsingStatus /
  getUserResumeUploads / getResumeSignedUrl ([[project_resume_pipeline]]).
- **2026-09-11 (−4)**: createInviteToken, validateInviteToken,
  markInviteTokenUsed, assignOrgToUser. These backed the dead `/invite/:token` →
  `/onboarding/profile` client chain (removed the same day). Prod `invites`
  collection had 0 docs and there were 0 invocations in 30d. us-central1
  services went 997 → 993. The orphaned `match /invites` rule was removed
  and rules were deployed the same day.
- **2026-09-11 (+1, claimed)**: `sodexoContactIntroCron`
  ([[project_sodexo_contact_intro]]). Headroom was 993 at build time.

## Domain move checklist (deferred 2026-09-09 — revisit when c1staffing.com / app.c1staffing.com is added)
- Firebase Hosting: add the domain; DNS; then 301 hrxone.com → new origin so Google transfers rankings.
- Set `platform_config/seo.canonicalOrigin` = `https://<new host>` (jobPostingSeo derives canonicals,
  og:url, JobPosting JSON-LD urls, sitemap.xml and robots.txt from it; without it, it uses the request host).
- Regenerate static legal pages with the new origin (`scripts/generateStaticLegalPages.py` — replace the
  hrxone.com literals in NAV/FOOT/sms terms) and re-take `public/sms-optin.png` (portal-worker/.scratch/optin-shot.ts).
- Re-point the Twilio 10DLC campaign URLs (PrivacyPolicyUrl / TermsAndConditionsUrl / message_flow links)
  if the campaign is still in review; an approved campaign does not need resubmission for a domain change.
- Slack/Gmail/Natalie links: `hrxone.com` literals in functions/src/natalie/* (profile/assignment links).
- Resubmit the sitemap in Search Console for the new property.
