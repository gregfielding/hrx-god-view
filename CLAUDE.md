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

## Git workflow (two-person team — Greg + Mark, both using Claude)

- **Pull before you start**: run `git pull` at the beginning of any session
  that will edit code, and before starting a new piece of work.
- **Push after you commit**: an unpushed commit exists only on one laptop —
  the teammate can't see it and a lost machine loses it.
- **☠️ Never deploy from a stale or unpushed tree.** Hosting deploys ship
  the WHOLE bundle: deploying from a checkout that's missing the other
  person's pushed commits silently reverts their live features. Before any
  `firebase deploy`: `git pull`, confirm `git log origin/main..main` is
  empty or being pushed now, then build fresh and deploy.
- Trunk-based on `main` with small, frequent commits is the default; use a
  feature branch + PR for large or risky changes.
- Announce functions deploys to each other (two simultaneous deploys of
  the same function can race).

## Memory policy (for Claude sessions)

Ops/dev/institutional knowledge → `docs/claude/` in this repo (shared).
Operator-personal strategy (sales, outreach, personal inbox) → that
operator's local Claude memory, never the repo.
