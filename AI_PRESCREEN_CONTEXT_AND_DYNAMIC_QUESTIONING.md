# AI_PRESCREEN_CONTEXT_AND_DYNAMIC_QUESTIONING.md

## Purpose

Define how the AI pre-screen interview becomes context-aware by incorporating:
- worker readiness
- entity onboarding requirements
- assignment/job requirements
- business logic (e.g., CORT gig vs career)

This document extends:
AI_PRESCREEN_SCORING_AND_ELIGIBILITY.md

---

# Core Concept

The interview is no longer generic.

It becomes:

"Can this worker successfully perform THIS assignment under THESE conditions?"

---

# 1. Interview Context Object

The AI interview must receive a structured context object BEFORE questions begin.

type AiInterviewContext = {
  worker: {
    userId: string;
    hasResume: boolean;
    workHistoryCount: number;
    phone: boolean;
    location: {
      city?: string;
      state?: string;
      zip?: string;
    };
  };

  entity: {
    entityId: string;
    entityName: string;
    workerType: 'W2' | '1099';
    requiresDrugScreen: boolean;
    requiresBackgroundCheck: boolean;
    requiresEVerify: boolean;
  };

  assignment?: {
    jobId: string;
    title: string;
    startTime?: string;
    days?: string[];
    location?: string;
    requiresDrugScreen?: boolean;
    requiresBackgroundCheck?: boolean;
    physicalRequirements?: string[];
    certificationsRequired?: string[];
    uniformRequirements?: string[];
  };

  readiness: {
    missingRequirements: string[];
    hasOpenScreening: boolean;
  };

  businessRules?: {
    allowGigPath?: boolean;
    tenant?: string;
  };
};

---

# 2. Interview Structure

## Part A — Core Questions (ALWAYS)

Use existing templates:
- motivation
- experience
- attendance
- transportation
- physical comfort
- drug/background disclosure
- supervisor feedback

---

## Part B — Dynamic Questions (CONDITIONAL)

### Shift Module
IF assignment.startTime exists:

"Your shift starts at {startTime}. Can you reliably be there on time?"

---

### Location Module
IF assignment.location exists:

"This job is located in {location}. Will you be able to reliably get there?"

---

### Compliance Module
IF requiresDrugScreen:

"This job requires a drug screen before starting. Are you able to complete that?"

IF requiresBackgroundCheck:

"This job requires a background check. Are you able to pass and complete it?"

---

### Physical Module
IF physicalRequirements exist:

"This job involves physical work such as {list}. Are you comfortable with that?"

---

### Certification Module
IF certificationsRequired exists:

"This job requires {cert}. Do you have this certification?"

---

### Uniform Module
IF uniformRequirements exist:

"This role requires {uniform}. Do you have these available?"

---

### Business Logic Module (CORT)

IF businessRules.allowGigPath:

"We may have gig shifts available before a full-time role opens. Would you be willing to take gig shifts in the meantime?"

---

# 3. Output Model

type AiInterviewResult = {
  candidateScore: number;
  recommendation: 'proceed' | 'review' | 'decline';

  assignmentReadiness: {
    status: 'ready' | 'review' | 'blocked';
    reasons: string[];
  };

  alternatePaths?: {
    gigEligible?: boolean;
  };
};

---

# 4. Assignment Readiness Logic

## READY
- Accepts shift
- Accepts location
- Accepts compliance requirements
- No blocking flags

## REVIEW
- Minor uncertainty (e.g., "not sure")
- Missing minor requirement

## BLOCKED
- Cannot meet shift
- Cannot travel
- Fails drug/background
- Missing critical certification

---

# 5. Gig Path Logic

IF:
- candidateScore >= 70
- assignmentReadiness = blocked OR review
- worker accepts gig path

THEN:
- set alternatePaths.gigEligible = true

---

# 6. Auto-Onboarding Trigger (Future)

Eligible for automatic onboarding when:

- recommendation = proceed
- assignmentReadiness = ready
- OR gigEligible = true

---

# 7. Rules

- Do NOT generate questions dynamically via LLM
- Use deterministic modules only
- Limit dynamic questions to avoid fatigue
- Keep total interview under ~3 minutes

---

# END
