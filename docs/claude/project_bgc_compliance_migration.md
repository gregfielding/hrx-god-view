# bgc compliance migration

> Background-check compliance program — policy v1.1 + P0 kit + P1 (incl. webhook secret ENFORCED) + P2 cases + P2.5 + policy page + P3 notices ALL DEPLOYED 2026-07-14; P3 FULLY LIVE (first real send verified 2026-07-14); P4 intake needs dedicated compliance-Gmail connect; P5-P6 unbuilt

# Background-check compliance migration — state of play (2026-07-13)

Docs (repo, authoritative): docs/compliance/background-check-review-process.md
(policy v1.1 — 7-year lookbacks, pending charges never considered, Lancaster=PA
CHRIA, owner Donna Persson), hrx-background-check-migration-plan.md (P0–P6),
p0-manual-operations-runbook.md. Policy artifact:
claude.ai/code/artifact/c08d90b4-22bc-4314-8dc9-3d365b022374. P0 kit in Greg's
Downloads: policy PDF, letter templates docx (EN/ES + CA/PA variants, DRAFT for
counsel), fillable IA worksheet PDF (45 fields), P0 runbook PDF.

**P1 security — DEPLOYED (commit bf28a279):**
- Webhook `apiIntegrationsAccusourceWebhooks`: shared-secret check
  (headers x-accusource-webhook-secret / x-webhook-secret / x-api-key /
  Bearer / ?secret=), constant-time, never logged. **WARN-ONLY mode**:
  DONE 2026-07-14: Greg pasted ?secret= into all 13 SourceDirect webhook
  slots (portal: accusourcedirect.com → API v1.0 → WebHooks, per-company
  C1 Staffing), logs confirmed hasSecretParam=True, ENFORCE=true deployed;
  verified POST w/o secret → 401, with secret → 200. GETs remain an
  unauthenticated validation stub (no writes) by design.
- Tenant scoping via `assertCallerBelongsToTenant` (hrx:true exempt; legacy
  docs w/o tenantId logged+allowed) on setAccusourceLineAdjudication,
  getAccusourceBackgroundCheckPdf, markBackgroundCheckCompleteOutside.
- Verdict authority (policy §6): FAILED verdicts / overrides off effective
  FAILED require `tenants/{tid}/integrations/accusource.complianceReviewerUids`
  — POPULATED: Greg zazCFZdVZMTX3AJZsVmrYzHmb6Q2 + Donna Persson
  vEdJeKRlcgOs3FoI57EfBkP5Ewp1 (her securityLevel-7 doc; she also has a
  duplicate sl-2 doc under dm@c1staffing.com — orphan-UID pattern). Empty
  allowlist falls back to admin gate (logged).
- PDF fetches now write background_check_report_viewed to worker activity log.

**P2 adjudication cases — DEPLOYED + verified e2e 2026-07-13 (commits
3d78ce32 + panel fix):** tenants/{tid}/adjudication_cases (rules: L5+/admin
read, client writes DENIED — all writes via 6 callables: open/worksheet/
notice/status/approval/close). Tier+caseId stamped on backgroundChecks doc.
closeAdjudicationCase enforces §5.2 (pre-adverse recorded, window elapsed/
answered, no open dispute, 11-factor worksheet complete on deny) + §6
signature matrix (compliance allowlist; ops_manager=L5; executive=
executiveUids [Greg] w/ rationale; distinct-signer rule). Append-only
events subcoll + worker activity logs on every mutation AND on order/
mark-complete/verdict/PDF callables. UI: AdjudicationCaseSection in
Backgrounds tab (entry point when rollup ACTION_NEEDED/FAILED). Deadline
calc: at least-5-business-days from UTC day — evening sends round UP a day
(compliant direction). Verified via synthetic fixture on sandbox worker
TWXMM1mOJHepmk80Qsx128w9AiS2, then deleted.

**P2.5 Drive folders + policy page — DEPLOYED+VERIFIED 2026-07-14:**
runtime SA 143752240496-compute@developer.gserviceaccount.com is Content
Manager on "C1 Compliance" Shared Drive (id 0AGHZdN_CpiauUk9PVA, auto-
resolved via drives.list + cached as complianceDriveId on the accusource
integration config; Drive API was already enabled on hrx1-d3beb).
openAdjudicationCase creates Background Checks/{year}/{Last, First — uid}
best-effort + stamps driveFolderId/Url + drive_folder_ready event; panel
shows 'Open case folder'. Approvals render as signature stamps (script
name, role+decision, timestamp, uid prefix). In-app policy page at
/compliance/background-check-policy (L5-gated), content GENERATED from
docs md via scripts/generateBackgroundCheckPolicyContent.js — rerun on
policy bumps; linked from Backgrounds tab + case panel.

**P3 notices — DEPLOYED 2026-07-14 (commits 8f6decc5+):**
sendAdjudicationNotice callable (compliance-gated): versioned templates
(adjudicationNoticeTemplates.ts NOTICE_TEMPLATE_VERSION v1.1-draft, CA/PA
variants, EN + ES appended for es-preference), sends from
compliance@c1staffing.com (SendGrid per-send fromEmail; mailbox created
2026-07-14 as real Workspace user), attaches consumer report (refuses if
finalReportReady false) + official CFPB Summary EN+ES (vendored to
Storage from consumerfinance.gov on first use), computes deadline →
awaiting_candidate, SMS nudge (content-free, 24h dedupe), files letter
HTML to Drive case folder, records templateVersion+providerMessageId.
craContactBlock SET 2026-07-14 (AccuSourceHR, Inc., 11811 N. Tatum
Blvd., Suite 3090, Phoenix, AZ 85028, (888) 649-6272). FIRST LIVE SEND
VERIFIED (dispute-ack to sandbox worker = Greg's gmail; providerMessageId
recorded). SendGrid gotchas solved: (1) secrets binding — bind ONLY
sendGridFromEmail/Name; SENDGRID_API_KEY is a plain .env var and Cloud
Run rejects overlapping secret bindings; (2) compliance@ single-sender
VERIFIED 2026-07-14 + noticeFromEmail SET on accusource config
(.scratch/setNoticeFromEmail.ts; API test send 202) → notices now send
truly AS compliance@c1staffing.com (replyTo support also in
EmailProvider+SendGrid). Domain auth (c1staffing.com CNAMEs) started
2026-07-14 — check DNS verification status if deliverability questions.
compliance@ mailbox EXISTS as real Workspace seat (created 2026-07-14). adjudicationDeadlineCron every 6h:
reminder at deadline-48h, auto window_expired + reviewer notifications.
Case panel: Email buttons + manual-record fallbacks + notices log.

**P4 intake — DEPLOYED 2026-07-14 (commit 1e15d9b6), awaiting Greg's
one-click OAuth grant:** functions/src/compliance/complianceMailbox.ts.
getComplianceGmailAuthUrl (reviewer-gated, gmail.readonly ONLY, state
purpose:'complianceMailbox') + branch in gmailOAuthCallback (dynamic
import avoids cycles) storing tokens at tenants/{tid}/integrations/
complianceMailbox — NEVER users/{uid}.gmailTokens (Greg's own live
there); callback REFUSES any Google account except expectedEmail
(default compliance@c1staffing.com) and requires refresh_token.
complianceMailboxIntakeCron every 10 min (scheduler job verified
ENABLED): per tenant, list newer_than:14d, exactly-once via
processedMessages subcollection ledger (poison messages ledgered as
outcome:'error' — no retry loops); sender matched against cases in
open/awaiting_candidate/candidate_responded/disputed/window_expired
(email from last notices[].emailTo else users doc); match →
awaiting_candidate|window_expired flips candidate_responded (+
candidateRespondedAt, lastInboundEmailAt), event candidate_email_received
(body excerpt 1500ch), email text + attachments (20MB budget) filed to
Drive case folder, dispute keywords EN+ES set disputeLanguageDetected
flag (never auto-flips disputed status), reviewers notified; unmatched
human mail → light nudge (noreply/system senders skipped); token death →
connected:false + tokenError + reconnect alert. UI: ComplianceMailboxCard
on /compliance/background-check-policy (hides itself for non-reviewers
via status-callable permission error); Connect opens popup, listens for
'google-auth-success' postMessage. notifyComplianceReviewers now exported
from adjudicationNotices.ts. Live bundle main.b8330b59.js verified.
REMAINING: Greg clicks Connect signed into compliance@, then e2e test
(fixture case + reply from candidate gmail).

**Not built yet:** P4 dispute automation, P5 audit
exports + 7-year retention job, P6 compliance queue page. Pre-existing
gap flagged: top-level backgroundChecks rules allow isAssignedToTenant
reads (workers) — tighten in P-later.
[[feature-separation-termination]] [[project-conventions]]
