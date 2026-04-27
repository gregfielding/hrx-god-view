# Recruiter scoring schema audit

**Purpose:** Single source of truth for recruiter-facing scoring. No UI changes in this document.

**Sources:** `src/utils/scoreSummary.ts`, `src/utils/scoring/recruiterOperationalScore.ts`, `src/utils/scoring/recruiterPrimaryDisplay.ts`, `functions/src/workerAiPrescreen/recomputeInterviewScoreSummary.ts`, `functions/src/workerAiPrescreen/submitWorkerAiPrescreenInterview.ts`, `src/types/workerAiPrescreenInterview.ts`, `src/types/prescreenCategoryScores.ts`, `src/utils/hiringScoreV1.ts`, profile/score UI components.

---

## 1. All score fields in the system

### 1.1 `users/{uid}` (top-level, outside `scoreSummary`)

| Field name | Meaning | Usage | Status |
|------------|---------|--------|--------|
| `categoryScoresCurrent` | Durable v1/v2 per-category scores (0–100 + confidence in v2) | Score tab, header chips, job order panels, action items context | **ACTIVE** — category intelligence (evolving; not the single headline number) |
| `categoryScoresCurrentUpdatedAt` | Timestamp for category freshness | Freshness / staleness helpers | **DERIVED** (metadata) |
| `riskProfile` | Structured risk + staleness (from prescreen / rules) | Overview, tables, action items, decision copy | **ACTIVE** — gates, not a replacement for operational score |
| Legacy `aiScore` / `score` / `profileScore` (top-level) | Old flat fields | `getUserScore()` fallback only | **LEGACY** — prefer `scoreSummary` |

### 1.2 `users/{uid}.scoreSummary`

| Field name | Meaning | Typical UI | Status |
|------------|---------|--------|--------|
| `overrideAdjustedScore` | Denormalized **operational** recruiter-trust score (0–100) from latest prescreen rules | Primary when present; synced from interview `ai` | **ACTIVE** — canonical **primary** when `primaryRecruiterScoreSource` is operational |
| `baseInterviewScore` | Raw prescreen model score before operational overrides | Score tab, provenance strip, “base vs adjusted” | **ACTIVE** (supporting) |
| `overrideScoreDelta`, `overrideBand`, `overrideRulesVersion`, `recruiterTrustLevel`, `scoreComputationVersion` | Audit / override metadata | Debug strip, tooltips | **ACTIVE** (supporting / audit) |
| `primaryRecruiterScoreSource` | `operational_prescreen` \| `interview_quality_proxy` \| `legacy_profile_composite` | `ScorePrimarySourceStrip`, debugging | **DERIVED** (server classification) |
| `primaryRecruiterScoreUpdatedAt`, `recruiterScoreSourceVersion` | When primary layer last updated; version string | Freshness UI | **DERIVED** |
| `scoreConflictDetected` | `true` when `|operational − aiScore| ≥ 15` (recompute) | Conflict hints | **DERIVED** |
| `interviewAvg` | Mean of **all** interview `score10` / `score` (0–10 scale) | Interview summary lines | **DERIVED** (aggregate) |
| `interviewCount`, `interviewLastAt`, `interviewLastScore10`, `interviewLastInterviewKind` | Latest interview metadata | Proxy rules, list views | **DERIVED** |
| `reviewAvg`, `reviewCount`, `reviewLastAt` | Star-review aggregates | Quality blend in recompute | **ACTIVE** (supporting) |
| `qualityScore` | Blend of interview/review quality (0–100) used in **composite** path | Feeds `aiScore` in recompute | **DERIVED** |
| `completenessScore`, `responsivenessScore` | Profile inputs to composite | Hiring Score / AI Score card | **ACTIVE** (supporting for legacy composite) |
| `aiScore` | **Composite** “Hiring Score” / legacy blend: f(completeness, responsiveness, **qualityScore**) in recompute; OR **Hiring Score v1.1** (C/D/R) from profile via `getScoreSummaryUpdateFromHiringScoreV1` | Tables (`SmartGroupsPage` still often use raw `aiScore`), worker hero, relative scoring | **LEGACY** for recruiter **decisions** when prescreen operational exists; still **persisted and displayed** |
| `aiScoreUpdatedAt` | Timestamp for `aiScore` | Freshness | **DERIVED** |
| `aiWeights` | Weights for C/R/Q composite | Score tab AI breakdown | **LEGACY** (supporting) |
| `components` (C/D/R), `explainability`, `hiringScoreVersion`, `hiringScoreComputedAt`, `hiringScoreInputSignature` | Hiring Score v1.1 profile model | Profile-driven hiring score | **ACTIVE** for **profile** hiring score track; **secondary** to operational prescreen when both exist |
| `autoAdvanceEligible` | Denormalized from `ai.hiringDecision` | Gates | **DERIVED** |

### 1.3 `users/{uid}/interviews/{id}` (worker AI prescreen)

| Field name | Meaning | UI | Status |
|------------|---------|-----|--------|
| `interviewKind` | `worker_ai_prescreen` | Routing | **ACTIVE** |
| `score10`, `score` | **0–10** scale copy of interview score (see submit pipeline) | Lists, aggregates; **not** the 0–100 operational headline | **DERIVED** (display scale) |
| `ai.overallScore` | Typically aligned with operational adjusted score post-submit | Interview modal | **ACTIVE** (interview snapshot) |
| `ai.baseInterviewScore` | Raw score before overrides | Decision summary | **ACTIVE** |
| `ai.overrideAdjustedScore` | **Operational** 0–100 after rules | **Highest precedence** for recruiter primary when reading live interview | **ACTIVE** |
| `ai.overrideScoreDelta`, `overrideBand`, `recruiterTrustLevel`, … | Same as profile mirror | Audit | **ACTIVE** |
| `ai.categoryScores`, `ai.categoryEvidence` | Six category 0–100 + evidence | Category intelligence, Score tab | **ACTIVE** (supporting) |
| `ai.recommendation` | `proceed` \| `review` \| `caution` \| `decline` | Decision / action items | **ACTIVE** (non-numeric) |
| `ai.hiringDecision` | Rules decision + auto-advance flags | Hiring / routing | **ACTIVE** |
| `ai.subScores` | Legacy buckets (experience, reliability, …) | Older UI paths | **LEGACY** |

### 1.4 Other persisted paths

| Location | Meaning | Status |
|----------|---------|--------|
| `users/{uid}/category_score_events/*` | Append-only audit of category deltas | **ACTIVE** (audit trail; read-restricted vs user doc) |
| `tenants/.../applications/.../aiAutomation.categoryScores` | Application-scoped category snapshot | **ACTIVE** (parallel to user categories) |

### 1.5 Derived UI helpers (no Firestore field)

| Helper | Role | Status |
|--------|------|--------|
| `resolveRecruiterOperationalScore100` | Precedence: interview override → summary override → bases → last10×10 (only if latest kind is prescreen) → `aiScore` | **DERIVED** — **canonical resolution** |
| `getRecruiterPrimaryScore100` / `getRecruiterPrimaryScore100FromSummary` | Single 0–100 for tables/header when only `scoreSummary` | **DERIVED** |
| `resolveRecruiterPrimaryDisplay` | Primary + legacy composite + conflict flag | **DERIVED** |
| `getCanonicalStoredAiScore` | Reads **`scoreSummary.aiScore` only** | **DERIVED** (legacy composite number) |
| `getUserScore` | `aiScore` then `qualityScore` then legacy top-level | **LEGACY** entry point |
| `computeHiringScoreV1` / `getScoreSummaryUpdateFromHiringScoreV1` | Profile Hiring Score v1.1 → writes `scoreSummary.aiScore` + components | **DERIVED** (profile model) |

---

## 2. Canonical recruiter score

### PRIMARY (single number recruiters should trust for **prescreen hiring**)

- **Operational score:** `ai.overrideAdjustedScore` on the latest prescreen interview, denormalized to **`scoreSummary.overrideAdjustedScore`**.
- Resolution order: **`resolveRecruiterOperationalScore100`** (see `recruiterOperationalScore.ts`).

### SECONDARY (supporting)

| Layer | Fields | Role |
|-------|--------|------|
| Category intelligence | `categoryScoresCurrent`, `ai.categoryScores` | Explainability, not one headline |
| Interview base | `ai.baseInterviewScore` / `overallScore`, `scoreSummary.baseInterviewScore` | “Raw” vs adjusted |
| Risk | `riskProfile` | Gates and narrative |
| Rules outputs | `ai.recommendation`, `ai.hiringDecision` | **Decisions** complement the numeric score |

### LEGACY (still displayed; misleading if shown as “the” score without context)

- **`scoreSummary.aiScore`:** Composite blend (recompute: quality from interviews/reviews + profile C/R; **or** Hiring Score v1.1 from profile). Stored as “AI Score” / Hiring Score in many places.
- **`getCanonicalStoredAiScore`:** Explicitly **only** `aiScore` — not operational.
- **Raw `interviewAvg` / `score10×10`:** Aggregates or 0–10 scale; can diverge from operational prescreen.

### Server truth label

- **`scoreSummary.primaryRecruiterScoreSource`:** `operational_prescreen` when operational layer is present; else `interview_quality_proxy` or `legacy_profile_composite`.

---

## 3. Conflicts (example: AI 40 vs Interview 97 vs Operational 100)

### Why it happens

1. **`aiScore` (e.g. 40)** is computed in **`recomputeUserInterviewScoreSummary`** as:
   - `qualityScore` from **average interview scores** (and review) mapped to 0–100, **combined** with stored `completenessScore` and `responsivenessScore` in a **fixed-weight formula** — **not** the same as the prescreen rules engine output.
2. **“Interview 97”** in UI often refers to **`baseInterviewScore`** or **`overallScore`** (0–100) on the **prescreen** interview — the **model** score before trust overrides.
3. **Operational 100** is **`overrideAdjustedScore`** after **business rules** (trust, caps, blocks) — the **intended** recruiter-facing number when prescreen exists.

So three different **definitions**:

| Label | What it is |
|-------|------------|
| Composite **AI Score** | Profile + blended “quality” — can lag or disagree with prescreen |
| Base / model score | Raw AI prescreen scoring |
| Operational | Rules-adjusted prescreen — **what product treats as primary** |

### Which is correct for hiring?

- **For prescreen-based hiring decisions:** **Operational score** (`overrideAdjustedScore`) + **`ai.hiringDecision` / `ai.recommendation`** + **risk**.
- **Which is misleading:** Showing **`aiScore` alone** as “the score” when a prescreen exists — it is explicitly **legacy/composite** in comments and can **differ by ≥15** (`scoreConflictDetected`).

---

## 4. Recommendation (CRITICAL)

### FINAL MODEL (proposed)

| Role | Source |
|------|--------|
| **Primary score (single number)** | `resolveRecruiterOperationalScore100` → `adjustedScore` (0–100), backed by **`overrideAdjustedScore`** when prescreen exists |
| **Supporting** | `baseInterviewScore`, category scores, `interviewAvg`, `reviewAvg` |
| **Non-numeric** | `ai.hiringDecision`, `ai.recommendation`, `riskProfile` |
| **Legacy / secondary line** | `scoreSummary.aiScore` labeled **“Legacy profile / composite hiring score”** (or hidden in condensed views) |

### Remove / hide (UX policy — not implemented in this audit)

- **Hide or downgrade** raw **`aiScore`** as a headline when `primaryRecruiterScoreSource === 'operational_prescreen'` or when `latestPrescreenInterviewAi` exists.
- **Do not** use **`getUserScore`** / raw **`aiScore`** for recruiter tables without the same operational resolution used in `RecruiterUsers` / header refactors.
- **Deprecate** over time: top-level legacy `aiScore` / `profileScore` on user doc for recruiter surfaces.

### Direct answer

**What score should determine hiring decisions?**

- **Numeric:** **`overrideAdjustedScore`** (operational prescreen), with **`baseInterviewScore`** as context.
- **Non-numeric:** **`ai.hiringDecision`** and **`ai.recommendation`**, plus **`riskProfile`** — the score alone does not replace rules.

---

## 5. Data flow (simple)

```mermaid
flowchart LR
  subgraph submit [Prescreen submit]
    A[answers + context] --> B[composePrescreenAiBundle]
    B --> C[scored.overallScore base]
    B --> D[operationalOverride.adjustedScore]
    D --> E[interviews/{id}.ai]
    E --> F[score10 / score on interview doc]
  end
  subgraph recompute [recomputeUserInterviewScoreSummary]
    E --> G[Read latest interviews + user scoreSummary]
    G --> H[Merge operational fields into scoreSummary]
    G --> I[Compute qualityScore + aiScore composite]
    G --> J[mergeRiskProfileIntoUserUpdateIfChanged]
    H --> K[users/{uid} update]
    I --> K
    J --> K
  end
  subgraph profile [Profile-driven Hiring Score v1.1]
    L[user doc fields] --> M[computeHiringScoreV1]
    M --> N[scoreSummary.aiScore + components]
    N --> K
  end
```

**Where recompute happens**

- **Callable / triggers:** `recomputeUserInterviewScoreSummary` (Functions), `reviewAndRescoreUser` (manual), prescreen submit path (after interview write).
- **Client (explicit):** `persistScoreSummaryFromProfile` / Hiring Score v1.1 updates **only** on profile edits — **not** on passive page load (by design).

**What gets persisted**

- **Interview doc:** Full `ai` block + `score10`.
- **User doc:** `scoreSummary.*` (operational + composite + aggregates) + **`riskProfile`** merge when risk builder runs.

---

## 6. Summary table: ACTIVE vs LEGACY vs DERIVED

| Concept | Classification |
|---------|------------------|
| `overrideAdjustedScore` (interview + profile) | **ACTIVE** primary numeric |
| `ai.recommendation` / `hiringDecision` | **ACTIVE** decision |
| `categoryScoresCurrent` / `ai.categoryScores` | **ACTIVE** supporting |
| `riskProfile` | **ACTIVE** supporting |
| `scoreSummary.aiScore` (composite / v1.1) | **LEGACY** headline when prescreen operational exists; still **ACTIVE** as profile model |
| `interviewAvg`, `qualityScore`, `interviewLastScore10` | **DERIVED** / context |
| `primaryRecruiterScoreSource`, `scoreConflictDetected` | **DERIVED** |
| Top-level `aiScore` on user | **LEGACY** |

---

*End of audit.*
