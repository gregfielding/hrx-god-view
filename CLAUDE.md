# HRX (C1 Staffing god-view) — Claude Code guide

Multi-tenant staffing platform: CRA React client (`src/`), Firebase Cloud
Functions (`functions/`), Firestore, hosted at hrxone.com. Production
project `hrx1-d3beb`; primary tenant `BCiP2bQ9CgVOCTfV6MhD` (C1 Staffing).

## Institutional knowledge — read this first

`docs/claude/README.md` indexes everything non-obvious about this system:
integration gotchas (Everee, QBO, Expensify, E-Verify/WorkBright, Indeed
Flex, Fieldglass), data-model conventions, operational state of ongoing
projects, and a long list of hard-won footguns. **Load the files relevant
to your task before working in that area.** When you learn a durable
ops/dev fact, update the matching file there (create one if needed) and
keep its README index current — that directory is the team's shared brain.

## Non-negotiable operating rules

- **Deploys**: always a named list — `firebase deploy --only
  functions:a,functions:b`. A bare `--only functions` hard-fails on
  orphaned legacy functions. The project is AT the Cloud Run 1,000
  services/region cap: creating any NEW function requires deleting a dead
  one first (see docs/claude/project_conventions.md).
- **onCall functions** need `cors: true` in options or hrxone.com is
  CORS-blocked.
- **`shared/` ↔ `src/shared/`** are byte-identical mirrors — edit both.
- **i18n**: edit `i18n/locales/*.json`; `public/` copies are generated.
- **Never commit PII files** (worker CSVs carry SSN last-4). Scratch
  data/scripts live in gitignored `functions/.scratch/`; scratch scripts
  run from the `functions/` directory (ts-node fails from repo root).
- **Secrets** live in gitignored `functions/.env.hrx1-d3beb` (Everee
  tokens, QBO keys, Expensify creds, OAuth). Never print values. If the
  file is lost, reconstruct from the Firebase console / provider
  dashboards.
- **Firestore**: `assignments` are the point of truth (fill gaps by
  materializing assignments, never read-time patches); every bulk loader
  must stamp `createdAt` (orderBy drops docs missing the field); use
  `stripUndefinedDeep` — naive undefined-strippers corrupt timestamps.
- **Functions memory**: 512MiB minimum (256MiB OOMs on cold start).

## Memory policy (for Claude sessions)

Ops/dev/institutional knowledge → `docs/claude/` in this repo (shared).
Operator-personal strategy (sales, outreach, personal inbox) → that
operator's local Claude memory, never the repo.
