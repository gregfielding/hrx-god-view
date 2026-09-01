# AI interview ("prescreen") deep-dive review — 2026-08-29

> Greg's ask: "deep dive into our entire interview process... built a few months
> ago using ChatGPT, I'm sure there is much room for improvement." Full review
> artifact: https://claude.ai/code/artifact/ (see index below — published same
> day). Status: TWO P0s FIXED + a month-long prod divergence RECOVERED same
> session; structural items listed for prioritization.

## The headline

**There is no AI in the "AI interview."** Zero LLM calls anywhere in the
subsystem (53 files audited). Questions are hardcoded templates + string
interpolation; scoring is pure arithmetic (`model: 'rules_v1'`); the
"orchestrator" is an if/else ladder. Marginal AI cost per interview: $0.
Meanwhile ~20 code comments and the AI-provider docs describe LLM verdicts
that don't exist — a ChatGPT-era naming artifact that actively misleads
maintainers (e.g. `advanceOnReviewRecommendation` overrides a `score < 80`
check, not model judgment). This is not necessarily bad — deterministic is
auditable and free — but it must be TRUE in the docs and code comments.

## Incident found + fixed during the review ☠️

**The cumulative answer bank was deployed from an UNMERGED branch on 8/01
and never landed on main.** Prod ran a franken-state: plan + auto-complete
hooks on branch code (deployed 8/01), but `submitWorkerAiPrescreenInterview`
was redeployed from main on 8/26 (bank WRITES silently stopped), the
reminders cron on 8/27 (bank conversions lost), and every hosting deploy
since 8/01 shipped the client without the bank UI. Fixed 2026-08-29: branch
`claude/charming-tharp-821cd7` merged to main (clean auto-merge, commit
8ed49d81), all five prescreen functions + hosting redeployed from main.
**Process rule reinforced: NEVER deploy from an unmerged branch — the next
main deploy silently reverts it** (the exact mirror of the CLAUDE.md
stale-tree rule).

## P0s fixed same-day (8a155ccb)

1. **Compliance dead end (disclosure suppression).** The drug/background
   follow-up steps were computed as visible but never rendered
   (`buildPrescreenNavEntries` fixed tail order); an honest "yes" hit the
   server's explanation-required validation with NO screen to answer it —
   the only escape was flipping the answer to "no". Legal exposure, not
   just UX. Follow-ups now render behind their parent questions.
2. **Fabricated answers.** `ensureFastPathNarrativePadding` invented
   motivation/pressure sentences, stored them in the transcript as the
   worker's own words (English-only even for ES workers), and the synthetic
   text gamed the concrete-detail scorer (ended in "…with the team", a
   concrete-detail keyword). Deleted; empty narratives now score as empty.

## Structural findings (open, ranked)

3. **English-only text scoring penalizes Spanish answers** — every quality
   heuristic (concrete-detail keywords, clarity/filler lists, admission
   phrases) is English regex, while the UI is fully bilingual. A Spanish
   answer scores "vague" by construction → flags → caps → likely `review`
   instead of `proceed`. Disparate impact inside an auto-hiring gate.
   Cleanest fix: ONE Claude call (rubric-based narrative quality, bilingual
   by nature) replacing the regex quality layer — see recommendation.
4. **Near-zero test coverage on auto-reject logic** — one test file total;
   the 679-line scorer, category scores, hiring decision ladder, policy
   resolution, orchestrator all untested (one even exports `__testing`
   nobody imports).
5. **`ai.overallScore` is the PRE-override score** while letterGrade +
   recommendation are post-override (up to 15 pts apart) — anything reading
   overallScore misreads the record.
6. **SMS cap covers 1 of 3 senders** (`claimDailyPrescreenSmsSlot` only in
   the reminders cron; the auto-invite + first-touch senders bypass it) and
   `autoScheduledInterviewInvite` re-anchors the 5-day cadence
   unconditionally, bypassing `shouldStampNewCadenceStart`.
7. **Stored question text ≠ shown question text** — `prescreenQuestionLabels`
   drifted from the client copy on ≥7 questions, and stores English-only
   labels against Spanish answers.
8. **Dead/contradictory code**: 658-line client scorer copy used only for a
   type import; unreachable MAX_QUALITY_PENALTY; unemitted enum members
   with shipped display strings; `walk_bike` scored 0 by one module and
   "strong transport" by another; default compliance risk 0.48 puts
   never-asked candidates in the moderate no-show band by construction;
   silent orchestrator failure falls back to stale legacy decisions.
9. **No save/resume** — answers live in React state only; closing the tab at
   step 15/16 loses everything (the answer bank softens repeat pain but not
   first-run abandonment).

## 2026-08-29 same-day execution (commits 5ba41f20, ac424dd4)

Items 3-7 of the ranked list SHIPPED hours after the review:
- **Bilingual Claude rubric** (`claudeNarrativeQuality.ts`, claude-sonnet-5,
  8s race, kill switch `PRESCREEN_LLM_QUALITY=off`) is now the primary
  answer-quality judge; regex is the fallback. Smoke-proven: identical
  strong Spanish answers went from all-low + `vague_response` (regex) to
  experience/communication high, +9 (rubric), 2.9s. `ai.answerQualitySource`
  stamps provenance.
- **`ai.overallScore` = post-override score** (matches letterGrade/
  recommendation); base stays in `baseInterviewScore`.
- **Daily prescreen-SMS slot shared across all three senders** + the
  auto-invite's cadence anchor now gated by `shouldStampNewCadenceStart`.
- **Truth-sweep** of the seven LLM-claiming comments + the stale
  AI-provider doc.
- **Test infra fixed** (`functions/jest.config.js`, ts-jest — the suite
  was unrunnable) + 11 decision-ladder tests green.
Still open from the list: save/resume for first-run interviews, dead-code
sweep (client scorer copy, unemitted enums, walk_bike inconsistency,
0.48 default compliance risk), stored-vs-shown question label drift.

## Recommendation (for Greg/Mark to prioritize)

Keep the deterministic core (auditable, free, fast) but make it honest and
fair: (a) truth-sweep the docs/comments (rules, not LLM); (b) replace the
English regex quality layer with ONE bilingual Claude call per interview
(rubric-scored narrative quality — fixes the Spanish penalty at the root,
~$0.01-0.03/interview on Sonnet); (c) unify overallScore semantics;
(d) tests for the decision ladder before any threshold tuning; (e) extend
the daily SMS cap to all three senders. The conversational-AI interview
(voice, adaptive follow-ups) is a separate product decision — the current
system is a form wizard and works as one.

Related: [[project_prescreen_cumulative_interview]],
[[feature_interview_sms_cadence]], [[project_llm_provider_claude]],
[[project_signup_flow_review]] (interview entry points),
[[project_tiered_shift_access]] (scores as access ordering).
