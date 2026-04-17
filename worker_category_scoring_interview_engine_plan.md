# Worker Category Scoring + Dynamic Interview Engine Implementation Plan

## Purpose

This document defines the implementation plan to move the worker interview and worker-intelligence system from a single prescreen score into a category-based scoring model that is:

- durable across time
- fed by interviews and real-world worker behavior
- useful to recruiters and automation
- dynamic without becoming un-auditable or unstable

It also folds in the next-generation interview architecture goals:
- more conversational
- higher completion rates
- more useful worker data
- reusable for micro-interviews and later workforce intelligence flows

This plan is intentionally structured so it can be implemented in phases without breaking the current prescreen/hiring flow.

---

## North Star

We are building a worker scoring and interview system where:

1. **Each worker has durable category scores**
2. **Interview answers contribute to those scores**
3. **Real-world behavior also contributes to those scores**
4. **Score updates are controlled, auditable, and bounded**
5. **The interview engine becomes adaptive, reusable, and conversational**
6. **Recruiters and automation can act on category scores directly**

---

## Core Category Model

We will officially move to six category scores.

### 1. Reliability
Definition:
- Shows up
- Follows through
- Communicates issues
- Can be counted on

### 2. Punctuality
Definition:
- Arrives on time
- Plans ahead
- Handles timing/logistics well

### 3. Work Ethic
Definition:
- Effort
- Willingness to work hard
- Persistence under pressure
- Takes direction seriously

### 4. Team Fit
Definition:
- Respect
- Coachability
- Ability to work with others
- Professional attitude

### 5. Job Readiness
Definition:
- Experience
- Skills
- Profile completeness
- Physical fit
- Operational readiness for specific work

### 6. Stability
Definition:
- Consistency over time
- Reduced churn risk
- Maintains employment continuity
- Builds trust through repeated completion of work/onboarding/compliance tasks

---

## Design Principles

### 1. Category scores must be explainable
Every score should have:
- sources
- contributing events
- recent changes
- confidence / evidence history

No opaque “black box” final score without traceability.

### 2. Interview answers are not the only signal
Interview answers are the starting estimate.
Behavior is the truth.

### 3. Dynamic scoring must be bounded
No infinite loops.
No runaway self-triggering writes.
No repeated score inflation from the same event.

### 4. Score updates must be idempotent
Each scoring event should be processed once per event type / event id / worker id.

### 5. Recruiters must understand the outputs
Category scores should be human-usable and visible enough to influence decisions.

### 6. Existing prescreen flow should not be broken
We should layer category scoring into the current architecture before replacing the old overall score model.

---

## High-Level System Architecture

We will separate the system into four layers:

### Layer A — Interview Engine
Collects structured and open-ended answers.

### Layer B — Category Scoring Engine
Maps interview answers and behavioral events into category score changes.

### Layer C — Worker Score Ledger / Event Processor
Stores scored events and updates durable worker category scores.

### Layer D — Decision + Automation Consumers
Uses worker category scores for:
- hiring decisions
- matching
- search/filtering
- outreach segmentation
- readiness / risk logic

---

## Proposed Data Model

## 1. Durable worker category scores
Recommended location:

`users/{uid}.workerScores`

### Example shape

```ts
workerScores: {
  overall?: number
  reliability: {
    score: number
    confidence: number
    updatedAt: Timestamp
    sourceSummary?: string[]
  }
  punctuality: {
    score: number
    confidence: number
    updatedAt: Timestamp
    sourceSummary?: string[]
  }
  workEthic: {
    score: number
    confidence: number
    updatedAt: Timestamp
    sourceSummary?: string[]
  }
  teamFit: {
    score: number
    confidence: number
    updatedAt: Timestamp
    sourceSummary?: string[]
  }
  jobReadiness: {
    score: number
    confidence: number
    updatedAt: Timestamp
    sourceSummary?: string[]
  }
  stability: {
    score: number
    confidence: number
    updatedAt: Timestamp
    sourceSummary?: string[]
  }
  version: 1
}
```

Notes:
- `overall` can remain optional at first
- confidence should represent confidence in the category score, not worker confidence
- sourceSummary can be short human-readable tags only

---

## 2. Score event ledger
Recommended new collection:

`tenants/{tenantId}/worker_score_events/{eventId}`

### Purpose
This is the bounded, auditable source of truth for score changes.

### Example shape

```ts
{
  tenantId: string
  userId: string
  applicationId?: string | null
  interviewId?: string | null
  assignmentId?: string | null
  shiftId?: string | null

  eventType: string
  eventSource: 'interview' | 'onboarding' | 'assignment' | 'shift' | 'background_check' | 'payroll' | 'manual' | 'micro_interview'
  eventKey: string // idempotency key

  categoryDeltas: {
    reliability?: number
    punctuality?: number
    workEthic?: number
    teamFit?: number
    jobReadiness?: number
    stability?: number
  }

  evidence: Record<string, unknown>
  processedAt: Timestamp
  createdAt: Timestamp
  version: 1
}
```

### Why a ledger matters
Without this, you risk:
- loops
- repeated score application
- impossible debugging
- unstable worker reputation math

---

## 3. Category score snapshots on interview docs
Add category score outputs to:

`users/{uid}/interviews/{interviewId}.ai.categoryScores`

### Example

```ts
ai: {
  overallScore: number
  recommendation: 'proceed' | 'review' | 'decline'
  categoryScores: {
    reliability: number
    punctuality: number
    workEthic: number
    teamFit: number
    jobReadiness: number
    stability: number
  }
  categoryEvidence?: {
    reliability: string[]
    punctuality: string[]
    workEthic: string[]
    teamFit: string[]
    jobReadiness: string[]
    stability: string[]
  }
}
```

This is the **interview-derived snapshot**, not necessarily the final durable worker score.

---

## 4. Optional category score snapshot on application
Recommended:
store the same interview-time category snapshot on the application under `aiAutomation`.

This helps recruiters and automation avoid extra joins when evaluating one application.

---

## Category Scoring Inputs

We should support three families of scoring inputs.

## A. Interview-derived scoring
Based on:
- structured answers
- opening preference data
- dynamic prescreen steps
- open-ended answer interpretation
- answer quality and follow-ups

This produces:
- interview category snapshot
- initial hiring recommendation
- input to durable score ledger

## B. Profile-completeness and readiness events
Examples:
- verified phone
- geocoded home address
- resume uploaded
- skills added
- background check completed
- onboarding completed
- payroll onboarding completed

These should primarily affect:
- jobReadiness
- responsibility / reliability
- stability

## C. Real-world behavior and work history events
Examples:
- showed up for first shift
- late arrival
- no-show
- accepted and completed shifts repeatedly
- positive post-shift feedback
- negative client feedback
- repeated assignment completion

These should become the strongest long-term signals.

---

## Initial Scoring Source Map by Category

## Reliability
Signals:
- attendance history answers
- transportation plan quality
- background check completion
- onboarding completion
- accepted shift completion
- no-shows / callouts
- communication actions

## Punctuality
Signals:
- shift punctuality dynamic step
- commute realism
- transportation backup
- actual on-time shift records
- pre-shift readiness confirmation

## Work Ethic
Signals:
- pressure_situation narrative
- motivation
- supervisor_feedback
- completion of assigned tasks / repeated shifts
- manager/client feedback later

## Team Fit
Signals:
- supervisor_feedback narrative
- teamwork/conflict prompts later
- post-shift worker/client fit data
- professionalism signals

## Job Readiness
Signals:
- relevant experience
- work confidence
- skills
- profile completeness
- physical fit
- required docs or certifications
- geocoded address
- phone verification

## Stability
Signals:
- completed onboarding
- completed payroll setup
- consistent engagement over time
- repeated work completion
- low churn / return patterns
- maintained availability

---

## Important Event Example

Example from your note:

> background check ordered on Monday and completed by Tuesday should improve responsibility score

Yes — but frame it carefully:
- the **ordering** itself should not improve score automatically
- the **completion** of the background check can increase:
  - jobReadiness
  - reliability
  - stability

Suggested event:
`background_check_completed`

Suggested deltas:
- reliability: +2 to +4
- jobReadiness: +4 to +8
- stability: +1 to +3

Final weights should be tuned later.

---

## Guardrails to Prevent Loops / Runaway Functions

This is critical.

### 1. Every score event needs an idempotency key
Example:

`bgcheck_completed:{backgroundCheckId}`

or

`shift_completed:{assignmentId}:{shiftId}`

### 2. Score changes should be applied by one processor only
Do not let every feature mutate `users/{uid}.workerScores` directly.

Preferred pattern:
- feature emits score event
- score processor consumes event
- score processor updates durable scores

### 3. Use bounded deltas
No event should be allowed to move a score infinitely.
Define per-event maximums.

### 4. Distinguish snapshot scores from durable scores
Interview score snapshot ≠ durable worker score.
Interview score contributes to durable score, but is not the whole thing.

### 5. No recursive event emission from worker score writes
Updating `users/{uid}.workerScores` must not itself emit more score events.

---

## Implementation Phases

# Phase 1 — Introduce category scoring inside the current interview
Goal:
Add category score outputs to the existing worker AI prescreen without breaking current overall scoring.

### Work
1. Define category schema and constants
2. Map existing prescreen questions to categories
3. Interpret open-ended answers into category evidence
4. Produce interview-time category snapshots
5. Write category scores onto:
   - interview doc
   - application aiAutomation snapshot
6. Keep existing overall score + recommendation active

### Notes
This phase is additive, not replacement.

---

# Phase 2 — Introduce durable worker category scores
Goal:
Create persistent worker-level category scores and update them from interviews.

### Work
1. Add `users/{uid}.workerScores`
2. Create `worker_score_events`
3. Add interview submit → emits one score event
4. Create worker score processor
5. Process interview snapshot into durable worker scores

### Notes
At first, only interview-driven score events need to be supported.

---

# Phase 3 — Add non-interview score events
Goal:
Allow behavior and milestone events to update durable category scores.

### First candidate event types
- `phone_verified`
- `address_geocoded`
- `resume_uploaded`
- `background_check_completed`
- `payroll_onboarding_completed`
- `onboarding_completed`
- `first_shift_completed`
- `shift_no_show`
- `shift_late`
- `positive_post_shift_feedback`
- `negative_post_shift_feedback`

### Work
1. Define event type catalog
2. Define category delta rules
3. Emit events from existing workflows
4. Update durable worker scores through event processor

---

# Phase 4 — Update interview engine to the new architecture
Goal:
Make the interview more conversational, more adaptive, and aligned with category scoring.

---

## Conversational / completion improvements to incorporate

### 1. Reduce essay pressure early
Implementation direction:
- lower the early substantive word burden
- use lighter warm-up wording
- reserve the deepest narrative prompts for after the worker has momentum

### 2. Move one practical/job-fit block earlier
Implementation direction:
- bring shift / commute / job-fit relevance earlier in the interview
- make the interview feel tied to real work faster

### 3. Add section framing + reflection
Implementation direction:
- add short section headers
- reflect back worker choices
- tell them what the next section is for

Examples:
- “You’re interested in Industrial and Hospitality work.”
- “Next, a few quick questions about your experience.”
- “Last section — just making sure we can match you to nearby jobs.”

### 4. Make the Strengthen Panel feel optional and helpful
Implementation direction:
- show only highest-value items first
- do not dump all rescue flows at once
- present as profile boost, not surprise extra work

### 5. Align copy with actual effort
Implementation direction:
- stop overpromising “2-minute interview” if untrue
- use more honest duration framing

---

# Phase 5 — Add better data collection fields
Goal:
Add 3–5 more high-value durable worker data points.

Recommended additions:

## 1. Shift timing / daypart preference
Suggested field:
`workerProfile.preferences.shiftAvailabilityPreferences`

## 2. Commute tolerance / travel radius
Suggested field:
`workerProfile.preferences.maxCommutePreference`
`workerProfile.preferences.transportationMode`

## 3. Preferred work environment
Suggested field:
`workerProfile.preferences.preferredWorkEnvironments`

## 4. Employment path intent
Suggested field:
`workerProfile.preferences.employmentPathPreference`
Examples:
- gig
- temp_to_hire
- long_term
- open_to_any

## 5. Optional future: pay band preference
Suggested field:
`workerProfile.preferences.targetPayBand`

---

# Phase 6 — Introduce micro-interviews
Goal:
Reuse the interview template system for smaller worker conversations.

## Recommended first micro-interviews

### A. Pre-shift readiness
Purpose:
Reduce no-shows and confusion before first shift

Questions:
- Are you still available?
- Do you know where to go?
- Do you have the right uniform?
- Do you need help?

Outputs:
- ready
- at risk
- needs help

Likely score impacts:
- reliability
- punctuality
- jobReadiness

### B. Post-shift feedback
Purpose:
Learn about client / worksite quality and worker fit

Questions:
- Did the shift match the description?
- Were you treated professionally?
- Would you return?
- Anything we should know?

Outputs:
- worker satisfaction
- site quality
- client intelligence
- returnability

Likely score impacts:
- teamFit
- stability
- client/site intelligence rather than immediate worker score in some cases

### C. Worker re-engagement / profile refresh
Purpose:
Refresh stale profiles and reactivate talent

Questions:
- Are you still open to gig work?
- Are your schedule preferences still current?
- Have you gained new skills?
- Are you open to temp-to-hire?

Outputs:
- refreshed profile
- better segmentation
- stronger outreach

---

## Micro-interview architecture recommendation

Use the same interview collection:
`users/{uid}/interviews/{interviewId}`

But distinguish by:
- `interviewKind`
- `templateKey`

Examples:
- `worker_ai_prescreen`
- `worker_pre_shift_readiness`
- `worker_post_shift_feedback`
- `worker_profile_refresh`

Do not reuse prescreen scoring/hiring logic blindly.
Each interviewKind should have its own downstream handler.

---

## Proposed Technical Workstreams

## Workstream 1 — Category scoring model
- define category constants
- define category score schema
- define score evidence model

## Workstream 2 — Interview scoring map
- map existing questions to categories
- preserve current overall score temporarily
- add category snapshots to interview/app

## Workstream 3 — Score event ledger
- create worker score event collection
- create processor
- add idempotency and delta rules

## Workstream 4 — Conversational interview upgrades
- copy and section framing
- reorder selected steps
- reduce fatigue
- improve strengthen panel UX

## Workstream 5 — Durable worker data enrichment
- add shift timing
- commute tolerance
- work environment
- employment path preference

## Workstream 6 — Micro-interviews
- create first template kind
- add first short submit path
- define score/non-score effects

---

## Risks and Design Watchouts

### 1. Do not let micro-interviews contaminate prescreen averages
Current interview summary logic may aggregate all non-archived interviews.
This must be made category/interviewKind-aware.

### 2. Do not let every workflow mutate worker scores directly
Use score events + a processor.

### 3. Do not overfit category scoring too early
Start with stable mappings and modest deltas.

### 4. Do not let conversational improvements explode interview length
The goal is more relevant, not much longer.

### 5. Do not overcomplicate taxonomy in v1
Keep fields practical and operational.

---

## Suggested Rollout Order

### Step 1
Add category score schema and category snapshots to the existing prescreen interview

### Step 2
Create durable worker category scores and interview-based score event processing

### Step 3
Add the 5 conversational/completion improvements to the current interview UX

### Step 4
Add the next 3–5 durable worker preference fields

### Step 5
Emit a small number of non-interview score events
Start with:
- background_check_completed
- payroll_onboarding_completed
- onboarding_completed
- first_shift_completed
- shift_no_show

### Step 6
Implement pre-shift readiness micro-interview

### Step 7
Implement post-shift feedback micro-interview

---

## Success Criteria

We should consider this initiative successful when:

1. Recruiters can see and use category scores
2. Interview completion improves
3. Worker profiles become richer and more useful
4. Hiring decisions become more explainable
5. Real-world behavior updates worker scores over time
6. Pre-shift readiness reduces no-shows
7. Post-shift feedback creates reusable client/worksite intelligence

---

## Final Recommendation

Do not try to replace the whole current prescreen system at once.

The right move is:

1. **Add category scoring alongside the current score**
2. **Introduce a score ledger and durable worker category scores**
3. **Improve the interview experience with lighter, smarter, more conversational structure**
4. **Then reuse the template system for micro-interviews**

That gives you a strong, defensible worker-intelligence architecture without breaking the existing hiring workflow.
