# Logging Refactor Audit (Nov 2025)

This document captures every Firestore logging or diagnostics writer that must be removed or rerouted to the upcoming centralized logger. Each section lists the file, function (or module), what it logs, the target collection, and whether the log can be deleted permanently.

> Legend — **Target collections:** `ai_logs`, `aiMoments`, `ai_cache`, `campaign_analysis`, `context_analysis`, or any `*log*/*moment*/debug` collection.

---

## Backend – `functions/src`

| File / Function | Collection | Purpose / Notes | Remove? |
| --- | --- | --- | --- |
| `feedbackEngine.ts` → `logAIAction` (and `logAIActionCallable`, `listAILogs`) | `ai_logs` | Writes every AI prompt/response + metadata; callable exposes list view. | **Yes, replace with logger** |
| `firestoreTriggers.ts` (`firestoreLog*` functions) | `ai_logs` | Firestore triggers re-log CRUD events (meta logging). | **Delete** |
| `safeFirestoreLogAILogCreated.ts`, `safeFirestoreAILogUpdated.ts`, `firestoreLogAILogCreatedDisabled.ts`, `emergencyTriggerDisable.ts` | `ai_logs` | Variants / kill switches around meta-logging. | **Delete** |
| `aiLoggingOptimization.ts` | `ai_logs`, `ai_cache` | Rate-limited log writer + dashboards. | **Delete** |
| `aiEngineProcessor.ts`, `safeAiEngineProcessor.ts` | `ai_logs`, `campaign_analysis`, `context_analysis` | Processes `ai_logs` stream, writes derived analysis docs + updates log entries. | **Delete** |
| `autoDevOpsMonitoring.ts`, `autoDevOpsAssistant.ts`, `monitor_function_rates.js`, `vectorSettings.ts` | `ai_logs` | Admin utilities querying or mutating `ai_logs`. | **Delete / rewrite to console** |
| `dealCoach.ts`, `dealCoachAnalyzeCallable`, `dealCoach` helpers | `ai_cache`, `ai_logs` | Cache/rate-limit doc writes for dedupe metadata. | Replace with in-memory/cache + logger |
| `taskEngine.ts` (multiple helpers) | `ai_cache`, `ai_logs` | Stores AI task suggestions/results, rate limits. | Replace writes with logger |
| `scheduler.ts` (AI Scheduler), `modules/workLifeBalance.ts`, `modules/professionalGrowth.ts`, `modules/miniLearningBoosts.ts`, etc. | `aiMoments`, `scheduledMoments`, custom log docs | Creates/updates `aiMoments` + emits Firestore log docs per user. | **Disable + replace** |
| `companyEnrichment.ts`, `contactEnrichment.ts` | `ai_logs`, `ai_cache` | Writes enrichment statuses / metrics. | Use logger only |
| `gmailBulkImport.ts`, `autoDevOpsMonitoring.ts` | `ai_logs` | Captures import progress/errors. | Use logger only |
| `pipelineTotalsOptimized.ts`, `companySnapshotFanoutOptimized.ts`, `updateActiveSalespeopleOnDealOptimized.ts`, `companyLocationUpdateOptimized.ts` | `ai_cache` | Rate limit documents for fanouts. | Replace with in-memory or Redis; no Firestore |
| `aiLogging*` markdown specs (`AI_LOGGING_COST_CONTAINMENT_POLICY.md`, etc.) | — | Docs referencing legacy logging. | Remove once refactor done |

Other helpers referencing targeted collections (`getGmailStatusOptimized.ts`, `generateDealAISummary.ts`, `autoDevAssistant.ts`, `vectorSettings.ts`, etc.) also need rewrites; they currently query or mutate `ai_logs`/`ai_cache`.

---

## Frontend – `src/*`

Multiple React pages/components call `setDoc`/`addDoc` directly on `ai_logs` for telemetry:

| Component | Purpose | Remove? |
| --- | --- | --- |
| `src/pages/TenantViews/ModuleDetailsView.tsx`, `TenantModules.tsx`, `AgencyModules.tsx` | Writes module toggle events to `ai_logs`. | **Replace with `logger.*`** |
| `src/pages/AgencyProfile/components/AISettingsTabSections/*` (`VectorSettings`, `TraitsEngineSettings`, `ToneStyleSettings`, `MomentsEngineSettings`, `RetrievalFilters`, etc.) | Every save/test action logs to `ai_logs`. | **Replace** |
| `src/pages/Admin/*` (`WeightsEngine.tsx`, `ToneSettings.tsx`, `MomentsEngine.tsx`, etc.) | Emits admin audit logs to `ai_logs` / `aiMoments`. | **Replace** |
| `src/firebase/fixLogEntry.ts`, `src/modules/autoDevOps/runLogFixer.ts` | Direct maintenance tools manipulating `ai_logs`. | Obsolete after refactor |
| `src/utils/activityService.ts`, `src/components/ActivityLogTab.tsx` | Reads tenant `ai_logs` for timeline UI. | Needs redesign (point to new lightweight source or disable) |
| `src/pages/Admin/DailyMotivation.tsx` | UI copy references AI logs. | Update messaging |

---

## Collections Summary

| Collection | Writers | Safe to delete? | Notes |
| --- | --- | --- | --- |
| `ai_logs` | Numerous backend + frontend modules | Yes | Replace entirely with centralized logger |
| `aiMoments` / `scheduledMoments` | Scheduler & admin tools | Yes (replace with config stored elsewhere) | Massive fan-out scheduling costs |
| `ai_cache` | All “optimized” fanout/rate limit helpers | Replace | Should move to memory/Redis/env flag; no Firestore needed |
| `campaign_analysis`, `context_analysis` | `aiEngineProcessor.ts` | Yes | Only used for AI debugging |
| `campaign_analysis`, `context_analysis`, `ai-metrics`, `ai_logs` subcollections | Rare queries only for diagnostics | Delete |

All of the above logs are debugging/analytics only and can be removed permanently once the centralized logger is in place.

---

## Next Actions

1. Implement shared logger utilities (backend + frontend) with feature flag + TTL Firestore fallback.  
2. Rip out all Firestore logging calls listed above; replace with `logger.*`.  
3. Delete cron jobs/helpers whose only purpose was to maintain `ai_logs` or analysis collections.  
4. Verify `ENABLE_FIRESTORE_LOGS` default is `false` in both Functions and Next.js environments.

Once complete, Firestore will no longer store AI logs or diagnostics, eliminating the runaway costs.


