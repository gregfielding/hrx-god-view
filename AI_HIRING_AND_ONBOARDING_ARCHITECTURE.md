# AI_HIRING_AND_ONBOARDING_ARCHITECTURE.md

## Purpose

Define the full AI-driven hiring and onboarding system for C1 / HRX, including:
- application-driven interview flow
- context-aware AI interview
- scoring and decisioning
- automated onboarding actions

This system is fully built once, but includes 3 flexible control layers:
1. Interview Eligibility Rules
2. Interview Question Rules
3. Interview Outcome Automation Rules

---

# SYSTEM OVERVIEW

## Stage 1 — Application
Worker applies to a job posting.

Creates:
- users/{uid}
- tenants/{tenantId}/applications/{applicationId}

Key linkage:
- application.jobId → job_posting
- optional application.jobOrderId

---

## Stage 2 — Interview Eligibility Decision (Delayed ~1 hour)

Evaluate:

### Inputs
- application exists
- worker profile completeness
- resume OR work history
- phone/contact readiness
- location readiness
- work authorization baseline

### Outputs
- eligible_for_interview
- complete_profile_first
- skip_interview

---

## Stage 3 — Interview

### Core Questions (fixed)
- motivation
- experience
- confidence
- attendance
- transportation
- physical comfort
- compliance disclosure
- supervisor feedback

### Dynamic Questions (context-driven)

Based on:
- job posting
- optional job order
- tenant rules

Modules:
- shift confirmation
- location confirmation
- drug screen confirmation
- background check confirmation
- physical requirements
- certifications
- uniform/PPE
- gig fallback (CORT)

---

## Stage 4 — Scoring

### Outputs
- overallScore (0–100)
- score10 (0–10)
- flags
- recommendation: proceed | review | decline

### Additional outputs
- assignmentFit (lightweight)
- alternatePaths.gigEligible

---

## Stage 5 — Decision Engine

Inputs:
- score
- flags
- recommendation
- dynamic answers
- posting rules
- tenant rules

Outputs:
- recruiter review
- auto-onboard
- gig routing
- hold

---

## Stage 6 — Onboarding Actions

Triggered automatically when allowed:

- payroll invite
- background check order
- drug screen order
- I-9 request
- onboarding pipeline start

---

# FLEXIBLE CONTROL LAYERS

## 1. Interview Eligibility Rules

aiPrescreenEligibility:
- enabled
- requireApplication
- requireResumeOrSkill (legacy Firestore key `requireResumeOrWorkHistory` still read)
- requirePhone
- requireLocation
- requireWorkAuthorizationBaseline

---

## 2. Interview Question Rules

aiPrescreenQuestions:
- askShiftConfirmation
- askLocationConfirmation
- askDrugScreenConfirmation
- askBackgroundConfirmation
- askPhysicalConfirmation
- askCertificationConfirmation
- askUniformConfirmation
- allowGigFallbackQuestion

---

## 3. Automation Outcome Rules

aiPrescreenAutomation:
- minimumScoreToProceed
- minimumScoreToAutoOnboard
- autoOnboardEnabled
- autoOrderBackgroundCheck
- autoOrderDrugScreen
- autoSendPayrollInvite
- autoRequestI9Documents
- allowGigFallbackRouting
- requireNoMajorFlagsForAutomation

---

# CONTEXT RESOLUTION

Prescreen uses:

1. worker (users/{uid})
2. application (applications/{id})
3. job posting (job_postings/{jobId})
4. job order (optional)
5. tenant rules

DO NOT USE:
- assignment
- entity employment
- onboarding pipeline
- readinessSnapshotV1

---

# ARCHITECTURE PRINCIPLE

Separate systems:

## Prescreen Intelligence
- application + posting stage
- decides who moves forward

## Application Readiness Engine
- onboarding stage
- tracks missing requirements
- drives reminders

## Pre-Shift Readiness
- final reminders before shift

---

# WORKFLOW SUMMARY

1. Apply
2. Wait (~1h)
3. Evaluate eligibility
4. Invite interview OR request profile completion
5. Worker completes interview
6. Score + evaluate
7. Decision:
   - recruiter review
   - auto-onboard
   - gig fallback
8. Trigger onboarding actions

---

# DESIGN PRINCIPLE

Build:
- full infrastructure

Keep flexible:
- eligibility rules
- question selection
- automation outcomes

---

# END
