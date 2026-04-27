# AI Hiring Policy Container Architecture

## Purpose

Define a scalable, flexible architecture for AI-driven hiring that separates:

1. Worker-facing job context
2. Interview logic
3. Hiring decisions and automation

This prevents brittle logic and allows safe iteration of hiring strategies without rebuilding infrastructure.

---

# Core Principle

**Do NOT store all hiring logic on the job posting.**

Instead, split responsibilities across:

- Job Posting → "What is the job?"
- Hiring Container (Job Order or Group) → "How aggressively should we hire?"
- Tenant → "What are the defaults?"

---

# System Layers

## Layer A — Job Posting (Worker-Facing + Interview Context)

**Firestore:**

```
tenants/{tenantId}/job_postings/{jobId}
```

### Responsibilities

Defines:

- Job description
- Worker-facing requirements
- Interview context (what questions to ask)

### Fields

```
aiPrescreen: {
  enabled: boolean
  questions: {
    askShiftConfirmation: boolean
    askLocationConfirmation: boolean
    askDrugScreenConfirmation: boolean
    askBackgroundConfirmation: boolean
    askCertificationConfirmation: boolean
    askUniformConfirmation: boolean
    allowGigFallbackQuestion: boolean
  }
}
```

### Notes

- Always used to generate interview questions
- May be enriched by job order if linked
- Never responsible for hiring quotas or automation

---

## Layer B — Hiring Container (Decision Engine)

A **Hiring Container** is the source of truth for hiring decisions.

It can be either:

- Job Order (specific job)
- Group (labor pool)

---

## Option 1 — Job Order (Direct Hire)

**Firestore:**

```
tenants/{tenantId}/job_orders/{jobOrderId}
```

### Responsibilities

- Exact hiring need
- Shift-level requirements
- Worksite details
- Hiring volume + thresholds

### Fields

```
aiHiring: {
  autoAdvanceEnabled: boolean
  minimumScoreToAdvance: number        // e.g. 75
  maximumAutoAdvances: number          // throttle
  targetReadyCount: number             // fully onboarded target
  targetOnboardingCount: number        // in-progress target
  stopWhenTargetReached: boolean
  allowGigFallback: boolean
}
```

### Data Visibility

AI can access:

- company
- worksite address
- shift times
- workers needed
- applicants
- onboarding status

---

## Option 2 — Group (Labor Pool)

**Firestore:**

```
tenants/{tenantId}/groups/{groupId}
```

### Responsibilities

- Pool-based hiring strategy
- Target workforce size
- Default job assumptions

### Fields

```
aiHiring: {
  autoAdvanceEnabled: boolean
  minimumScoreToAdvance: number
  targetReadyCount: number
  targetOnboardingCount: number
  topPercentToAdvance: number          // optional (e.g. 50)
  allowGigFallback: boolean
  defaultCompany: string
  defaultWorksite: {
    city: string
    state: string
    address?: string
  }
}
```

### Behavior

Used when:

- Job posting is NOT linked to a job order
- Posting auto-adds workers to a group

---

## Layer C — Tenant Defaults

**Firestore:**

```
tenants/{tenantId}
```

### Responsibilities

Fallback behavior when neither posting nor container defines rules

### Fields

```
aiPrescreen: {
  eligibility: {
    requireResumeOrSkill: boolean
    requirePhone: boolean
    requireLocation: boolean
    requireWorkAuthorization: boolean
  }
}

aiHiring: {
  minimumScoreToAdvance: number
  allowGigFallback: boolean
}
```

---

# Resolution Logic

## Step 1 — Determine Hiring Container

```
if (application.jobOrderId exists):
    container = jobOrder
else if (posting.autoAddToGroup):
    container = group
else:
    container = null (manual path)
```

---

## Step 2 — Build Interview Context

Sources:

1. Job Posting (primary)
2. Job Order (optional enrichment)
3. Tenant defaults

---

## Step 3 — Run AI Interview

Inputs:

- Core questions (fixed)
- Dynamic questions (posting + container context)

Output:

- overallScore (0–100)
- flags[]
- recommendation (proceed / review / decline)
- dynamic answers

---

## Step 4 — Hiring Decision (NO automation yet)

Decision logic should use:

```
score
+ flags
+ dynamic answers
+ container.aiHiring rules
```

Example:

```
if score >= minimumScoreToAdvance
AND no critical flags:
    recommendation = "advance"
else:
    recommendation = "review"
```

---

# Future (NOT IMPLEMENTED YET)

## Stage 5 — Automation

Will later include:

- Trigger onboarding pipeline
- Send payroll invite
- Order background check
- Order drug screen
- Request I-9 documents

Controlled by:

```
aiHiring.autoAdvanceEnabled
```

---

# Key Design Rules

## 1. Posting ≠ Hiring Policy

Posting controls:

- what we ask
- what worker sees

NOT:

- who gets hired
- how many
- when to stop

---

## 2. Hiring Container Owns Decisions

- Job Order → structured hiring
- Group → pooled hiring

---

## 3. No Assignment Assumptions in Prescreen

Do NOT use:

- assignments
- entity_employments
- onboarding pipelines
- readinessSnapshotV1

Prescreen operates **only on:**

- worker profile
- application
- posting
- optional job order

---

## 4. Keep Defaults Stable

If no config is present:

- behavior must match current system

---

# Example Scenarios

## Scenario A — Job Order (CORT Dallas)

- Need 25 workers
- 10 onboarded
- 5 onboarding

AI decision:

- advance top candidates until onboarding target reached

---

## Scenario B — Group-Based Hiring

- Target: 30 workers
- Current: 12 onboarded
- 9 in progress

AI decision:

- advance highest-scoring candidates
- stop when target reached

---

## Scenario C — Low Data Applicant

AI decision:

- do NOT interview
- send "complete profile" message

---

# Summary

This architecture enables:

- Flexible hiring strategies
- Safe experimentation
- Clear separation of concerns
- Scalable automation later

---

# Instructions for Cursor

Implement as follows:

1. Add config support (no behavior change)
2. Wire resolution logic (posting → container → tenant)
3. Keep defaults identical to current system
4. Do NOT implement automation yet

Return:

A. Files changed  
B. Final config shapes  
C. Resolution logic implemented  
D. Default behavior verification  
E. tsc/build result  
