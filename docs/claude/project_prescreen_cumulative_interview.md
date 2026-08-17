# prescreen cumulative interview

> "Cumulative worker pre-screen — worker-level answer bank, delta interviews, zero-delta auto-complete; shipped 2026-08-01"

Cumulative pre-screen interview (Greg's 2026-07-31 ask: repeat applicants kept getting the full
16-step Quick interview). Design doc: `docs/prescreen-cumulative-interview.md`. Shipped + deployed
2026-08-01 (branch claude/charming-tharp-821cd7, commits 61f4fc8a / f774049d / 9295df3d + deploy).

- **Answer bank**: `users/{uid}/prescreen/answerBank` — latest answer per question id with
  `answeredAt`; written by submit for `source:'asked'` rows only (carried rows keep old
  answeredAt). Admin-only; client never reads it (coverage flows through the plan callable).
- **Policy module**: `shared/prescreenAnswerBank.ts` (mirrored `src/shared/`;
  `functions/src/shared` is a SYMLINK to root `shared/` — only two real copies). Windows:
  preferences/reliability 90d, experience/compliance/supervisor 180d, certs 365d,
  job-specific dynamics (shift/commute/physical/uniform) never carried. "not_sure"-style
  answers are answered-but-not-carriable. Unit tests in `src/shared/prescreenAnswerBank.test.ts`.
- **Delta rendering**: `getWorkerAiPrescreenInterviewPlan` returns `bankCoverage`; the wizard
  seeds state from bank answers, filters covered steps, submits full merged answers +
  `askedStepIds`. Zero-delta link-open shows one-tap "Use my saved answers".
- **Zero-delta auto-complete**: `maybeAutoCompletePrescreenFromBank` (calls extracted
  `performPrescreenSubmission` — same rules_v1 scoring/writes; interview doc gets
  `autoCompletedFromBank`, app gets `workerAiPrescreenAutoCompletedFromBank`). Hooks:
  onApplicationCreated, onApplicationStatusChanged (→submitted), and
  processWorkerAiPrescreenReminders (first invite + both chases — converts queued rows).
  Cadence ([[feature-interview-sms-cadence]]) never starts: completion precedes scheduling, and
  combined first-touch / reminder scheduling / reminder loop now all check
  `workerAiPrescreenInterviewCompletedAt` (the reminder loop previously lacked that check).
- **Scorer correction**: the prescreen scorer is deterministic `rules_v1`
  (scoreWorkerAiPrescreen.ts), NOT an LLM — the only LLM scorer is the separate
  gpt-4o-mini applicant-fit score which doesn't read interview answers.
- **Backfill**: `functions/.scratch/backfillPrescreenAnswerBank20260801.ts` (gitignored;
  no orderBy on interviews — the project exempts that single-field index). ~3,327 flagged users.
- Deployed fns (named): submitWorkerAiPrescreenInterview, getWorkerAiPrescreenInterviewPlan,
  onApplicationCreated, onApplicationStatusChanged, processWorkerAiPrescreenReminders.
- Future (not built): worker "review saved answers" UI, per-cert expiry, bank-aware
  profile-first chase copy.
