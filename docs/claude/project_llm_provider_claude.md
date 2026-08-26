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

## Phase 2 — DONE + DEPLOYED 2026-08-21 (40 functions)

Every remaining chat call site moved to the adapter (incl. 9 raw
`fetch('https://api.openai.com/v1/chat/completions')` callers and the
Responses-API call in workerSupportAssistant). Adapter extensions for
this phase: OpenAI function `tools` → Claude tools with `tool_use` →
`message.tool_calls` (+ `finish_reason: 'tool_calls'`), `tool_choice`
auto/required/none/named, and `response_format: json_schema` → Claude
structured outputs (`output_config.format`). `chatWithGPT` (in-app
assistant) keeps its tool loop; its SSE branch (no browser consumer —
the web app reads `data.reply`) now emits the full reply as ONE
OpenAI-shaped delta event rather than token streaming.
Modules: appAi, gptGateway, enhancedMainChat, dealCoach (4 sites),
safeDealCoachAnalyzeCallable, calculateApplicantFitScore, devopsChat,
workerSupportAssistant, prospecting, feedbackEngine, companyEnrichment,
simpleEnrichCompanyOnDemand, enhanceContactWithAI, enhanceCompanyWithSerp,
extractCompanyInfoFromUrls, discoverCompanyLocations, discoverCompanyUrls,
fetchCompanyNews, findSimilarCompanies, utils/openaiHelper (→
batchTagMotivationsWithAI).
Deployed: chatWithGPT, enhancedChatWithGPT, app_ai_generateResponse,
workerSupportAssistant, all 11 dealCoach* fns, enrichCompany{OnCreate,
Weekly,Batch,OnDemand}, getEnrichmentStats, runProspecting,
saveProspectingSearch, addProspectsToCRM, createCallList, the 6 deployed
feedback* fns, enqueueApplicantScore, recalculateApplicantScore,
findSimilarCompanies, fetchCompanyNews, discoverCompany{Locations,Urls},
enhanceCompanyWithSerp, enhanceContactWithAI, extractCompanyInfoFromUrls,
batchTagMotivationsWithAI. Not deployed (code only): devopsChat,
saveFeedbackTemplate, listFeedbackTemplates.
Smoke: `.scratch/claude-phase2-smoke.ts` (json_schema + tool_calls live).

**Remaining on OpenAI: embeddings only** — `utils/embeddings.ts`,
`codeAware.ts` (`/v1/embeddings`), `vectorSettings.ts`. Anthropic has no
embeddings endpoint; move to Voyage if OpenAI is to be fully retired.
`OPENAI_API_KEY` must therefore stay in the env file (and funded) for
those paths only.

## Footguns

- Never pass `temperature`/`top_p` to Opus 5 (400). The adapter strips
  them; direct SDK callers must not add them.
- Prompts that said "respond with JSON" relied on OpenAI json_object
  mode; Claude honors the injected JSON-only instruction, but the
  adapter still validates — a parse failure throws, and every caller
  already had try/catch + regex/fallback paths.
- **Cold-start memory**: the Anthropic SDK adds ~10-20MiB to the bundle;
  `workerSupportAssistant` at 256MiB OOM'd at 267MiB on first deploy
  after migration → bumped to 512MiB. Audit any other 256MiB function
  before deploying it with the adapter (CLAUDE.md already says 512 min).
- Add a billing/429 alert (log-based) so a credit outage can't go quiet
  for days again — recommended to Greg 2026-08-21, not yet built.
