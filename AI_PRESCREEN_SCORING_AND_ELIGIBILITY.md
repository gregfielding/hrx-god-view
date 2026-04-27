# AI_PRESCREEN_SCORING_AND_ELIGIBILITY.md

## Purpose

This document defines the **v1 scoring logic** and **interview eligibility threshold** for the worker AI pre-screen interview.

This is intended to guide implementation of:
- backend/cloud function scoring
- interview invite eligibility logic
- recruiter review output
- worker invite vs “complete profile first” branching

This document is intentionally limited to:
1. scoring logic
2. eligibility logic

It does **not** define:
- final UI layout
- Flutter implementation details
- messaging copy details
- storage/rules implementation details beyond the required output shapes

Those should be handled in the follow-up implementation plan.

---

## Scope

This spec applies to the existing worker AI pre-screen question set:

- `motivation`
- `similar_experience`
- `experience_details`
- `work_confidence`
- `attendance_issues`
- `attendance_explanation`
- `transportation_plan`
- `backup_transportation`
- `physical_comfort`
- `drug_screen`
- `background_check`
- `supervisor_feedback`
- `additional_notes`

We are **not changing** these questions in this spec.

---

## Goals

The AI pre-screen is intended to:
- reduce recruiter first-pass interview volume
- standardize early screening
- identify obvious risk flags
- prioritize who should move forward fastest
- avoid interviewing workers whose profiles are too incomplete to evaluate well

The AI pre-screen is **not** intended to:
- fully replace recruiter judgment
- make final hiring decisions by itself
- reject workers automatically in a rigid way in v1
- evaluate personality in a deep or speculative way

---

## Core Principles

1. **Use the existing questions exactly as they are.**
2. **Use simple, rules-based scoring for v1.**
3. **Bias toward triage, not perfect prediction.**
4. **Use recruiter override and review for borderline cases.**
5. **Do not invite everyone to interview.**
6. **Only invite workers once they meet a minimum profile completeness threshold.**

---

# 1. Interview Eligibility Threshold

## Purpose

Before a worker is invited to complete the AI pre-screen, we need to decide whether their profile is complete enough to justify interviewing them.

We do **not** want to:
- ask a worker to do more work immediately after a long application
- interview applicants who provided too little information to evaluate well
- waste recruiter or system time on incomplete profiles

---

## v1 Eligibility Rule

A worker is **eligible for AI pre-screen interview invitation** if:

### Required baseline
- usable phone number is present  
- and basic location is present  

### Plus one work-history signal
At least one of:
- resume uploaded  
- or meaningful work history present  

### Plus minimum work authorization baseline
There is enough information to reasonably continue the process without obvious missing core identity/work-authorization baseline.

---

## Interpretation of each rule

### A. Usable phone number is present
“Usable” means:
- phone exists
- phone looks valid enough to contact the worker

A phone number is the minimum communication baseline for staffing operations.

### B. Basic location is present
This should include enough information to understand whether the worker is geographically placeable, such as:
- city + state
- zip
- or equivalent location baseline used elsewhere in the system

### C. Resume uploaded OR meaningful work history present
The worker should have at least one of:
- a resume file uploaded
- or work history with enough content to be useful

For v1, “meaningful work history” can be defined conservatively as:
- at least one prior role
- with employer and/or title
- and enough descriptive text or duration to not be effectively blank

### D. Minimum work authorization baseline
This should be evaluated against whatever profile/application fields already exist.
This is intentionally broad in this spec because the exact source fields may differ by surface.

The point is:
- do not invite to interview if the profile is so incomplete that the worker is clearly not ready to move forward

---

## Eligibility Output Shape

The eligibility evaluator should return:

```ts
type AiPrescreenEligibilityResult = {
  eligibleForInterview: boolean;
  reason:
    | 'eligible'
    | 'missing_contact'
    | 'missing_location'
    | 'missing_experience_signal'
    | 'missing_work_auth_baseline'
    | 'incomplete_profile';
  missingFields: string[];
};
```

### Recommended `missingFields` values
Use simple UI/message-friendly identifiers such as:
- `phone`
- `location`
- `resume_or_work_history`
- `work_authorization`

Do not overcomplicate these in v1.

---

## Eligibility Decision Rules

### Eligible
Set `eligibleForInterview = true` when:
- phone present
- location present
- and (`resume uploaded` OR `meaningful work history present`)
- and work authorization baseline is sufficient

### Not eligible
Set `eligibleForInterview = false` when any required condition is missing.

---

## Recommended v1 behavior after application

### If eligible
Do **not** force the interview immediately after application submit.

Instead:
- wait about **1 hour**
- then send an invite to complete the short AI pre-screen

### If not eligible
Also wait about **1 hour**, then send a profile-completion prompt:
- ask the worker to complete more profile details before interview
- ideally reference what is missing in a worker-friendly way

---

# 2. Scoring Logic

## Purpose

This scoring system converts the AI pre-screen answers into:
- an overall score
- sub-scores
- flags
- a recommendation
- a short recruiter-facing summary

This is **not** meant to be a black-box intelligence layer.
It is a transparent, rules-based triage system.

---

## Scoring Output Shape

```ts
type AiPrescreenScoreResult = {
  overallScore: number; // 0-100
  recommendation: 'proceed' | 'review' | 'decline';
  flags: string[];
  summary: string;
  subScores: {
    experience: number;      // 0-25
    reliability: number;     // 0-25
    transportation: number;  // 0-20
    risk: number;            // 0-20
    physical: number;        // 0-10
  };
};
```

---

## Category Weights

| Category | Max Score |
|---|---:|
| Experience | 25 |
| Reliability | 25 |
| Transportation | 20 |
| Risk / Compliance | 20 |
| Physical Fit | 10 |
| **Total** | **100** |

---

# 3. Detailed Scoring Rules

## A. Experience (0–25)

### Inputs used
- `similar_experience`
- `experience_details`
- `work_confidence`

### Rules

#### `similar_experience`
- `Yes` → +15
- `No` → +5

#### `experience_details`
- meaningful text present (recommended heuristic: trimmed length > 20 chars) → +5
- empty / missing → +0

#### `work_confidence`
Evaluate number and quality of selections:
- 2 or more concrete selections → +5
- 1 selection → +3
- empty / only vague “Other” without detail → +0

### Experience subtotal
Cap at 25.

### Suggested experience flags
- `limited_relevant_experience` if:
  - `similar_experience = No`
  - or `experience_details` is empty and `work_confidence` is weak

---

## B. Reliability (0–25)

### Inputs used
- `attendance_issues`
- `attendance_explanation`
- `supervisor_feedback`

### Rules

#### `attendance_issues`
- `No` → +20
- `Yes` → +5

#### `attendance_explanation`
If `attendance_issues = Yes`:
- reasonable explanation present (recommended heuristic: trimmed length > 10 chars) → +3
- no explanation → +0

If `attendance_issues = No`:
- no extra points needed

#### `supervisor_feedback`
If meaningful text is present:
- positive or neutral text present → +2
- empty → +0

Do not overfit sentiment analysis in v1.
Use only light heuristics if implemented at all.

### Reliability subtotal
Cap at 25.

### Suggested reliability flags
- `attendance_risk` if `attendance_issues = Yes`

---

## C. Transportation (0–20)

### Inputs used
- `transportation_plan`
- `backup_transportation`

### Rules

#### `transportation_plan`
- `My own car` → +12
- `Ride from someone else` → +8
- `Public transportation` → +6
- `Not sure yet` → +2

#### `backup_transportation`
- `Yes` → +8
- `No` → +2

### Transportation subtotal
Cap at 20.

### Suggested transportation flags
- `transportation_risk` if `transportation_plan = Not sure yet`
- `no_backup_transport` if `backup_transportation = No`

---

## D. Risk / Compliance (0–20)

### Inputs used
- `drug_screen`
- `background_check`

### Rules

#### `drug_screen`
- `No` → +10
- `Not sure` → +5
- `Yes` → +0

#### `background_check`
- `No` → +10
- `Not sure` → +5
- `Yes` → +0

### Risk subtotal
Cap at 20.

### Suggested risk flags
- `drug_risk` if `drug_screen = Yes`
- `drug_unknown` if `drug_screen = Not sure`
- `background_risk` if `background_check = Yes`
- `background_unknown` if `background_check = Not sure`

---

## E. Physical Fit (0–10)

### Inputs used
- `physical_comfort`

### Rules
- `Yes` → +10
- `No` → +0

### Suggested physical-fit flags
- `physical_mismatch` if `physical_comfort = No`

---

# 4. Overall Score Calculation

The final score is the sum of:
- experience
- reliability
- transportation
- risk
- physical

### Formula
```ts
overallScore =
  subScores.experience +
  subScores.reliability +
  subScores.transportation +
  subScores.risk +
  subScores.physical;
```

Clamp to `0–100`.

---

# 5. Recommendation Thresholds

Use only these three recommendation states in v1:

- `proceed`
- `review`
- `decline`

## Rules

### Proceed
Set `recommendation = 'proceed'` when:
- `overallScore >= 75`
- and there are no major hard-risk flags requiring recruiter judgment

### Review
Set `recommendation = 'review'` when:
- `overallScore` is between `50 and 74`
- or there are moderate concerns that should be looked at by a recruiter

### Decline
Set `recommendation = 'decline'` when:
- `overallScore < 50`
- or there are major compliance/risk concerns that make the candidate a likely poor fit for immediate movement

---

## Important v1 nuance

Even if `recommendation = 'decline'`, this should still be treated as:
- recruiter-facing triage guidance
- not a fully autonomous final hiring action

The UI and workflow should preserve recruiter judgment.

---

# 6. Major vs Moderate Flags

## Major flags
Treat these as strong caution indicators:
- `drug_risk`
- `background_risk`
- `physical_mismatch`

## Moderate flags
Treat these as caution / review indicators:
- `attendance_risk`
- `transportation_risk`
- `no_backup_transport`
- `limited_relevant_experience`
- `drug_unknown`
- `background_unknown`

---

# 7. Summary Generation

The summary should be:
- 1–2 sentences
- recruiter-facing
- plain English
- based on the strongest signals, not every detail

## Good summary examples

### Proceed
“Candidate reports relevant experience, no attendance issues, and a reliable transportation plan. No major compliance risks were identified.”

### Review
“Candidate appears generally placeable, but there are moderate concerns around transportation or prior attendance. Recruiter review is recommended.”

### Decline
“Candidate disclosed a potential compliance issue or significant fit concern that may affect placement. Review before moving forward.”

## Summary generation rules
Mention:
- strongest positive signal
- strongest risk signal
- recommendation tone

Do not:
- sound legalistic
- sound punitive
- over-explain

---

# 8. Storage Expectations

This scoring spec assumes results will be written into the existing interview document shape under:

`users/{userId}/interviews/{interviewId}`

Recommended extension:

```ts
{
  interviewKind: 'worker_ai_prescreen',
  applicationId?: string | null,
  questions: [...],
  score10: number, // mapped from overallScore / 10
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
      physical: number
    },
    model: 'rules_v1',
    computedAt: Timestamp
  }
}
```

### `score10` mapping
For compatibility with the existing interview UI/history:
```ts
score10 = Math.round(overallScore / 10)
```

---

# 9. Edge Cases

## Missing optional answers
If optional fields are missing:
- do not fail scoring
- just score conservatively

## Multi-select `work_confidence`
If stored as a string instead of string[] in some UI edge case:
- normalize to array if possible
- otherwise treat as one selection

## Blank text answers
Trim whitespace before evaluating text quality.

## Unknown enum values
If the UI ever sends an unexpected answer:
- do not throw
- score conservatively
- add a warning log if helpful

---

# 10. Logging Recommendations

At scoring time, log:
- userId
- interviewKind
- applicationId if present
- overallScore
- recommendation
- flags

Do not log full sensitive free-text answers unless needed for debugging.

---

# 11. v1 Non-Goals

This spec intentionally does **not** include:
- LLM-based personality analysis
- sentiment-heavy judgment
- automatic hiring/rejection actions
- per-client custom scoring
- job-specific scoring
- dynamic question branching

Those can come later.

---

# 12. Implementation Checklist

Use this checklist before building the callable/UI integration.

## Scoring
- [ ] exact question IDs are unchanged
- [ ] score buckets implemented exactly
- [ ] flags implemented exactly
- [ ] recommendation thresholds implemented exactly
- [ ] summary generation implemented

## Eligibility
- [ ] eligibility rule implemented
- [ ] missing fields returned clearly
- [ ] delayed invite flow can branch on eligibility

## Storage
- [ ] writes fit existing `users/{uid}/interviews/{id}` model
- [ ] `interviewKind = worker_ai_prescreen`
- [ ] `score10` mapped from `overallScore`
- [ ] `ai` block saved consistently

## Safety
- [ ] recruiter review remains possible for all outcomes
- [ ] no autonomous hard rejection flow in v1

---

# 13. Final Recommendation

For v1, this system should be treated as:

- **good enough to prioritize recruiter attention**
- **good enough to reduce screening workload**
- **not yet good enough to be the sole final decision-maker**

That is the intended operating posture.
