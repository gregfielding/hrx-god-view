# HRX — User Scoring + Reviews Spec (Recruiter Interviews, Star Reviews, AI Score)

**Status:** Draft spec for Cursor implementation

## 0) Problem statement
You need **three distinct scoring systems** on a User record:

1. **Recruiter Interview Score** (0–10): created by internal recruiters; multiple interviews per user; aggregate should **average** (with optional weighting).
2. **Reviews** (1–5 stars + notes): created by internal team now, and optionally **clients** later; these should be separate from interviews and designed with “best practices” (immutability, attribution, moderation).
3. **AI Score** (0–100): already shown on the Users table; should measure:
   - **Profile completeness**
   - **Responsiveness** to messaging (SMS inbox / email / etc.)
   - **Interview** and **Review** scoring

This spec defines data models, formulas, UI components (React + MUI), and Firestore schema + security rules.

---

## 1) Definitions

### 1.1 Score types
- **InterviewScore (0–10):** numeric slider entered by recruiter at end of interview.
- **ReviewStars (1–5):** star rating + short/long note, optionally tied to an assignment/job.
- **AIScore (0–100):** computed, not directly editable by humans.

### 1.2 Canonical display
- Users table: show **AI Score** as primary pill (existing).
- User detail page: show a compact **Score Stack**:
  - AI Score (0–100)
  - Interview Avg (0–10)
  - Review Avg (1–5)

---

## 2) Firestore schema

> Assumes your existing tenant-based structure: `/tenants/{tenantId}/...`

### 2.1 User document additions
Path: `/tenants/{tenantId}/users/{userId}`

Add fields:
```ts
// stored on the user doc for fast list rendering (denormalized)
scoreSummary?: {
  aiScore?: number;                // 0..100
  aiScoreUpdatedAt?: Timestamp;

  interviewAvg?: number;           // 0..10 (1 decimal)
  interviewCount?: number;
  interviewLastAt?: Timestamp;

  reviewAvg?: number;              // 1..5 (1 decimal)
  reviewCount?: number;
  reviewLastAt?: Timestamp;

  responsivenessScore?: number;    // 0..100
  completenessScore?: number;      // 0..100
  qualityScore?: number;           // 0..100 (from interviews+reviews)

  // optional: debug weights used for AI score
  aiWeights?: {
    completeness: number;
    responsiveness: number;
    quality: number;
  };
};

// optional: configurable per tenant
scoringConfigRef?: {
  configId: string; // e.g. 'default'
};
```

### 2.2 Interviews
Path: `/tenants/{tenantId}/users/{userId}/interviews/{interviewId}`

```ts
export type InterviewRecord = {
  createdAt: Timestamp;
  createdByUid: string;            // recruiter UID
  createdByName?: string;          // denormalized for UI

  // optionally link to job/order/assignment
  jobId?: string;
  assignmentId?: string;
  companyId?: string;

  // form content
  questions?: Array<{ question: string; answer: string; }>;
  notes?: string;

  // scoring
  score10: number;                 // 0..10
  scoreLabel?: string;             // optional (e.g., 'Strong', 'OK')

  // safety
  isArchived?: boolean;
  updatedAt?: Timestamp;
  updatedByUid?: string;
};
```

### 2.3 Reviews
Path: `/tenants/{tenantId}/users/{userId}/reviews/{reviewId}`

```ts
export type UserReview = {
  createdAt: Timestamp;
  createdByUid: string;
  createdByName?: string;

  // source
  reviewerType: 'internal' | 'client';
  clientId?: string;               // if reviewerType='client'
  clientUserId?: string;           // user id in client portal

  // scope
  companyId?: string;              // who the worker worked for
  assignmentId?: string;           // tie to a shift/job assignment
  jobId?: string;

  // rating
  stars5: number;                  // 1..5

  // text
  title?: string;                  // optional short title
  note?: string;                   // recommended 1-3 sentences
  privateNote?: string;            // internal-only (never shown to worker/client)

  // moderation
  visibility: 'internal' | 'shared_with_client' | 'worker_visible';
  status: 'active' | 'flagged' | 'removed';
  removedAt?: Timestamp;
  removedByUid?: string;
  removalReason?: string;

  updatedAt?: Timestamp;
  updatedByUid?: string;
};
```

### 2.4 (Optional) Scoring config per tenant
Path: `/tenants/{tenantId}/scoringConfigs/{configId}`

```ts
export type ScoringConfig = {
  updatedAt: Timestamp;
  updatedByUid: string;

  // AI score weights (must sum to 1.0)
  weights: {
    completeness: number;          // default 0.45
    responsiveness: number;        // default 0.25
    quality: number;               // default 0.30
  };

  // quality subweights
  qualityWeights: {
    interview: number;             // default 0.60
    review: number;                // default 0.40
  };

  // completeness fields and points
  completenessRubric: Array<{
    key: string;                   // e.g. 'hasPhoneVerified'
    label: string;
    points: number;                // e.g. 10
  }>;

  // responsiveness rubric
  responsivenessRubric: {
    // time windows in hours and point impacts
    replyWithin1h: number;         // e.g. +25
    replyWithin4h: number;         // e.g. +18
    replyWithin24h: number;        // e.g. +10
    replyOver24h: number;          // e.g. +2
    noReply: number;               // e.g. 0

    // penalties
    stopOptOutPenalty: number;     // e.g. -30
    bouncePenalty: number;         // e.g. -20
  };
};
```

---

## 3) Score calculations

### 3.1 Interview aggregate
Default:
- `interviewAvg = average(score10)` across `interviews` where `isArchived != true`.
- Round to **1 decimal** for display.

Optional future enhancement:
- Weight by recency: `weight = 1 / (1 + ageDays/30)`.

### 3.2 Review aggregate
Default:
- `reviewAvg = average(stars5)` across reviews where `status == 'active'`.
- Optionally only include `reviewerType=='internal'` for internal-only views.

### 3.3 Completeness score (0–100)
Rubric-based.

Example rubric (edit as needed):
- Has verified phone: 15
- Has email: 5
- Has address/city/state: 10
- Has DOB: 5
- Has emergency contact: 10
- Has transportation answer: 10
- Has at least 1 skill tag: 10
- Has at least 1 group / placement target: 5
- Has at least 1 application completed: 10
- Has at least 1 interview: 10
- Has onboarding started: 10

`completenessScore = clamp(0..100, sum(points for satisfied items))`

### 3.4 Responsiveness score (0–100)
Derived from messaging data (SMS threads + future channels).

MVP rules:
- Compute last **N** inbound messages requiring response (e.g. last 20 inbound messages from user).
- Measure time-to-first-response from HRX (or assigned recruiter) to that inbound.
- Score each interaction based on SLA buckets, then average.

Example SLA buckets (configurable):
- reply <= 1h: 100
- reply <= 4h: 80
- reply <= 24h: 60
- reply > 24h: 30
- no reply after 72h: 0

Penalties:
- If user opted out of SMS (STOP): apply `stopOptOutPenalty` to responsiveness, but do not go below 0.
- If email bounces or phone invalid: apply penalty.

### 3.5 Quality score (0–100)
Blend interviews + reviews:

Convert to 0–100 scales:
- `interviewScore100 = (interviewAvg / 10) * 100`
- `reviewScore100 = ((reviewAvg - 1) / 4) * 100`  (maps 1..5 to 0..100)

Then:
`qualityScore = interviewWeight * interviewScore100 + reviewWeight * reviewScore100`

### 3.6 AI Score (0–100)
`aiScore = wCompleteness * completenessScore + wResponsiveness * responsivenessScore + wQuality * qualityScore`

Defaults:
- completeness 0.45
- responsiveness 0.25
- quality 0.30

Clamp and round:
- Store as integer for table display (rounded).
- Show one decimal optionally in detail view.

---

## 4) Write paths and recompute strategy

### 4.1 Denormalized summary updates
Whenever `interviews/*` or `reviews/*` change, update `users/{userId}.scoreSummary`.

Two safe patterns:

**Pattern A (Cloud Function triggers):**
- onWrite interviews
- onWrite reviews
- onWrite messaging events affecting responsiveness
- onWrite user profile changes affecting completeness

Each trigger calls `recomputeUserScores(tenantId, userId)`.

**Pattern B (Scheduled batched recompute):**
- daily job recomputes all users who had activity in last 24h

Recommended: **Pattern A + daily backstop**.

### 4.2 recomputeUserScores()
Pseudo:
- Load scoringConfig (default if missing)
- Query interviews (active)
- Query reviews (active)
- Compute interviewAvg, reviewAvg
- Compute completenessScore from user doc
- Compute responsivenessScore from smsThreads/messages (or messageLogs)
- Compute qualityScore, aiScore
- Write scoreSummary on user doc

Performance:
- Keep computed arrays small (limit N for responsiveness)
- Use Firestore aggregates later if needed

---

## 5) UI spec (React + MUI)

### 5.1 Users table
Existing: show AI Score pill.

Enhancements:
- Tooltip on AI Score pill: show breakdown
  - Completeness: X
  - Responsiveness: Y
  - Quality: Z
  - Interview Avg: A/10
  - Reviews: B/5

MUI components:
- `Chip` for AI score
- `Tooltip` + `Stack`

### 5.2 User Details header — Score Stack
Add a compact score area near the top (right side of header row).

Wireframe:
```
[Avatar] Name  (actions)
City, State • Created date
Onboarding %

AI Score: [ 87 ]   Interview Avg: [ 7.5/10 ]   Reviews: [ ★★★★☆ 4.2 ]
```

Components:
- AI: `Chip` (filled)
- Interview avg: `Chip` (outlined)
- Review avg: `Rating` + small text

### 5.3 Interview tab
You already have an interview form with a slider.

Required changes:
- Save interview as `InterviewRecord` in subcollection.
- Allow **multiple interviews**.
- Interview History list shows:
  - createdAt, recruiter name
  - score10
  - expand to show Q/A and notes

Use MUI:
- `Accordion`, `AccordionSummary`, `AccordionDetails`
- `Slider` (0–10)
- `Button` “Submit Interview”

### 5.4 Reviews tab (NEW)
Add a new tab: **Reviews** (between Notes and Messages, or near Activity Log).

#### 5.4.1 Reviews list
Each review card shows:
- Reviewer name + badge (Internal/Client)
- Timestamp
- `Rating` stars (read-only)
- Title + note
- Visibility pill (Internal / Shared / Worker Visible)
- Optional linked assignment/company chip

MUI:
- `Card`, `CardHeader`, `CardContent`
- `Rating` (MUI)
- `Chip` for visibility
- `IconButton` (flag/remove)

#### 5.4.2 Create review modal
Button: **+ Add Review**

Fields:
- Stars (required)
- Title (optional)
- Note (recommended)
- Visibility (default: internal)
- Private note (internal-only)
- Link assignment/company (optional)

Best practices:
- Reviews should be **append-only** by default.
- Allow editing for a short window (e.g., 15 minutes) or by admin.
- “Remove” should soft-delete (`status='removed'`) with reason.

Icons:
- Stars: `Rating`
- Remove: `DeleteOutline`
- Flag: `FlagOutlined`
- Edit: `EditOutlined`

### 5.5 Summary widget inside “Overview” card
In the Overview tab, add a “Scoring” section showing breakdown bars.

Wireframe:
```
Scoring
AI Score: 87
Completeness: [██████████      ] 92
Responsiveness: [███████         ] 70
Quality: [████████          ] 80
- Interviews: 7.5/10 (4)
- Reviews: 4.2/5 (3)
```

MUI:
- `LinearProgress` with labels (custom)
- `Stack` for layout

---

## 6) Messaging integration hooks (for responsiveness)

### 6.1 Data needed
From your SMS system:
- thread + message timestamps
- direction inbound/outbound
- association to user (participant)

If the participant normalization exists (from your SMS work):
- Use `participant.type=='user'` and `participant.id==userId`

### 6.2 Responsiveness computation (MVP)
- For each inbound message from user, find first outbound message after it (same thread).
- Compute minutes to respond.
- Score based on bucket.

Edge cases:
- If outbound was automated (source=automation), optionally count as a response or partial response.
- If inbound is STOP/HELP, don’t treat as requiring response.

---

## 7) API endpoints (Cloud Functions)

### 7.1 Create/update interview
- `POST /api/users/:userId/interviews`
  - body: `{ score10, questions[], notes, jobId?, assignmentId?, companyId? }`
  - writes interview doc
  - triggers recompute

### 7.2 Create review
- `POST /api/users/:userId/reviews`
  - body: `{ stars5, title?, note?, privateNote?, visibility, companyId?, assignmentId?, jobId? }`

### 7.3 Moderate review (admin)
- `POST /api/users/:userId/reviews/:reviewId/moderate`
  - body: `{ action: 'flag'|'remove'|'restore', reason? }`

### 7.4 Recompute scores
- `POST /api/users/:userId/recomputeScores`
  - admin-only
  - calls `recomputeUserScores()`

---

## 8) Security rules

### 8.1 Assumptions
- Internal access requires tenant membership and security level.
- Clients (future) will have limited access.

### 8.2 Proposed rules (internal MVP)
- Interviews:
  - Read: internal securityLevel >= 5
  - Write: internal securityLevel >= 5
- Reviews:
  - Read: internal securityLevel >= 5
  - Write internal reviews: internal securityLevel >= 5
  - Write client reviews: only client portal users with explicit permission (future)
- scoreSummary on user doc:
  - Write: server only (recommended)

Example (pseudo rules):
```js
match /tenants/{tenantId}/users/{userId} {
  allow read: if isInternal(tenantId, 5);
  allow update: if isInternal(tenantId, 5) && !('scoreSummary' in request.resource.data.diff(resource.data).changedKeys());
}

match /tenants/{tenantId}/users/{userId}/interviews/{interviewId} {
  allow read: if isInternal(tenantId, 5);
  allow create, update: if isInternal(tenantId, 5);
  allow delete: if isInternal(tenantId, 6);
}

match /tenants/{tenantId}/users/{userId}/reviews/{reviewId} {
  allow read: if isInternal(tenantId, 5);
  allow create: if isInternal(tenantId, 5);
  allow update: if isInternal(tenantId, 6); // moderation
  allow delete: if false; // use soft-delete
}
```

---

## 9) Indexes
Likely queries:
- list interviews by createdAt desc
- list reviews by createdAt desc

Indexes (if needed):
- `users/{userId}/interviews` orderBy `createdAt`
- `users/{userId}/reviews` orderBy `createdAt`

---

## 10) Implementation checklist (Cursor)

### Phase 1 — Data + UI foundations
- [ ] Add `scoreSummary` to user type + UI read rendering
- [ ] Update Interview save path to create docs under `/interviews`
- [ ] Add Interview History list (Accordion)
- [ ] Create Reviews tab + Review list + Create modal
- [ ] Create server functions for create interview/review (or direct Firestore writes with rules)

### Phase 2 — Score computation
- [ ] Implement `recomputeUserScores(tenantId, userId)` Cloud Function
- [ ] Triggers: onWrite interview/review/user
- [ ] Compute and write `scoreSummary`
- [ ] Add tooltip breakdown in Users table

### Phase 3 — Responsiveness scoring
- [ ] Implement responsiveness computation using SMS thread/message data
- [ ] Add messaging triggers to recompute when new inbound/outbound arrives

### Phase 4 — Client portal readiness
- [ ] Add client reviewer roles
- [ ] Implement visibility enforcement and moderation workflows

---

## 11) UX copy guidelines
- Avoid “AI Score is the truth.” Present as **signal**.
- Provide transparency: show breakdown and why score is what it is.
- Never show private/internal notes to workers or clients.

---

## 12) Open questions (leave as TODOs)
- Should interviews be limited per week or per assignment?
- Should review edits be allowed? If yes, for how long?
- Do we want separate review averages for internal vs client?
- Responsiveness: do automated replies count as response?

