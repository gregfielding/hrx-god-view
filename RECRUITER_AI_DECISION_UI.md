# RECRUITER_AI_DECISION_UI.md

## Purpose

Define the recruiter-facing UI for AI interview results and AI hiring decisions.

This UI should help recruiters quickly understand:
- how the worker scored
- what the AI recommendation is
- what the hiring decision engine decided
- why that decision was reached
- whether the worker is eligible for future automation

This document is intentionally focused on visibility and trust, not automation.

---

# Core Principle

The recruiter UI should make AI output:
- easy to scan
- easy to trust
- easy to override mentally
- clearly separated into:
  1. interview score
  2. hiring decision
  3. reason codes / flags

The recruiter should never feel like:
- the system is hiding logic
- AI made a silent decision
- “hold” vs “review” are ambiguous

---

# UI Goals

1. Show the latest AI pre-screen result clearly
2. Show the final AI hiring decision separately from raw score
3. Show reason codes in plain English
4. Show gig-path eligibility when relevant
5. Keep the current Interview tab as the primary surface
6. Avoid creating a totally separate recruiter workflow in v1

---

# Primary Surface

## Interview Tab

Primary recruiter surface:
src/pages/UserProfile/components/InterviewTab.tsx

This is the best first place to show the AI decision because:
- interview data is already there
- recruiters already use it
- it avoids new workflow sprawl

---

# UI Layout

## 1. Latest AI Pre-Screen Summary Card

At the top of InterviewTab, when the latest interview is:
- interviewKind = worker_ai_prescreen

Render a summary card.

### Suggested sections

#### Header
- Title: AI pre-screen
- Source chip: Worker AI
- Optional application/job chip if applicationId exists

#### Score row
- Overall score: 82 / 100
- Score10: 8 / 10
- Recommendation chip:
  - Proceed
  - Review
  - Decline

#### Decision row
Show a separate chip/block for the decision engine:
- Advance
- Review
- Hold
- Reject

These should NOT be visually merged with the score recommendation.

#### Explanation row
Plain-English explanation like:
- “Strong score and no blocking issues. Candidate may be moved forward.”
- “Candidate scored well, but job-specific answers suggest this role may not fit.”
- “Candidate should be reviewed before moving forward.”

#### Reason chips
Show standardized reason chips:
- Passed all checks
- Moderate flags present
- Failed score threshold
- Failed job requirement
- Capacity reached
- Onboarding throttled
- Gig path eligible

#### Flags block
If flags exist, show them in a compact warning section:
- Attendance risk
- Transportation risk
- No backup transportation
- Drug risk
- Background risk
- Physical mismatch
- Limited relevant experience

#### Dynamic fit block
If dynamic answers exist, show a short list of any meaningful negatives:
- Cannot reliably make shift start
- Commute may be an issue
- Physical job fit concern

#### Alternate paths
If gig_path_eligible exists:
- show a highlighted note:
  - “Open to gig fallback path”

---

# 2. Interview History Table

In the existing history table, add or confirm these columns:
- Date
- Source
- Score
- Recommendation
- Decision
- Flags / Notes (compact)

### Suggested values

#### Source
- Worker AI
- Recruiter

#### Recommendation
From scoring:
- Proceed
- Review
- Decline

#### Decision
From decision engine:
- Advance
- Review
- Hold
- Reject

This distinction matters.

---

# 3. Interview Detail Dialog

Inside the detail dialog for a worker AI pre-screen, add an AI Hiring Decision block above or near the existing AI assessment block.

## Suggested order

1. Source / metadata
2. AI pre-screen score block
3. AI hiring decision block
4. Dynamic fit / alternate path block
5. Q&A transcript

---

# AI Hiring Decision Block

Show:

## Decision
- Advance / Review / Hold / Reject

## Eligible for Auto-Advance
Display as:
- Yes
- No

But only as an informational field for now.

Suggested helper text:
- “Automation is not enabled yet” or
- “This does not trigger onboarding automatically in v1”

## Reason Codes
Map codes to human-readable labels.

### Recommended mapping

| Code | Label |
|---|---|
| passed_all_checks | Passed all checks |
| failed_score_threshold | Score below threshold |
| moderate_flags_present | Moderate concerns require review |
| failed_job_requirement | Job-specific requirement issue |
| capacity_reached | Hiring target already met |
| onboarding_throttled | Onboarding limit reached |
| gig_path_eligible | Eligible for gig fallback |
| critical_flag_drug | Drug-screen concern |
| critical_flag_background | Background concern |
| critical_flag_physical | Physical requirement concern |

## Dynamic answer summary
When relevant, show a short summary:
- Shift punctuality: Yes / No / Not sure
- Worksite commute: Yes / No / Not sure
- Physical job fit: Yes / No / Not sure
- Gig path willingness: Yes / No / Not sure

Do not dump raw dynamic question IDs directly in the UI.

---

# Color / Status Semantics

Use consistent color language:

## Recommendation (score-based)
- Proceed → success
- Review → warning
- Decline → error

## Decision (decision-engine-based)
- Advance → success
- Review → warning
- Hold → neutral or warning
- Reject → error

Important:
- “Hold” should not look identical to “Reject”
- “Review” should not look identical to “Hold”

Recommended:
- Advance = green
- Review = amber
- Hold = blue-gray or outlined warning-neutral
- Reject = red

---

# Plain-English Helper Copy

Recruiters should understand the difference between score and decision.

### Example helper copy
- “Recommendation reflects the worker’s interview score.”
- “Decision reflects score + job-specific answers + hiring rules.”

This can be a small caption beneath the decision area.

---

# v1 Integration Rules

## Do show
- score
- recommendation
- decision
- reason codes
- flags
- alternate path eligibility
- eligibleForAutoAdvance (read-only)

## Do NOT show yet
- actual automation actions firing
- onboarding triggers
- silent auto-move behavior
- editable AI decision rules in recruiter UI

---

# Data Shape Expected

The UI should read from the stored interview document under:
users/{uid}/interviews/{id}

### Existing / expected fields

```ts
{
  interviewKind: 'worker_ai_prescreen',
  score10: number,
  ai: {
    overallScore: number,
    recommendation: 'proceed' | 'review' | 'decline',
    flags: string[],
    summary: string,
    subScores: {
      experience: number,
      reliability: number,
      transportation: number,
      risk: number,
      physical: number,
    },
    model: string,
    computedAt: Timestamp,

    assignmentReadiness?: {
      status: 'ready' | 'review' | 'blocked',
      reasons: string[],
    },

    alternatePaths?: {
      gigEligible?: boolean,
    },

    hiringDecision?: {
      decision: 'advance' | 'review' | 'hold' | 'reject',
      eligibleForAutoAdvance: boolean,
      reasonCodes: string[],
    },
  }
}
```

If hiringDecision is not yet written into the interview document, v1 UI may:
- compute it inline from available data if that is already happening elsewhere
- or defer rendering until integrated

Preferred long-term pattern:
- store hiringDecision on the interview doc after evaluation

---

# Recommended Integration Path

## Step 1
Add decision display to InterviewTab summary card

## Step 2
Add decision column to history table

## Step 3
Add decision block to detail dialog

## Step 4
Add human-readable mappings for reason codes and dynamic answers

This keeps the rollout incremental.

---

# UX Risks to Avoid

## 1. Merging recommendation and decision
Bad:
- one chip for both

Good:
- separate labels:
  - Score recommendation
  - Hiring decision

## 2. Hiding reason codes
Recruiters will distrust the system if they only see:
- Advance
- Hold
- Reject

They need to know why.

## 3. Making “hold” look like “reject”
Hold means:
- not right for this exact path
- maybe still useful

Reject means:
- stronger no-go outcome

Keep them visually distinct.

## 4. Showing raw internal codes only
Always map to human labels first.

---

# Suggested File Targets

Primary likely files:
- src/pages/UserProfile/components/InterviewTab.tsx
- src/types/workerAiPrescreenInterview.ts

Optional helper:
- src/utils/workerAiHiringDecisionDisplay.ts

That helper can centralize:
- reason code label mapping
- decision badge color mapping
- dynamic-answer display mapping

---

# Example Recruiter Experience

## Candidate A
- Score: 82
- Recommendation: Proceed
- Decision: Advance
- Reasons: Passed all checks
- Auto-advance eligible: No (automation off)

Recruiter interpretation:
- Good candidate; move forward confidently

## Candidate B
- Score: 78
- Recommendation: Proceed
- Decision: Hold
- Reasons: Failed job requirement, Gig path eligible
- Dynamic answers: commute = no, gig path = yes

Recruiter interpretation:
- Not right for this exact job, but viable for gig fallback

## Candidate C
- Score: 61
- Recommendation: Review
- Decision: Review
- Reasons: Moderate concerns require review
- Flags: attendance risk, no backup transportation

Recruiter interpretation:
- Needs human judgment before moving ahead

---

# Non-Goals

This doc does NOT include:
- recruiter override actions
- automation controls
- queue prioritization UI
- pipeline movement UI
- bulk decision workflows

Those can come later.

---

# Instructions for Cursor

Implement the smallest clean v1 UI:

1. InterviewTab summary card
2. Decision column in history table
3. Decision block in detail dialog
4. Helper mapping for reason codes and decision labels

Do not redesign the whole recruiter app.

Return:
A. files changed
B. final UI layout used
C. mapping helpers added
D. any data-shape assumptions
E. tsc/build result
