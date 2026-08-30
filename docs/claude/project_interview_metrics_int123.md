---
name: project-interview-metrics-int123
description: INT-1/2/3 interviews build (2026-08-30) — funnel metrics report, save/resume session spine, recruiter visibility + manual override; data sources and traps
metadata:
  type: project
---

# Interviews INT-1/2/3 (built 2026-08-30, Greg: "build and complete INT-2 and INT-3")

Commit 27b41e57. Companion to [[project-interview-review-2026-08]] (the audit
that sized this) and the eight-area roadmap artifact ("HRX Next Four").

## INT-1 — /reports/interview-metrics (new "Usage & metrics" section)

- Backend: `functions/src/workerAiPrescreen/interviewMetrics.ts`, served by
  `backfillPrescreenCategoryScores` with `mode: 'interviewMetrics'`
  (mode-flag convention — Cloud Run cap). Gate: `canManageOnboarding`.
- Funnel sources (each stage a DIFFERENT collection — do not "simplify"):
  - **invited** = `tenants/{t}/messageLogs` by the 4 interview
    `messageTypeId`s. ☠️ `users.interviewStatus` is NOT a counting field —
    several senders never update it (userGroupInterviewInviteSend).
  - **started** = `collectionGroup('prescreen')` on `planFetchedAt`
    (session docs; tracking BEGINS 2026-08-30 — earlier ranges show 0).
  - **completed/passed** = `collectionGroup('interviews')`
    `interviewKind == 'worker_ai_prescreen'` (index pre-existed).
    `autoCompletedFromBank` bucketed separately — bank auto-completes are
    not human sessions and must not flatter the funnel.
  - **passed** = `ai.recommendation` buckets. Engine "proceed" ≠ the
    stricter orchestrator `aiAutomation.decision === 'advance'` that group
    auto-hire reads — the report labels this.
- Indexes created 2026-08-30 (live + recorded in firestore.indexes.json):
  messageLogs (messageTypeId ASC, createdAt ASC) composite; `prescreen`
  CG field exemption on `planFetchedAt`. The report fails SOFT with a
  warning while they build.

## INT-2 — session spine (save/resume + "started")

- `functions/src/workerAiPrescreen/interviewSession.ts` →
  `users/{uid}/prescreen/session`: `planFetchedAt` (first-fetch-wins,
  transaction, fail-open), `lastPlanFetchAt`, `draftAnswers` /
  `draftMultiAnswers` (sanitized, 200KB cap), `lastStepId/Index`
  (drop-off signal), `completedAt` (submit stamps it, clears drafts, doc
  KEPT for funnel queries).
- Plan callable modes: default returns plan + `savedSession`;
  `mode: 'saveProgress'` persists drafts. Client wrapper:
  `saveWorkerAiPrescreenProgress` in `src/services/workerAiPrescreenCallable.ts`.
- Page (`WorkerAiPrescreenPage.tsx`): drafts restored OVER bank seeds
  (drafts are newer), cursor re-applied clamped via `pendingResumeIndex`
  (nav length can shrink between sessions), bilingual
  `workerAiPrescreen.resumeBanner`, 1.5s-debounced fail-open auto-save.
  Follow-up fields ride reserved keys `__followup_experience/pressure`.
- No client Firestore access to `users/{uid}/prescreen` — everything via
  the callable (rules unchanged, deliberate).

## INT-3 — recruiter surfaces

- `InterviewInviteStateLine` (ApplicantsUsersStyleTableCells): invite
  state on rows from user-doc fields only ("Invited Nd ago — no
  interview yet"). `lastInterviewInvitedAt` added to RecruiterUser type.
  Re-invite already existed (OrderInterviewInlineAction).
- `ManualInterviewDecisionControls` (WorkerAiPrescreenInterviewCardContent):
  Mark passed (advance) / Hold → writes `aiAutomation.decision` +
  `aiAutomation.manualOverride {decision, byUid, byName, at}` on the
  application. ☠️ This is the SAME field auto-hire gates read — a manual
  "advance" makes the worker auto-hire-eligible where a group toggle is
  on; that is the point, but know it.

## Open / deferred

- INT-2 "tighter question set per position type" — needs Greg's product
  input (which questions per position type); not built.
- Chase-effectiveness attribution (completions caused by chase 1/2) —
  v2; needs invite-to-completion joins.
- Language split in the report — needs a users join; deferred.
- c1_app parity: the Flutter interview should pass `entry` to the plan
  callable and adopt saveProgress/savedSession (same wire API) — punch
  list entry added; c1_app tree owned by the riverpod-3 session today.
- Web UI ships with the NEXT HOSTING DEPLOY (functions deployed
  2026-08-30; report page + resume UX live only after hosting ships).
