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
