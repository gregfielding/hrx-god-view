# Cumulative Worker Pre-Screen Interview

**Status:** Approved design (Greg, 2026-07-31 ask) — implemented 2026-08.
**Problem:** A worker who has applied + interviewed several times still gets the full ~16-step
"Quick interview" (`/c1/workers/prescreen?applicationId=…`) for every new application, starting
with questions HRX already has answers to ("What type of work are you interested in?").

## Current architecture (as-built, pre-change)

- **Questions**: 26 static core steps (`src/constants/workerAiPrescreenQuestions.ts` +
  `workerAiPrescreenOpeningSteps.ts`) + per-job dynamic steps built server-side
  (`functions/src/workerAiPrescreen/buildDynamicPrescreenQuestions.ts`) and fetched via the
  `getWorkerAiPrescreenInterviewPlan` callable.
- **Answers**: held in React state only; one submit at the end via `submitWorkerAiPrescreenInterview`,
  which scores (deterministic `rules_v1`, no LLM), writes the audit doc
  `users/{uid}/interviews/{id}` (`questions[]` of `{id, question, answer, type}`), stamps the user doc
  (`interviewStatus: 'completed'`, `hasWorkerAiPrescreenInterview`) and the application doc
  (`workerAiPrescreenInterviewCompletedAt`, `aiAutomation.*`, chase-clearing).
- **Cadence**: interview-invite SMS + chases keyed off application fields
  (`workerAiPrescreenReminder*`, `Chase1/2*`) with the user-level 5-day hard-stop anchor
  (`interviewCadenceStartedAt`, `functions/src/workerAiPrescreen/interviewCadence.ts`). Every sender
  checks `workerAiPrescreenInterviewCompletedAt` before nudging — except
  `shouldSendCombinedApplicationInterviewFirstTouch`, which did not (fixed in this change).
- **Existing partial reuse**: opening preferences are denormalized to
  `workerProfile.preferences.*` and prefilled (`workerAiPrescreenAdaptiveEntry.ts`);
  `prescreenDynamicDedupe.ts` suppresses shift/commute/physical dynamics when core answers cover
  them. Nothing else carries across applications.

## Design

### 1. Worker-level answer bank

New doc `users/{uid}/prescreen/answerBank` (admin-written only; the client never reads or writes it
directly — coverage flows through the plan callable):

```jsonc
{
  "version": 1,
  "answers": {
    "<questionId>": {
      "answer": "string | string[]",       // normalized value (arrays for multi-select)
      "answeredAt": "<Timestamp>",          // when the worker actually answered it
      "sourceInterviewId": "<id>",
      "applicationId": "<id|null>",
      "category": "preferences|experience|reliability|compliance|certification|wrap_up|job_specific"
    }
  },
  "updatedAt": "<Timestamp>"
}
```

Written by `submitWorkerAiPrescreenInterview` for every question the worker **actually answered
this session** (`source: 'asked'`); carried answers keep their original `answeredAt`.

### 2. Staleness policy (shared module)

`shared/prescreenAnswerBank.ts` — byte-identical copies in `shared/`, `src/shared/`,
`functions/src/shared/` (pure module, no imports). Per-question-id → category → freshness window:

| Category | Question ids | Freshness |
|---|---|---|
| preferences | `opening_*` | 90 days |
| experience | `experience_details`, `motivation`, `pressure_situation`, `work_confidence` | 180 days |
| reliability | `attendance_issues`, `attendance_explanation`, `transportation_plan`, `backup_transportation`, `physical_comfort` | 90 days |
| compliance | `drug_screen(_detail)`, `background_check(_detail)`, `background_offense_*`, `dyn_job_drug_screen`, `dyn_job_background_check` | 180 days |
| certification | `dyn_cert__<slug>` (per cert) | 365 days (expiry proxy — no per-cert expiry data yet); `dyn_cert_willing__<slug>` 90 days |
| wrap-up | `supervisor_feedback` 180d, `additional_notes` 90d | |
| job-specific (**always asked**) | `dyn_shift_punctuality`, `dyn_worksite_commute`, `dyn_physical_job_fit`, `dyn_uniform_available` | never banked for coverage (existing core-answer dedupe still suppresses the first three) |

`confirm_legal_first_name` stays gated by `userDocNeedsLegalFirstNameConfirm` (already delta-like).
`dyn_gig_path_willing`: 90 days.

### 3. Delta interview

`getWorkerAiPrescreenInterviewPlan` additionally loads the bank + user doc and returns
`bankCoverage: { coveredCoreStepIds, coveredDynamicStepIds, bankAnswers, bankDynamicAnswers, computedAtMs }`.
Coverage = fresh per policy **and** valid per the same minimums the wizard enforces (substantive
word counts, compliance detail ≥15 chars when drug/bg = yes, conditional includes evaluated
against bank answers).

Client (`WorkerAiPrescreenPage`):
- seeds `answers`/`dynamicAnswers` state from `bankAnswers` (so conditional-step gating and the
  dynamic dedupe behave exactly as if the worker had just typed them),
- removes covered steps from the nav (worker sees **only the delta**, with a "we kept your
  previous answers" banner),
- submit sends the full merged answer set (unchanged server validation) **plus
  `askedStepIds`** — the steps actually rendered — so the server can distinguish
  asked vs carried for the audit trail and bank freshness.

Interview audit docs (`users/{uid}/interviews/{id}`) keep the full per-application snapshot:
every `questions[]` row now carries `source: 'asked' | 'carried'`.

### 4. Zero-delta auto-complete

`maybeAutoCompletePrescreenFromBank` (server): given an application, compute the delta from the
bank; if **empty** (also requires: no legal-name confirm needed, prescreen required by policy,
tenant outreach context sane), run the extracted submission core
(`performPrescreenSubmission`) with bank answers — same scoring, same interview doc (marked
`autoCompletedFromBank: true`, `entry: 'auto_carryover_zero_delta'`, all rows `source: 'carried'`),
same application writes (`workerAiPrescreenInterviewCompletedAt`, `aiAutomation.*`) plus
`workerAiPrescreenAutoCompletedFromBank: true`.

Hook points:
- `onApplicationCreated` / `onApplicationStatusChanged` (→ submitted): run **before** the combined
  first-touch SMS; on auto-complete the worker gets the plain "application received" message with
  no interview ask, and no chases are ever scheduled.
- `processWorkerAiPrescreenReminders`: before sending the first reminder for an application,
  re-check delta (covers applications already pending when this ships + banks that filled in
  between). Outcome recorded as `auto_completed_from_bank`.
- Defense in depth: `shouldSendCombinedApplicationInterviewFirstTouch` now also refuses when
  `workerAiPrescreenInterviewCompletedAt` is set.

The 5-day cadence never starts because completion precedes every scheduling site; existing
`skipped_interview_done` checks cover races. Downstream automation (auto-onboard trigger on
`workerAiPrescreenInterviewCompletedAt`, phase-6 queue, score summaries) fires identically to a
typed interview.

Client fallback: if a worker opens an interview link whose delta is empty (e.g. SMS sent before
bank filled), the page shows a "you're all set — confirm" single-tap screen that submits the
carried answers.

### 5. Migration / backfill

One-shot gitignored script `functions/.scratch/backfillPrescreenAnswerBank.ts` (dry-run default):
for each user with `hasWorkerAiPrescreenInterview == true` (plus `interviewStatus == 'completed'`
sweep), read `users/{uid}/interviews` where `interviewKind == 'worker_ai_prescreen'`, walk
ascending by `createdAt`, and take the **latest** answer per question id with
`answeredAt = interview createdAt`. Multi-select strings are split back to arrays (same rule as
`extractPrescreenAnswersFromInterviewDoc`). Idempotent merge; reruns safe. Freshness is evaluated
at read time, so old interviews simply yield stale (re-asked) categories — no data is discarded.

## Non-goals / future

- Worker-facing "review & edit my saved answers" screen (bank is invisible except through
  shorter interviews).
- Per-cert expiry tracking (365-day proxy until cert records carry expiry).
- LLM re-scoring — scorer stays `rules_v1`.
