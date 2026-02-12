# HRX Scoring Architecture v1.1 — Finalized Model
_Last updated: 2026-02-12 22:26 UTC_

This document **locks the philosophy and system definition** for HRX scoring + compliance. It is designed to be a single source of truth for Cursor and the codebase.

---

## 1) The Three-Layer Model (Non‑negotiable Separation)

HRX has **three distinct evaluation systems**:

### A) Hiring Score (Global)
**Scope:** Person-level (job-agnostic)  
**Purpose:** “How strong/reliable is this worker in general?”  
**Storage:** `users/{uid}.scoreSummary.aiScore` (source of truth)  
**UX labels:** Admin “AI Score” / Worker “Hiring Score”

### B) Job Match Score (Per Job/Application)
**Scope:** Person ↔ job  
**Purpose:** “How well does this worker match THIS job’s requirement pack?”  
**Storage:** `applications/{applicationId}.jobScoreSummary` (snapshot)  
**UX labels:** Admin “Job Score” / Worker “Score for this job”

### C) Compliance Status (Onboarding + payroll readiness)
**Scope:** Person-level, but **journey-driven** (W2 vs contractor) and policy-driven  
**Purpose:** “Are they legally/operationally eligible to be onboarded/paid/assigned?”  
**Storage:** `users/{uid}.onboarding` (checklist + computed summary)  
**UX labels:** Admin/Worker “Compliance”

**Rule:** Compliance is **not** a scoring system. It can gate assignment/placement, but it does not change Hiring Score or Job Match Score math.

---

## 2) Golden Rules (Trust + Defensibility)

1. **Deterministic scoring first.** No black-box AI ranking for hiring decisions.
2. **Explainability is mandatory.** Every score must produce “why” and “what to do next.”
3. **Hard gates are binary.** Missing a hard requirement → `eligible=false` (Job Match).
4. **Snapshots are stored, but freshness is enforced.** (Stale detection + recompute)
5. **No sensitive doc storage in HRX.** Everee stores the file; HRX stores pointers + metadata.
6. **Employment type matters.** W2 vs 1099 is a first-class dimension in requirement packs + compliance journeys.

---

## 3) Hiring Score v1.1 (Global)

### 3.1 Purpose
Hiring Score measures **profile readiness + strength + engagement potential** without referencing any specific job.

### 3.2 Components (v1.1)
Hiring Score is built from three components:

- **Completeness (C)** — “Do we have the basics to place you?”
- **Depth (D)** — “How much real signal do we have (experience/certs/education)?”
- **Engagement & Reliability (R)** — “Do you respond/show up?” (neutral baseline until signals mature)

### 3.3 Final Formula
**HiringScore = 0.60*C + 0.25*D + 0.15*R**

All components are 0–100. Final score is clamped 0–100.

#### Baselines
- If a worker is brand new, **R defaults to 50** (neutral).
- R becomes signal-based later (response time, acceptance, attendance, no-shows).

### 3.4 Completeness (C) — Checklist (0–100)
C is a **binary checklist** with weighted items. Items should be clear to workers.

Recommended default checklist weights (sum to 100):
- Phone verified: 15
- Home address present: 10
- Availability/preferences present: 15
- Resume uploaded: 10
- Bio present: 10
- Skills present (>= 3): 10
- Work history present (>= 1 role): 20
- Education present (>= 1 entry OR “none declared”): 10

> Note: “none declared” still counts as a completed field if explicitly set, to reduce confusion and gaming.

### 3.5 Depth (D) — Diminishing returns (0–100)
D rewards *more signal* but prevents infinite gaming.

D = ExperienceDepth + CertDepth + EducationDepth + BonusSignals

Recommended caps:
- ExperienceDepth (max 45)
  - 1 role: 15
  - 2 roles: 25
  - 3 roles: 35
  - 4+ roles: 45
  - Optional: small bonus for longer tenure or relevance once taxonomy exists

- CertDepth (max 35)
  - 1 cert: 15
  - 2 certs: 25
  - 3 certs: 30
  - 4+ certs: 35
  - Expired certs count at 25% value

- EducationDepth (max 20)
  - Highest education rank applied (not additive across entries)
  - None: 0
  - HS: 5
  - AA/Trade: 10
  - BA/BS: 15
  - MA+: 20

- BonusSignals (max 10)
  - Languages present (>=1): +5
  - References/endorsements (future): +5

### 3.6 Hiring Score Explainability
Store in scoreSummary (v1.1):
- `components.completeness` and `components.depth` and `components.reliability`
- `explainability.missingFields[]`
- `explainability.nextActions[]` (ordered, worker-friendly)
- `computedAt`, `version`

**Worker UI:** “Hiring Score” plus “Top 3 ways to improve.”

---

## 4) Job Match Score v1.1 (Per Job/Application)

### 4.1 Purpose
Job Match Score is computed by comparing worker profile vs a **Requirement Pack** attached to a job/job order/posting.

### 4.2 Final Formula
**JobScore = 0.80*RequirementsScore + 0.20*HiringLift**

- RequirementsScore: 0–100 (pack comparison)
- HiringLift: the worker’s Hiring Score (0–100) at compute time, or 50 if missing

### 4.3 Eligibility & Capping
- If any **hard** requirement fails → `eligible=false`
- Ineligible applicants should sort below eligible:
  - **Cap** `jobScore = min(jobScore, 49)` when `eligible=false`

### 4.4 RequirementsScore Weights (0–100)
These match your established rubric and are locked for v1.1:

- Licenses/Certifications: **30**
- Experience Level: **25**
- Education Level: **15**
- Shift Preference Overlap: **20**
- Language: **5**
- Physical/PPE/Uniform: **5** (defaults to info unless acknowledgements exist)

### 4.5 Requirement Pack Rule Types (Locked)
Each category is one of:
- **hard**: missing → eligible=false + missingRequired
- **scored**: affects score but does not flip eligibility
- **info**: displayed only, no score impact (unless future acknowledgements)

**Important:** “Show on post” is display only and must not determine scoring.

### 4.6 Explainability Outputs (Mandatory)
JobScoreSummaryV1 must include:
- `eligible`
- `buckets.missingRequired[]` (hard gate failures only)
- `buckets.missingOptional[]` (scored but missing)
- `buckets.matched[]`
- `buckets.gates[]` (pass/fail + reasons)
- `nextActions[]` with `sectionId` deep links where applicable
- `breakdown.requirements` and `breakdown.hiringLift`

### 4.7 Worker vs Recruiter UX Rules
- **Worker sees Job Score** only in job/app context (“Score for this job”).
- **Recruiter sees Job Score** in applicant tables with a “Why?” tooltip/popover.
- Always show **Not Eligible** chip when `eligible=false`.
- “Fix now” deep-links should go to:
  - `/c1/workers/profile` section anchors (availability/experience/education/skills/bio)
  - `/c1/workers/documents` (resume/certs uploads)
  - Everee view for compliance docs (via pointers)

---

## 5) Requirement Packs v1.1 (Schema + Policies)

### 5.1 Schema
RequirementPackV1 includes (existing + locked intent):
- requiredCerts
- requiredExperienceLevels
- requiredEducationLevels
- requiredShiftTypes
- requiredLanguages
- physicalPpeTags
- per-category `importance: "hard" | "scored" | "info"`
- `version` (integer) **required** going forward

### 5.2 Employment Type Dimension
Packs must include (or imply) an employment type policy:
- `employmentType: "w2" | "contractor" | "either"`

This influences:
- compliance journey template selection
- hard gates in some roles (e.g., W2 nursing)

---

## 6) Compliance System v1.1 (Everee‑first, HRX‑orchestrated)

### 6.1 HRX Never Stores Sensitive Files
Do not store:
- SSN, I‑9 scans, W‑4, driver license images, social security card images

HRX stores only:
- provider: everee
- externalId
- viewUrl or viewLink token
- expiresAt
- status
- checklist state

### 6.2 Compliance Data Model
`users/{uid}.onboarding` must include:
- `journey: "employee" | "contractor"`
- `templateId`
- `checklist` object (keyed items)
- **computed summary**:
  - `overallStatus: "complete" | "incomplete" | "expired" | "pending"`
  - `compliancePercent: number`
  - `requiredCount`, `completedCount`, `expiredCount`, `expiringSoonCount`
  - `lastEvaluatedAt`, `lastSyncedAtEveree`

### 6.3 Expiration Semantics (Locked)
- >30 days: Verified
- <=30 days: Expiring soon
- <=0 days: Expired

### 6.4 Compliance ↔ Placement Rules (Separation)
Compliance can block:
- placement creation
- assignment confirmation
- payroll activation
…but does **not** change Hiring Score or Job Score math.

Compliance can appear as a “Gate” in Job Match Score only when:
- The requirement pack explicitly marks a compliance item as hard for that job type (rare, but allowed).

---

## 7) Freshness, Recompute & Audit Trail (v1.1)

### 7.1 Snapshot + Stale Guard Rules
Hiring Score is stored on user and must have:
- `computedAt`
- `version`

Job Score is stored on application and must have:
- `computedAt`
- `requirementPackVersion`
- `aiScoreAtCompute`
- optional `stale` block for UI

A score is stale if:
- `user.profileUpdatedAt > jobScoreSummary.computedAt`
- OR requirementPackVersion changed
- OR `abs(currentAiScore - aiScoreAtCompute) >= 10` (optional threshold)

### 7.2 Recompute Strategy (Locked)
- Compute Job Score at application creation (already done)
- Recompute lazily:
  - on applicant table load (if stale)
  - via recruiter “Refresh scores” action (batch)
- Store snapshot after recompute (overwrite current snapshot)

### 7.3 Timestamp Hygiene
Avoid mixing “computed time” with `serverTimestamp()` ambiguity.
Recommended:
- `computedAt`: Timestamp.now() when you compute
- `writtenAt`: serverTimestamp() on Firestore write

### 7.4 One Writer Rules (Target State)
- Hiring Score: computed by a single server-side compute path (trigger/callable)
- Job Score: computed by a single shared function (already shared) used by all creation paths

---

## 8) Canonical Naming (Lock It)
- Global: **Hiring Score**
- Per job: **Job Match Score** (display as “Job Score” in recruiter tables)
- Compliance: **Compliance**

Avoid “Readiness score” as a numeric label. “Job Readiness” can remain as a page title but refers to the Hiring Score value.

---

## 9) Implementation Checklist (What Cursor should do next)

### 9.1 Hiring Score v1.1
- Ensure scoreSummary includes: version, computedAt, components, explainability
- Ensure completeness uses the locked checklist + weights
- Implement Depth with diminishing returns + caps
- Keep Reliability neutral baseline (50) until signals mature

### 9.2 Requirement Packs v1.1
- Add `version` to packs
- Add `employmentType` (or clear policy)
- Ensure per-category importance exists and is honored

### 9.3 Job Match Score v1.1
- Ensure jobScoreSummary writes include requirementPackVersion and aiScoreAtCompute
- Implement stale detection and recruiter “Refresh scores” batch recompute
- Ensure missingRequired only contains hard failures

### 9.4 Compliance v1.1
- Replace mock checklist with Firestore subscription
- Implement `computeComplianceSummary(checklist)` and store results under `users/{uid}.onboarding`
- Add header compliance strip on Documents page
- Add recruiter compliance badges in applicant/placement contexts

---

## 10) Acceptance Criteria (v1.1)

### Hiring Score
- Stable 0–100 score displayed consistently in admin and worker
- “Top 3 improvements” shown and matches explainability
- Depth increases score when adding more experience/certs/education (with caps)

### Job Match Score
- For jobs with requirementPackId: default sort by Job Score without overriding user choice
- Not eligible candidates clearly flagged and sorted below eligible
- “Why?” shows missingRequired/matched/nextActions
- Snapshot is stale-guarded and can be refreshed

### Compliance
- Worker documents page shows compliance checklist + expiration statuses
- No sensitive docs stored in HRX
- Everee pointers and expiration metadata support proactive renewals

---

## 11) Notes for Future v1.2+ (Not required now)
- Reliability signals: response time, shift acceptance, attendance, no-shows, cancellations
- Quality signals: supervisor ratings, repeat bookings, tenure, disputes
- Job taxonomy: role/category mapping for “relevant experience” scoring
- Acknowledgement flows: physical/PPE/uniform becomes scored/hard only after worker acknowledgement UX exists
