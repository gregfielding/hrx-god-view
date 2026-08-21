# LLM provider: Claude (Anthropic) — migration from OpenAI

**Decision (Greg 2026-08-21): switch the app's server-side LLM calls from
OpenAI to Claude.** Trigger: the OpenAI account ran out of credits on
2026-08-18 13:08 UTC and silently broke Fieldglass enrichment (no
hiring-manager contact line, no AI copy, no rate/headcount sync on JOs
#407+), resume parsing (30 failures), AI job descriptions, and the
nightly scheduling triage for three days. Root-cause signature in logs:
`429 You have no credits remaining` on `fieldglassenrichmentingest`.

## How it's wired

- `functions/src/utils/claudeChat.ts` — **OpenAI-shaped adapter** backed
  by the Anthropic Messages API. Exposes `getClaudeChat()` →
  `{ chat: { completions: { create(params) } } }` returning
  `choices[0].message.content`, so call sites migrate by swapping ONE
  line (`new OpenAI(...)` → `getClaudeChat()`); unit tests that inject
  mock clients of that shape keep working. Mapping: `model` ignored →
  `CLAUDE_MODEL` env (default `claude-opus-5`); system msgs → `system`;
  `response_format: json_object` → JSON-only instruction + fence strip +
  `JSON.parse` validation; `max_completion_tokens` → `max_tokens` floor
  4096 (adaptive thinking shares the cap); `temperature`/`top_p`
  DROPPED (Opus 5 returns 400 on sampling params); adaptive thinking at
  effort `medium` (`CLAUDE_EFFORT` env); server-side refusal fallbacks
  (`betas: server-side-fallback-2026-07-01`, `fallbacks: 'default'`);
  `stop_reason: refusal` → thrown Error.
- Key: `ANTHROPIC_API_KEY` in gitignored `functions/.env.hrx1-d3beb`
  (ships with function deploys like the other env keys). Rotate at
  console.anthropic.com if exposed. Turn on auto-reload billing.
- SDK: `@anthropic-ai/sdk` 0.120.x in functions/package.json.
- Observed latency ~12s per extraction call (Opus 5, medium effort) —
  fine for background enrichment; revisit effort `low` or Sonnet 5 for
  high-volume paths if cost/latency matters.

## Phase 1 — DONE + DEPLOYED 2026-08-21 (21 functions)

Modules: fieldglass/enrichment.ts, resumeParser.ts, index.ts
(generateJobDescription, analyzeAITraining, trackSatisfaction,
getBroadcastAnalytics, translateContent, escalateConversation,
analyzeConversationSentiment via `callOpenAI`), indeedFlex/parser/
llmFallback.ts, sales/inboxChiefOfStaff.ts, sales/sodexoReplies.ts,
scheduling/schedulingTriageNightly.ts, workersComp/suggestWorkersCompCode.ts,
translation/openai.ts + http/processTranslationJob.ts.
Deployed names: fieldglassEnrichmentIngest, fieldglassEnrichmentQueue,
fieldglassInboundWebhook, onFieldglassIngestEventCreatedParse,
indeedFlexInboundWebhook, onIngestEventCreatedParse, parseResumeHttp,
generateJobDescription, inboxTriageCron/Now, inboxMorningBriefCron/Now,
sodexoReplyScanCron/Now, resolveSodexoReply, schedulingTriageNightly,
processTranslationJob, translateContent, analyzeAITraining,
trackSatisfaction, getBroadcastAnalytics. (suggestWorkersCompCode,
escalateConversation, analyzeConversationSentiment are NOT deployed
functions — code migrated, nothing to deploy; never create new ones.)
Smoke test: `.scratch/claude-migration-smoke.ts` (FG extraction + posting
copy on a synthetic detail page) — all fields extracted incl. hiring
manager.

## Phase 2 — TODO

Still on OpenAI (`new OpenAI(` in 13 files): appAi.ts, enhancedMainChat,
devopsChat, codeAware, feedbackEngine, companyEnrichment,
enhanceCompanyWithSerp, enhanceContactWithAI, discoverCompanyLocations,
discoverCompanyUrls, extractCompanyInfoFromUrls, fetchCompanyNews,
findSimilarCompanies, prospecting, simpleEnrichCompanyOnDemand,
safeDealCoachAnalyzeCallable, dealCoach, workerSupportAssistant,
calculateApplicantFitScore, gptGateway/openaiHelper. Same one-line swap
pattern. **Embeddings stay on OpenAI** (utils/embeddings.ts, codeAware,
vectorSettings) — Anthropic has no embeddings endpoint; move to Voyage
if/when OpenAI is fully retired.

## Footguns

- Never pass `temperature`/`top_p` to Opus 5 (400). The adapter strips
  them; direct SDK callers must not add them.
- Prompts that said "respond with JSON" relied on OpenAI json_object
  mode; Claude honors the injected JSON-only instruction, but the
  adapter still validates — a parse failure throws, and every caller
  already had try/catch + regex/fallback paths.
- Add a billing/429 alert (log-based) so a credit outage can't go quiet
  for days again — recommended to Greg 2026-08-21, not yet built.
