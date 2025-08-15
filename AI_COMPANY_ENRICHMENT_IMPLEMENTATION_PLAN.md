## AI Company Enrichment – End‑to‑End Battle Plan

### Purpose
Create a reliable, cost‑controlled enrichment pipeline that gathers public signals (website, LinkedIn, jobs) and produces structured, actionable intelligence for each company using GPT‑5, with first‑class logging, testing, and UI.

### Guiding Principles
- Prefer server-side Firebase Functions with strict authz and observability.
- Deterministic JSON schema, validated before writes; never store freeform blobs without structure.
- Cache and re-use scraped content; only re-LLM on signal change or staleness.
- Emit AI Logging events for every step; treat logs as the “bloodflow” that powers follow‑ups.
- Roll out incrementally: on-demand → backtest cohort → scheduled.

## Phase 0 — Foundations (Docs + Config)
- [ ] Create strict JSON schema (zod) for `aiEnrichment` including generated scripts and tags
- [ ] Define envs in Functions runtime:
  - `OPENAI_API_KEY`, `OPENAI_MODEL=gpt-5` (fallback `gpt-5-mini`), `SERPAPI_KEY`
  - `ENRICHMENT_DAILY_TENANT_LIMIT=50`, `ENRICHMENT_WEEKLY_LIMIT=300`
  - `ENRICHMENT_DEFAULT_STALENESS_DAYS=7`
  - `SLACK_ENRICHMENT_ALERT_WEBHOOK_URL` (optional)
- [ ] Add cost guardrails doc (token caps, truncation strategy)

## Phase 1 — Data Model & Write Path
### Firestore (additive)
- companies doc: `lastEnrichedAt`, `enrichmentVersion`, `leadScore`, `leadSignals`
- companies doc: `aiEnrichment` object with:
  - `businessSummary: string`
  - `hiringTrends: string[]`
  - `topJobTitles: string[]`
  - `redFlags: string[]`
  - `likelyPainPoints: string[]`
  - `suggestedApproach: string`
  - `inferredOrgStructure: { ops?: string; hr?: string; warehouse?: string }`
  - `competitorCompanies: string[]`
  - `recommendedContacts: { role: string; titleGuess: string }[]`
  - `generatedScripts: { coldEmail: string; coldCallOpening: string; voicemail: string }`
  - `suggestedTags: string[]`
- subcollections:
  - `ai_enrichments/{versionId}`: full snapshot + meta `{ createdAt, model, tokenUsage, websiteHash, linkedinHash, jobHash, qaNotes? }`
  - `vectors/embedding` (optional): `{ model, dims, vector, createdAt }`
  - `enrichment_cache/state`: `{ websiteText, linkedinText, jobText, websiteHash, linkedinHash, jobHash, fetchedAt }`

### Index considerations
- (Optional) Composite: `lastEnrichedAt` ordered with `tenantId` for scheduled queries (we can also page within tenant path).

## Phase 2 — Functions Scaffolding
Files to add:
- `functions/src/companyEnrichment.ts`
  - `export async function runCompanyEnrichment(tenantId, companyId, opts?: { mode?: 'full'|'metadata'; force?: boolean }): Promise<void>`
  - `export const enrichCompanyOnCreate` (firestore onCreate; debounce ~15s)
  - `export const enrichCompanyOnDemand` (callable; requires tenant membership)
  - `export const enrichCompanyWeekly` (pub/sub schedule; batches with caps)
  - Emits AI Logging: `companyEnrichment.started|success|failure`
- `functions/src/schemas/companyEnrichment.ts` (zod schema shared by runtime & tests)
- `functions/src/utils/serp.ts` (SERP fetch, text extraction, hashing)
- `functions/src/utils/enrichmentPrompt.ts` (prompt builder with schema hints)
- `functions/src/utils/embeddings.ts` (optional, feature-flagged)

Behavioral details:
- `mode: 'metadata'` only refreshes cache + hashes, no GPT call
- `mode: 'full'` calls GPT iff `force === true` OR hashes changed OR `lastEnrichedAt` > staleness
- On success: update doc fields, write versioned snapshot, update `lastEnrichedAt` and increment `enrichmentVersion`
- On error: log failure, backoff, and respect per-tenant quotas

## Phase 3 — SERP Integration & Content Normalization
- Use SERPAPI (paid) to fetch:
  - Homepage and About pages (prefer cached HTML endpoints)
  - LinkedIn company page via `site:linkedin.com/company {companyName}`
  - Jobs via `site:indeed.com/cmp {companyName}` and/or LinkedIn Jobs
- Normalize HTML → text:
  - Keep headings <h1–h3>, paragraphs, list items; drop nav, footers
  - Truncate per-source text (e.g., ≤10k chars each) and compress whitespace
- Hash each source (SHA‑256) and store

## Phase 4 — Prompt + JSON Validation
- Build prompt from normalized sources
- Use OpenAI JSON schema mode; enforce exact schema
- Validate with zod; on failure retry once with corrective hint; otherwise fail with clear reason
- Capture token usage for metrics and cost dashboards

## Phase 5 — Lead Scoring & Signals
- Add `computeCompanyLeadScore(enrichment)` with deterministic weights:
  - `hiring velocity` +20; `warehouse ops` +10; `red flags` +15; `competitors using temp staff` +25; etc.
- Persist `company.leadScore` and `company.leadSignals`
- Surface score chip on dashboard; feed into deal coach/prioritization where relevant

## Phase 6 — UI Enhancements (Company Dashboard)
- Add an “AI Enrichment” widget (right column):
  - Shows `lastEnrichedAt`, model, tokenUsage (if present), leadScore chip
  - Chips: `hiringTrends`, `redFlags`, `likelyPainPoints`
  - Lists: `topJobTitles`, `competitorCompanies`, `recommendedContacts`
  - Callout: `suggestedApproach`
  - Controls:
    - Primary: “Re‑Enrich with AI” → callable (dropdown: Full | Metadata‑only)
    - Tertiary: “Use cold email/call opener/voicemail” → prefill our Email/Task dialogs
  - If `aiEnrichmentQaNotes`, show “Needs review” chip with tooltip

## Phase 7 — Backtest Cohort
- Script: `scripts/migrations/backfillCompanyEnrichment.ts`
  - Filters: `hasActiveDeals` OR `hasOpenJobOrders` (computed fields or derived counts)
  - Args: `--tenant`, `--limit 500`, `--mode full`, `--force`
  - Output: token costs, success rate, time per company
- Produce report under `reports/enrichment_backtest_YYYY-MM-DD.json`

## Phase 8 — Scheduler Rollout
- Enable `enrichCompanyWeekly` (Sunday 02:00 UTC)
- Strategy:
  1) metadata-only sweep (cheap) to detect content changes
  2) run full LLM only for changed/stale companies
- Global and per‑tenant caps; Slack alert if exceeded or failure rate > threshold

## Phase 9 — QA Validator (Optional but recommended)
- Post‑LLM quick check using a cheaper model; store `qaNotes` if suspicious (industry mismatch, filler, contradictions)
- Don’t block writes; surface warning in UI & logs

## Phase 10 — Embeddings (Feature Flag)
- Combine `businessSummary + hiringTrends + likelyPainPoints` and embed
- Store under `vectors/embedding` for future semantic search (“find similar companies”)
- Batch during backtest to warm index

## Phase 11 — Insights Feed (Admin)
- New page `/admin/ai-insights-feed` (internal)
- Cards: “fastest hiring”, “ops turnover risk”, “emerging hotspots in TX/NV/CA”
- Data from `aiEnrichment` + `leadSignals` across tenant

## Phase 12 — Observability & Controls
- AI Logging events: `companyEnrichment.started|success|failure`
- Telemetry metrics:
  - `enrichment_runs_total`, `enrichment_failures_total`, `token_usage_total`
  - Per‑tenant daily breakdown
- Slack alerts (optional), never email by default

## Phase 13 — Security
- Callable auth: `context.auth` required, tenant membership enforced
- Respect quotas and role; block external origin; all scraping is server-side via SERP

## Phase 14 — Tests
- Unit tests (Functions):
  - Schema validation + retry on invalid JSON
  - Metadata-only path skips GPT
  - Versioning write and history retention
  - Lead score computation
- E2E (Playwright):
  - “Re‑Enrich with AI” button flow → disabled state, success toast, widget updates
  - Scripts buttons prefill Email/Task dialogs

## Phase 15 — Cost Controls
- Text truncation caps per source; token budget guardrails
- Per‑tenant daily cap with graceful deferral
- Weekly scheduler batch limit; jittered execution to avoid spikes

## Acceptance Criteria (Go/No‑Go)
- On‑demand enrichment works with auth + logging; widget displays structured results
- Backtest of 100–500 companies completes under cost ceiling with ≥90% valid JSON rate
- Weekly job respects caps; error rate < 5% and recoverable
- Lead score computed and visible; outreach scripts usable from UI

## Concrete TODO Checklist
- [ ] Add zod schema `functions/src/schemas/companyEnrichment.ts`
- [ ] Add SERP helpers `functions/src/utils/serp.ts`
- [ ] Add embeddings helper `functions/src/utils/embeddings.ts` (feature‑flagged)
- [ ] Implement `functions/src/companyEnrichment.ts` (core + triggers + schedule)
- [ ] Wire AI Logging + metrics counters
- [ ] Add backfill script `scripts/migrations/backfillCompanyEnrichment.ts`
- [ ] UI: CompanyDetails “AI Enrichment” widget + callable button + scripts actions
- [ ] Tests: unit for functions; e2e for UI flow
- [ ] Configure envs and deploy functions (deploy only changed functions per project standard)
- [ ] Monitor logs/costs; iterate weights for lead scoring

## Notes & Dependencies
- Reuse existing discoverCompanyUrls callable if helpful before SERP queries
- Follow existing logging protocol and deployment constraints (deploy only changed functions)
- No nightly emails; Slack optional per env variable


