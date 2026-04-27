# AI Score System v1.0 (Canonical) — HRX / C1
**Purpose:** Make the AI/Hiring Score a single, defensible foundation for (1) staffing decisions and (2) worker guidance.  
**Non‑negotiable:** ONE score system, shared across Admin + Worker views. No competing “readiness” metric.

---

## 0) Names & UX Labels
### Internal canonical name
- **AI Score** (stored + computed)

### Worker-facing label
- **Hiring Score** (same value as AI Score)

### Admin-facing label
- **AI Score** (same value as Hiring Score)

**Rule:** The UI may label it differently, but the value comes from the same stored object: `users/{uid}.scoreSummary`.

---

## 1) Canonical Stored Shape (Firestore)
**Document:** `users/{uid}`  
**Field:** `scoreSummary` (single source of truth)

```ts
type ScoreSummaryV1 = {
  version: "v1.0";
  computedAt: Timestamp;        // when scoreSummary was computed
  inputsHash?: string;          // optional: stable hash of relevant inputs for debugging
  weights: { completeness: 0.45; responsiveness: 0.25; quality: 0.30 };

  // Component scores are each 0–100
  components: {
    completeness: number;
    responsiveness: number;
    quality: number;
  };

  // Total is 0–100 integer
  aiScore: number;

  // Explainability payload (drives worker prompts and admin “why”)
  explainability: {
    missingFields: string[];     // canonical keys, eg "availability", "workEligibility"
    nextActions: Array<{
      key: string;               // eg "add_availability"
      label: string;             // short human label
      description?: string;      // optional longer guidance
      sectionId?: string;        // worker anchor id (READINESS_SECTION_IDS)
      impactEstimate?: number;   // optional estimated score gain
      href?: string;             // optional route fallback
    }>;
  };

  // Optional diagnostics
  diagnostics?: {
    profileUpdatedAt?: Timestamp;
    lastSignalAt?: Timestamp;    // last time any responsiveness/quality signal updated
    staleReason?: string;        // filled if recompute was triggered due to staleness
  };
};
```

### Legacy compatibility (must support during migration)
Existing code may have:
- `userDoc.scoreSummary.aiScore` ✅ preferred
- `userDoc.aiScore`, `userDoc.score`, `userDoc.profileScore` (legacy primitives)

**Requirement:** Implement `getUserScore(userDoc)` adapter that prefers `scoreSummary.aiScore` and falls back to legacy fields until migration completes.

---

## 2) One Canonical Compute Function (Deterministic)
### Single source of truth
Create a canonical scorer that outputs the full object above:

- **Server canonical:** `functions/src/scoring/scoreSummaryV1.ts`
- **Shared types (client+server):** `src/types/scoreSummary.ts` (or shared folder if you have one)

```ts
function computeScoreSummaryV1(userDoc: UserDoc, signals: Signals): ScoreSummaryV1
```

**Rules**
1) Deterministic: same inputs → same output.
2) Component scores always 0–100.
3) Total score always integer 0–100.
4) Store the full object back to `users/{uid}.scoreSummary`.
5) UI never “makes up” a score. It only reads stored `scoreSummary`.

---

## 3) Core Formula (v1.0)
### Weights (match current admin explanation)
- Completeness: **0.45**
- Responsiveness: **0.25**
- Quality: **0.30**

```txt
AI Score = round(
  completeness * 0.45 +
  responsiveness * 0.25 +
  quality * 0.30
)
```

---

## 4) Component Definitions (Rock‑Solid / Explainable)

### A) Completeness (0–100)
**What it means:** “Can we place this worker without friction?” (placeability)

**Implementation:** weighted checklist mapped to real fields.

Recommended v1 checklist (tune as needed):
- Identity basics (name, phone, email): 10
- Work eligibility verified (not just uploaded): 25
- Availability/preferences present: 20
- Work experience ≥ 1 entry: 10
- Skills ≥ 5: 10
- Certifications ≥ 1 (or role-required): 10
- Resume present (if your flow uses it): 5
- Address/commute info present: 10

Total: 100

**Important guardrails**
- “Verified” > “Uploaded” for eligibility.
- Don’t reward fluff: the checklist should be about placement readiness.
- Keep field mapping explicit and unit-tested.

Output:
```ts
{ score: number; missingFields: string[]; nextActions: NextAction[] }
```

Canonical missing field keys (examples):
- `identityBasics`
- `workEligibility`
- `availability`
- `workExperience`
- `skills`
- `certifications`
- `resume`
- `address`

---

### B) Responsiveness (0–100)
**What it means:** “Will they respond and coordinate reliably?” (communication + acceptance behavior)

**v1 conservative approach** (avoid punishing users with no opportunities yet):
- Start with neutral baseline **50**
- Adjust based on signals:
  - Response time to system prompts (median/avg over last N): up to +20 / down to -20
  - Acceptance rate (accepted / offered): up to +20 / down to -20
  - Recency (last active): up to +10 / down to -10
  - No-show or late-cancel events: heavy penalties (see Quality too; don’t double punish)

**Signals source (examples)**
- Outbound message logs (SMS/push/email)
- Assignment offer events + accept/decline
- App/web session activity logs
- Timesheet/clock-in events

**Anti-gaming**
- Don’t award “responsiveness” for spammy self-updates; only count responses to system requests or offers.
- If user never received an offer/message, keep baseline 50 (don’t punish for silence).

---

### C) Quality (0–100)
**What it means:** “Are they likely to perform well for our clients?” (reliability + outcomes)

**Key requirement:** New applicants must not default to 0.  
Use neutral baseline **50** until enough signals exist.

v1 components (conservative):
- Completed assignments count: +0 to +20
- Client rating / feedback (if available): +0 to +20
- Attendance reliability (no-shows, late cancels): -0 to -40
- Repeat bookings / tenure: +0 to +20

**No-show / reliability rules**
- No-shows are the most damaging signal and should be strongly penalized.
- Distinguish “cancelled with notice” vs “no-show” if you have it.

---

## 5) Explainability (Worker + Admin)
### Store explainability WITH the score
Compute and store:
- `missingFields[]`
- `nextActions[]` (top 3–5)

**Worker UX usage**
- Worker `/c1/workers/profile` should render unlock prompts from `scoreSummary.explainability.nextActions` if present, otherwise fallback to local derivation.

**Admin UX usage**
- Admin score tab can show components + “why” without recomputing in UI.

**NextAction mapping**
`sectionId` must match worker anchors (READINESS_SECTION_IDS), e.g.
- `readiness-availability`
- `readiness-work-experience`
- `readiness-certifications`
- `readiness-bio`
- `readiness-skills`

---

## 6) Freshness & Drift Elimination (Critical)
Your current risk: stored score can be stale vs formula recompute.

### Freshness rule
ScoreSummary is considered **stale** if:
- `profileUpdatedAt` > `scoreSummary.computedAt`, OR
- any tracked signal timestamp > `scoreSummary.computedAt`

### Required timestamps
Ensure user doc has at least:
- `profileUpdatedAt` (updated on any profile write)
- `lastSignalAt` (updated on responsiveness/quality signal writes)

Store these in `scoreSummary.diagnostics` for debugging.

### Stale guard behavior
If stale:
- recompute immediately (server-side) and overwrite `scoreSummary`.

---

## 7) Recompute Triggers (Single Strategy)
### Preferred: server-side recompute on meaningful events
Implement Cloud Functions triggers (or your existing pipeline) that call canonical compute:

1) **On user profile writes** (fields that affect completeness)
- Trigger: Firestore `users/{uid}` onWrite
- Guard: only recompute when relevant fields changed (avoid infinite loops by ignoring writes to `scoreSummary` itself)

2) **On message/offer response events** (responsiveness)
- Trigger on `messageEvents/{eventId}` or existing logs collection

3) **On assignment lifecycle events** (quality)
- Offered, accepted, completed, no-show, late cancel

**Hard rule:** Only one function writes `scoreSummary` to prevent competing updates.

### Optional: manual “Refresh score” (temporary)
Until all triggers are live, you may add an admin-only “Refresh score” button that calls a callable function to recompute. Mark as temporary.

---

## 8) Prevent Loops (Firestore onWrite Safety)
When using `users/{uid}` triggers:
- If the only changed field is `scoreSummary`, exit.
- Use a field mask / diff to detect relevant changes.
- Consider writing `scoreSummary` with `merge: true` while preserving other fields.

---

## 9) Migration Plan (Legacy → scoreSummary v1.0)
### Step 1: Read adapter everywhere
- Use `getUserScore(userDoc)` so nothing breaks.

### Step 2: Backfill job (one-time)
- Script or function to compute and write `scoreSummary` for existing users.

### Step 3: Deprecate legacy fields
- Once all UIs use `scoreSummary.aiScore`, stop writing legacy primitive fields.

---

## 10) Tests & Smoke Verification (Must Have)
### Unit tests (recommended)
- `computeCompletenessScore()` with fixture users
- `computeResponsivenessScore()` with fixture signals
- `computeQualityScore()` with fixture histories
- `computeScoreSummaryV1()` end-to-end fixtures

### Smoke script (minimum)
A script that:
1) Loads a user
2) Computes scoreSummary
3) Writes it
4) Reads it back
5) Asserts stored equals computed and `computedAt` updates

Also verify:
- Editing a completeness field causes recompute
- Stale guard triggers if `profileUpdatedAt` > `computedAt`

---

## 11) UI Rules (Worker vs Admin)
### Worker: `/c1/workers/profile`
- Displays “Hiring Score” from `scoreSummary.aiScore`
- Progress bar reflects that value
- Unlock prompts come from `scoreSummary.explainability.nextActions` (fallback ok)

### Admin: Score tab
- Displays “AI Score” from the same `scoreSummary.aiScore`
- Shows components + weights + computedAt
- Shows explainability (missingFields/nextActions) for transparency

---

## 12) Near-Term Decisions (v1.0 Defaults)
To keep the system fair and “sound” now:
- Completeness is checklist-driven and explicit.
- Responsiveness baseline = 50 if no opportunities yet.
- Quality baseline = 50 for new applicants.
- Heavy negative signal for no-shows.
- Score is versioned and recomputed deterministically.

---

# Cursor Implementation Checklist (Do These In Order)
1) Create canonical scorer module `computeScoreSummaryV1()` (server) + shared types.
2) Implement recompute trigger(s) and stale guard; ensure no infinite loops.
3) Extend stored shape to include explainability payload.
4) Update worker prompts to prefer stored nextActions.
5) Update admin score view to read the same `scoreSummary` fields (adapter ok).
6) Add smoke test to prove computed == stored after profile edits.
7) Backfill existing users to populate `scoreSummary`.

---

# Deliverables Expected From Cursor
- File locations of existing scoring code + final consolidated module(s)
- Final `ScoreSummaryV1` type and where it’s stored
- Trigger strategy implemented + loop guards
- Evidence: a test or script showing deterministic compute and no drift
- Notes on any ambiguous fields and how they were mapped into Completeness/Responsiveness/Quality
