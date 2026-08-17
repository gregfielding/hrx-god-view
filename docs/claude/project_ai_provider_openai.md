# ai provider openai

> All AI-driven extraction/parsing/enrichment in this codebase uses OpenAI; the appAi.ts and resumeParser.ts files are the established patterns to mirror for new AI work

This codebase uses **OpenAI** for AI-driven work, not Anthropic. Default model is `gpt-5`. The pattern for new AI features is to mirror the existing modules, not introduce a second provider.

**Why:** All current AI surfaces (resume parsing, company enrichment, feedback engine, Worker AI Prescreen, contact enrichment, app_ai chat) are wired through OpenAI. Adding Anthropic alongside would split the AI stack into two providers — not load-bearing for any current need. Confirmed with Greg 2026-05-15 in the Indeed Flex parser design.

**How to apply:**
- **Generic AI calls** — use the `app_ai_generateResponse` callable shape in [functions/src/appAi.ts](functions/src/appAi.ts): `onCall` + `withIdempotency('<name>.v1', logicalInput, ttl, async () => ...)` + `openai.chat.completions.create({ model: 'gpt-5', ... })`.
- **Domain-specific parsers** — mirror [functions/src/resumeParser.ts](functions/src/resumeParser.ts): a single file owns its **Zod schemas** (`ParsedResumeDataSchema`, `ResumeUploadSchema`, etc.), its prompt, its preprocessing (file-format sniffing, NLP via `compromise`, OCR via `@google-cloud/vision`), and the OpenAI call. Graceful validation fallback — Zod errors are logged + warned, but the unvalidated data is returned rather than crashing the pipeline.
- **Idempotency** — every AI call wrapped in `withIdempotency` from `functions/src/middleware/aiGuard.ts`. Skips this only with a real reason.
- **Don't** introduce `@anthropic-ai/sdk` without explicit approval. The `claude-api` skill in Claude Code is unrelated to this codebase's runtime — it's about building Anthropic apps generally, not this project.
- **`OPENAI_API_KEY`** is the env var. Provisioned in Cloud Functions runtime config.

**Existing AI-using modules** (touch points worth knowing about):
- `appAi.ts` — generic chat completion
- `resumeParser.ts` — file → structured profile data
- `companyEnrichment.ts` + `enhanceCompanyWithSerp.ts` + `simpleEnrichCompanyOnDemand.ts` — CRM enrichment
- `discoverCompanyUrls.ts` / `discoverCompanyLocations.ts` / `extractCompanyInfoFromUrls.ts` — company discovery
- `findSimilarCompanies.ts` — similarity search
- `fetchCompanyNews.ts` — news enrichment
- `feedbackEngine.ts` — feedback-loop AI
- `enhanceContactWithAI.ts` — contact enrichment
- `workerAiPrescreen/*` — the Worker AI Prescreen subsystem (heavy iteration; tread carefully)
