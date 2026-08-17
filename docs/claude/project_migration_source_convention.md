# migration source convention

> Bulk-imported user docs carry a migrationSource string; the suppression helper userIsInActiveMigration() matches ^tempworks_ or ^bi1_ prefixes to silence outbound automation across 5+ message paths

Bulk-imported user docs (Tempworks emergency import, future BI.1 imports, any subsequent migration) carry a `migrationSource` field whose value follows a prefix convention used by the suppression helper.

- Value format: `<source>_<date|context>`, e.g., `tempworks_emergency_2026-05-07`.
- Recognized prefixes: `^tempworks_` and `^bi1_`. New migration sources should start with one of these (or update `userIsInActiveMigration()` in `functions/src/messaging/migrationSuppress.ts` to recognize the new prefix).

**Why:** Bulk imports must not trigger normal onboarding messaging (welcome SMS, Apply-Wizard reminders, interview-invite SMS) — workers are migrated mid-flight and need a single coordinated migration message, not the full new-hire automation barrage. PRs #2/#3/#4 deployed five suppression sites that all consult this field via `userIsInActiveMigration()`:

- `processApplyWizardReminders`
- `processScheduledInterviewInvites`
- `enqueueWelcomeSmsOnUserCreated`
- `dispatchWorkerHired` + `dispatchWorkerOnboardingPipelineStarted` (doc-level gates)
- In-process `suppressNotifications: true` flag on `runStartOnCallEmploymentFlow`

Note: `processWorkerOnboardingReminders` was **un-gated** in PR #4 — stock onboarding reminders ("complete your I-9", "set up direct deposit") flow normally for migration workers; only the migration-context dispatchers stay suppressed.

**How to apply:**
- When writing a new bulk-import script, set `migrationSource` on every imported user doc and use a `tempworks_` or `bi1_` prefix.
- When adding a new message path / trigger, check whether it should be suppressed for migration users — if yes, call `userIsInActiveMigration()` before dispatch and stamp the suppressed-sites audit array.
- Don't hardcode a specific source value in new code — match the prefix via the helper. The exact value (e.g., `tempworks_emergency_2026-05-07`) is hardcoded only at the import-script's `MIGRATION_SOURCE` constant.
- Idempotency timestamps are per-wave, not shared: `migrationMessageSentAt`, `migrationCorrectedLinkSentAt`, future `migrationReminderSentAt`. Each wave stamps independently so re-runs are safe.
