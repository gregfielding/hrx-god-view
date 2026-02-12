# AI Score System v1.0 — Gap Analysis vs Current Codebase

**Purpose:** Weigh AI-Score-System-v1.0.md against existing scoring so we have a single, defensible foundation.  
**Status:** Current system is **partially aligned**; several gaps must close for a rock-solid foundation.

---

## 1) Current State (What We Have)

### 1.1 Stored shape

| Location | What's stored |
|----------|----------------|
| **users/{uid}.scoreSummary** | `aiScore`, `aiScoreUpdatedAt`, `completenessScore`, `responsivenessScore`, `qualityScore`, `aiWeights`, plus interview/review fields (`interviewAvg`, `interviewCount`, `interviewLastAt`, `interviewLastScore10`, `reviewAvg`, `reviewCount`, `reviewLastAt`) |

**Gap vs spec:** No `version`, no `computedAt`, no `components` object, no `explainability` (missingFields / nextActions), no `diagnostics` (profileUpdatedAt, lastSignalAt, staleReason). Spec requires a single canonical shape `ScoreSummaryV1`.

### 1.2 Formula (weights)

| Current | Spec v1.0 |
|---------|-----------|
| **scoreSummary.ts** `DEFAULT_AI_WEIGHTS`: completeness 0.45, responsiveness 0.25, quality 0.30 | Same: 0.45 / 0.25 / 0.30 ✅ |

Formula is aligned: `round(completeness*0.45 + responsiveness*0.25 + quality*0.30)`.

### 1.3 Completeness (0–100)

| Current | Spec v1.0 |
|---------|-----------|
| **applicantScoring.ts** `calculateCompletenessScore()`: ad-hoc points (Basic 15, Verification 12, Skills 12, Work 10, Certs 8, Education 4, Bio 8, **Resume 25**, Engagement 8) | Checklist: Identity 10, **Work eligibility verified 25**, **Availability 20**, Work exp 10, Skills 10, Certs 10, **Resume 5**, **Address 10** (total 100) |

**Gaps:**

- No explicit **availability** (shift prefs / availableToStartDate) in current completeness; spec gives it 20.
- Work eligibility is 6 points (verification) today; spec wants “verified” (not just uploaded) and 25.
- Resume is 25 today; spec 5 (placeability, not heavy resume bias).
- No **missingFields[]** or **nextActions[]** output; completeness returns only a number.
- Checklist not documented as “placement readiness”; some engagement/recency logic is not in spec.

**Risk:** Two different “completeness” semantics (current vs spec) → score drift and confusion. We need **one** canonical completeness that matches spec and is used everywhere.

### 1.4 Responsiveness (0–100)

| Current | Spec v1.0 |
|---------|-----------|
| **Never computed in codebase.** Always **default 50** when building aiScore (scoreSummary.ts `getScoreSummaryUpdateFromCompleteness`, InterviewTab, ScoreTab). | Baseline 50; adjust from response time, acceptance rate, recency, no-show/late-cancel. |

**Gap:** Responsiveness is a constant 50. No signals (message response, offer accept/decline, activity, no-shows) are collected or written. Spec expects real signals and anti-gaming (e.g. don’t punish if user never got an offer).

### 1.5 Quality (0–100)

| Current | Spec v1.0 |
|---------|-----------|
| **InterviewTab** (and similar): derived from **interviewAvg** (0–10 → *10 to 0–100) and **reviewAvg** (1–5 → scaled to 0–100), blended; written to `scoreSummary.qualityScore` when interview/review is submitted. | Baseline 50 for new applicants; then completed assignments, client rating, attendance reliability (no-show penalty), repeat bookings. |

**Gaps:**

- New applicants with no interviews/reviews end up with quality 0 in practice (or null and then 0 in formula), which **punishes new users**; spec says baseline 50.
- Quality is interview/review-only; spec also wants assignments, no-shows, repeat bookings. No assignment lifecycle or no-show data feeding quality today.

### 1.6 Where score is computed and written

| Trigger | What happens |
|---------|----------------|
| **UserProfile load** | Backfill: if completeness missing or 0 but profile has content, writes `scoreSummary.completenessScore`, `aiScore`, `aiScoreUpdatedAt`. |
| **persistScoreSummaryFromProfile()** | Called from UserProfile (e.g. after skills update) and ProfileOverview (after some overview save). Reads user doc, runs `calculateCompletenessScore()`, merges with existing responsiveness (50) and quality, writes completeness + aiScore + aiScoreUpdatedAt. |
| **InterviewTab** (submit interview / delete interview) | Recomputes quality from interviews + reviews, then aiScore from completeness + responsiveness (50) + quality; writes interview fields + qualityScore + aiScore + aiScoreUpdatedAt. |
| **ReviewsTab** (or similar) | Same pattern: quality from reviews (and interviews), then aiScore; writes to scoreSummary. |
| **Firestore** | **No production trigger** on `users/{uid}` that recomputes score. `testUserUpdate` only logs to test_logs; it does not write scoreSummary. |

**Gaps vs spec:**

- **No single canonical compute.** Completeness is client-side in applicantScoring; quality is client-side in InterviewTab/ReviewsTab; responsiveness is never computed. Spec requires **one** server-side `computeScoreSummaryV1(userDoc, signals)`.
- **Stale risk.** Score is only updated on specific UI actions (profile save, interview submit). If profile is edited elsewhere or by another client, stored score can stay stale. Spec requires freshness rule (e.g. profileUpdatedAt > computedAt → recompute) and server-side recompute.
- **Multiple writers.** UserProfile, ProfileOverview, InterviewTab, ReviewsTab all write to scoreSummary with dot-path updates. Spec says **only one** function should write scoreSummary to avoid races and drift.

### 1.7 Explainability and worker prompts

| Current | Spec v1.0 |
|---------|-----------|
| **Worker** `/c1/workers/profile`: prompts from **getReadinessPrompts(userDoc)** in `readinessPrompts.ts` — local derivation from raw profile (availability, certs, work experience, bio). No use of scoreSummary. | Worker should prefer **scoreSummary.explainability.nextActions**; fallback to local derivation OK. |
| **Admin** | Score tab shows components and weights; no structured “missingFields” or “nextActions” from storage. | Admin should show explainability (missingFields / nextActions) from stored scoreSummary. |

**Gap:** We do not store or compute `explainability: { missingFields, nextActions }`. Worker prompts are 100% local; admin has no stored explainability. Spec wants explainability stored with the score and driving both worker and admin UX.

### 1.8 Read adapter and legacy

| Current | Spec |
|---------|--------|
| **getUserScore(userDoc)** in scoreSummary.ts: prefers scoreSummary.aiScore, then qualityScore, then legacy userDoc.aiScore / score / profileScore. | Same idea: one adapter, prefer scoreSummary, support legacy during migration. ✅ |

Adapter is in place and matches spec intent.

---

## 2) Spec v1.0 Requirements vs Current (Summary)

| Spec requirement | Current status | Action |
|------------------|----------------|--------|
| Single stored shape `ScoreSummaryV1` (version, computedAt, components, explainability, diagnostics) | Partial: we have aiScore, components as flat fields, no explainability/diagnostics | Extend stored shape; add version and computedAt; add explainability + diagnostics |
| One canonical compute function (server) | No server canonical; client-only completeness + quality, responsiveness fixed at 50 | Add `computeScoreSummaryV1()` server-side; call from trigger or callable |
| Completeness = checklist (placement readiness), explicit weights per spec | Different checklist and weights (e.g. resume 25, no availability) | Define canonical completeness (spec checklist); use it everywhere |
| Responsiveness baseline 50, then signals | Always 50; no signals | Keep 50 until signals exist; document; add signal pipeline later |
| Quality baseline 50 for new applicants | Quality 0 when no interviews/reviews | Use 50 when no signals; then blend in assignment/review/no-show when available |
| Explainability stored with score (missingFields, nextActions) | Not stored | Compute in canonical scorer; write explainability; worker prompts prefer it |
| Freshness rule (recompute when profileUpdatedAt > computedAt) | No freshness check; no profileUpdatedAt on user doc | Add profileUpdatedAt (and lastSignalAt) on profile/signal writes; implement stale guard in recompute |
| Single writer for scoreSummary (no competing updates) | Multiple clients (UserProfile, ProfileOverview, InterviewTab, etc.) write scoreSummary | Move all score writes to server (trigger or callable); client only triggers recompute or reads |
| Recompute triggers: profile writes, message/offer events, assignment lifecycle | Only ad-hoc client calls (profile save, interview submit); no Firestore trigger for users | Add users/{uid} onWrite (with guard to skip when only scoreSummary changed); optional triggers for signals later |
| Worker prompts from explainability.nextActions with sectionId | Local getReadinessPrompts only | After explainability exists: worker reads nextActions; map sectionId to READINESS_SECTION_IDS; keep local fallback |
| Tests / smoke: deterministic compute, computed == stored | No tests for scoreSummary compute or persistence | Add unit tests for completeness + full score; smoke: write then read back and assert |

---

## 3) Recommended Path to a Rock-Solid Foundation

### Phase 1 — Canonical shape and compute (no new triggers yet)

1. **Shared types**  
   - Add `src/types/scoreSummary.ts` (or shared types) with `ScoreSummaryV1`: version, computedAt, weights, components, aiScore, explainability (missingFields, nextActions with sectionId), diagnostics.  
   - Keep existing flat fields readable via adapter so current UI keeps working.

2. **Canonical completeness**  
   - Implement spec checklist (identity 10, workEligibility 25, availability 20, workExperience 10, skills 10, certifications 10, resume 5, address 10) in one place (e.g. `computeCompletenessScoreV1(userDoc)`).  
   - Return `{ score, missingFields, nextActions }` so explainability can be built from it.  
   - Use it in both client (for backward compatibility during migration) and server (for canonical compute).

3. **Canonical scorer (server)**  
   - Add `functions/src/scoring/scoreSummaryV1.ts`: `computeScoreSummaryV1(userDoc, signals)`.  
   - Completeness from (2). Responsiveness = 50 until signals exist. Quality = 50 when no interviews/reviews/assignments; otherwise derive from existing logic (interviews/reviews) and later add assignments/no-shows.  
   - Output full `ScoreSummaryV1` including explainability.

4. **Persistence**  
   - Single write: merge full `scoreSummary` (or at least version, computedAt, components, aiScore, explainability, diagnostics) to `users/{uid}.scoreSummary`.  
   - Ensure user doc has `updatedAt` or `profileUpdatedAt` on profile writes so freshness can be checked later.

### Phase 2 — Single writer and freshness

5. **Recompute trigger**  
   - Firestore trigger: `users/{uid}` onWrite.  
   - Guard: if only `scoreSummary` (and maybe a few safe fields) changed, skip.  
   - Otherwise: load user doc + any signal data, call `computeScoreSummaryV1()`, write scoreSummary.  
   - This makes server the single writer and removes drift from multiple client writes.

6. **Stale guard**  
   - In trigger (or in callable used by “Refresh score”): if `profileUpdatedAt` (or user.updatedAt) > scoreSummary.computedAt, recompute and overwrite.

7. **Client behavior**  
   - Stop writing scoreSummary from client (UserProfile, ProfileOverview, InterviewTab, etc.).  
   - Client only: trigger recompute (e.g. callable “refreshScore” after profile save) or rely on Firestore trigger.  
   - Admin “Refresh score” can call same callable until trigger covers all cases.

### Phase 3 — Worker and admin UX

8. **Worker prompts**  
   - When `scoreSummary.explainability?.nextActions` exists, use it for unlock prompts; map sectionId to READINESS_SECTION_IDS and “Fix now” behavior.  
   - Fallback: keep current `getReadinessPrompts(userDoc)`.

9. **Admin**  
   - Score tab reads same scoreSummary; show components, weights, computedAt, and explainability (missingFields / nextActions).

### Phase 4 — Responsiveness and quality (later)

10. **Responsiveness**  
    - Add signal collection (message response, offer accept/decline, activity).  
    - In canonical scorer, use baseline 50 and adjust from signals per spec (no punishment when no opportunities).

11. **Quality**  
    - In canonical scorer: baseline 50 when no data; when data exists, use interview/review and later assignment completion, no-shows, repeat bookings per spec.

---

## 4) File / Location Reference (Current)

| Concern | Current location |
|---------|------------------|
| Stored shape / adapter | `src/utils/scoreSummary.ts` (ScoreSummary type, normalizeScoreSummary, getUserScore, getScoreSummaryUpdateFromCompleteness, computeAiScoreFromComponents) |
| Completeness (current) | `src/utils/applicantScoring.ts` (calculateCompletenessScore, calculateProfileScore) |
| Persist from profile | `src/utils/persistScoreSummaryFromProfile.ts` |
| Quality + aiScore write (interview/review) | `src/pages/UserProfile/components/InterviewTab.tsx` (and similar for reviews) |
| Worker prompts | `src/components/worker/profile/readinessPrompts.ts` (getReadinessPrompts, READINESS_SECTION_IDS) |
| Distribution (percentiles) | `functions/src/scoringDistribution.ts` (reads scoreSummary from users; no write to users) |
| User trigger | `functions/src/firestoreTriggers.ts` (testUserUpdate — log only, no score) |

---

## 5) What NOT to do (per spec and stability)

- Do not introduce a second “readiness” or “profile completion” metric that competes with AI Score.  
- Do not let the client be the source of truth for when to recompute; use server trigger or callable.  
- Do not add new ad-hoc writers to scoreSummary; converge on one server path.  
- Do not change formula weights (0.45 / 0.25 / 0.30) without updating the spec and all consumers.

---

**Conclusion:** The codebase already has the right formula, a read adapter, and a single display label (Hiring Score / AI Score). To reach a rock-solid foundation we need: (1) one canonical stored shape and server-side scorer, (2) completeness aligned to the spec checklist and returning explainability, (3) a single writer (server trigger + optional callable), (4) freshness and no competing client writes, and (5) worker prompts driven by stored explainability with local fallback. Implementing the checklist in order (canonical scorer + types → trigger + stale guard → client stop-writing → worker/admin explainability) will get us there without breaking existing behavior during migration.
