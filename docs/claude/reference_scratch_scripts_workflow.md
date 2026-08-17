# scratch scripts workflow

> Operational scripts (migrations, backfills, one-shot sends) live in functions/.scratch/, are gitignored, and run locally with npx ts-node — the directory's tsconfig.json already includes ../shared for cross-imports

One-shot operational scripts (Firestore migrations, backfills, mass sends, audit probes) live in `functions/.scratch/`. The directory is gitignored — these scripts never get committed. Greg runs them locally.

**Conventions:**
- Run with `npx ts-node functions/.scratch/<script>.ts <flags>` from the repo root.
- Default to `--dry-run`; require `--write` for actual writes.
- Common flags: `--limit=N`, `--batch-size=N`, `--entity=<slug>`, optional `--no-refresh-oob` style escape hatches.
- Output structured JSON to `functions/.scratch/<script>-{ts}.json`. The filename timestamp is the run start; the file is the audit trail.
- Idempotency: stamp a per-wave timestamp field on user docs (e.g., `migrationMessageSentAt`, `migrationCorrectedLinkSentAt`) so re-runs skip already-processed docs.
- `functions/.scratch/tsconfig.json` already includes `../shared/**/*.ts` so shared imports work without setup.

**Template scripts to mirror when writing new ones:**
- `functions/.scratch/createAuthForMigrants.ts` — Firestore-iteration + Auth-create pattern, idempotent stamping.
- `functions/.scratch/emergencyTempworksImport.ts` — CSV-import + Firestore find-or-create + cross-system call pattern.
- `functions/.scratch/sendMigrationCorrectedLink.ts` — filter-then-send pattern with JIT regeneration and per-recipient entity resolution.

**Secret access (each shell session):** Twilio/SendGrid creds live in Google Secret Manager — not in `.env`. Export them before running any send-script:

```sh
export TWILIO_ACCOUNT_SID=$(gcloud secrets versions access latest --secret=TWILIO_ACCOUNT_SID --project=hrx1-d3beb)
export TWILIO_AUTH_TOKEN=$(gcloud secrets versions access latest --secret=TWILIO_AUTH_TOKEN --project=hrx1-d3beb)
export TWILIO_MESSAGING_PHONE_NUMBER=$(gcloud secrets versions access latest --secret=TWILIO_MESSAGING_PHONE_NUMBER --project=hrx1-d3beb)
export SENDGRID_API_KEY=$(gcloud secrets versions access latest --secret=SENDGRID_API_KEY --project=hrx1-d3beb)
```

`GOOGLE_APPLICATION_CREDENTIALS=$HOME/.config/gcloud-claude/service-account.json` is the Claude Code auth path. That SA does **not** have Secret Manager access — Greg has to run the secret exports manually. Don't expect Claude Code to bootstrap them.

**Known gap:** BI.0 import script lacked SIGINT/SIGHUP handling — Ctrl+C and terminal close don't stop the Node process. Tracked as DH.4. Add signal handlers to any long-running new script.
