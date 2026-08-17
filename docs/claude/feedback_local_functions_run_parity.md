# local functions run parity

> Running functions code locally via ts-node scratch scripts silently diverges from prod — MockSmsProvider + Firestore undefined-value crashes; how to get parity

Two prod/local divergences bit hard on 2026-07-07 (Fieldglass radius blast "sent 0 SMS" — looked like a consent bug, was neither):

1. **SMS provider**: `getSmsProvider()` (functions/src/messaging/smsProviderFactory.ts) falls back to **MockSmsProvider** when `SMS_PROVIDER` is unset. Deployed functions load `SMS_PROVIDER=twilio` from `functions/.env.hrx1-d3beb`; a bare `npx ts-node .scratch/…` run does NOT load that file → "SMS sent" logs with `mock-…` SIDs and nothing reaches Twilio.
2. **Firestore undefined values**: deployed bundles run with `ignoreUndefinedProperties: true` — but only IMPLICITLY, because `resumeParser.ts` (imported by index.ts in every bundle) calls `db.settings(...)` unguarded at module load. Scratch scripts that import a functions module directly don't get it → writes with `threadId: undefined` / `fromUserId: undefined` / `ctaLabel: undefined` (pervasive `|| undefined` pattern in routingOrchestrator/unifiedWorkerNotifications) THROW locally and kill the send before Twilio is called.

**Why:** local repro of messaging bugs gives false negatives (mock "successes") and false positives (undefined crashes that never happen in prod) — I burned a debugging session on each.

**How to apply:** in any scratch script exercising messaging/notification code: `admin.initializeApp(...); const db = admin.firestore(); db.settings({ ignoreUndefinedProperties: true });` BEFORE importing the functions module, and export `SMS_PROVIDER=twilio` + the four TWILIO_* secrets (via `gcloud secrets versions access latest --secret=… --project=hrx1-d3beb`, never printed) when a real send is intended. Also note the fragility: if anyone reorders index.ts imports or guards resumeParser's settings call away, prod loses ignoreUndefinedProperties and the whole orchestrator SMS/push path starts crashing on those undefined fields — the `|| undefined` sites (~25 in routingOrchestrator.ts) should eventually be cleaned up or the setting made explicit in index.ts.
